import * as vscode from "vscode";
import type { HistoryEntry } from "../model";
import type { HistoryStore } from "../storage/history";
import { methodIcon } from "./projectsTree";

export class HistoryTree implements vscode.TreeDataProvider<HistoryEntry> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly history: HistoryStore) {
    history.onDidChange(() => this.changed.fire());
  }

  getChildren(): HistoryEntry[] {
    return [...this.history.list()];
  }

  getTreeItem(entry: HistoryEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `${entry.draft.method} ${entry.draft.url.replace("{{baseUrl}}", "")}`,
    );
    item.id = entry.id;
    item.iconPath = methodIcon(entry.draft.method);
    item.description = `${entry.status ?? "failed"} · ${entry.durationMs} ms`;
    item.tooltip = [
      entry.title,
      new Date(entry.time).toLocaleString(),
      entry.error,
    ]
      .filter(Boolean)
      .join("\n");
    item.command = {
      command: "locall.openHistory",
      title: "Open Request",
      arguments: [entry.id],
    };
    return item;
  }
}
