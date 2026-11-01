import * as assert from "assert";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import {
  detectServers,
  fetchSpec,
  isLoopbackUrl,
  liveBaseUrl,
} from "../detect/localhost";

const SPEC = {
  openapi: "3.0.0",
  info: { title: "Live API", version: "9" },
  servers: [{ url: "https://prod.example.com/api" }],
  paths: {},
};

function listen(handler: http.RequestListener): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const portOf = (server: http.Server) => (server.address() as AddressInfo).port;

suite("Localhost detection", () => {
  const servers: http.Server[] = [];

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
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    servers.push(server);
    const port = portOf(server);
    const [found] = await detectServers([port]);
    assert.strictEqual(found.port, port);
    assert.strictEqual(found.spec?.title, "Live API");
    assert.strictEqual(found.spec?.url, `http://127.0.0.1:${port}/v3/api-docs`);
    assert.strictEqual(found.spec?.baseUrl, `http://127.0.0.1:${port}/api`);
  });

  test("lists a running server with no spec, ignoring invalid JSON", async () => {
    const server = await listen((_req, res) => res.end("<html>not json</html>"));
    servers.push(server);
    const [found] = await detectServers([portOf(server)]);
    assert.ok(found);
    assert.strictEqual(found.spec, undefined);
  });

  test("ignores a JSON response that is not a spec", async () => {
    const server = await listen((_req, res) => res.end('{"status":"ok"}'));
    servers.push(server);
    const [found] = await detectServers([portOf(server)]);
    assert.strictEqual(found.spec, undefined);
  });

  test("omits closed ports", async () => {
    const closed = await listen(() => undefined);
    const port = portOf(closed);
    await new Promise((resolve) => closed.close(resolve));
    assert.deepStrictEqual(await detectServers([port]), []);
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
    await assert.rejects(fetchSpec(`http://127.0.0.1:${portOf(redirect)}/`));
    assert.strictEqual(followed, false);
  });

  test("refuses addresses that are not loopback", async () => {
    assert.ok(isLoopbackUrl("http://127.0.0.1:1/"));
    assert.ok(isLoopbackUrl("http://[::1]:1/"));
    assert.ok(isLoopbackUrl("http://localhost:1/"));
    assert.ok(!isLoopbackUrl("http://example.com/"));
    assert.ok(!isLoopbackUrl("http://127.0.0.1.example.com/"));
    assert.ok(!isLoopbackUrl("file:///etc/passwd"));
    await assert.rejects(fetchSpec("http://example.com/openapi.json"), /Not a localhost/);
  });

  test("handles missing or invalid server URLs for the base URL", () => {
    assert.strictEqual(liveBaseUrl("http://127.0.0.1:1"), "http://127.0.0.1:1");
    assert.strictEqual(liveBaseUrl("http://127.0.0.1:1", "/rel"), "http://127.0.0.1:1");
    assert.strictEqual(liveBaseUrl("http://127.0.0.1:1", "https://x.test/"), "http://127.0.0.1:1");
  });
});
