import * as vscode from "vscode";
import type { DetectedServer } from "./detect/localhost";
import { PanelManager } from "./panels/requestPanel";
import { displayName, ProjectStore } from "./projects/store";
import { EnvironmentStore } from "./storage/environments";
import { HistoryStore } from "./storage/history";
import { SavedRequests } from "./storage/saved";
import { HistoryTree } from "./views/historyTree";
import { LocalhostTree } from "./views/localhostTree";
import { ProjectsTree, type ProjectNode } from "./views/projectsTree";

export function activate(context: vscode.ExtensionContext) {
  const store = new ProjectStore(context);
  const environments = new EnvironmentStore(context);
  const saved = new SavedRequests(context);
  const history = new HistoryStore(context);
  const panels = new PanelManager(
    context,
    store,
    environments,
    saved,
    history,
  );
  const localhost = new LocalhostTree(store);
  const localhostView = vscode.window.createTreeView("locallLocalhost", {
    treeDataProvider: localhost,
  });
  localhost.setPolling(localhostView.visible);

  const command = (name: string, run: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand(name, run);

  context.subscriptions.push(
    store,
    panels,
    localhost,
    localhostView,
    localhostView.onDidChangeVisibility(({ visible }) =>
      localhost.setPolling(visible),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("locall.detection")) {
        localhost.setPolling(localhostView.visible);
        void localhost.refresh();
      }
    }),
    vscode.window.registerTreeDataProvider(
      "locallProjects",
      new ProjectsTree(store),
    ),
    vscode.window.registerTreeDataProvider(
      "locallHistory",
      new HistoryTree(history),
    ),

    command("locall.addSpecFile", async () => {
      const files = await vscode.window.showOpenDialog({
        canSelectMany: true,
        filters: { "API spec": ["json"] },
        openLabel: "Add Spec",
      });
      for (const file of files ?? []) {
        await store.addFile(file);
      }
    }),
    command("locall.refreshProjects", () => store.reload()),
    command("locall.removeProject", async (node: ProjectNode) => {
      if (node?.kind !== "project") {
        return;
      }
      const confirmed = await vscode.window.showWarningMessage(
        `Remove "${displayName(node.project)}" from Locall?`,
        {
          modal: true,
          detail: `The project will no longer be listed. This won't delete any files or stop any servers.\n\n${node.project.location}`,
        },
        "Remove",
      );
      if (confirmed === "Remove") {
        await store.remove(node.project.id);
      }
    }),
    command("locall.openProject", (projectId: string) =>
      panels.openProject(projectId),
    ),
    command("locall.openEndpoint", (projectId: string, endpointId: string) =>
      panels.openEndpoint(projectId, endpointId),
    ),
    command("locall.searchEndpoints", async () => {
      const items = store.list().flatMap((project) =>
        (project.spec?.collections ?? []).flatMap((collection) =>
          collection.endpoints.map((endpoint) => ({
            label: `${endpoint.method} ${endpoint.path}`,
            description: `${displayName(project)} › ${collection.name}`,
            detail: endpoint.summary,
            projectId: project.id,
            endpointId: endpoint.id,
          })),
        ),
      );
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
    }),
    command("locall.newRequest", () => panels.openBlank()),
    command("locall.manageEnvironments", async (node?: ProjectNode) => {
      if (node?.kind === "project") {
        panels.openEnvironments(node.project.id);
        return;
      }
      const picked = await vscode.window.showQuickPick(
        [
          ...store.list().map((project) => ({
            label: displayName(project),
            description: project.folder,
            projectId: project.id as string | undefined,
          })),
          { label: "Requests without a project", description: undefined, projectId: undefined },
        ],
        { placeHolder: "Manage environments for which project?" },
      );
      if (picked) {
        panels.openEnvironments(picked.projectId);
      }
    }),
    command("locall.refreshLocalhost", () => localhost.refresh()),
    command("locall.addDetected", async (server: DetectedServer) => {
      if (server?.spec) {
        await store.addLocalhost(server.spec.url);
      }
    }),
    command("locall.openBlankRequest", (server: DetectedServer) => {
      const specUrl = server?.spec?.url;
      if (specUrl && store.get(specUrl)) {
        panels.openProject(specUrl);
      } else {
        panels.openBlank(server ? `${server.origin}/` : "");
      }
    }),
    command("locall.openHistory", (id: string) => {
      const entry = history.get(id);
      if (entry) {
        panels.openDraft(
          id,
          `${entry.draft.method} ${entry.title}`,
          entry.draft,
          entry.projectId,
          entry.endpointId,
        );
      }
    }),
    command("locall.clearHistory", () => history.clear()),
  );

  void history.load();
  void store.reload();
  void localhost.refresh();

  return { store, environments };
}

export function deactivate() {}
