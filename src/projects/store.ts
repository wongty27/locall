import { createHash } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { fetchSpec, type DetectedServer } from "../detect/localhost";
import type { Endpoint, Project } from "../model";
import { isSpec, parseSpec } from "../openapi/parse";
import { readJson, writeJson } from "../storage/files";

const MANUAL_KEY = "locall.manualProjects";
const SPEC_GLOB = "**/{api,swagger,openapi}.json";
const EXCLUDE_GLOB = "**/{node_modules,.git,.locall}/**";
const MAX_DISCOVERED = 200;
const MAX_SPEC_BYTES = 50 * 1024 * 1024;

interface ManualEntry {
  kind: "file" | "localhost";
  location: string;
}

export class ProjectStore implements vscode.Disposable {
  private projects: Project[] = [];
  private detected: DetectedServer[] = [];
  private reloadCount = 0;
  private reloadTimer?: NodeJS.Timeout;
  private manualWatchers: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const watcher = vscode.workspace.createFileSystemWatcher(SPEC_GLOB);
    const schedule = () => this.scheduleReload();
    this.disposables.push(
      watcher,
      watcher.onDidCreate(schedule),
      watcher.onDidChange(schedule),
      watcher.onDidDelete(schedule),
      vscode.workspace.onDidChangeWorkspaceFolders(schedule),
    );
  }

  dispose() {
    clearTimeout(this.reloadTimer);
    vscode.Disposable.from(...this.disposables, ...this.manualWatchers).dispose();
  }

  list(): readonly Project[] {
    return this.projects.map((project) => this.withLive(project));
  }

  get(id: string): Project | undefined {
    const project = this.projects.find((item) => item.id === id);
    return project && this.withLive(project);
  }

  getEndpoint(projectId: string, endpointId: string): Endpoint | undefined {
    for (const collection of this.get(projectId)?.spec?.collections ?? []) {
      const endpoint = collection.endpoints.find(
        (item) => item.id === endpointId,
      );
      if (endpoint) {
        return endpoint;
      }
    }
    return undefined;
  }

  private withLive(project: Project): Project {
    const match = this.detected.find(
      (server) =>
        server.spec &&
        (server.spec.url === project.id ||
          (project.spec && server.spec.title === project.spec.title)),
    );
    return match?.spec
      ? { ...project, liveUrl: match.spec.baseUrl }
      : { ...project };
  }

  isAdded(specUrl: string): boolean {
    return this.manual().some((entry) => entry.location === specUrl);
  }

  /** Updates live badges, and reloads when a saved localhost server comes back. */
  setDetected(servers: DetectedServer[]): void {
    this.detected = servers;
    const recovered = this.projects.some(
      (project) =>
        project.source === "localhost" &&
        (project.stale || project.error) &&
        servers.some((server) => server.spec?.url === project.id),
    );
    if (recovered) {
      void this.reload();
    } else {
      this.changed.fire();
    }
  }

  private manual(): ManualEntry[] {
    return this.context.globalState.get<ManualEntry[]>(MANUAL_KEY, []);
  }

  async addFile(file: vscode.Uri): Promise<void> {
    await this.addManual({ kind: "file", location: file.fsPath });
  }

  async addLocalhost(specUrl: string): Promise<void> {
    await this.addManual({ kind: "localhost", location: specUrl });
  }

  private async addManual(entry: ManualEntry) {
    const manual = this.manual();
    if (!manual.some((item) => item.location === entry.location)) {
      await this.context.globalState.update(MANUAL_KEY, [...manual, entry]);
    }
    await this.reload();
  }

  async remove(id: string): Promise<void> {
    await this.context.globalState.update(
      MANUAL_KEY,
      this.manual().filter((entry) => entry.location !== id),
    );
    await this.reload();
  }

  private scheduleReload() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => void this.reload(), 300);
  }

  async reload(): Promise<void> {
    const run = ++this.reloadCount;
    const manual = this.manual();
    const discovered = await vscode.workspace.findFiles(
      SPEC_GLOB,
      EXCLUDE_GLOB,
      MAX_DISCOVERED,
    );
    const manualPaths = new Set(manual.map((entry) => entry.location));
    const results = await Promise.all([
      ...discovered
        .filter((uri) => !manualPaths.has(uri.fsPath))
        .map((uri) => this.loadFile(uri, "workspace")),
      ...manual.map((entry) =>
        entry.kind === "file"
          ? this.loadFile(vscode.Uri.file(entry.location), "file")
          : this.loadLocalhost(entry.location),
      ),
    ]);
    if (run !== this.reloadCount) {
      return; // A newer reload has started, and its result will be used.
    }
    this.projects = results
      .filter((project) => project !== undefined)
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
    this.watchManualFiles(manual);
    this.changed.fire();
  }

  private watchManualFiles(manual: ManualEntry[]) {
    vscode.Disposable.from(...this.manualWatchers).dispose();
    this.manualWatchers = manual
      .filter((entry) => entry.kind === "file")
      .map((entry) => {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(
            vscode.Uri.file(path.dirname(entry.location)),
            path.basename(entry.location),
          ),
        );
        const schedule = () => this.scheduleReload();
        watcher.onDidChange(schedule);
        watcher.onDidCreate(schedule);
        watcher.onDidDelete(schedule);
        return watcher;
      });
  }

  private async loadFile(
    uri: vscode.Uri,
    source: "workspace" | "file",
  ): Promise<Project | undefined> {
    const base: Project = {
      id: uri.fsPath,
      source,
      location: uri.fsPath,
      folder: vscode.workspace.getWorkspaceFolder(uri)?.name,
    };
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > MAX_SPEC_BYTES) {
        return { ...base, error: "Spec is larger than 50 MB." };
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      const doc: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!isSpec(doc)) {
        // An auto-discovered api.json can be an unrelated file, so skip it quietly.
        return source === "workspace"
          ? undefined
          : { ...base, error: "Not a Swagger or OpenAPI document." };
      }
      return { ...base, spec: parseSpec(doc) };
    } catch (error) {
      return { ...base, error: errorText(error) };
    }
  }

  private cacheFile(specUrl: string) {
    const name = createHash("sha256").update(specUrl).digest("hex");
    return vscode.Uri.joinPath(
      this.context.globalStorageUri,
      "specs",
      `${name}.json`,
    );
  }

  private async loadLocalhost(specUrl: string): Promise<Project> {
    const base: Project = {
      id: specUrl,
      source: "localhost",
      location: specUrl,
    };
    try {
      const doc = await fetchSpec(specUrl);
      await writeJson(this.cacheFile(specUrl), doc);
      return { ...base, spec: parseSpec(doc, specUrl) };
    } catch (error) {
      const cached = await readJson<unknown>(this.cacheFile(specUrl));
      return isSpec(cached)
        ? { ...base, spec: parseSpec(cached, specUrl), stale: true }
        : { ...base, error: errorText(error) };
    }
  }
}

export function displayName(project: Project): string {
  return project.spec?.title ?? path.basename(project.location);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
