import * as assert from "assert";
import { draftFromEndpoint } from "../http/draft";
import { isSpec, parseSpec } from "../openapi/parse";

const find = (spec: ReturnType<typeof parseSpec>, id: string) => {
  const endpoint = spec.collections
    .flatMap((collection) => collection.endpoints)
    .find((item) => item.id === id);
  assert.ok(endpoint, `missing ${id}`);
  return endpoint;
};

suite("OpenAPI parser", () => {
  test("recognises specs and rejects other JSON", () => {
    assert.ok(isSpec({ openapi: "3.0.0" }));
    assert.ok(isSpec({ swagger: "2.0" }));
    assert.ok(!isSpec({ note: "hi" }));
    assert.ok(!isSpec([]));
    assert.ok(!isSpec(null));
  });

  test("reads OpenAPI 3 collections, parameters and auth", () => {
    const spec = parseSpec({
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
    assert.deepStrictEqual(
      spec.collections.map((collection) => collection.name),
      ["Orders", "Default"],
    );
    const endpoint = find(spec, "GET /orders/{id}");
    assert.strictEqual(endpoint.parameters[0].required, true);
    assert.deepStrictEqual(endpoint.auth, { type: "bearer" });
    assert.deepStrictEqual(endpoint.responses, [{ status: "200", description: "ok" }]);
  });

  test("reads Swagger 2 servers, body and form data", () => {
    const spec = parseSpec({
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
    assert.deepStrictEqual(JSON.parse(invoice.requestBody!.example), { amount: 0 });
    assert.deepStrictEqual(invoice.auth, { type: "apiKey", key: "X-Key", in: "header" });
    assert.strictEqual(find(spec, "POST /login").requestBody!.example, "user=a+b");
  });

  test("survives circular references and looping $ref chains", () => {
    const spec = parseSpec({
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
    assert.deepStrictEqual(JSON.parse(find(spec, "POST /nodes").requestBody!.example), {
      name: "string",
      next: null,
    });
    assert.strictEqual(find(spec, "POST /loop").requestBody!.example, "");
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
    const body = find(parseSpec(doc), "POST /x").requestBody!.example;
    assert.strictEqual(({} as Record<string, unknown>).polluted, undefined);
    assert.deepStrictEqual(Object.keys(JSON.parse(body)).sort(), ["__proto__", "a"]);
  });

  test("uses the source URL for relative servers", () => {
    const spec = parseSpec(
      { openapi: "3.0.0", info: {}, servers: [{ url: "/api" }] },
      "http://127.0.0.1:3000/openapi.json",
    );
    assert.deepStrictEqual(spec.servers, ["http://127.0.0.1:3000/api"]);
  });

  test("builds a request draft and adds undeclared path parameters", () => {
    const spec = parseSpec({
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
    const draft = draftFromEndpoint(find(spec, "GET /a/{id}/b/{other}"));
    assert.strictEqual(draft.url, "{{baseUrl}}/a/{id}/b/{other}");
    assert.deepStrictEqual(
      draft.pathParams.map((row) => [row.key, row.value]),
      [["id", "7"], ["other", ""]],
    );
    assert.strictEqual(draft.queryParams[0].enabled, false);
  });
});
