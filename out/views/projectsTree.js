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
exports.ProjectsTree = void 0;
exports.methodIcon = methodIcon;
const vscode = __importStar(require("vscode"));
const store_1 = require("../projects/store");
const METHOD_COLORS = {
    GET: "charts.green",
    POST: "charts.yellow",
    PUT: "charts.blue",
    PATCH: "charts.purple",
    DELETE: "charts.red",
    HEAD: "charts.foreground",
    OPTIONS: "charts.foreground",
};
function methodIcon(method) {
    return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor(METHOD_COLORS[method]));
}
class ProjectsTree {
    store;
    changed = new vscode.EventEmitter();
    onDidChangeTreeData = this.changed.event;
    constructor(store) {
        this.store = store;
        store.onDidChange(() => this.changed.fire());
    }
    getChildren(node) {
        if (!node) {
            return this.store
                .list()
                .map((project) => ({ kind: "project", project }));
        }
        if (node.kind === "project") {
            return (node.project.spec?.collections ?? []).map((collection) => ({
                kind: "collection",
                project: node.project,
                collection,
            }));
        }
        if (node.kind === "collection") {
            return node.collection.endpoints.map((endpoint) => ({
                kind: "endpoint",
                project: node.project,
                endpoint,
            }));
        }
        return [];
    }
    getTreeItem(node) {
        if (node.kind === "project") {
            return projectItem(node.project);
        }
        if (node.kind === "collection") {
            const item = new vscode.TreeItem(node.collection.name, vscode.TreeItemCollapsibleState.Collapsed);
            item.id = `${node.project.id}#${node.collection.name}`;
            item.iconPath = new vscode.ThemeIcon("folder");
            item.description = `${node.collection.endpoints.length}`;
            item.tooltip = node.collection.description;
            return item;
        }
        const { endpoint, project } = node;
        const item = new vscode.TreeItem(`${endpoint.method} ${endpoint.path}`);
        item.id = `${project.id}#${endpoint.id}`;
        item.iconPath = methodIcon(endpoint.method);
        item.description =
            (endpoint.deprecated ? "deprecated · " : "") + (endpoint.summary ?? "");
        item.tooltip = endpoint.description ?? endpoint.summary;
        item.contextValue = "endpoint";
        item.command = {
            command: "locall.openEndpoint",
            title: "Open Request",
            arguments: [project.id, endpoint.id],
        };
        return item;
    }
}
exports.ProjectsTree = ProjectsTree;
function projectItem(project) {
    const item = new vscode.TreeItem((0, store_1.displayName)(project), project.spec
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None);
    item.id = project.id;
    item.contextValue =
        project.source === "workspace" ? "project" : "project.removable";
    item.tooltip = project.error
        ? `${project.location}\n${project.error}`
        : project.location;
    if (project.error) {
        item.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
        item.description = project.error;
    }
    else {
        item.iconPath = new vscode.ThemeIcon("server-process", project.liveUrl ? new vscode.ThemeColor("charts.green") : undefined);
        item.description = [
            project.liveUrl ? "● live" : project.stale ? "offline" : "",
            project.spec?.version ? `v${project.spec.version}` : "",
            project.folder ?? "",
        ]
            .filter(Boolean)
            .join(" · ");
    }
    item.command = {
        command: "locall.openProject",
        title: "Open Project",
        arguments: [project.id],
    };
    return item;
}
//# sourceMappingURL=projectsTree.js.map