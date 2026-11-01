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
exports.PanelManager = void 0;
const node_crypto_1 = require("node:crypto");
const vscode = __importStar(require("vscode"));
const draft_1 = require("../http/draft");
const send_1 = require("../http/send");
const store_1 = require("../projects/store");
const messages_1 = require("../shared/messages");
class PanelManager {
    context;
    store;
    environments;
    saved;
    history;
    panels = new Map();
    subscriptions;
    constructor(context, store, environments, saved, history) {
        this.context = context;
        this.store = store;
        this.environments = environments;
        this.saved = saved;
        this.history = history;
        this.subscriptions = [
            environments.onDidChange(() => void this.broadcastEnv()),
            store.onDidChange(() => void this.refreshOverviews()),
        ];
    }
    dispose() {
        vscode.Disposable.from(...this.subscriptions).dispose();
        for (const open of this.panels.values()) {
            open.panel.dispose();
        }
    }
    openProject(projectId) {
        const project = this.store.get(projectId);
        if (!project) {
            return;
        }
        this.open(`project:${projectId}`, (0, store_1.displayName)(project), {
            projectId,
            view: async () => {
                const current = this.store.get(projectId);
                return current && { kind: "overview", project: current };
            },
        });
    }
    openEndpoint(projectId, endpointId) {
        const project = this.store.get(projectId);
        const endpoint = this.store.getEndpoint(projectId, endpointId);
        if (!project || !endpoint) {
            return;
        }
        const saveKey = `${(0, store_1.displayName)(project)}::${endpoint.id}`;
        this.open(`endpoint:${projectId}:${endpointId}`, endpoint.id, {
            request: {
                projectId,
                endpointId,
                saveKey,
                title: (0, store_1.displayName)(project),
            },
            view: () => this.requestView(project, endpoint, saveKey),
        });
    }
    /** A request that is not tied to a spec, such as one for a detected port. */
    openDraft(key, title, draft, projectId, endpointId) {
        this.open(`draft:${key}`, title, {
            request: { projectId, endpointId, title },
            view: async () => {
                const project = projectId ? this.store.get(projectId) : undefined;
                return {
                    kind: "request",
                    breadcrumb: [title],
                    draft,
                    endpoint: endpointId
                        ? this.store.getEndpoint(projectId ?? "", endpointId)
                        : undefined,
                    baseUrl: project && baseUrlOf(project),
                    live: !!project?.liveUrl,
                    canSave: false,
                    saved: false,
                };
            },
        });
    }
    openBlank(url = "") {
        this.openDraft(crypto.randomUUID(), "New Request", (0, draft_1.emptyDraft)(url));
    }
    openEnvironments(projectId) {
        const project = projectId ? this.store.get(projectId) : undefined;
        const name = project && (0, store_1.displayName)(project);
        this.open(`environments:${project?.id ?? ""}`, name ? `Environments: ${name}` : "Environments", {
            envProjectId: project?.id,
            view: async () => ({
                kind: "environments",
                projectName: name,
                environments: await this.environments.list(name),
            }),
        });
    }
    panelProjectId(open) {
        return open.request?.projectId ?? open.projectId ?? open.envProjectId;
    }
    /** Environments belong to the panel's project, identified by its API title. */
    scope(open) {
        const id = this.panelProjectId(open);
        const project = id ? this.store.get(id) : undefined;
        return project && (0, store_1.displayName)(project);
    }
    async requestView(project, endpoint, saveKey) {
        const stored = await this.saved.get(saveKey);
        const collection = project.spec?.collections.find((item) => item.endpoints.includes(endpoint));
        const current = this.store.get(project.id) ?? project;
        return {
            kind: "request",
            breadcrumb: [(0, store_1.displayName)(project), collection?.name ?? ""].filter(Boolean),
            draft: stored ?? (0, draft_1.draftFromEndpoint)(endpoint),
            endpoint,
            baseUrl: baseUrlOf(current),
            live: !!current.liveUrl,
            canSave: true,
            saved: !!stored,
        };
    }
    open(key, title, options) {
        const existing = this.panels.get(key);
        if (existing) {
            existing.panel.reveal();
            return;
        }
        const distUri = vscode.Uri.joinPath(this.context.extensionUri, "dist");
        const panel = vscode.window.createWebviewPanel("locall.panel", title, vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [distUri],
        });
        panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "icon.svg");
        panel.webview.html = pageHtml(panel.webview, distUri);
        const open = { panel, ...options };
        this.panels.set(key, open);
        const listener = panel.webview.onDidReceiveMessage((raw) => {
            const message = (0, messages_1.parseWebviewMessage)(raw);
            if (message) {
                this.handle(open, message).catch((error) => {
                    void vscode.window.showErrorMessage(`Locall: ${error instanceof Error ? error.message : String(error)}`);
                });
            }
        });
        panel.onDidDispose(() => {
            open.abort?.abort();
            listener.dispose();
            this.panels.delete(key);
        });
    }
    post(open, message) {
        void open.panel.webview.postMessage(message);
    }
    async init(open) {
        const view = await open.view();
        if (view) {
            this.post(open, {
                type: "init",
                view,
                env: await this.environments.state(this.scope(open)),
            });
        }
    }
    async variables(open) {
        const projectId = open.request?.projectId;
        const project = projectId ? this.store.get(projectId) : undefined;
        const baseUrl = project && baseUrlOf(project);
        // The active environment can override the spec's base URL.
        return {
            ...(baseUrl ? { baseUrl } : {}),
            ...(await this.environments.activeVariables(this.scope(open))),
        };
    }
    async handle(open, message) {
        switch (message.type) {
            case "ready":
                await this.init(open);
                break;
            case "send":
                await this.send(open, message.draft);
                break;
            case "cancel":
                open.abort?.abort();
                break;
            case "save":
                if (open.request?.saveKey) {
                    await this.saved.set(open.request.saveKey, message.draft);
                    this.post(open, { type: "savedState", saved: true });
                }
                break;
            case "reset": {
                const { projectId, endpointId, saveKey } = open.request ?? {};
                const endpoint = projectId && endpointId
                    ? this.store.getEndpoint(projectId, endpointId)
                    : undefined;
                if (endpoint && saveKey) {
                    await this.saved.remove(saveKey);
                    this.post(open, { type: "draft", draft: (0, draft_1.draftFromEndpoint)(endpoint) });
                    this.post(open, { type: "savedState", saved: false });
                }
                break;
            }
            case "copyCurl": {
                const built = (0, send_1.buildRequest)(message.draft, await this.variables(open));
                if (built.ok) {
                    await vscode.env.clipboard.writeText((0, send_1.toCurl)(built.request));
                    void vscode.window.setStatusBarMessage("Copied as cURL", 2000);
                }
                else {
                    void vscode.window.showWarningMessage(built.error);
                }
                break;
            }
            case "setEnv":
                await this.environments.setActive(this.scope(open), message.name);
                break;
            case "manageEnvs":
                this.openEnvironments(this.panelProjectId(open));
                break;
            case "openEndpoint":
                if (open.projectId) {
                    this.openEndpoint(open.projectId, message.endpointId);
                }
                break;
            case "saveEnvs":
                await this.environments.save(this.scope(open), message.environments);
                void vscode.window.setStatusBarMessage("Environments saved", 2000);
                await this.init(open);
                break;
        }
    }
    async send(open, draft) {
        open.abort?.abort();
        const abort = new AbortController();
        open.abort = abort;
        this.post(open, { type: "sending" });
        const built = (0, send_1.buildRequest)(draft, await this.variables(open));
        const response = built.ok
            ? await (0, send_1.sendRequest)(built.request, abort.signal)
            : {
                ok: false,
                headers: [],
                body: "",
                durationMs: 0,
                sizeBytes: 0,
                truncated: false,
                binary: false,
                error: built.error,
            };
        if (open.abort !== abort) {
            return; // A newer send replaced this one.
        }
        open.abort = undefined;
        this.post(open, { type: "response", response });
        if (built.ok) {
            this.history.add({
                title: open.request?.title ?? "Request",
                projectId: open.request?.projectId,
                endpointId: open.request?.endpointId,
                draft,
                status: response.status,
                error: response.error,
                durationMs: response.durationMs,
            });
        }
    }
    async broadcastEnv() {
        for (const open of this.panels.values()) {
            this.post(open, {
                type: "env",
                env: await this.environments.state(this.scope(open)),
            });
        }
    }
    async refreshOverviews() {
        for (const open of this.panels.values()) {
            if (open.projectId) {
                await this.init(open);
            }
        }
    }
}
exports.PanelManager = PanelManager;
function baseUrlOf(project) {
    return project.liveUrl ?? project.spec?.servers[0];
}
function pageHtml(webview, distUri) {
    const nonce = (0, node_crypto_1.randomBytes)(16).toString("base64");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "webview.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "webview.css"));
    const csp = [
        "default-src 'none'",
        `style-src ${webview.cspSource}`,
        `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${style}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
//# sourceMappingURL=requestPanel.js.map