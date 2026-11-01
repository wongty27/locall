import type { RequestDraft, ResponseResult } from "../model";

export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export interface BuiltRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
}

export type BuildResult =
  | { ok: true; request: BuiltRequest }
  | { ok: false; error: string };

export type Variables = Record<string, string>;

export function substitute(
  text: string,
  variables: Variables,
  missing?: Set<string>,
): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, name: string) => {
    if (Object.hasOwn(variables, name)) {
      return variables[name];
    }
    missing?.add(name);
    return match;
  });
}

/** Resolves variables, parameters and auth into the request that will be sent. */
export function buildRequest(
  draft: RequestDraft,
  variables: Variables,
): BuildResult {
  const missing = new Set<string>();
  const sub = (text: string) => substitute(text, variables, missing);

  let urlText = sub(draft.url).trim();
  const emptyPath: string[] = [];
  for (const param of draft.pathParams) {
    const placeholder = `{${param.key}}`;
    if (!urlText.includes(placeholder)) {
      continue;
    }
    const value = sub(param.value);
    if (!value) {
      emptyPath.push(param.key);
      continue;
    }
    urlText = urlText.replaceAll(placeholder, encodeURIComponent(value));
  }

  const headers: [string, string][] = draft.headers
    .filter((row) => row.enabled && row.key.trim())
    .map((row) => [sub(row.key).trim(), sub(row.value)]);
  const query: [string, string][] = draft.queryParams
    .filter((row) => row.enabled && row.key.trim())
    .map((row) => [sub(row.key).trim(), sub(row.value)]);

  const auth = draft.auth;
  if (auth.type === "bearer") {
    headers.push(["Authorization", `Bearer ${sub(auth.token)}`]);
  } else if (auth.type === "basic") {
    const pair = `${sub(auth.username)}:${sub(auth.password)}`;
    headers.push([
      "Authorization",
      `Basic ${Buffer.from(pair, "utf8").toString("base64")}`,
    ]);
  } else if (auth.type === "apiKey") {
    (auth.in === "header" ? headers : query).push([
      sub(auth.key),
      sub(auth.value),
    ]);
  }

  const canHaveBody = draft.method !== "GET" && draft.method !== "HEAD";
  const body = canHaveBody && draft.body ? sub(draft.body) : undefined;
  if (
    body !== undefined &&
    draft.contentType &&
    !headers.some(([key]) => key.toLowerCase() === "content-type")
  ) {
    headers.push(["Content-Type", draft.contentType]);
  }

  if (missing.size > 0) {
    return {
      ok: false,
      error: `Unresolved variables: ${[...missing].join(", ")}. Define them in the active environment.`,
    };
  }
  if (emptyPath.length > 0) {
    return {
      ok: false,
      error: `Missing path parameters: ${emptyPath.join(", ")}.`,
    };
  }

  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return { ok: false, error: `Invalid URL: ${urlText || "(empty)"}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs are supported." };
  }
  for (const [key, value] of query) {
    url.searchParams.append(key, value);
  }
  return {
    ok: true,
    request: { method: draft.method, url: url.toString(), headers, body },
  };
}

export function toCurl(request: BuiltRequest): string {
  const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;
  const parts = [`curl -X ${request.method} ${quote(request.url)}`];
  for (const [key, value] of request.headers) {
    parts.push(`-H ${quote(`${key}: ${value}`)}`);
  }
  if (request.body !== undefined) {
    parts.push(`--data-raw ${quote(request.body)}`);
  }
  return parts.join(" \\\n  ");
}

export async function sendRequest(
  request: BuiltRequest,
  signal: AbortSignal,
): Promise<ResponseResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal,
    });
    const { bytes, truncated } = await readLimited(
      response,
      MAX_RESPONSE_BYTES,
    );
    const contentType = response.headers.get("content-type") ?? undefined;
    const binary = isBinary(contentType, bytes);
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      body: binary ? "" : new TextDecoder().decode(bytes),
      contentType,
      durationMs: elapsed(),
      sizeBytes: bytes.length,
      truncated,
      binary,
      finalUrl: response.url,
    };
  } catch (error) {
    return {
      ok: false,
      headers: [],
      body: "",
      durationMs: elapsed(),
      sizeBytes: 0,
      truncated: false,
      binary: false,
      error: describeError(error),
    };
  }
}

/** Reads a response body, stopping once it passes the byte limit. */
export async function readLimited(
  response: Response,
  limit: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const remaining = limit - total;
      if (value.length > remaining) {
        chunks.push(value.subarray(0, remaining));
        total = limit;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  }
  return { bytes: Buffer.concat(chunks), truncated };
}

function isBinary(contentType: string | undefined, bytes: Uint8Array): boolean {
  if (contentType) {
    if (/^(text\/|application\/(.*[+/])?(json|xml|javascript|x-www-form-urlencoded|yaml|graphql))/i.test(contentType)) {
      return false;
    }
    if (/^(image|audio|video|font)\/|octet-stream|pdf|zip/i.test(contentType)) {
      return true;
    }
  }
  return bytes.subarray(0, 1024).includes(0);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "Request cancelled.";
    }
    const cause = (error as { cause?: { code?: string; message?: string } })
      .cause;
    if (cause?.code === "ECONNREFUSED") {
      return "Connection refused. Is the server running?";
    }
    if (cause?.code === "ENOTFOUND") {
      return "Host not found.";
    }
    return cause?.message || error.message;
  }
  return String(error);
}
