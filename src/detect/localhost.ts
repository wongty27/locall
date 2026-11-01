import * as net from "node:net";
import { readLimited } from "../http/send";
import { isSpec, parseSpec } from "../openapi/parse";

export const DEFAULT_PORTS = [
  3000, 3001, 4000, 5000, 5173, 8000, 8080, 8081, 8888, 9000,
];

export const SPEC_PATHS = [
  "/openapi.json",
  "/swagger.json",
  "/api.json",
  "/v3/api-docs",
  "/v2/api-docs",
  "/swagger/v1/swagger.json",
  "/api-docs",
  "/docs-json",
];

const MAX_SPEC_BYTES = 10 * 1024 * 1024;
const PORT_TIMEOUT_MS = 300;
const SPEC_TIMEOUT_MS = 2000;

const HOSTS = [
  { connect: "127.0.0.1", url: "127.0.0.1" },
  { connect: "::1", url: "[::1]" },
];

export interface DetectedServer {
  port: number;
  origin: string;
  spec?: {
    url: string;
    title: string;
    version: string;
    /** Spec server path applied to this origin. */
    baseUrl: string;
  };
}

export function isLoopbackUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isPortOpen(
  host: string,
  port: number,
  timeoutMs = PORT_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/**
 * Fetches a spec from a loopback address. Redirects are not followed, so a
 * local service cannot send the request to another host.
 */
export async function fetchSpec(
  url: string,
  timeoutMs = SPEC_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  if (!isLoopbackUrl(url)) {
    throw new Error(`Not a localhost URL: ${url}`);
  }
  const response = await fetch(url, {
    redirect: "manual",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }
  const { bytes, truncated } = await readLimited(response, MAX_SPEC_BYTES);
  if (truncated) {
    throw new Error("Spec is larger than 10 MB.");
  }
  const doc: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isSpec(doc)) {
    throw new Error("Response is not a Swagger or OpenAPI document.");
  }
  return doc;
}

async function detectPort(
  port: number,
  specPaths: string[],
): Promise<DetectedServer | undefined> {
  for (const host of HOSTS) {
    if (!(await isPortOpen(host.connect, port))) {
      continue;
    }
    const origin = `http://${host.url}:${port}`;
    for (const path of specPaths) {
      const url = origin + path;
      try {
        const doc = await fetchSpec(url);
        const spec = parseSpec(doc, url);
        return {
          port,
          origin,
          spec: {
            url,
            title: spec.title,
            version: spec.version,
            baseUrl: liveBaseUrl(origin, spec.servers[0]),
          },
        };
      } catch {
        // Most services do not serve this path. Try the next one.
      }
    }
    return { port, origin };
  }
  return undefined;
}

/** Keeps the spec server's path but points it at the detected server. */
export function liveBaseUrl(origin: string, server?: string): string {
  if (!server) {
    return origin;
  }
  try {
    return (origin + new URL(server).pathname).replace(/\/+$/, "");
  } catch {
    return origin;
  }
}

export async function detectServers(
  ports: number[],
  specPaths: string[] = SPEC_PATHS,
): Promise<DetectedServer[]> {
  const results = await Promise.all(
    [...new Set(ports)].map((port) => detectPort(port, specPaths)),
  );
  return results.filter((server) => server !== undefined);
}
