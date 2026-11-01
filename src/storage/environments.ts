import * as vscode from "vscode";
import type { Environment } from "../model";
import type { EnvironmentState } from "../shared/messages";
import { dataDir, readJson, writeJson } from "./files";

const ACTIVE_KEY = "locall.activeEnvironment";

/**
 * `environments` belongs to requests outside any project. `projects` is keyed
 * by API title, because file paths differ between machines and this file can
 * be committed.
 */
interface EnvironmentFile {
  environments?: Environment[];
  projects?: Record<string, Environment[]>;
}

/** The project an environment belongs to. Undefined means no project. */
export type EnvironmentScope = string | undefined;

export class EnvironmentStore {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get file() {
    return vscode.Uri.joinPath(dataDir(this.context), "environments.json");
  }

  private secretKey(scope: EnvironmentScope, environment: string, variable: string) {
    const dir = dataDir(this.context).toString();
    return scope === undefined
      ? `locall.env:${dir}:${environment}:${variable}`
      : `locall.env:${JSON.stringify([dir, scope, environment, variable])}`;
  }

  private activeKey(scope: EnvironmentScope) {
    return scope === undefined ? ACTIVE_KEY : `${ACTIVE_KEY}:${scope}`;
  }

  private async readFile(): Promise<EnvironmentFile> {
    const data = await readJson<EnvironmentFile>(this.file);
    return data !== null && typeof data === "object" ? data : {};
  }

  private fromFile(data: EnvironmentFile, scope: EnvironmentScope): Environment[] {
    const list =
      scope === undefined
        ? data.environments
        : data.projects && Object.hasOwn(data.projects, scope)
          ? data.projects[scope]
          : undefined;
    return Array.isArray(list) ? list : [];
  }

  /** Environments as stored on disk. Secret variables have empty values. */
  private async load(scope: EnvironmentScope): Promise<Environment[]> {
    return this.fromFile(await this.readFile(), scope);
  }

  async list(scope: EnvironmentScope): Promise<Environment[]> {
    const environments = await this.load(scope);
    for (const environment of environments) {
      for (const variable of environment.variables) {
        if (variable.secret) {
          variable.hasValue = !!(await this.context.secrets.get(
            this.secretKey(scope, environment.name, variable.key),
          ));
        }
      }
    }
    return environments;
  }

  async state(scope: EnvironmentScope): Promise<EnvironmentState> {
    const environments = await this.load(scope);
    const stored = this.context.workspaceState.get<string>(this.activeKey(scope));
    const current = environments.find((item) => item.name === stored);
    return {
      names: environments.map((item) => item.name),
      active: current?.name,
      baseUrl: current?.variables.find(
        (variable) => variable.key === "baseUrl" && !variable.secret,
      )?.value,
    };
  }

  async setActive(scope: EnvironmentScope, name: string | null): Promise<void> {
    await this.context.workspaceState.update(
      this.activeKey(scope),
      name ?? undefined,
    );
    this.changed.fire();
  }

  /** Values of the scope's active environment, including secrets. */
  async activeVariables(scope: EnvironmentScope): Promise<Record<string, string>> {
    const { active } = await this.state(scope);
    const environment = (await this.load(scope)).find(
      (item) => item.name === active,
    );
    const variables: Record<string, string> = {};
    for (const variable of environment?.variables ?? []) {
      if (!variable.key) {
        continue;
      }
      const value = variable.secret
        ? await this.context.secrets.get(
            this.secretKey(scope, environment!.name, variable.key),
          )
        : variable.value;
      if (value !== undefined) {
        variables[variable.key] = value;
      }
    }
    return variables;
  }

  /**
   * Saves editor contents for one scope and leaves the others untouched. A
   * blank secret field keeps the stored value, and secrets of removed
   * variables are deleted.
   */
  async save(scope: EnvironmentScope, environments: Environment[]): Promise<void> {
    const data = await this.readFile();
    const previous = this.fromFile(data, scope);
    const kept = new Set<string>();
    const stored: Environment[] = [];

    for (const environment of environments) {
      const name = environment.name.trim();
      if (!name) {
        continue;
      }
      const variables = [];
      for (const variable of environment.variables) {
        const key = variable.key.trim();
        if (!key) {
          continue;
        }
        if (variable.secret) {
          const secretKey = this.secretKey(scope, name, key);
          kept.add(secretKey);
          // A duplicate has no secret of its own yet, so it takes the source's.
          const value =
            variable.value ||
            (environment.copiedFrom === undefined
              ? undefined
              : await this.context.secrets.get(
                  this.secretKey(scope, environment.copiedFrom, key),
                ));
          if (value) {
            await this.context.secrets.store(secretKey, value);
          }
          variables.push({ key, value: "", secret: true });
        } else {
          variables.push({ key, value: variable.value, secret: false });
        }
      }
      stored.push({ name, variables });
    }

    for (const environment of previous) {
      for (const variable of environment.variables) {
        const secretKey = this.secretKey(scope, environment.name, variable.key);
        if (variable.secret && !kept.has(secretKey)) {
          await this.context.secrets.delete(secretKey);
        }
      }
    }

    await writeJson(
      this.file,
      scope === undefined
        ? { ...data, environments: stored }
        : {
            ...data,
            // fromEntries defines the key directly, so a title like
            // "__proto__" stays ordinary data.
            projects: {
              ...data.projects,
              ...Object.fromEntries([[scope, stored]]),
            },
          },
    );
    this.changed.fire();
  }
}
