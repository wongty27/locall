"use strict";
// Generates a sample value from a JSON schema for pre-filling request bodies.
Object.defineProperty(exports, "__esModule", { value: true });
exports.asObject = asObject;
exports.lookupRef = lookupRef;
exports.deref = deref;
exports.schemaExample = schemaExample;
const MAX_DEPTH = 12;
const MAX_NODES = 5000;
function asObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
/** Looks up a local "#/a/b" reference. Remote references return undefined. */
function lookupRef(doc, ref) {
    if (!ref.startsWith("#/")) {
        return undefined;
    }
    let current = doc;
    for (const raw of ref.slice(2).split("/")) {
        const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
        const object = asObject(current);
        if (!object || !Object.hasOwn(object, key)) {
            return undefined;
        }
        current = object[key];
    }
    return current;
}
/** Follows a chain of $ref nodes, stopping if the chain loops. */
function deref(doc, node) {
    const seen = new Set();
    let current = asObject(node);
    while (current && typeof current.$ref === "string") {
        if (seen.has(current.$ref)) {
            return undefined;
        }
        seen.add(current.$ref);
        current = asObject(lookupRef(doc, current.$ref));
    }
    return current;
}
function schemaExample(doc, schema) {
    return build(doc, schema, new Set(), 0, { nodes: 0 });
}
function build(doc, node, stack, depth, budget) {
    budget.nodes++;
    if (depth > MAX_DEPTH || budget.nodes > MAX_NODES) {
        return null;
    }
    const raw = asObject(node);
    if (!raw) {
        return null;
    }
    if (typeof raw.$ref === "string") {
        if (stack.has(raw.$ref)) {
            return null;
        }
        const next = new Set(stack).add(raw.$ref);
        return build(doc, lookupRef(doc, raw.$ref), next, depth + 1, budget);
    }
    for (const key of ["example", "default", "const"]) {
        if (raw[key] !== undefined) {
            return raw[key];
        }
    }
    if (Array.isArray(raw.examples) && raw.examples.length > 0) {
        return raw.examples[0];
    }
    if (Array.isArray(raw.enum) && raw.enum.length > 0) {
        return raw.enum[0];
    }
    if (Array.isArray(raw.allOf)) {
        const merged = {};
        for (const part of raw.allOf) {
            const value = build(doc, part, stack, depth + 1, budget);
            if (asObject(value)) {
                Object.assign(merged, value);
            }
        }
        return merged;
    }
    const variants = raw.oneOf ?? raw.anyOf;
    if (Array.isArray(variants) && variants.length > 0) {
        return build(doc, variants[0], stack, depth + 1, budget);
    }
    const type = Array.isArray(raw.type)
        ? raw.type.find((item) => item !== "null")
        : raw.type;
    const properties = asObject(raw.properties);
    if (type === "object" || properties) {
        const result = {};
        for (const [key, value] of Object.entries(properties ?? {})) {
            Object.defineProperty(result, key, {
                value: build(doc, value, stack, depth + 1, budget),
                enumerable: true,
                writable: true,
                configurable: true,
            });
        }
        return result;
    }
    switch (type) {
        case "array":
            return raw.items === undefined
                ? []
                : [build(doc, raw.items, stack, depth + 1, budget)];
        case "integer":
        case "number":
            return 0;
        case "boolean":
            return true;
        case "string":
            return stringExample(raw.format);
        default:
            return null;
    }
}
function stringExample(format) {
    switch (format) {
        case "date":
            return "2026-01-01";
        case "date-time":
            return "2026-01-01T00:00:00Z";
        case "email":
            return "user@example.com";
        case "uuid":
            return "00000000-0000-0000-0000-000000000000";
        case "uri":
        case "url":
            return "https://example.com";
        default:
            return "string";
    }
}
//# sourceMappingURL=example.js.map