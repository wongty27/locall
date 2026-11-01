import type {
  ApiSpec,
  AuthHint,
  Collection,
  Endpoint,
  HttpMethod,
  Parameter,
} from "../model";
import { asObject, deref, schemaExample } from "./example";

type Json = Record<string, unknown>;

const PATH_METHODS: [string, HttpMethod][] = [
  ["get", "GET"],
  ["post", "POST"],
  ["put", "PUT"],
  ["patch", "PATCH"],
  ["delete", "DELETE"],
  ["head", "HEAD"],
  ["options", "OPTIONS"],
];

const DEFAULT_COLLECTION = "Default";

export function isSpec(doc: unknown): doc is Json {
  const object = asObject(doc);
  return (
    !!object &&
    (typeof object.openapi === "string" || typeof object.swagger === "string")
  );
}

/**
 * Converts a Swagger 2.0 or OpenAPI 3.x document to the internal model.
 * @param sourceUrl where the spec was fetched from, for resolving relative servers
 */
export function parseSpec(doc: Json, sourceUrl?: string): ApiSpec {
  const isV2 = typeof doc.swagger === "string";
  const info = asObject(doc.info) ?? {};
  const collections = new Map<string, Collection>();

  for (const item of Array.isArray(doc.tags) ? doc.tags : []) {
    const tag = asObject(item);
    if (tag && typeof tag.name === "string") {
      collections.set(tag.name, {
        name: tag.name,
        description: text(tag.description),
        endpoints: [],
      });
    }
  }

  for (const [path, rawItem] of Object.entries(asObject(doc.paths) ?? {})) {
    const pathItem = deref(doc, rawItem);
    if (!pathItem) {
      continue;
    }
    for (const [key, method] of PATH_METHODS) {
      const operation = asObject(pathItem[key]);
      if (!operation) {
        continue;
      }
      const tags = Array.isArray(operation.tags) ? operation.tags : [];
      const tagName =
        typeof tags[0] === "string" && tags[0] ? tags[0] : DEFAULT_COLLECTION;
      let collection = collections.get(tagName);
      if (!collection) {
        collection = { name: tagName, endpoints: [] };
        collections.set(tagName, collection);
      }
      collection.endpoints.push(
        parseOperation(doc, isV2, method, path, pathItem, operation),
      );
    }
  }

  return {
    title: text(info.title) ?? "Untitled API",
    version: text(info.version) ?? "",
    description: text(info.description),
    specVersion: String(isV2 ? doc.swagger : doc.openapi),
    servers: isV2 ? v2Servers(doc, sourceUrl) : v3Servers(doc, sourceUrl),
    collections: [...collections.values()].filter(
      (collection) => collection.endpoints.length > 0,
    ),
  };
}

function parseOperation(
  doc: Json,
  isV2: boolean,
  method: HttpMethod,
  path: string,
  pathItem: Json,
  operation: Json,
): Endpoint {
  // Operation parameters override path-level ones with the same name and location.
  const rawParams = new Map<string, Json>();
  for (const source of [pathItem.parameters, operation.parameters]) {
    for (const entry of Array.isArray(source) ? source : []) {
      const param = deref(doc, entry);
      if (param && typeof param.name === "string") {
        rawParams.set(`${String(param.in)}:${param.name}`, param);
      }
    }
  }

  const parameters: Parameter[] = [];
  const bodyParams: Json[] = [];
  for (const param of rawParams.values()) {
    if (
      param.in === "path" ||
      param.in === "query" ||
      param.in === "header" ||
      param.in === "cookie"
    ) {
      parameters.push({
        name: String(param.name),
        in: param.in,
        required: param.required === true || param.in === "path",
        description: text(param.description),
        example: parameterExample(doc, param),
      });
    } else if (param.in === "body" || param.in === "formData") {
      bodyParams.push(param);
    }
  }

  return {
    id: `${method} ${path}`,
    method,
    path,
    summary: text(operation.summary),
    description: text(operation.description),
    deprecated: operation.deprecated === true,
    parameters,
    requestBody: isV2
      ? v2Body(doc, operation, bodyParams)
      : v3Body(doc, operation),
    responses: Object.entries(asObject(operation.responses) ?? {}).map(
      ([status, value]) => ({
        status,
        description: text(deref(doc, value)?.description),
      }),
    ),
    auth: authHint(doc, operation),
  };
}

function parameterExample(doc: Json, param: Json): string | undefined {
  if (param.example !== undefined) {
    return stringify(param.example);
  }
  const first = Object.values(asObject(param.examples) ?? {})[0];
  const firstValue = deref(doc, first)?.value;
  if (firstValue !== undefined) {
    return stringify(firstValue);
  }
  // Swagger 2 declares the schema fields on the parameter itself.
  const schema = deref(doc, param.schema) ?? param;
  for (const value of [
    schema.example,
    schema.default,
    Array.isArray(schema.enum) ? schema.enum[0] : undefined,
  ]) {
    if (value !== undefined) {
      return stringify(value);
    }
  }
  return undefined;
}

function v3Body(doc: Json, operation: Json): Endpoint["requestBody"] {
  const body = deref(doc, operation.requestBody);
  const content = asObject(body?.content);
  if (!body || !content) {
    return undefined;
  }
  const types = Object.keys(content);
  const contentType =
    types.find((type) => type === "application/json") ??
    types.find((type) => /[/+]json\b/.test(type)) ??
    types.find((type) => !type.startsWith("multipart/")) ??
    types[0];
  if (!contentType) {
    return undefined;
  }
  const media = asObject(content[contentType]) ?? {};
  let value = media.example;
  if (value === undefined) {
    value = deref(doc, Object.values(asObject(media.examples) ?? {})[0])?.value;
  }
  if (value === undefined) {
    value = schemaExample(doc, media.schema);
  }
  return {
    contentType,
    example: bodyText(contentType, value),
    required: body.required === true,
  };
}

function v2Body(
  doc: Json,
  operation: Json,
  params: Json[],
): Endpoint["requestBody"] {
  if (params.length === 0) {
    return undefined;
  }
  const consumes = Array.isArray(operation.consumes)
    ? operation.consumes
    : Array.isArray(doc.consumes)
      ? doc.consumes
      : [];
  const body = params.find((param) => param.in === "body");
  if (body) {
    const contentType =
      consumes.find((type) => /json/.test(String(type))) ??
      consumes[0] ??
      "application/json";
    return {
      contentType: String(contentType),
      example: bodyText(String(contentType), schemaExample(doc, body.schema)),
      required: body.required === true,
    };
  }
  const fields: Json = {};
  for (const param of params) {
    fields[String(param.name)] = parameterExample(doc, param) ?? "";
  }
  const contentType = consumes.includes("multipart/form-data")
    ? "multipart/form-data"
    : "application/x-www-form-urlencoded";
  return {
    contentType,
    example: bodyText(contentType, fields),
    required: params.some((param) => param.required === true),
  };
}

function bodyText(contentType: string, value: unknown): string {
  if (contentType.startsWith("multipart/")) {
    return ""; // Needs a generated boundary; not supported as raw text.
  }
  if (contentType === "application/x-www-form-urlencoded" && asObject(value)) {
    return new URLSearchParams(
      Object.entries(value as Json).map(
        ([key, item]): [string, string] => [key, stringify(item)],
      ),
    ).toString();
  }
  if (typeof value === "string") {
    return value;
  }
  return value === null || value === undefined
    ? ""
    : JSON.stringify(value, null, 2);
}

function authHint(doc: Json, operation: Json): AuthHint | undefined {
  const security = operation.security ?? doc.security;
  if (!Array.isArray(security)) {
    return undefined;
  }
  const schemes =
    asObject(asObject(doc.components)?.securitySchemes) ??
    asObject(doc.securityDefinitions) ??
    {};
  for (const requirement of security) {
    for (const name of Object.keys(asObject(requirement) ?? {})) {
      const scheme = deref(doc, schemes[name]);
      if (!scheme) {
        continue;
      }
      if (scheme.type === "apiKey") {
        if (
          typeof scheme.name === "string" &&
          (scheme.in === "header" || scheme.in === "query")
        ) {
          return { type: "apiKey", key: scheme.name, in: scheme.in };
        }
      } else if (
        scheme.type === "basic" ||
        (scheme.type === "http" &&
          String(scheme.scheme).toLowerCase() === "basic")
      ) {
        return { type: "basic" };
      } else if (
        scheme.type === "oauth2" ||
        scheme.type === "openIdConnect" ||
        scheme.type === "http"
      ) {
        return { type: "bearer" };
      }
    }
  }
  return undefined;
}

function v3Servers(doc: Json, sourceUrl?: string): string[] {
  const servers: string[] = [];
  for (const entry of Array.isArray(doc.servers) ? doc.servers : []) {
    const server = asObject(entry);
    if (!server || typeof server.url !== "string") {
      continue;
    }
    let url = server.url;
    for (const [name, value] of Object.entries(
      asObject(server.variables) ?? {},
    )) {
      const fallback = asObject(value)?.default;
      if (fallback !== undefined) {
        url = url.replaceAll(`{${name}}`, String(fallback));
      }
    }
    const resolved = resolveServer(url, sourceUrl);
    if (resolved) {
      servers.push(resolved);
    }
  }
  if (servers.length === 0 && sourceUrl) {
    servers.push(new URL(sourceUrl).origin);
  }
  return servers;
}

function v2Servers(doc: Json, sourceUrl?: string): string[] {
  const basePath = typeof doc.basePath === "string" ? doc.basePath : "";
  if (typeof doc.host === "string" && doc.host) {
    const schemes = Array.isArray(doc.schemes) ? doc.schemes : [];
    const scheme = schemes.includes("https") ? "https" : (schemes[0] ?? "http");
    return [`${String(scheme)}://${doc.host}${basePath}`.replace(/\/+$/, "")];
  }
  const resolved = resolveServer(basePath || "/", sourceUrl);
  return resolved ? [resolved] : [];
}

function resolveServer(url: string, sourceUrl?: string): string | undefined {
  if (/^https?:\/\//i.test(url)) {
    return url.replace(/\/+$/, "");
  }
  if (!sourceUrl) {
    return undefined;
  }
  try {
    return new URL(url, sourceUrl).toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
