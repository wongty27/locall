"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyDraft = emptyDraft;
exports.draftFromEndpoint = draftFromEndpoint;
function emptyDraft(url = "") {
    return {
        method: "GET",
        url,
        pathParams: [],
        queryParams: [],
        headers: [],
        auth: { type: "none" },
        contentType: "application/json",
        body: "",
    };
}
/** Builds the initial request from what the spec says about an endpoint. */
function draftFromEndpoint(endpoint) {
    const toRow = (param) => ({
        key: param.name,
        value: param.example ?? "",
        enabled: param.required || param.example !== undefined,
        description: param.description,
        required: param.required,
    });
    const pathParams = endpoint.parameters
        .filter((param) => param.in === "path")
        .map(toRow);
    // Specs sometimes omit a path parameter that the path template still needs.
    for (const match of endpoint.path.matchAll(/\{([^}]+)\}/g)) {
        if (!pathParams.some((row) => row.key === match[1])) {
            pathParams.push({
                key: match[1],
                value: "",
                enabled: true,
                required: true,
            });
        }
    }
    return {
        method: endpoint.method,
        url: `{{baseUrl}}${endpoint.path}`,
        pathParams,
        queryParams: endpoint.parameters
            .filter((param) => param.in === "query")
            .map(toRow),
        headers: endpoint.parameters
            .filter((param) => param.in === "header")
            .map(toRow),
        auth: authFromHint(endpoint),
        contentType: endpoint.requestBody?.contentType ?? "application/json",
        body: endpoint.requestBody?.example ?? "",
    };
}
function authFromHint(endpoint) {
    switch (endpoint.auth?.type) {
        case "bearer":
            return { type: "bearer", token: "" };
        case "basic":
            return { type: "basic", username: "", password: "" };
        case "apiKey":
            return {
                type: "apiKey",
                key: endpoint.auth.key,
                value: "",
                in: endpoint.auth.in,
            };
        default:
            return { type: "none" };
    }
}
//# sourceMappingURL=draft.js.map