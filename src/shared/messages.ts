import {
  HTTP_METHODS,
  type Auth,
  type Endpoint,
  type Environment,
  type KeyValue,
  type Project,
  type RequestDraft,
  type ResponseResult,
} from "../model";

export interface EnvironmentState {
  names: string[];
  active?: string;
  /** Active environment's baseUrl, which overrides the project's. */
  baseUrl?: string;
}

export type ViewState =
  | {
      kind: "request";
      breadcrumb: string[];
      draft: RequestDraft;
      endpoint?: Endpoint;
      baseUrl?: string;
      live: boolean;
      canSave: boolean;
      saved: boolean;
    }
  | { kind: "overview"; project: Project }
  | { kind: "environments"; projectName?: string; environments: Environment[] };

export type HostMessage =
  | { type: "init"; view: ViewState; env: EnvironmentState }
  | { type: "env"; env: EnvironmentState }
  | { type: "sending" }
  | { type: "response"; response: ResponseResult }
  | { type: "savedState"; saved: boolean }
  | { type: "draft"; draft: RequestDraft };

export type WebviewMessage =
  | { type: "ready" }
  | { type: "send"; draft: RequestDraft }
  | { type: "cancel" }
  | { type: "save"; draft: RequestDraft }
  | { type: "reset" }
  | { type: "copyCurl"; draft: RequestDraft }
  | { type: "setEnv"; name: string | null }
  | { type: "manageEnvs" }
  | { type: "openEndpoint"; endpointId: string }
  | { type: "saveEnvs"; environments: Environment[] };

const isString = (value: unknown): value is string => typeof value === "string";
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function isKeyValue(value: unknown): value is KeyValue {
  return (
    isObject(value) &&
    isString(value.key) &&
    isString(value.value) &&
    typeof value.enabled === "boolean"
  );
}

function isAuth(value: unknown): value is Auth {
  if (!isObject(value)) {
    return false;
  }
  switch (value.type) {
    case "none":
      return true;
    case "bearer":
      return isString(value.token);
    case "basic":
      return isString(value.username) && isString(value.password);
    case "apiKey":
      return (
        isString(value.key) &&
        isString(value.value) &&
        (value.in === "header" || value.in === "query")
      );
    default:
      return false;
  }
}

export function isDraft(value: unknown): value is RequestDraft {
  return (
    isObject(value) &&
    (HTTP_METHODS as readonly unknown[]).includes(value.method) &&
    isString(value.url) &&
    Array.isArray(value.pathParams) &&
    value.pathParams.every(isKeyValue) &&
    Array.isArray(value.queryParams) &&
    value.queryParams.every(isKeyValue) &&
    Array.isArray(value.headers) &&
    value.headers.every(isKeyValue) &&
    isAuth(value.auth) &&
    isString(value.contentType) &&
    isString(value.body)
  );
}

function isEnvironment(value: unknown): value is Environment {
  return (
    isObject(value) &&
    isString(value.name) &&
    (value.copiedFrom === undefined || isString(value.copiedFrom)) &&
    Array.isArray(value.variables) &&
    value.variables.every(
      (item) =>
        isObject(item) &&
        isString(item.key) &&
        isString(item.value) &&
        typeof item.secret === "boolean",
    )
  );
}

/** Webview content is treated as untrusted: anything malformed is dropped. */
export function parseWebviewMessage(raw: unknown): WebviewMessage | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  switch (raw.type) {
    case "ready":
    case "cancel":
    case "reset":
    case "manageEnvs":
      return { type: raw.type };
    case "send":
    case "save":
    case "copyCurl":
      return isDraft(raw.draft)
        ? { type: raw.type, draft: raw.draft }
        : undefined;
    case "setEnv":
      return isString(raw.name) || raw.name === null
        ? { type: "setEnv", name: raw.name }
        : undefined;
    case "openEndpoint":
      return isString(raw.endpointId)
        ? { type: "openEndpoint", endpointId: raw.endpointId }
        : undefined;
    case "saveEnvs":
      return Array.isArray(raw.environments) &&
        raw.environments.every(isEnvironment)
        ? { type: "saveEnvs", environments: raw.environments }
        : undefined;
    default:
      return undefined;
  }
}
