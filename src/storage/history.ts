import * as vscode from "vscode";
import { redactDraft } from "../http/redact";
import type { HistoryEntry } from "../model";
import { readJson, writeJson } from "./files";

const LIMIT = 200;

export class HistoryStore {
  private entries: HistoryEntry[] = [];
  private writing: Promise<void> = Promise.resolve();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get file() {
    return vscode.Uri.joinPath(this.context.globalStorageUri, "history.json");
  }

  async load(): Promise<void> {
    const entries = await readJson<HistoryEntry[]>(this.file);
    this.entries = Array.isArray(entries) ? entries : [];
    this.changed.fire();
  }

  list(): readonly HistoryEntry[] {
    return this.entries;
  }

  get(id: string): HistoryEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  add(entry: Omit<HistoryEntry, "id" | "time">): void {
    this.entries = [
      {
        ...entry,
        draft: redactDraft(entry.draft),
        id: crypto.randomUUID(),
        time: Date.now(),
      },
      ...this.entries,
    ].slice(0, LIMIT);
    this.persist();
  }

  clear(): void {
    this.entries = [];
    this.persist();
  }

  private persist() {
    this.changed.fire();
    // Writes run one at a time so an older one cannot replace a newer one.
    this.writing = this.writing
      .then(() => writeJson(this.file, this.entries))
      .catch((error: unknown) => console.error("Locall: history write", error));
  }
}
