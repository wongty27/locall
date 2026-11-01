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
exports.SavedRequests = void 0;
const vscode = __importStar(require("vscode"));
const redact_1 = require("../http/redact");
const files_1 = require("./files");
/** Saved endpoint edits, keyed by API title and endpoint so they can be shared. */
class SavedRequests {
    context;
    constructor(context) {
        this.context = context;
    }
    get file() {
        return vscode.Uri.joinPath((0, files_1.dataDir)(this.context), "requests.json");
    }
    secretKey(key) {
        return `locall.saved:${(0, files_1.dataDir)(this.context).toString()}:${key}`;
    }
    async get(key) {
        const saved = await (0, files_1.readJson)(this.file);
        if (!saved || !Object.hasOwn(saved, key)) {
            return undefined;
        }
        const secrets = await this.context.secrets.get(this.secretKey(key));
        return (0, redact_1.mergeSecrets)(saved[key], secrets ? JSON.parse(secrets) : {});
    }
    async set(key, draft) {
        const saved = (await (0, files_1.readJson)(this.file)) ?? {};
        const { clean, secrets } = (0, redact_1.splitSecrets)(draft);
        Object.defineProperty(saved, key, {
            value: clean,
            enumerable: true,
            writable: true,
            configurable: true,
        });
        await (0, files_1.writeJson)(this.file, saved);
        await this.context.secrets.store(this.secretKey(key), JSON.stringify(secrets));
    }
    async remove(key) {
        const saved = await (0, files_1.readJson)(this.file);
        if (saved && Object.hasOwn(saved, key)) {
            delete saved[key];
            await (0, files_1.writeJson)(this.file, saved);
        }
        await this.context.secrets.delete(this.secretKey(key));
    }
}
exports.SavedRequests = SavedRequests;
//# sourceMappingURL=saved.js.map