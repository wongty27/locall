"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const draft_1 = require("../http/draft");
const parse_1 = require("../openapi/parse");
const find = (spec, id) => {
    const endpoint = spec.collections
        .flatMap((collection) => collection.endpoints)
        .find((item) => item.id === id);
    assert.ok(endpoint, `missing ${id}`);
    return endpoint;
};
suite("OpenAPI parser", () => {
    test("recognises specs and rejects other JSON", () => {
        assert.ok((0, parse_1.isSpec)({ openapi: "3.0.0" }));
        assert.ok((0, parse_1.isSpec)({ swagger: "2.0" }));
        assert.ok(!(0, parse_1.isSpec)({ note: "hi" }));
        assert.ok(!(0, parse_1.isSpec)([]));
        assert.ok(!(0, parse_1.isSpec)(null));
    });
    test("reads OpenAPI 3 collections, parameters and auth", () => {
        const spec = (0, parse_1.parseSpec)({
            openapi: "3.0.3",
            info: { title: "Shop", version: "1" },
            servers: [{ url: "https://{env}.example.com/api/", variables: { env: { default: "dev" } } }],
            tags: [{ name: "Orders", description: "Order things" }, { name: "Unused" }],
            components: { securitySchemes: { jwt: { type: "http", scheme: "bearer" } } },
            paths: {
                "/orders/{id}": {
                    parameters: [{ name: "id", in: "path", schema: { type: "integer" } }],
                    get: { tags: ["Orders"], security: [{ jwt: [] }], responses: { 200: { description: "ok" } } },
                },
                "/health": { get: {} },
            },
        });
        assert.deepStrictEqual(spec.servers, ["https://dev.example.com/api"]);
        assert.deepStrictEqual(spec.collections.map((collection) => collection.name), ["Orders", "Default"]);
        const endpoint = find(spec, "GET /orders/{id}");
        assert.strictEqual(endpoint.parameters[0].required, true);
        assert.deepStrictEqual(endpoint.auth, { type: "bearer" });
        assert.deepStrictEqual(endpoint.responses, [{ status: "200", description: "ok" }]);
    });
    test("reads Swagger 2 servers, body and form data", () => {
        const spec = (0, parse_1.parseSpec)({
            swagger: "2.0",
            info: { title: "Billing", version: "2" },
            host: "api.test",
            basePath: "/v1",
            schemes: ["http", "https"],
            definitions: { Invoice: { type: "object", properties: { amount: { type: "number" } } } },
            securityDefinitions: { key: { type: "apiKey", name: "X-Key", in: "header" } },
            paths: {
                "/invoices": {
                    post: {
                        security: [{ key: [] }],
                        parameters: [{ name: "body", in: "body", schema: { $ref: "#/definitions/Invoice" } }],
                    },
                },
                "/login": {
                    post: {
                        consumes: ["application/x-www-form-urlencoded"],
                        parameters: [{ name: "user", in: "formData", type: "string", default: "a b" }],
                    },
                },
            },
        });
        assert.deepStrictEqual(spec.servers, ["https://api.test/v1"]);
        const invoice = find(spec, "POST /invoices");
        assert.deepStrictEqual(JSON.parse(invoice.requestBody.example), { amount: 0 });
        assert.deepStrictEqual(invoice.auth, { type: "apiKey", key: "X-Key", in: "header" });
        assert.strictEqual(find(spec, "POST /login").requestBody.example, "user=a+b");
    });
    test("survives circular references and looping $ref chains", () => {
        const spec = (0, parse_1.parseSpec)({
            openapi: "3.1.0",
            info: { title: "Loop" },
            components: {
                schemas: {
                    Node: { type: "object", properties: { name: { type: "string" }, next: { $ref: "#/components/schemas/Node" } } },
                    A: { $ref: "#/components/schemas/B" },
                    B: { $ref: "#/components/schemas/A" },
                },
                parameters: { P: { $ref: "#/components/parameters/P" } },
            },
            paths: {
                "/nodes": {
                    post: {
                        parameters: [{ $ref: "#/components/parameters/P" }],
                        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Node" } } } },
                    },
                },
                "/loop": {
                    post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/A" } } } } },
                },
            },
        });
        assert.deepStrictEqual(JSON.parse(find(spec, "POST /nodes").requestBody.example), {
            name: "string",
            next: null,
        });
        assert.strictEqual(find(spec, "POST /loop").requestBody.example, "");
    });
    test("does not follow __proto__ in references or properties", () => {
        const doc = JSON.parse(`{
      "openapi": "3.0.0",
      "info": { "title": "Proto" },
      "paths": { "/x": { "post": { "requestBody": { "content": { "application/json": {
        "schema": { "type": "object", "properties": {
          "__proto__": { "type": "string" },
          "a": { "$ref": "#/__proto__/toString" }
        } }
      } } } } } }
    }`);
        const body = find((0, parse_1.parseSpec)(doc), "POST /x").requestBody.example;
        assert.strictEqual({}.polluted, undefined);
        assert.deepStrictEqual(Object.keys(JSON.parse(body)).sort(), ["__proto__", "a"]);
    });
    test("uses the source URL for relative servers", () => {
        const spec = (0, parse_1.parseSpec)({ openapi: "3.0.0", info: {}, servers: [{ url: "/api" }] }, "http://127.0.0.1:3000/openapi.json");
        assert.deepStrictEqual(spec.servers, ["http://127.0.0.1:3000/api"]);
    });
    test("builds a request draft and adds undeclared path parameters", () => {
        const spec = (0, parse_1.parseSpec)({
            openapi: "3.0.0",
            info: {},
            paths: {
                "/a/{id}/b/{other}": {
                    get: {
                        parameters: [
                            { name: "id", in: "path", required: true, example: 7 },
                            { name: "q", in: "query" },
                        ],
                    },
                },
            },
        });
        const draft = (0, draft_1.draftFromEndpoint)(find(spec, "GET /a/{id}/b/{other}"));
        assert.strictEqual(draft.url, "{{baseUrl}}/a/{id}/b/{other}");
        assert.deepStrictEqual(draft.pathParams.map((row) => [row.key, row.value]), [["id", "7"], ["other", ""]]);
        assert.strictEqual(draft.queryParams[0].enabled, false);
    });
});
//# sourceMappingURL=openapi.test.js.map