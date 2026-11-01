"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSpec = isSpec;
exports.parseSpec = parseSpec;
const example_1 = require("./example");
const PATH_METHODS = [
    ["get", "GET"],
    ["post", "POST"],
    ["put", "PUT"],
    ["patch", "PATCH"],
    ["delete", "DELETE"],
    ["head", "HEAD"],
    ["options", "OPTIONS"],
];
const DEFAULT_COLLECTION = "Default";
function isSpec(doc) {
    const object = (0, example_1.asObject)(doc);
    return (!!object &&
        (typeof object.openapi === "string" || typeof object.swagger === "string"));
}
/**
 * Converts a Swagger 2.0 or OpenAPI 3.x document to the internal model.
 * @param sourceUrl where the spec was fetched from, for resolving relative servers
 */
function parseSpec(doc, sourceUrl) {
    const isV2 = typeof doc.swagger === "string";
    const info = (0, example_1.asObject)(doc.info) ?? {};
    const collections = new Map();
    for (const item of Array.isArray(doc.tags) ? doc.tags : []) {
        const tag = (0, example_1.asObject)(item);
        if (tag && typeof tag.name === "string") {
            collections.set(tag.name, {
                name: tag.name,
                description: text(tag.description),
                endpoints: [],
            });
        }
    }
    for (const [path, rawItem] of Object.entries((0, example_1.asObject)(doc.paths) ?? {})) {
        const pathItem = (0, example_1.deref)(doc, rawItem);
        if (!pathItem) {
            continue;
        }
        for (const [key, method] of PATH_METHODS) {
            const operation = (0, example_1.asObject)(pathItem[key]);
            if (!operation) {
                continue;
            }
            const tags = Array.isArray(operation.tags) ? operation.tags : [];
            const tagName = typeof tags[0] === "string" && tags[0] ? tags[0] : DEFAULT_COLLECTION;
            let collection = collections.get(tagName);
            if (!collection) {
                collection = { name: tagName, endpoints: [] };
                collections.set(tagName, collection);
            }
            collection.endpoints.push(parseOperation(doc, isV2, method, path, pathItem, operation));
        }
    }
    return {
        title: text(info.title) ?? "Untitled API",
        version: text(info.version) ?? "",
        description: text(info.description),
        specVersion: String(isV2 ? doc.swagger : doc.openapi),
        servers: isV2 ? v2Servers(doc, sourceUrl) : v3Servers(doc, sourceUrl),
        collections: [...collections.values()].filter((collection) => collection.endpoints.length > 0),
    };
}
function parseOperation(doc, isV2, method, path, pathItem, operation) {
    // Operation parameters override path-level ones with the same name and location.
    const rawParams = new Map();
    for (const source of [pathItem.parameters, operation.parameters]) {
        for (const entry of Array.isArray(source) ? source : []) {
            const param = (0, example_1.deref)(doc, entry);
            if (param && typeof param.name === "string") {
                rawParams.set(`${String(param.in)}:${param.name}`, param);
            }
        }
    }
    const parameters = [];
    const bodyParams = [];
    for (const param of rawParams.values()) {
        if (param.in === "path" ||
            param.in === "query" ||
            param.in === "header" ||
            param.in === "cookie") {
            parameters.push({
                name: String(param.name),
                in: param.in,
                required: param.required === true || param.in === "path",
                description: text(param.description),
                example: parameterExample(doc, param),
            });
        }
        else if (param.in === "body" || param.in === "formData") {
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
        responses: Object.entries((0, example_1.asObject)(operation.responses) ?? {}).map(([status, value]) => ({
            status,
            description: text((0, example_1.deref)(doc, value)?.description),
        })),
        auth: authHint(doc, operation),
    };
}
function parameterExample(doc, param) {
    if (param.example !== undefined) {
        return stringify(param.example);
    }
    const first = Object.values((0, example_1.asObject)(param.examples) ?? {})[0];
    const firstValue = (0, example_1.deref)(doc, first)?.value;
    if (firstValue !== undefined) {
        return stringify(firstValue);
    }
    // Swagger 2 declares the schema fields on the parameter itself.
    const schema = (0, example_1.deref)(doc, param.schema) ?? param;
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
function v3Body(doc, operation) {
    const body = (0, example_1.deref)(doc, operation.requestBody);
    const content = (0, example_1.asObject)(body?.content);
    if (!body || !content) {
        return undefined;
    }
    const types = Object.keys(content);
    const contentType = types.find((type) => type === "application/json") ??
        types.find((type) => /[/+]json\b/.test(type)) ??
        types.find((type) => !type.startsWith("multipart/")) ??
        types[0];
    if (!contentType) {
        return undefined;
    }
    const media = (0, example_1.asObject)(content[contentType]) ?? {};
    let value = media.example;
    if (value === undefined) {
        value = (0, example_1.deref)(doc, Object.values((0, example_1.asObject)(media.examples) ?? {})[0])?.value;
    }
    if (value === undefined) {
        value = (0, example_1.schemaExample)(doc, media.schema);
    }
    return {
        contentType,
        example: bodyText(contentType, value),
        required: body.required === true,
    };
}
function v2Body(doc, operation, params) {
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
        const contentType = consumes.find((type) => /json/.test(String(type))) ??
            consumes[0] ??
            "application/json";
        return {
            contentType: String(contentType),
            example: bodyText(String(contentType), (0, example_1.schemaExample)(doc, body.schema)),
            required: body.required === true,
        };
    }
    const fields = {};
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
function bodyText(contentType, value) {
    if (contentType.startsWith("multipart/")) {
        return ""; // Needs a generated boundary; not supported as raw text.
    }
    if (contentType === "application/x-www-form-urlencoded" && (0, example_1.asObject)(value)) {
        return new URLSearchParams(Object.entries(value).map(([key, item]) => [key, stringify(item)])).toString();
    }
    if (typeof value === "string") {
        return value;
    }
    return value === null || value === undefined
        ? ""
        : JSON.stringify(value, null, 2);
}
function authHint(doc, operation) {
    const security = operation.security ?? doc.security;
    if (!Array.isArray(security)) {
        return undefined;
    }
    const schemes = (0, example_1.asObject)((0, example_1.asObject)(doc.components)?.securitySchemes) ??
        (0, example_1.asObject)(doc.securityDefinitions) ??
        {};
    for (const requirement of security) {
        for (const name of Object.keys((0, example_1.asObject)(requirement) ?? {})) {
            const scheme = (0, example_1.deref)(doc, schemes[name]);
            if (!scheme) {
                continue;
            }
            if (scheme.type === "apiKey") {
                if (typeof scheme.name === "string" &&
                    (scheme.in === "header" || scheme.in === "query")) {
                    return { type: "apiKey", key: scheme.name, in: scheme.in };
                }
            }
            else if (scheme.type === "basic" ||
                (scheme.type === "http" &&
                    String(scheme.scheme).toLowerCase() === "basic")) {
                return { type: "basic" };
            }
            else if (scheme.type === "oauth2" ||
                scheme.type === "openIdConnect" ||
                scheme.type === "http") {
                return { type: "bearer" };
            }
        }
    }
    return undefined;
}
function v3Servers(doc, sourceUrl) {
    const servers = [];
    for (const entry of Array.isArray(doc.servers) ? doc.servers : []) {
        const server = (0, example_1.asObject)(entry);
        if (!server || typeof server.url !== "string") {
            continue;
        }
        let url = server.url;
        for (const [name, value] of Object.entries((0, example_1.asObject)(server.variables) ?? {})) {
            const fallback = (0, example_1.asObject)(value)?.default;
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
function v2Servers(doc, sourceUrl) {
    const basePath = typeof doc.basePath === "string" ? doc.basePath : "";
    if (typeof doc.host === "string" && doc.host) {
        const schemes = Array.isArray(doc.schemes) ? doc.schemes : [];
        const scheme = schemes.includes("https") ? "https" : (schemes[0] ?? "http");
        return [`${String(scheme)}://${doc.host}${basePath}`.replace(/\/+$/, "")];
    }
    const resolved = resolveServer(basePath || "/", sourceUrl);
    return resolved ? [resolved] : [];
}
function resolveServer(url, sourceUrl) {
    if (/^https?:\/\//i.test(url)) {
        return url.replace(/\/+$/, "");
    }
    if (!sourceUrl) {
        return undefined;
    }
    try {
        return new URL(url, sourceUrl).toString().replace(/\/+$/, "");
    }
    catch {
        return undefined;
    }
}
function text(value) {
    return typeof value === "string" && value ? value : undefined;
}
function stringify(value) {
    return typeof value === "string" ? value : JSON.stringify(value);
}
//# sourceMappingURL=parse.js.map