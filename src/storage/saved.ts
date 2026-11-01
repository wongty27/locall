import * as vscode from "vscode";
import {
  mergeSecrets,
  splitSecrets,
  type DraftSecrets,
} from "../http/redact";
import type { RequestDraft } from "../model";
import { dataDir, readJson, writeJson } from "./files";

type SavedFile = Record<string, RequestDraft>;

/** Saved endpoint edits, keyed by API title and endpoint so they can be shared. */
export class SavedRequests {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private get file() {
    return vscode.Uri.joinPath(dataDir(this.context), "requests.json");
  }

  private secretKey(key: string) {
    return `locall.saved:${dataDir(this.context).toString()}:${key}`;
  }

  async get(key: string): Promise<RequestDraft | undefined> {
    const saved = await readJson<SavedFile>(this.file);
    if (!saved || !Object.hasOwn(saved, key)) {
      return undefined;
    }
    const secrets = await this.context.secrets.get(this.secretKey(key));
    return mergeSecrets(
      saved[key],
      secrets ? (JSON.parse(secrets) as DraftSecrets) : {},
    );
  }

  async set(key: string, draft: RequestDraft): Promise<void> {
    const saved = (await readJson<SavedFile>(this.file)) ?? {};
    const { clean, secrets } = splitSecrets(draft);
    Object.defineProperty(saved, key, {
      value: clean,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    await writeJson(this.file, saved);
    await this.context.secrets.store(
      this.secretKey(key),
      JSON.stringify(secrets),
    );
  }

  async remove(key: string): Promise<void> {
    const saved = await readJson<SavedFile>(this.file);
    if (saved && Object.hasOwn(saved, key)) {
      delete saved[key];
      await writeJson(this.file, saved);
    }
    await this.context.secrets.delete(this.secretKey(key));
  }
}
