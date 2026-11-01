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
const localhost_1 = require("../detect/localhost");
const SPEC = {
    openapi: "3.0.0",
    info: { title: "Live API", version: "9" },
    servers: [{ url: "https://prod.example.com/api" }],
    paths: {},
};
function listen(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, "127.0.0.1", () => resolve(server));
    });
}
const portOf = (server) => server.address().port;
suite("Localhost detection", () => {
    const servers = [];
    suiteTeardown(() => {
        for (const server of servers) {
            server.closeAllConnections();
            server.close();
        }
    });
    test("finds a server's spec and points its base URL at the server", async () => {
        const server = await listen((req, res) => {
            if (req.url === "/v3/api-docs") {
                res.end(JSON.stringify(SPEC));
            }
            else {
                res.statusCode = 404;
                res.end();
            }
        });
        servers.push(server);
        const port = portOf(server);
        const [found] = await (0, localhost_1.detectServers)([port]);
        assert.strictEqual(found.port, port);
        assert.strictEqual(found.spec?.title, "Live API");
        assert.strictEqual(found.spec?.url, `http://127.0.0.1:${port}/v3/api-docs`);
        assert.strictEqual(found.spec?.baseUrl, `http://127.0.0.1:${port}/api`);
    });
    test("lists a running server with no spec, ignoring invalid JSON", async () => {
        const server = await listen((_req, res) => res.end("<html>not json</html>"));
        servers.push(server);
        const [found] = await (0, localhost_1.detectServers)([portOf(server)]);
        assert.ok(found);
        assert.strictEqual(found.spec, undefined);
    });
    test("ignores a JSON response that is not a spec", async () => {
        const server = await listen((_req, res) => res.end('{"status":"ok"}'));
        servers.push(server);
        const [found] = await (0, localhost_1.detectServers)([portOf(server)]);
        assert.strictEqual(found.spec, undefined);
    });
    test("omits closed ports", async () => {
        const closed = await listen(() => undefined);
        const port = portOf(closed);
        await new Promise((resolve) => closed.close(resolve));
        assert.deepStrictEqual(await (0, localhost_1.detectServers)([port]), []);
    });
    test("does not follow redirects", async () => {
        let followed = false;
        const target = await listen((_req, res) => {
            followed = true;
            res.end(JSON.stringify(SPEC));
        });
        const redirect = await listen((_req, res) => {
            res.statusCode = 302;
            res.setHeader("location", `http://127.0.0.1:${portOf(target)}/`);
            res.end();
        });
        servers.push(target, redirect);
        await assert.rejects((0, localhost_1.fetchSpec)(`http://127.0.0.1:${portOf(redirect)}/`));
        assert.strictEqual(followed, false);
    });
    test("refuses addresses that are not loopback", async () => {
        assert.ok((0, localhost_1.isLoopbackUrl)("http://127.0.0.1:1/"));
        assert.ok((0, localhost_1.isLoopbackUrl)("http://[::1]:1/"));
        assert.ok((0, localhost_1.isLoopbackUrl)("http://localhost:1/"));
        assert.ok(!(0, localhost_1.isLoopbackUrl)("http://example.com/"));
        assert.ok(!(0, localhost_1.isLoopbackUrl)("http://127.0.0.1.example.com/"));
        assert.ok(!(0, localhost_1.isLoopbackUrl)("file:///etc/passwd"));
        await assert.rejects((0, localhost_1.fetchSpec)("http://example.com/openapi.json"), /Not a localhost/);
    });
    test("handles missing or invalid server URLs for the base URL", () => {
        assert.strictEqual((0, localhost_1.liveBaseUrl)("http://127.0.0.1:1"), "http://127.0.0.1:1");
        assert.strictEqual((0, localhost_1.liveBaseUrl)("http://127.0.0.1:1", "/rel"), "http://127.0.0.1:1");
        assert.strictEqual((0, localhost_1.liveBaseUrl)("http://127.0.0.1:1", "https://x.test/"), "http://127.0.0.1:1");
    });
});
//# sourceMappingURL=detect.test.js.map