import * as vscode from "vscode";

/** `.locall` in the first workspace folder, or global storage with no workspace. */
export function dataDir(context: vscode.ExtensionContext): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder
    ? vscode.Uri.joinPath(folder.uri, ".locall")
    : context.globalStorageUri;
}

export async function readJson<T>(uri: vscode.Uri): Promise<T | undefined> {
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    void vscode.window.showWarningMessage(
      `Locall could not parse ${vscode.workspace.asRelativePath(uri)}.`,
    );
    return undefined;
  }
}

export async function writeJson(uri: vscode.Uri, value: unknown): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
  await vscode.workspace.fs.writeFile(
    uri,
    new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`),
  );
}
