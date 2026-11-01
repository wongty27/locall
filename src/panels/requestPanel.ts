import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { draftFromEndpoint, emptyDraft } from "../http/draft";
import { buildRequest, sendRequest, toCurl } from "../http/send";
import type { Endpoint, Project, RequestDraft } from "../model";
import { displayName, type ProjectStore } from "../projects/store";
import {
  parseWebviewMessage,
  type HostMessage,
  type ViewState,
  type WebviewMessage,
} from "../shared/messages";
import type { EnvironmentStore } from "../storage/environments";
import type { HistoryStore } from "../storage/history";
import type { SavedRequests } from "../storage/saved";

interface RequestContext {
  projectId?: string;
  endpointId?: string;
  saveKey?: string;
  title: string;
}

interface OpenPanel {
  panel: vscode.WebviewPanel;
  abort?: AbortController;
  request?: RequestContext;
  projectId?: string;
  /** Project whose environments an environments panel edits. */
  envProjectId?: string;
  view: () => Promise<ViewState | undefined>;
}

export class PanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, OpenPanel>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ProjectStore,
    private readonly environments: EnvironmentStore,
    private readonly saved: SavedRequests,
    private readonly history: HistoryStore,
  ) {
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

  openProject(projectId: string) {
    const project = this.store.get(projectId);
    if (!project) {
      return;
    }
    this.open(`project:${projectId}`, displayName(project), {
      projectId,
      view: async () => {
        const current = this.store.get(projectId);
        return current && { kind: "overview", project: current };
      },
    });
  }

  openEndpoint(projectId: string, endpointId: string) {
    const project = this.store.get(projectId);
    const endpoint = this.store.getEndpoint(projectId, endpointId);
    if (!project || !endpoint) {
      return;
    }
    const saveKey = `${displayName(project)}::${endpoint.id}`;
    this.open(`endpoint:${projectId}:${endpointId}`, endpoint.id, {
      request: {
        projectId,
        endpointId,
        saveKey,
        title: displayName(project),
      },
      view: () => this.requestView(project, endpoint, saveKey),
    });
  }

  /** A request that is not tied to a spec, such as one for a detected port. */
  openDraft(
    key: string,
    title: string,
    draft: RequestDraft,
    projectId?: string,
    endpointId?: string,
  ) {
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
    this.openDraft(crypto.randomUUID(), "New Request", emptyDraft(url));
  }

  openEnvironments(projectId?: string) {
    const project = projectId ? this.store.get(projectId) : undefined;
    const name = project && displayName(project);
    this.open(
      `environments:${project?.id ?? ""}`,
      name ? `Environments: ${name}` : "Environments",
      {
        envProjectId: project?.id,
        view: async () => ({
          kind: "environments",
          projectName: name,
          environments: await this.environments.list(name),
        }),
      },
    );
  }

  private panelProjectId(open: OpenPanel) {
    return open.request?.projectId ?? open.projectId ?? open.envProjectId;
  }

  /** Environments belong to the panel's project, identified by its API title. */
  private scope(open: OpenPanel) {
    const id = this.panelProjectId(open);
    const project = id ? this.store.get(id) : undefined;
    return project && displayName(project);
  }

  private async requestView(
    project: Project,
    endpoint: Endpoint,
    saveKey: string,
  ): Promise<ViewState> {
    const stored = await this.saved.get(saveKey);
    const collection = project.spec?.collections.find((item) =>
      item.endpoints.includes(endpoint),
    );
    const current = this.store.get(project.id) ?? project;
    return {
      kind: "request",
      breadcrumb: [displayName(project), collection?.name ?? ""].filter(
        Boolean,
      ),
      draft: stored ?? draftFromEndpoint(endpoint),
      endpoint,
      baseUrl: baseUrlOf(current),
      live: !!current.liveUrl,
      canSave: true,
      saved: !!stored,
    };
  }

  private open(
    key: string,
    title: string,
    options: Omit<OpenPanel, "panel">,
  ) {
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const distUri = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    const panel = vscode.window.createWebviewPanel(
      "locall.panel",
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [distUri],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      "resources",
      "icon.svg",
    );
    panel.webview.html = pageHtml(panel.webview, distUri);

    const open: OpenPanel = { panel, ...options };
    this.panels.set(key, open);
    const listener = panel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseWebviewMessage(raw);
      if (message) {
        this.handle(open, message).catch((error: unknown) => {
          void vscode.window.showErrorMessage(
            `Locall: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    });
    panel.onDidDispose(() => {
      open.abort?.abort();
      listener.dispose();
      this.panels.delete(key);
    });
  }

  private post(open: OpenPanel, message: HostMessage) {
    void open.panel.webview.postMessage(message);
  }

  private async init(open: OpenPanel) {
    const view = await open.view();
    if (view) {
      this.post(open, {
        type: "init",
        view,
        env: await this.environments.state(this.scope(open)),
      });
    }
  }

  private async variables(open: OpenPanel) {
    const projectId = open.request?.projectId;
    const project = projectId ? this.store.get(projectId) : undefined;
    const baseUrl = project && baseUrlOf(project);
    // The active environment can override the spec's base URL.
    return {
      ...(baseUrl ? { baseUrl } : {}),
      ...(await this.environments.activeVariables(this.scope(open))),
    };
  }

  private async handle(open: OpenPanel, message: WebviewMessage) {
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
        const endpoint =
          projectId && endpointId
            ? this.store.getEndpoint(projectId, endpointId)
            : undefined;
        if (endpoint && saveKey) {
          await this.saved.remove(saveKey);
          this.post(open, { type: "draft", draft: draftFromEndpoint(endpoint) });
          this.post(open, { type: "savedState", saved: false });
        }
        break;
      }
      case "copyCurl": {
        const built = buildRequest(message.draft, await this.variables(open));
        if (built.ok) {
          await vscode.env.clipboard.writeText(toCurl(built.request));
          void vscode.window.setStatusBarMessage("Copied as cURL", 2000);
        } else {
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

  private async send(open: OpenPanel, draft: RequestDraft) {
    open.abort?.abort();
    const abort = new AbortController();
    open.abort = abort;
    this.post(open, { type: "sending" });

    const built = buildRequest(draft, await this.variables(open));
    const response = built.ok
      ? await sendRequest(built.request, abort.signal)
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

  private async broadcastEnv() {
    for (const open of this.panels.values()) {
      this.post(open, {
        type: "env",
        env: await this.environments.state(this.scope(open)),
      });
    }
  }

  private async refreshOverviews() {
    for (const open of this.panels.values()) {
      if (open.projectId) {
        await this.init(open);
      }
    }
  }
}

function baseUrlOf(project: Project): string | undefined {
  return project.liveUrl ?? project.spec?.servers[0];
}

function pageHtml(webview: vscode.Webview, distUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString("base64");
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
