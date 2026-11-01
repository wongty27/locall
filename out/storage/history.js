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
exports.HistoryStore = void 0;
const vscode = __importStar(require("vscode"));
const redact_1 = require("../http/redact");
const files_1 = require("./files");
const LIMIT = 200;
class HistoryStore {
    context;
    entries = [];
    writing = Promise.resolve();
    changed = new vscode.EventEmitter();
    onDidChange = this.changed.event;
    constructor(context) {
        this.context = context;
    }
    get file() {
        return vscode.Uri.joinPath(this.context.globalStorageUri, "history.json");
    }
    async load() {
        const entries = await (0, files_1.readJson)(this.file);
        this.entries = Array.isArray(entries) ? entries : [];
        this.changed.fire();
    }
    list() {
        return this.entries;
    }
    get(id) {
        return this.entries.find((entry) => entry.id === id);
    }
    add(entry) {
        this.entries = [
            {
                ...entry,
                draft: (0, redact_1.redactDraft)(entry.draft),
                id: crypto.randomUUID(),
                time: Date.now(),
            },
            ...this.entries,
        ].slice(0, LIMIT);
        this.persist();
    }
    clear() {
        this.entries = [];
        this.persist();
    }
    persist() {
        this.changed.fire();
        // Writes run one at a time so an older one cannot replace a newer one.
        this.writing = this.writing
            .then(() => (0, files_1.writeJson)(this.file, this.entries))
            .catch((error) => console.error("Locall: history write", error));
    }
}
exports.HistoryStore = HistoryStore;
//# sourceMappingURL=history.js.map