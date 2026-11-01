import * as vscode from "vscode";
import {
  DEFAULT_PORTS,
  detectServers,
  type DetectedServer,
} from "../detect/localhost";
import type { ProjectStore } from "../projects/store";

const REFRESH_MS = 30_000;

export class LocalhostTree
  implements vscode.TreeDataProvider<DetectedServer>, vscode.Disposable
{
  private servers: DetectedServer[] = [];
  private running?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly store: ProjectStore) {
    store.onDidChange(() => this.changed.fire());
  }

  dispose() {
    this.setPolling(false);
  }

  getChildren(): DetectedServer[] {
    return this.servers;
  }

  getTreeItem(server: DetectedServer): vscode.TreeItem {
    const item = new vscode.TreeItem(
      server.spec ? `:${server.port} ${server.spec.title}` : `:${server.port}`,
    );
    item.id = `${server.origin}|${server.spec?.url ?? ""}`;
    item.tooltip = server.spec?.url ?? server.origin;
    if (server.spec) {
      const added = this.store.isAdded(server.spec.url);
      item.iconPath = new vscode.ThemeIcon(
        "circle-filled",
        new vscode.ThemeColor("charts.green"),
      );
      item.description = added ? "added" : server.spec.version;
      item.contextValue = added ? "server.added" : "server.spec";
    } else {
      item.iconPath = new vscode.ThemeIcon("circle-outline");
      item.description = "no spec found";
      item.contextValue = "server.noSpec";
    }
    item.command = {
      command: "locall.openBlankRequest",
      title: "Open Request",
      arguments: [server],
    };
    return item;
  }

  /** Polls only while the view is visible. */
  setPolling(enabled: boolean) {
    clearInterval(this.timer);
    this.timer = undefined;
    if (enabled && config().get("enabled", true)) {
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    }
  }

  refresh(): Promise<void> {
    this.running ??= this.detect().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async detect() {
    let servers: DetectedServer[] = [];
    if (config().get("enabled", true)) {
      servers = await detectServers(validPorts());
    }
    const changed = JSON.stringify(servers) !== JSON.stringify(this.servers);
    this.servers = servers;
    if (changed) {
      this.changed.fire();
      this.store.setDetected(servers);
    }
  }
}

function config() {
  return vscode.workspace.getConfiguration("locall.detection");
}

function validPorts(): number[] {
  const ports = config().get<unknown>("ports", DEFAULT_PORTS);
  return Array.isArray(ports)
    ? ports.filter(
        (port): port is number =>
          Number.isInteger(port) && port > 0 && port < 65536,
      )
    : DEFAULT_PORTS;
}
