import * as assert from "assert";
import * as vscode from "vscode";
import type { ProjectStore } from "../projects/store";
import type { EnvironmentStore } from "../storage/environments";

suite("Extension", () => {
  let store: ProjectStore;
  let environments: EnvironmentStore;

  suiteSetup(async () => {
    const extension = vscode.extensions.all.find(
      (item) => item.packageJSON.name === "locall",
    );
    assert.ok(extension, "extension not found");
    const api = (await extension.activate()) as {
      store: ProjectStore;
      environments: EnvironmentStore;
    };
    store = api.store;
    environments = api.environments;
    await store.reload();
  });

  test("lists every spec in a multi-folder workspace and skips other files", () => {
    assert.deepStrictEqual(
      store.list().map((project) => project.spec?.title),
      ["Billing API", "Shop API"],
    );
  });

  test("groups endpoints into collections", () => {
    const shop = store.list().find((p) => p.spec?.title === "Shop API");
    assert.deepStrictEqual(
      shop?.spec?.collections.map((c) => [c.name, c.endpoints.length]),
      [["Orders", 4], ["Users", 1], ["Default", 1]],
    );
  });

  test("keeps environments separate for each project", async () => {
    const env = (name: string, url: string, token: string) => [
      {
        name,
        variables: [
          { key: "baseUrl", value: url, secret: false },
          { key: "token", value: token, secret: true },
        ],
      },
    ];
    const folder = vscode.workspace.workspaceFolders![0].uri;
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
      assert.strictEqual(
        (await environments.activeVariables("Billing API")).token,
        "billing-secret",
      );

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
      assert.ok(
        !new TextDecoder()
          .decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(data, "environments.json")))
          .includes("copiedFrom"),
      );

      // Saving one project leaves the others alone.
      await environments.save("Billing API", []);
      assert.deepStrictEqual((await environments.state("Billing API")).names, []);
      assert.deepStrictEqual((await environments.state("Shop API")).names, ["Local"]);

      const text = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(data, "environments.json")),
      );
      assert.ok(!text.includes("-secret"), "secret written to disk");
    } finally {
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
