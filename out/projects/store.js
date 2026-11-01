"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectStore = void 0;
exports.displayName = displayName;
const node_crypto_1 = require("node:crypto");
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const localhost_1 = require("../detect/localhost");
const parse_1 = require("../openapi/parse");
const files_1 = require("../storage/files");
const MANUAL_KEY = "locall.manualProjects";
const SPEC_GLOB = "**/{api,swagger,openapi}.json";
const EXCLUDE_GLOB = "**/{node_modules,.git,.locall}/**";
const MAX_DISCOVERED = 200;
const MAX_SPEC_BYTES = 50 * 1024 * 1024;
class ProjectStore {
    context;
    projects = [];
    detected = [];
    reloadCount = 0;
    reloadTimer;
    manualWatchers = [];
    disposables = [];
    changed = new vscode.EventEmitter();
    onDidChange = this.changed.event;
    constructor(context) {
        this.context = context;
        const watcher = vscode.workspace.createFileSystemWatcher(SPEC_GLOB);
        const schedule = () => this.scheduleReload();
        this.disposables.push(watcher, watcher.onDidCreate(schedule), watcher.onDidChange(schedule), watcher.onDidDelete(schedule), vscode.workspace.onDidChangeWorkspaceFolders(schedule));
    }
    dispose() {
        clearTimeout(this.reloadTimer);
        vscode.Disposable.from(...this.disposables, ...this.manualWatchers).dispose();
    }
    list() {
        return this.projects.map((project) => this.withLive(project));
    }
    get(id) {
        const project = this.projects.find((item) => item.id === id);
        return project && this.withLive(project);
    }
    getEndpoint(projectId, endpointId) {
        for (const collection of this.get(projectId)?.spec?.collections ?? []) {
            const endpoint = collection.endpoints.find((item) => item.id === endpointId);
            if (endpoint) {
                return endpoint;
            }
        }
        return undefined;
    }
    withLive(project) {
        const match = this.detected.find((server) => server.spec &&
            (server.spec.url === project.id ||
                (project.spec && server.spec.title === project.spec.title)));
        return match?.spec
            ? { ...project, liveUrl: match.spec.baseUrl }
            : { ...project };
    }
    isAdded(specUrl) {
        return this.manual().some((entry) => entry.location === specUrl);
    }
    /** Updates live badges, and reloads when a saved localhost server comes back. */
    setDetected(servers) {
        this.detected = servers;
        const recovered = this.projects.some((project) => project.source === "localhost" &&
            (project.stale || project.error) &&
            servers.some((server) => server.spec?.url === project.id));
        if (recovered) {
            void this.reload();
        }
        else {
            this.changed.fire();
        }
    }
    manual() {
        return this.context.globalState.get(MANUAL_KEY, []);
    }
    async addFile(file) {
        await this.addManual({ kind: "file", location: file.fsPath });
    }
    async addLocalhost(specUrl) {
        await this.addManual({ kind: "localhost", location: specUrl });
    }
    async addManual(entry) {
        const manual = this.manual();
        if (!manual.some((item) => item.location === entry.location)) {
            await this.context.globalState.update(MANUAL_KEY, [...manual, entry]);
        }
        await this.reload();
    }
    async remove(id) {
        await this.context.globalState.update(MANUAL_KEY, this.manual().filter((entry) => entry.location !== id));
        await this.reload();
    }
    scheduleReload() {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => void this.reload(), 300);
    }
    async reload() {
        const run = ++this.reloadCount;
        const manual = this.manual();
        const discovered = await vscode.workspace.findFiles(SPEC_GLOB, EXCLUDE_GLOB, MAX_DISCOVERED);
        const manualPaths = new Set(manual.map((entry) => entry.location));
        const results = await Promise.all([
            ...discovered
                .filter((uri) => !manualPaths.has(uri.fsPath))
                .map((uri) => this.loadFile(uri, "workspace")),
            ...manual.map((entry) => entry.kind === "file"
                ? this.loadFile(vscode.Uri.file(entry.location), "file")
                : this.loadLocalhost(entry.location)),
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
    watchManualFiles(manual) {
        vscode.Disposable.from(...this.manualWatchers).dispose();
        this.manualWatchers = manual
            .filter((entry) => entry.kind === "file")
            .map((entry) => {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(entry.location)), path.basename(entry.location)));
            const schedule = () => this.scheduleReload();
            watcher.onDidChange(schedule);
            watcher.onDidCreate(schedule);
            watcher.onDidDelete(schedule);
            return watcher;
        });
    }
    async loadFile(uri, source) {
        const base = {
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
            const doc = JSON.parse(new TextDecoder().decode(bytes));
            if (!(0, parse_1.isSpec)(doc)) {
                // An auto-discovered api.json can be an unrelated file, so skip it quietly.
                return source === "workspace"
                    ? undefined
                    : { ...base, error: "Not a Swagger or OpenAPI document." };
            }
            return { ...base, spec: (0, parse_1.parseSpec)(doc) };
        }
        catch (error) {
            return { ...base, error: errorText(error) };
        }
    }
    cacheFile(specUrl) {
        const name = (0, node_crypto_1.createHash)("sha256").update(specUrl).digest("hex");
        return vscode.Uri.joinPath(this.context.globalStorageUri, "specs", `${name}.json`);
    }
    async loadLocalhost(specUrl) {
        const base = {
            id: specUrl,
            source: "localhost",
            location: specUrl,
        };
        try {
            const doc = await (0, localhost_1.fetchSpec)(specUrl);
            await (0, files_1.writeJson)(this.cacheFile(specUrl), doc);
            return { ...base, spec: (0, parse_1.parseSpec)(doc, specUrl) };
        }
        catch (error) {
            const cached = await (0, files_1.readJson)(this.cacheFile(specUrl));
            return (0, parse_1.isSpec)(cached)
                ? { ...base, spec: (0, parse_1.parseSpec)(cached, specUrl), stale: true }
                : { ...base, error: errorText(error) };
        }
    }
}
exports.ProjectStore = ProjectStore;
function displayName(project) {
    return project.spec?.title ?? path.basename(project.location);
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=store.js.map