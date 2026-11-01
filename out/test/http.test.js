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
const http = __importStar(require("node:http"));
const draft_1 = require("../http/draft");
const redact_1 = require("../http/redact");
const send_1 = require("../http/send");
const messages_1 = require("../shared/messages");
function build(draft, vars = {}) {
    const result = (0, send_1.buildRequest)({ ...(0, draft_1.emptyDraft)(), ...draft }, vars);
    assert.ok(result.ok, result.ok ? "" : result.error);
    return result.request;
}
suite("Request building", () => {
    test("substitutes variables and reports missing ones", () => {
        const missing = new Set();
        assert.strictEqual((0, send_1.substitute)("{{ a }}/{{b}}", { a: "1" }, missing), "1/{{b}}");
        assert.deepStrictEqual([...missing], ["b"]);
        assert.strictEqual((0, send_1.substitute)("{{toString}}", {}), "{{toString}}");
    });
    test("refuses to send unresolved variables or empty path parameters", () => {
        const unresolved = (0, send_1.buildRequest)((0, draft_1.emptyDraft)("{{baseUrl}}/x"), {});
        assert.ok(!unresolved.ok && unresolved.error.includes("baseUrl"));
        const emptyPath = (0, send_1.buildRequest)({
            ...(0, draft_1.emptyDraft)("http://a.test/{id}"),
            pathParams: [{ key: "id", value: "", enabled: true }],
        }, {});
        assert.ok(!emptyPath.ok && emptyPath.error.includes("id"));
        assert.ok(!(0, send_1.buildRequest)((0, draft_1.emptyDraft)("not a url"), {}).ok);
        assert.ok(!(0, send_1.buildRequest)((0, draft_1.emptyDraft)("file:///etc/passwd"), {}).ok);
    });
    test("applies path, query, headers and skips disabled rows", () => {
        const request = build({
            url: "{{baseUrl}}/users/{id}",
            pathParams: [{ key: "id", value: "a/b", enabled: true }],
            queryParams: [
                { key: "q", value: "x y", enabled: true },
                { key: "off", value: "1", enabled: false },
            ],
            headers: [{ key: "X-Env", value: "{{env}}", enabled: true }],
        }, { baseUrl: "http://api.test", env: "dev" });
        assert.strictEqual(request.url, "http://api.test/users/a%2Fb?q=x+y");
        assert.deepStrictEqual(request.headers, [["X-Env", "dev"]]);
    });
    test("applies each auth type", () => {
        const url = "http://a.test/";
        assert.deepStrictEqual(build({ url, auth: { type: "bearer", token: "{{t}}" } }, { t: "abc" }).headers, [["Authorization", "Bearer abc"]]);
        assert.deepStrictEqual(build({ url, auth: { type: "basic", username: "u", password: "p" } }).headers, [["Authorization", "Basic dTpw"]]);
        assert.strictEqual(build({ url, auth: { type: "apiKey", key: "k", value: "v", in: "query" } }).url, "http://a.test/?k=v");
    });
    test("sends a body only on methods that allow one", () => {
        const url = "http://a.test/";
        assert.strictEqual(build({ url, method: "GET", body: "{}" }).body, undefined);
        const post = build({ url, method: "POST", body: "{}" });
        assert.strictEqual(post.body, "{}");
        assert.deepStrictEqual(post.headers, [["Content-Type", "application/json"]]);
    });
    test("shell-quotes cURL output", () => {
        const curl = (0, send_1.toCurl)({
            method: "POST",
            url: "http://a.test/",
            headers: [["X-A", "it's"]],
            body: "$(whoami)'",
        });
        assert.ok(curl.includes(`'X-A: it'\\''s'`));
        assert.ok(curl.includes(`--data-raw '$(whoami)'\\'''`));
    });
});
suite("Sending", () => {
    let server;
    let origin;
    suiteSetup(async () => {
        server = http.createServer((req, res) => {
            if (req.url === "/echo") {
                let body = "";
                req.on("data", (chunk) => (body += chunk));
                req.on("end", () => {
                    res.setHeader("content-type", "application/json");
                    res.end(JSON.stringify({ method: req.method, body }));
                });
            }
            else if (req.url === "/binary") {
                res.setHeader("content-type", "image/png");
                res.end(Buffer.from([0, 1, 2]));
            }
            else if (req.url === "/hang") {
                // Never answers, so the test can cancel it.
            }
            else {
                res.statusCode = 404;
                res.end("nope");
            }
        });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        origin = `http://127.0.0.1:${server.address().port}`;
    });
    suiteTeardown(() => {
        server.closeAllConnections();
        server.close();
    });
    const signal = () => new AbortController().signal;
    test("returns status, body, headers and size", async () => {
        const result = await (0, send_1.sendRequest)({ method: "POST", url: `${origin}/echo`, headers: [], body: "hi" }, signal());
        assert.strictEqual(result.status, 200);
        assert.deepStrictEqual(JSON.parse(result.body), { method: "POST", body: "hi" });
        assert.ok(result.sizeBytes > 0);
        assert.ok(result.headers.some(([key]) => key === "content-type"));
    });
    test("reports HTTP errors as responses and flags binary bodies", async () => {
        const missing = await (0, send_1.sendRequest)({ method: "GET", url: `${origin}/x`, headers: [] }, signal());
        assert.strictEqual(missing.status, 404);
        assert.strictEqual(missing.ok, false);
        const binary = await (0, send_1.sendRequest)({ method: "GET", url: `${origin}/binary`, headers: [] }, signal());
        assert.strictEqual(binary.binary, true);
        assert.strictEqual(binary.body, "");
    });
    test("gives clear errors for refused and cancelled requests", async () => {
        const closed = http.createServer();
        await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
        const { port } = closed.address();
        await new Promise((resolve) => closed.close(resolve));
        const refused = await (0, send_1.sendRequest)({ method: "GET", url: `http://127.0.0.1:${port}/`, headers: [] }, signal());
        assert.match(refused.error ?? "", /refused/i);
        const abort = new AbortController();
        const pending = (0, send_1.sendRequest)({ method: "GET", url: `${origin}/hang`, headers: [] }, abort.signal);
        setTimeout(() => abort.abort(), 20);
        assert.match((await pending).error ?? "", /cancelled/i);
    });
});
suite("Secret handling", () => {
    const secretDraft = {
        ...(0, draft_1.emptyDraft)("http://a.test/?token=abc&page=2"),
        headers: [
            { key: "Authorization", value: "Bearer abc", enabled: true },
            { key: "X-Key", value: "{{key}}", enabled: true },
            { key: "Accept", value: "*/*", enabled: true },
        ],
        queryParams: [{ key: "api_key", value: "zzz", enabled: true }],
        auth: { type: "bearer", token: "s3cr3t" },
    };
    test("removes literal secrets and keeps variable references", () => {
        const text = JSON.stringify((0, redact_1.redactDraft)(secretDraft));
        for (const secret of ["Bearer abc", "zzz", "s3cr3t", "token=abc"]) {
            assert.ok(!text.includes(secret), secret);
        }
        assert.ok(text.includes("{{key}}"));
        assert.ok(text.includes("page=2"));
        assert.ok(text.includes("*/*"));
    });
    test("keeps variable references in auth fields", () => {
        const draft = { ...(0, draft_1.emptyDraft)(), auth: { type: "bearer", token: "{{token}}" } };
        assert.deepStrictEqual((0, redact_1.redactDraft)(draft).auth, draft.auth);
    });
    test("restores secrets exactly", () => {
        const { clean, secrets } = (0, redact_1.splitSecrets)(secretDraft);
        assert.deepStrictEqual((0, redact_1.mergeSecrets)(clean, secrets), secretDraft);
    });
});
suite("Webview messages", () => {
    test("accepts valid messages", () => {
        assert.deepStrictEqual((0, messages_1.parseWebviewMessage)({ type: "ready" }), { type: "ready" });
        assert.ok((0, messages_1.parseWebviewMessage)({ type: "send", draft: (0, draft_1.emptyDraft)("http://a") }));
        assert.deepStrictEqual((0, messages_1.parseWebviewMessage)({ type: "setEnv", name: null }), {
            type: "setEnv",
            name: null,
        });
    });
    test("drops malformed messages", () => {
        for (const raw of [
            null,
            "ready",
            { type: "unknown" },
            { type: "send" },
            { type: "send", draft: { ...(0, draft_1.emptyDraft)(), method: "TRACE" } },
            { type: "send", draft: { ...(0, draft_1.emptyDraft)(), auth: { type: "bearer" } } },
            { type: "openEndpoint", endpointId: 1 },
            { type: "saveEnvs", environments: [{ name: "a", variables: [{}] }] },
        ]) {
            assert.strictEqual((0, messages_1.parseWebviewMessage)(raw), undefined);
        }
    });
});
//# sourceMappingURL=http.test.js.map