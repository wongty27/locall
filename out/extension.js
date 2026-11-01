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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const requestPanel_1 = require("./panels/requestPanel");
const store_1 = require("./projects/store");
const environments_1 = require("./storage/environments");
const history_1 = require("./storage/history");
const saved_1 = require("./storage/saved");
const historyTree_1 = require("./views/historyTree");
const localhostTree_1 = require("./views/localhostTree");
const projectsTree_1 = require("./views/projectsTree");
function activate(context) {
    const store = new store_1.ProjectStore(context);
    const environments = new environments_1.EnvironmentStore(context);
    const saved = new saved_1.SavedRequests(context);
    const history = new history_1.HistoryStore(context);
    const panels = new requestPanel_1.PanelManager(context, store, environments, saved, history);
    const localhost = new localhostTree_1.LocalhostTree(store);
    const localhostView = vscode.window.createTreeView("locallLocalhost", {
        treeDataProvider: localhost,
    });
    localhost.setPolling(localhostView.visible);
    const command = (name, run) => vscode.commands.registerCommand(name, run);
    context.subscriptions.push(store, panels, localhost, localhostView, localhostView.onDidChangeVisibility(({ visible }) => localhost.setPolling(visible)), vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("locall.detection")) {
            localhost.setPolling(localhostView.visible);
            void localhost.refresh();
        }
    }), vscode.window.registerTreeDataProvider("locallProjects", new projectsTree_1.ProjectsTree(store)), vscode.window.registerTreeDataProvider("locallHistory", new historyTree_1.HistoryTree(history)), command("locall.addSpecFile", async () => {
        const files = await vscode.window.showOpenDialog({
            canSelectMany: true,
            filters: { "API spec": ["json"] },
            openLabel: "Add Spec",
        });
        for (const file of files ?? []) {
            await store.addFile(file);
        }
    }), command("locall.refreshProjects", () => store.reload()), command("locall.removeProject", async (node) => {
        if (node?.kind !== "project") {
            return;
        }
        const confirmed = await vscode.window.showWarningMessage(`Remove "${(0, store_1.displayName)(node.project)}" from Locall?`, {
            modal: true,
            detail: `The project will no longer be listed. This won't delete any files or stop any servers.\n\n${node.project.location}`,
        }, "Remove");
        if (confirmed === "Remove") {
            await store.remove(node.project.id);
        }
    }), command("locall.openProject", (projectId) => panels.openProject(projectId)), command("locall.openEndpoint", (projectId, endpointId) => panels.openEndpoint(projectId, endpointId)), command("locall.searchEndpoints", async () => {
        const items = store.list().flatMap((project) => (project.spec?.collections ?? []).flatMap((collection) => collection.endpoints.map((endpoint) => ({
            label: `${endpoint.method} ${endpoint.path}`,
            description: `${(0, store_1.displayName)(project)} › ${collection.name}`,
            detail: endpoint.summary,
            projectId: project.id,
            endpointId: endpoint.id,
        }))));
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: items.length
                ? "Search endpoints in all projects"
                : "No endpoints found. Add a Swagger or OpenAPI file first.",
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (picked) {
            panels.openEndpoint(picked.projectId, picked.endpointId);
        }
    }), command("locall.newRequest", () => panels.openBlank()), command("locall.manageEnvironments", async (node) => {
        if (node?.kind === "project") {
            panels.openEnvironments(node.project.id);
            return;
        }
        const picked = await vscode.window.showQuickPick([
            ...store.list().map((project) => ({
                label: (0, store_1.displayName)(project),
                description: project.folder,
                projectId: project.id,
            })),
            { label: "Requests without a project", description: undefined, projectId: undefined },
        ], { placeHolder: "Manage environments for which project?" });
        if (picked) {
            panels.openEnvironments(picked.projectId);
        }
    }), command("locall.refreshLocalhost", () => localhost.refresh()), command("locall.addDetected", async (server) => {
        if (server?.spec) {
            await store.addLocalhost(server.spec.url);
        }
    }), command("locall.openBlankRequest", (server) => {
        const specUrl = server?.spec?.url;
        if (specUrl && store.get(specUrl)) {
            panels.openProject(specUrl);
        }
        else {
            panels.openBlank(server ? `${server.origin}/` : "");
        }
    }), command("locall.openHistory", (id) => {
        const entry = history.get(id);
        if (entry) {
            panels.openDraft(id, `${entry.draft.method} ${entry.title}`, entry.draft, entry.projectId, entry.endpointId);
        }
    }), command("locall.clearHistory", () => history.clear()));
    void history.load();
    void store.reload();
    void localhost.refresh();
    return { store, environments };
}
function deactivate() { }
//# sourceMappingURL=extension.js.map