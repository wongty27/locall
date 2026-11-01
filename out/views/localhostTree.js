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
exports.LocalhostTree = void 0;
const vscode = __importStar(require("vscode"));
const localhost_1 = require("../detect/localhost");
const REFRESH_MS = 30_000;
class LocalhostTree {
    store;
    servers = [];
    running;
    timer;
    changed = new vscode.EventEmitter();
    onDidChangeTreeData = this.changed.event;
    constructor(store) {
        this.store = store;
        store.onDidChange(() => this.changed.fire());
    }
    dispose() {
        this.setPolling(false);
    }
    getChildren() {
        return this.servers;
    }
    getTreeItem(server) {
        const item = new vscode.TreeItem(server.spec ? `:${server.port} ${server.spec.title}` : `:${server.port}`);
        item.id = `${server.origin}|${server.spec?.url ?? ""}`;
        item.tooltip = server.spec?.url ?? server.origin;
        if (server.spec) {
            const added = this.store.isAdded(server.spec.url);
            item.iconPath = new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.green"));
            item.description = added ? "added" : server.spec.version;
            item.contextValue = added ? "server.added" : "server.spec";
        }
        else {
            item.iconPath = new vscode.ThemeIcon("circle-outline");
            item.description = "no spec found";
            item.contextValue = "server.noSpec";
        }
        item.command = {
            command: "locall.openBlankRequest",
            title: "Open Request",
            arguments: [server],
        };
        return item;
    }
    /** Polls only while the view is visible. */
    setPolling(enabled) {
        clearInterval(this.timer);
        this.timer = undefined;
        if (enabled && config().get("enabled", true)) {
            void this.refresh();
            this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
        }
    }
    refresh() {
        this.running ??= this.detect().finally(() => {
            this.running = undefined;
        });
        return this.running;
    }
    async detect() {
        let servers = [];
        if (config().get("enabled", true)) {
            servers = await (0, localhost_1.detectServers)(validPorts());
        }
        const changed = JSON.stringify(servers) !== JSON.stringify(this.servers);
        this.servers = servers;
        if (changed) {
            this.changed.fire();
            this.store.setDetected(servers);
        }
    }
}
exports.LocalhostTree = LocalhostTree;
function config() {
    return vscode.workspace.getConfiguration("locall.detection");
}
function validPorts() {
    const ports = config().get("ports", localhost_1.DEFAULT_PORTS);
    return Array.isArray(ports)
        ? ports.filter((port) => Number.isInteger(port) && port > 0 && port < 65536)
        : localhost_1.DEFAULT_PORTS;
}
//# sourceMappingURL=localhostTree.js.map