"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDraft = isDraft;
exports.parseWebviewMessage = parseWebviewMessage;
const model_1 = require("../model");
const isString = (value) => typeof value === "string";
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function isKeyValue(value) {
    return (isObject(value) &&
        isString(value.key) &&
        isString(value.value) &&
        typeof value.enabled === "boolean");
}
function isAuth(value) {
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
            return (isString(value.key) &&
                isString(value.value) &&
                (value.in === "header" || value.in === "query"));
        default:
            return false;
    }
}
function isDraft(value) {
    return (isObject(value) &&
        model_1.HTTP_METHODS.includes(value.method) &&
        isString(value.url) &&
        Array.isArray(value.pathParams) &&
        value.pathParams.every(isKeyValue) &&
        Array.isArray(value.queryParams) &&
        value.queryParams.every(isKeyValue) &&
        Array.isArray(value.headers) &&
        value.headers.every(isKeyValue) &&
        isAuth(value.auth) &&
        isString(value.contentType) &&
        isString(value.body));
}
function isEnvironment(value) {
    return (isObject(value) &&
        isString(value.name) &&
        (value.copiedFrom === undefined || isString(value.copiedFrom)) &&
        Array.isArray(value.variables) &&
        value.variables.every((item) => isObject(item) &&
            isString(item.key) &&
            isString(item.value) &&
            typeof item.secret === "boolean"));
}
/** Webview content is treated as untrusted: anything malformed is dropped. */
function parseWebviewMessage(raw) {
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
//# sourceMappingURL=messages.js.map