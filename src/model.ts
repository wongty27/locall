// Plain data types shared by the extension host and the webview.
// This file must stay free of Node and VS Code imports.

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  description?: string;
  example?: string;
}

export type AuthHint =
  | { type: "bearer" }
  | { type: "basic" }
  | { type: "apiKey"; key: string; in: "header" | "query" };

export interface Endpoint {
  id: string;
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  deprecated: boolean;
  parameters: Parameter[];
  requestBody?: { contentType: string; example: string; required: boolean };
  responses: { status: string; description?: string }[];
  auth?: AuthHint;
}

export interface Collection {
  name: string;
  description?: string;
  endpoints: Endpoint[];
}

export interface ApiSpec {
  title: string;
  version: string;
  description?: string;
  specVersion: string;
  servers: string[];
  collections: Collection[];
}

export type ProjectSource = "workspace" | "file" | "localhost";

export interface Project {
  /** Absolute file path, or the spec URL for localhost projects. */
  id: string;
  source: ProjectSource;
  location: string;
  /** Workspace folder name, shown to tell similar projects apart. */
  folder?: string;
  spec?: ApiSpec;
  error?: string;
  /** Spec came from the local cache because the server could not be reached. */
  stale?: boolean;
  /** Base URL of a matching API detected on localhost. */
  liveUrl?: string;
}

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
  required?: boolean;
}

export type Auth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apiKey"; key: string; value: string; in: "header" | "query" };

export interface RequestDraft {
  method: HttpMethod;
  url: string;
  pathParams: KeyValue[];
  queryParams: KeyValue[];
  headers: KeyValue[];
  auth: Auth;
  contentType: string;
  body: string;
}

export interface ResponseResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers: [string, string][];
  body: string;
  contentType?: string;
  durationMs: number;
  sizeBytes: number;
  truncated: boolean;
  binary: boolean;
  error?: string;
  finalUrl?: string;
}

export interface EnvironmentVariable {
  key: string;
  /** Always empty for secret variables outside the extension's secret store. */
  value: string;
  secret: boolean;
  /** Webview only: a secret value is already stored. */
  hasValue?: boolean;
}

export interface Environment {
  name: string;
  variables: EnvironmentVariable[];
  /** Editor only: saved environment to copy blank secret values from. */
  copiedFrom?: string;
}

export interface HistoryEntry {
  id: string;
  time: number;
  projectId?: string;
  endpointId?: string;
  title: string;
  /** Redacted before it is stored. */
  draft: RequestDraft;
  status?: number;
  error?: string;
  durationMs: number;
}
