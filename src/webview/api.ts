import type { WebviewMessage } from "../shared/messages";

const vscode = acquireVsCodeApi();

export function post(message: WebviewMessage) {
  vscode.postMessage(message);
}
