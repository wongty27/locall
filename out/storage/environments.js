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
exports.EnvironmentStore = void 0;
const vscode = __importStar(require("vscode"));
const files_1 = require("./files");
const ACTIVE_KEY = "locall.activeEnvironment";
class EnvironmentStore {
    context;
    changed = new vscode.EventEmitter();
    onDidChange = this.changed.event;
    constructor(context) {
        this.context = context;
    }
    get file() {
        return vscode.Uri.joinPath((0, files_1.dataDir)(this.context), "environments.json");
    }
    secretKey(scope, environment, variable) {
        const dir = (0, files_1.dataDir)(this.context).toString();
        return scope === undefined
            ? `locall.env:${dir}:${environment}:${variable}`
            : `locall.env:${JSON.stringify([dir, scope, environment, variable])}`;
    }
    activeKey(scope) {
        return scope === undefined ? ACTIVE_KEY : `${ACTIVE_KEY}:${scope}`;
    }
    async readFile() {
        const data = await (0, files_1.readJson)(this.file);
        return data !== null && typeof data === "object" ? data : {};
    }
    fromFile(data, scope) {
        const list = scope === undefined
            ? data.environments
            : data.projects && Object.hasOwn(data.projects, scope)
                ? data.projects[scope]
                : undefined;
        return Array.isArray(list) ? list : [];
    }
    /** Environments as stored on disk. Secret variables have empty values. */
    async load(scope) {
        return this.fromFile(await this.readFile(), scope);
    }
    async list(scope) {
        const environments = await this.load(scope);
        for (const environment of environments) {
            for (const variable of environment.variables) {
                if (variable.secret) {
                    variable.hasValue = !!(await this.context.secrets.get(this.secretKey(scope, environment.name, variable.key)));
                }
            }
        }
        return environments;
    }
    async state(scope) {
        const environments = await this.load(scope);
        const stored = this.context.workspaceState.get(this.activeKey(scope));
        const current = environments.find((item) => item.name === stored);
        return {
            names: environments.map((item) => item.name),
            active: current?.name,
            baseUrl: current?.variables.find((variable) => variable.key === "baseUrl" && !variable.secret)?.value,
        };
    }
    async setActive(scope, name) {
        await this.context.workspaceState.update(this.activeKey(scope), name ?? undefined);
        this.changed.fire();
    }
    /** Values of the scope's active environment, including secrets. */
    async activeVariables(scope) {
        const { active } = await this.state(scope);
        const environment = (await this.load(scope)).find((item) => item.name === active);
        const variables = {};
        for (const variable of environment?.variables ?? []) {
            if (!variable.key) {
                continue;
            }
            const value = variable.secret
                ? await this.context.secrets.get(this.secretKey(scope, environment.name, variable.key))
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
    async save(scope, environments) {
        const data = await this.readFile();
        const previous = this.fromFile(data, scope);
        const kept = new Set();
        const stored = [];
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
                    const value = variable.value ||
                        (environment.copiedFrom === undefined
                            ? undefined
                            : await this.context.secrets.get(this.secretKey(scope, environment.copiedFrom, key)));
                    if (value) {
                        await this.context.secrets.store(secretKey, value);
                    }
                    variables.push({ key, value: "", secret: true });
                }
                else {
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
        await (0, files_1.writeJson)(this.file, scope === undefined
            ? { ...data, environments: stored }
            : {
                ...data,
                // fromEntries defines the key directly, so a title like
                // "__proto__" stays ordinary data.
                projects: {
                    ...data.projects,
                    ...Object.fromEntries([[scope, stored]]),
                },
            });
        this.changed.fire();
    }
}
exports.EnvironmentStore = EnvironmentStore;
//# sourceMappingURL=environments.js.map