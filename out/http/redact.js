"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitSecrets = splitSecrets;
exports.mergeSecrets = mergeSecrets;
exports.redactDraft = redactDraft;
const SENSITIVE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|client[-_]?secret|password|passwd)$/i;
/** A value that only references a variable holds no secret itself. */
function isLiteral(value) {
    return value !== "" && !/^\s*\{\{[^{}]+\}\}\s*$/.test(value);
}
/**
 * Separates secret values from a draft so the rest is safe to write to disk.
 * Request bodies are user-authored free text and are kept as they are.
 */
function splitSecrets(draft) {
    const secrets = {};
    const clean = {
        ...draft,
        pathParams: draft.pathParams.map((row) => ({ ...row })),
        queryParams: draft.queryParams.map((row) => scrub(row, "query", secrets)),
        headers: draft.headers.map((row) => scrub(row, "header", secrets)),
        auth: { ...draft.auth },
    };
    const auth = clean.auth;
    if (auth.type === "bearer" && isLiteral(auth.token)) {
        secrets["auth:token"] = auth.token;
        auth.token = "";
    }
    else if (auth.type === "basic" && isLiteral(auth.password)) {
        secrets["auth:password"] = auth.password;
        auth.password = "";
    }
    else if (auth.type === "apiKey" && isLiteral(auth.value)) {
        secrets["auth:value"] = auth.value;
        auth.value = "";
    }
    const queryStart = draft.url.indexOf("?");
    if (queryStart >= 0) {
        const pairs = draft.url.slice(queryStart + 1).split("&");
        const cleaned = pairs.map((pair) => {
            const [key, ...rest] = pair.split("=");
            const value = rest.join("=");
            return SENSITIVE.test(key) && isLiteral(value) ? `${key}=` : pair;
        });
        if (cleaned.join("&") !== pairs.join("&")) {
            secrets.url = draft.url;
            clean.url = `${draft.url.slice(0, queryStart)}?${cleaned.join("&")}`;
        }
    }
    return { clean, secrets };
}
/** Puts secrets from `splitSecrets` back into a stored draft. */
function mergeSecrets(draft, secrets) {
    const restore = (rows, prefix) => rows.map((row) => {
        const value = secrets[`${prefix}:${row.key}`];
        return value === undefined ? row : { ...row, value };
    });
    const merged = {
        ...draft,
        url: secrets.url ?? draft.url,
        queryParams: restore(draft.queryParams, "query"),
        headers: restore(draft.headers, "header"),
        auth: { ...draft.auth },
    };
    const auth = merged.auth;
    if (auth.type === "bearer") {
        auth.token = secrets["auth:token"] ?? auth.token;
    }
    else if (auth.type === "basic") {
        auth.password = secrets["auth:password"] ?? auth.password;
    }
    else if (auth.type === "apiKey") {
        auth.value = secrets["auth:value"] ?? auth.value;
    }
    return merged;
}
function redactDraft(draft) {
    return splitSecrets(draft).clean;
}
function scrub(row, prefix, secrets) {
    if (SENSITIVE.test(row.key) && isLiteral(row.value)) {
        secrets[`${prefix}:${row.key}`] = row.value;
        return { ...row, value: "" };
    }
    return { ...row };
}
//# sourceMappingURL=redact.js.map