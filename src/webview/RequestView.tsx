import { useMemo, useState } from "preact/hooks";
import {
  HTTP_METHODS,
  type Auth,
  type HttpMethod,
  type KeyValue,
  type RequestDraft,
  type ResponseResult,
} from "../model";
import type { EnvironmentState, ViewState } from "../shared/messages";
import { post } from "./api";

type RequestTab = "params" | "headers" | "auth" | "body" | "docs";
type RequestViewState = Extract<ViewState, { kind: "request" }>;

interface Props {
  view: RequestViewState;
  env: EnvironmentState;
  draft: RequestDraft;
  setDraft: (draft: RequestDraft) => void;
  response?: ResponseResult;
  sending: boolean;
  saved: boolean;
}

export function RequestView(props: Props) {
  const { view, env, draft, setDraft, response, sending, saved } = props;
  const [tab, setTab] = useState<RequestTab>(defaultTab(draft));
  const paramCount =
    draft.pathParams.length + draft.queryParams.filter((p) => p.enabled).length;
  const headerCount = draft.headers.filter((h) => h.enabled).length;

  const tabs: [RequestTab, string][] = [
    ["params", paramCount ? `Params (${paramCount})` : "Params"],
    ["headers", headerCount ? `Headers (${headerCount})` : "Headers"],
    ["auth", draft.auth.type === "none" ? "Auth" : "Auth •"],
    ["body", draft.body ? "Body •" : "Body"],
  ];
  if (view.endpoint) {
    tabs.push(["docs", "Docs"]);
  }

  return (
    <div class="request-page">
      <header class="request-header">
        <nav class="breadcrumb" aria-label="Location">
          {view.breadcrumb.join(" › ")}
          {view.live && <span class="chip live">● live</span>}
          {view.endpoint?.deprecated && (
            <span class="chip warn">Deprecated</span>
          )}
        </nav>
        <div class="env-picker">
          <label for="env">Environment</label>
          <select
            id="env"
            value={env.active ?? ""}
            onChange={(event) =>
              post({ type: "setEnv", name: event.currentTarget.value || null })
            }
          >
            <option value="">None</option>
            {env.names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button class="ghost" onClick={() => post({ type: "manageEnvs" })}>
            Manage
          </button>
        </div>
      </header>

      <form
        class="url-bar"
        onSubmit={(event) => {
          event.preventDefault();
          post({ type: sending ? "cancel" : "send", draft });
        }}
      >
        <select
          class={`method-select ${draft.method.toLowerCase()}`}
          aria-label="HTTP method"
          value={draft.method}
          onChange={(event) =>
            setDraft({
              ...draft,
              method: event.currentTarget.value as HttpMethod,
            })
          }
        >
          {HTTP_METHODS.map((method) => (
            <option key={method}>{method}</option>
          ))}
        </select>
        <input
          class="url-input mono"
          aria-label="Request URL"
          placeholder="https://api.example.com/path"
          spellcheck={false}
          value={draft.url}
          onInput={(event) =>
            setDraft({ ...draft, url: event.currentTarget.value })
          }
        />
        <button type="submit" class={sending ? "secondary" : "primary"}>
          {sending ? "Cancel" : "Send"}
        </button>
        {view.canSave && (
          <button
            type="button"
            class="secondary"
            onClick={() => post({ type: "save", draft })}
          >
            Save
          </button>
        )}
      </form>

      {draft.url.includes("{{baseUrl}}") && (
        <p class="hint mono">
          baseUrl ={" "}
          {env.baseUrl ??
            view.baseUrl ??
            "not set. Add a baseUrl variable to an environment."}
        </p>
      )}

      <div class="split">
        <section class="pane" aria-label="Request">
          <Tabs tabs={tabs} current={tab} onChange={setTab} />
          <div class="tab-body">
            {tab === "params" && <ParamsTab draft={draft} setDraft={setDraft} />}
            {tab === "headers" && (
              <KeyValueTable
                rows={draft.headers}
                onChange={(headers) => setDraft({ ...draft, headers })}
                addLabel="+ Add header"
              />
            )}
            {tab === "auth" && (
              <AuthTab
                auth={draft.auth}
                onChange={(auth) => setDraft({ ...draft, auth })}
              />
            )}
            {tab === "body" && <BodyTab draft={draft} setDraft={setDraft} />}
            {tab === "docs" && <DocsTab view={view} />}
          </div>
          <footer class="pane-footer">
            <button
              class="ghost"
              onClick={() => post({ type: "copyCurl", draft })}
            >
              Copy as cURL
            </button>
            {saved && (
              <button class="ghost" onClick={() => post({ type: "reset" })}>
                Reset to spec
              </button>
            )}
            {saved && <span class="muted">Saved edits</span>}
          </footer>
        </section>

        <ResponsePane response={response} sending={sending} />
      </div>
    </div>
  );
}

function defaultTab(draft: RequestDraft): RequestTab {
  if (draft.pathParams.length > 0 || draft.queryParams.length > 0) {
    return "params";
  }
  return draft.body ? "body" : "params";
}

function Tabs<T extends string>({
  tabs,
  current,
  onChange,
}: {
  tabs: [T, string][];
  current: T;
  onChange: (tab: T) => void;
}) {
  return (
    <div class="tabs" role="tablist">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={id === current}
          class={id === current ? "tab active" : "tab"}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ParamsTab({
  draft,
  setDraft,
}: {
  draft: RequestDraft;
  setDraft: (draft: RequestDraft) => void;
}) {
  return (
    <>
      {draft.pathParams.length > 0 && (
        <>
          <h3>Path parameters</h3>
          <KeyValueTable
            rows={draft.pathParams}
            fixed
            onChange={(pathParams) => setDraft({ ...draft, pathParams })}
          />
        </>
      )}
      <h3>Query parameters</h3>
      <KeyValueTable
        rows={draft.queryParams}
        onChange={(queryParams) => setDraft({ ...draft, queryParams })}
        addLabel="+ Add parameter"
      />
    </>
  );
}

function KeyValueTable({
  rows,
  onChange,
  addLabel,
  fixed,
}: {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  addLabel?: string;
  /** Rows come from the URL template, so they can't be removed or disabled. */
  fixed?: boolean;
}) {
  const patch = (index: number, change: Partial<KeyValue>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  return (
    <>
      {rows.length > 0 && (
        <table class="kv">
          <thead>
            <tr>
              {!fixed && <th class="narrow" aria-label="Enabled" />}
              <th>Key</th>
              <th>Value</th>
              {!fixed && <th class="narrow" aria-label="Remove" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} class={row.enabled ? "" : "disabled"}>
                {!fixed && (
                  <td class="center">
                    <input
                      type="checkbox"
                      aria-label={`Enable ${row.key}`}
                      checked={row.enabled}
                      onChange={(event) =>
                        patch(index, { enabled: event.currentTarget.checked })
                      }
                    />
                  </td>
                )}
                <td>
                  {fixed ? (
                    <span class="mono fixed-key">{row.key}</span>
                  ) : (
                    <input
                      class="mono"
                      aria-label="Key"
                      value={row.key}
                      spellcheck={false}
                      onInput={(event) =>
                        patch(index, { key: event.currentTarget.value })
                      }
                    />
                  )}
                  {row.required && <span class="required">required</span>}
                </td>
                <td>
                  <input
                    class="mono"
                    aria-label={`Value of ${row.key}`}
                    value={row.value}
                    spellcheck={false}
                    placeholder={row.description ?? ""}
                    title={row.description}
                    onInput={(event) =>
                      patch(index, { value: event.currentTarget.value })
                    }
                  />
                </td>
                {!fixed && (
                  <td class="center">
                    <button
                      type="button"
                      class="ghost icon"
                      aria-label={`Remove ${row.key}`}
                      onClick={() =>
                        onChange(rows.filter((_, i) => i !== index))
                      }
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {addLabel && (
        <button
          type="button"
          class="ghost"
          onClick={() =>
            onChange([...rows, { key: "", value: "", enabled: true }])
          }
        >
          {addLabel}
        </button>
      )}
    </>
  );
}

function AuthTab({
  auth,
  onChange,
}: {
  auth: Auth;
  onChange: (auth: Auth) => void;
}) {
  const setType = (type: Auth["type"]) => {
    switch (type) {
      case "bearer":
        return onChange({ type, token: "" });
      case "basic":
        return onChange({ type, username: "", password: "" });
      case "apiKey":
        return onChange({ type, key: "X-API-Key", value: "", in: "header" });
      default:
        return onChange({ type: "none" });
    }
  };
  return (
    <div class="form">
      <label>
        Type
        <select
          value={auth.type}
          onChange={(event) =>
            setType(event.currentTarget.value as Auth["type"])
          }
        >
          <option value="none">No auth</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic auth</option>
          <option value="apiKey">API key</option>
        </select>
      </label>
      {auth.type === "bearer" && (
        <label>
          Token
          <input
            class="mono"
            type="password"
            placeholder="{{token}}"
            value={auth.token}
            onInput={(event) =>
              onChange({ ...auth, token: event.currentTarget.value })
            }
          />
        </label>
      )}
      {auth.type === "basic" && (
        <>
          <label>
            Username
            <input
              class="mono"
              value={auth.username}
              onInput={(event) =>
                onChange({ ...auth, username: event.currentTarget.value })
              }
            />
          </label>
          <label>
            Password
            <input
              class="mono"
              type="password"
              value={auth.password}
              onInput={(event) =>
                onChange({ ...auth, password: event.currentTarget.value })
              }
            />
          </label>
        </>
      )}
      {auth.type === "apiKey" && (
        <>
          <label>
            Key
            <input
              class="mono"
              value={auth.key}
              onInput={(event) =>
                onChange({ ...auth, key: event.currentTarget.value })
              }
            />
          </label>
          <label>
            Value
            <input
              class="mono"
              type="password"
              value={auth.value}
              onInput={(event) =>
                onChange({ ...auth, value: event.currentTarget.value })
              }
            />
          </label>
          <label>
            Add to
            <select
              value={auth.in}
              onChange={(event) =>
                onChange({
                  ...auth,
                  in: event.currentTarget.value as "header" | "query",
                })
              }
            >
              <option value="header">Header</option>
              <option value="query">Query parameter</option>
            </select>
          </label>
        </>
      )}
      {auth.type !== "none" && (
        <p class="muted">
          Saved values go in VS Code's secret storage, never in project files.
        </p>
      )}
    </div>
  );
}

function BodyTab({
  draft,
  setDraft,
}: {
  draft: RequestDraft;
  setDraft: (draft: RequestDraft) => void;
}) {
  const noBody = draft.method === "GET" || draft.method === "HEAD";
  return (
    <div class="body-editor">
      <label class="inline">
        Content type
        <input
          class="mono"
          value={draft.contentType}
          spellcheck={false}
          onInput={(event) =>
            setDraft({ ...draft, contentType: event.currentTarget.value })
          }
        />
      </label>
      {noBody && (
        <p class="hint">{draft.method} requests are sent without a body.</p>
      )}
      {draft.contentType.startsWith("multipart/") && (
        <p class="hint">
          Multipart uploads aren't supported yet. Write the raw body and include
          the boundary in the content type.
        </p>
      )}
      <textarea
        class="mono"
        aria-label="Request body"
        spellcheck={false}
        value={draft.body}
        onInput={(event) =>
          setDraft({ ...draft, body: event.currentTarget.value })
        }
      />
    </div>
  );
}

function DocsTab({ view }: { view: RequestViewState }) {
  const endpoint = view.endpoint;
  if (!endpoint) {
    return null;
  }
  return (
    <div class="docs">
      {endpoint.summary && <h3>{endpoint.summary}</h3>}
      {endpoint.description && (
        <p class="pre-line">{endpoint.description}</p>
      )}
      {endpoint.parameters.length > 0 && (
        <>
          <h3>Parameters</h3>
          <table class="doc-table">
            <tbody>
              {endpoint.parameters.map((param) => (
                <tr key={`${param.in}:${param.name}`}>
                  <td class="mono">
                    {param.name}
                    {param.required && <span class="required">required</span>}
                  </td>
                  <td class="muted">{param.in}</td>
                  <td>{param.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {endpoint.responses.length > 0 && (
        <>
          <h3>Responses</h3>
          <table class="doc-table">
            <tbody>
              {endpoint.responses.map((item) => (
                <tr key={item.status}>
                  <td class={`mono status-text s${item.status[0]}`}>
                    {item.status}
                  </td>
                  <td>{item.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function ResponsePane({
  response,
  sending,
}: {
  response?: ResponseResult;
  sending: boolean;
}) {
  const [tab, setTab] = useState<"body" | "headers">("body");
  const body = useMemo(() => formatBody(response), [response]);

  return (
    <section class="pane response" aria-label="Response" aria-busy={sending}>
      {sending && <div class="progress" />}
      {!response && !sending && (
        <div class="empty">Press Send to see the response here.</div>
      )}
      {!response && sending && <div class="empty">Sending…</div>}
      {response?.error && (
        <div class="error-box" role="alert">
          {response.error}
        </div>
      )}
      {response && !response.error && (
        <>
          <div class="response-bar">
            <Tabs
              tabs={[
                ["body", "Body"],
                ["headers", `Headers (${response.headers.length})`],
              ]}
              current={tab}
              onChange={setTab}
            />
            <div class="stats">
              <span
                class={`status-pill s${String(response.status ?? 0)[0]}`}
              >
                {response.status} {response.statusText}
              </span>
              <span>{response.durationMs} ms</span>
              <span>{formatSize(response.sizeBytes)}</span>
            </div>
          </div>
          <div class="tab-body">
            {tab === "body" &&
              (response.binary ? (
                <div class="empty">
                  Binary response ({response.contentType ?? "unknown type"}), not
                  shown.
                </div>
              ) : body ? (
                <pre class="mono response-body">{body}</pre>
              ) : (
                <div class="empty">Empty response body.</div>
              ))}
            {tab === "headers" && (
              <table class="doc-table">
                <tbody>
                  {response.headers.map(([key, value], index) => (
                    <tr key={index}>
                      <td class="mono">{key}</td>
                      <td class="mono break">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {response.truncated && (
              <p class="hint">Only the first 10 MB of this response is shown.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function formatBody(response?: ResponseResult): string {
  if (!response?.body) {
    return "";
  }
  try {
    return JSON.stringify(JSON.parse(response.body), null, 2);
  } catch {
    return response.body;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
