import * as assert from "assert";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { emptyDraft } from "../http/draft";
import { mergeSecrets, redactDraft, splitSecrets } from "../http/redact";
import { buildRequest, sendRequest, substitute, toCurl } from "../http/send";
import type { RequestDraft } from "../model";
import { parseWebviewMessage } from "../shared/messages";

function build(draft: Partial<RequestDraft>, vars = {}) {
  const result = buildRequest({ ...emptyDraft(), ...draft }, vars);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.request;
}

suite("Request building", () => {
  test("substitutes variables and reports missing ones", () => {
    const missing = new Set<string>();
    assert.strictEqual(substitute("{{ a }}/{{b}}", { a: "1" }, missing), "1/{{b}}");
    assert.deepStrictEqual([...missing], ["b"]);
    assert.strictEqual(substitute("{{toString}}", {}), "{{toString}}");
  });

  test("refuses to send unresolved variables or empty path parameters", () => {
    const unresolved = buildRequest(emptyDraft("{{baseUrl}}/x"), {});
    assert.ok(!unresolved.ok && unresolved.error.includes("baseUrl"));
    const emptyPath = buildRequest(
      {
        ...emptyDraft("http://a.test/{id}"),
        pathParams: [{ key: "id", value: "", enabled: true }],
      },
      {},
    );
    assert.ok(!emptyPath.ok && emptyPath.error.includes("id"));
    assert.ok(!buildRequest(emptyDraft("not a url"), {}).ok);
    assert.ok(!buildRequest(emptyDraft("file:///etc/passwd"), {}).ok);
  });

  test("applies path, query, headers and skips disabled rows", () => {
    const request = build(
      {
        url: "{{baseUrl}}/users/{id}",
        pathParams: [{ key: "id", value: "a/b", enabled: true }],
        queryParams: [
          { key: "q", value: "x y", enabled: true },
          { key: "off", value: "1", enabled: false },
        ],
        headers: [{ key: "X-Env", value: "{{env}}", enabled: true }],
      },
      { baseUrl: "http://api.test", env: "dev" },
    );
    assert.strictEqual(request.url, "http://api.test/users/a%2Fb?q=x+y");
    assert.deepStrictEqual(request.headers, [["X-Env", "dev"]]);
  });

  test("applies each auth type", () => {
    const url = "http://a.test/";
    assert.deepStrictEqual(
      build({ url, auth: { type: "bearer", token: "{{t}}" } }, { t: "abc" }).headers,
      [["Authorization", "Bearer abc"]],
    );
    assert.deepStrictEqual(
      build({ url, auth: { type: "basic", username: "u", password: "p" } }).headers,
      [["Authorization", "Basic dTpw"]],
    );
    assert.strictEqual(
      build({ url, auth: { type: "apiKey", key: "k", value: "v", in: "query" } }).url,
      "http://a.test/?k=v",
    );
  });

  test("sends a body only on methods that allow one", () => {
    const url = "http://a.test/";
    assert.strictEqual(build({ url, method: "GET", body: "{}" }).body, undefined);
    const post = build({ url, method: "POST", body: "{}" });
    assert.strictEqual(post.body, "{}");
    assert.deepStrictEqual(post.headers, [["Content-Type", "application/json"]]);
  });

  test("shell-quotes cURL output", () => {
    const curl = toCurl({
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
  let server: http.Server;
  let origin: string;

  suiteSetup(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/echo") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ method: req.method, body }));
        });
      } else if (req.url === "/binary") {
        res.setHeader("content-type", "image/png");
        res.end(Buffer.from([0, 1, 2]));
      } else if (req.url === "/hang") {
        // Never answers, so the test can cancel it.
      } else {
        res.statusCode = 404;
        res.end("nope");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  suiteTeardown(() => {
    server.closeAllConnections();
    server.close();
  });

  const signal = () => new AbortController().signal;

  test("returns status, body, headers and size", async () => {
    const result = await sendRequest(
      { method: "POST", url: `${origin}/echo`, headers: [], body: "hi" },
      signal(),
    );
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(JSON.parse(result.body), { method: "POST", body: "hi" });
    assert.ok(result.sizeBytes > 0);
    assert.ok(result.headers.some(([key]) => key === "content-type"));
  });

  test("reports HTTP errors as responses and flags binary bodies", async () => {
    const missing = await sendRequest({ method: "GET", url: `${origin}/x`, headers: [] }, signal());
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(missing.ok, false);
    const binary = await sendRequest({ method: "GET", url: `${origin}/binary`, headers: [] }, signal());
    assert.strictEqual(binary.binary, true);
    assert.strictEqual(binary.body, "");
  });

  test("gives clear errors for refused and cancelled requests", async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise((resolve) => closed.close(resolve));
    const refused = await sendRequest(
      { method: "GET", url: `http://127.0.0.1:${port}/`, headers: [] },
      signal(),
    );
    assert.match(refused.error ?? "", /refused/i);

    const abort = new AbortController();
    const pending = sendRequest({ method: "GET", url: `${origin}/hang`, headers: [] }, abort.signal);
    setTimeout(() => abort.abort(), 20);
    assert.match((await pending).error ?? "", /cancelled/i);
  });
});

suite("Secret handling", () => {
  const secretDraft: RequestDraft = {
    ...emptyDraft("http://a.test/?token=abc&page=2"),
    headers: [
      { key: "Authorization", value: "Bearer abc", enabled: true },
      { key: "X-Key", value: "{{key}}", enabled: true },
      { key: "Accept", value: "*/*", enabled: true },
    ],
    queryParams: [{ key: "api_key", value: "zzz", enabled: true }],
    auth: { type: "bearer", token: "s3cr3t" },
  };

  test("removes literal secrets and keeps variable references", () => {
    const text = JSON.stringify(redactDraft(secretDraft));
    for (const secret of ["Bearer abc", "zzz", "s3cr3t", "token=abc"]) {
      assert.ok(!text.includes(secret), secret);
    }
    assert.ok(text.includes("{{key}}"));
    assert.ok(text.includes("page=2"));
    assert.ok(text.includes("*/*"));
  });

  test("keeps variable references in auth fields", () => {
    const draft = { ...emptyDraft(), auth: { type: "bearer" as const, token: "{{token}}" } };
    assert.deepStrictEqual(redactDraft(draft).auth, draft.auth);
  });

  test("restores secrets exactly", () => {
    const { clean, secrets } = splitSecrets(secretDraft);
    assert.deepStrictEqual(mergeSecrets(clean, secrets), secretDraft);
  });
});

suite("Webview messages", () => {
  test("accepts valid messages", () => {
    assert.deepStrictEqual(parseWebviewMessage({ type: "ready" }), { type: "ready" });
    assert.ok(parseWebviewMessage({ type: "send", draft: emptyDraft("http://a") }));
    assert.deepStrictEqual(parseWebviewMessage({ type: "setEnv", name: null }), {
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
      { type: "send", draft: { ...emptyDraft(), method: "TRACE" } },
      { type: "send", draft: { ...emptyDraft(), auth: { type: "bearer" } } },
      { type: "openEndpoint", endpointId: 1 },
      { type: "saveEnvs", environments: [{ name: "a", variables: [{}] }] },
    ]) {
      assert.strictEqual(parseWebviewMessage(raw), undefined);
    }
  });
});
