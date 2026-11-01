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
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
suite("Extension", () => {
    let store;
    let environments;
    suiteSetup(async () => {
        const extension = vscode.extensions.all.find((item) => item.packageJSON.name === "locall");
        assert.ok(extension, "extension not found");
        const api = (await extension.activate());
        store = api.store;
        environments = api.environments;
        await store.reload();
    });
    test("lists every spec in a multi-folder workspace and skips other files", () => {
        assert.deepStrictEqual(store.list().map((project) => project.spec?.title), ["Billing API", "Shop API"]);
    });
    test("groups endpoints into collections", () => {
        const shop = store.list().find((p) => p.spec?.title === "Shop API");
        assert.deepStrictEqual(shop?.spec?.collections.map((c) => [c.name, c.endpoints.length]), [["Orders", 4], ["Users", 1], ["Default", 1]]);
    });
    test("keeps environments separate for each project", async () => {
        const env = (name, url, token) => [
            {
                name,
                variables: [
                    { key: "baseUrl", value: url, secret: false },
                    { key: "token", value: token, secret: true },
                ],
            },
        ];
        const folder = vscode.workspace.workspaceFolders[0].uri;
        const data = vscode.Uri.joinPath(folder, ".locall");
        try {
            await environments.save("Shop API", env("Local", "http://shop", "shop-secret"));
            await environments.save("Billing API", env("Local", "http://billing", "billing-secret"));
            await environments.save("__proto__", env("Odd", "http://odd", "odd-secret"));
            await environments.setActive("Shop API", "Local");
            assert.deepStrictEqual(await environments.activeVariables("Shop API"), {
                baseUrl: "http://shop",
                token: "shop-secret",
            });
            // The same environment name in another project is not active there.
            assert.strictEqual((await environments.state("Billing API")).active, undefined);
            assert.deepStrictEqual(await environments.activeVariables("Billing API"), {});
            assert.deepStrictEqual((await environments.state(undefined)).names, []);
            assert.deepStrictEqual((await environments.state("__proto__")).names, ["Odd"]);
            assert.deepStrictEqual((await environments.state("Unknown")).names, []);
            await environments.setActive("Billing API", "Local");
            assert.strictEqual((await environments.activeVariables("Billing API")).token, "billing-secret");
            // A duplicate gets the source's secrets, and copiedFrom isn't saved.
            await environments.save("Shop API", [
                ...env("Local", "http://shop", ""),
                { ...env("Local copy", "http://shop", "")[0], copiedFrom: "Local" },
            ]);
            await environments.setActive("Shop API", "Local copy");
            assert.deepStrictEqual(await environments.activeVariables("Shop API"), {
                baseUrl: "http://shop",
                token: "shop-secret",
            });
            await environments.save("Shop API", env("Local", "http://shop", ""));
            await environments.setActive("Shop API", "Local");
            assert.ok(!new TextDecoder()
                .decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(data, "environments.json")))
                .includes("copiedFrom"));
            // Saving one project leaves the others alone.
            await environments.save("Billing API", []);
            assert.deepStrictEqual((await environments.state("Billing API")).names, []);
            assert.deepStrictEqual((await environments.state("Shop API")).names, ["Local"]);
            const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(data, "environments.json")));
            assert.ok(!text.includes("-secret"), "secret written to disk");
        }
        finally {
            await environments.setActive("Shop API", null);
            await environments.setActive("Billing API", null);
            await environments.save("Shop API", []);
            await environments.save("__proto__", []);
            await vscode.workspace.fs.delete(data, { recursive: true, useTrash: false });
        }
    });
    test("contributes commands that run without errors", async () => {
        const commands = await vscode.commands.getCommands(true);
        for (const name of [
            "locall.addSpecFile",
            "locall.searchEndpoints",
            "locall.refreshLocalhost",
            "locall.manageEnvironments",
        ]) {
            assert.ok(commands.includes(name), name);
        }
        const shop = store.list().find((p) => p.spec?.title === "Shop API");
        assert.ok(shop);
        await vscode.commands.executeCommand("locall.openProject", shop.id);
        await vscode.commands.executeCommand("locall.openEndpoint", shop.id, "POST /orders");
        await vscode.commands.executeCommand("locall.newRequest");
        await vscode.commands.executeCommand("locall.manageEnvironments", {
            kind: "project",
            project: shop,
        });
        await vscode.commands.executeCommand("locall.refreshLocalhost");
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });
});
//# sourceMappingURL=extension.test.js.map