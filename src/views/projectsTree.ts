import * as vscode from "vscode";
import type { Collection, Endpoint, HttpMethod, Project } from "../model";
import { displayName, type ProjectStore } from "../projects/store";

export type ProjectNode =
  | { kind: "project"; project: Project }
  | { kind: "collection"; project: Project; collection: Collection }
  | { kind: "endpoint"; project: Project; endpoint: Endpoint };

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "charts.green",
  POST: "charts.yellow",
  PUT: "charts.blue",
  PATCH: "charts.purple",
  DELETE: "charts.red",
  HEAD: "charts.foreground",
  OPTIONS: "charts.foreground",
};

export function methodIcon(method: HttpMethod): vscode.ThemeIcon {
  return new vscode.ThemeIcon(
    "circle-filled",
    new vscode.ThemeColor(METHOD_COLORS[method]),
  );
}

export class ProjectsTree implements vscode.TreeDataProvider<ProjectNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly store: ProjectStore) {
    store.onDidChange(() => this.changed.fire());
  }

  getChildren(node?: ProjectNode): ProjectNode[] {
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

  getTreeItem(node: ProjectNode): vscode.TreeItem {
    if (node.kind === "project") {
      return projectItem(node.project);
    }
    if (node.kind === "collection") {
      const item = new vscode.TreeItem(
        node.collection.name,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
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

function projectItem(project: Project): vscode.TreeItem {
  const item = new vscode.TreeItem(
    displayName(project),
    project.spec
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
  );
  item.id = project.id;
  item.contextValue =
    project.source === "workspace" ? "project" : "project.removable";
  item.tooltip = project.error
    ? `${project.location}\n${project.error}`
    : project.location;

  if (project.error) {
    item.iconPath = new vscode.ThemeIcon(
      "warning",
      new vscode.ThemeColor("problemsWarningIcon.foreground"),
    );
    item.description = project.error;
  } else {
    item.iconPath = new vscode.ThemeIcon(
      "server-process",
      project.liveUrl ? new vscode.ThemeColor("charts.green") : undefined,
    );
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
