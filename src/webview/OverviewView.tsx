import { useState } from "preact/hooks";
import type { Project } from "../model";
import { post } from "./api";

const SOURCE_LABELS = {
  workspace: "Found in workspace",
  file: "Added file",
  localhost: "Localhost",
};

export function OverviewView({ project }: { project: Project }) {
  const [filter, setFilter] = useState("");
  const spec = project.spec;

  if (!spec) {
    return (
      <main class="page">
        <h1>{project.location}</h1>
        <p class="error-box" role="alert">
          {project.error ?? "This spec could not be loaded."}
        </p>
      </main>
    );
  }

  const query = filter.trim().toLowerCase();
  const collections = spec.collections
    .map((collection) => ({
      ...collection,
      endpoints: collection.endpoints.filter((endpoint) =>
        `${endpoint.method} ${endpoint.path} ${endpoint.summary ?? ""}`
          .toLowerCase()
          .includes(query),
      ),
    }))
    .filter((collection) => collection.endpoints.length > 0);
  const total = spec.collections.reduce(
    (sum, collection) => sum + collection.endpoints.length,
    0,
  );

  return (
    <main class="page">
      <header class="overview-header">
        <h1>
          {spec.title}
          {spec.version && <span class="chip">v{spec.version}</span>}
          {project.liveUrl && <span class="chip live">● live</span>}
          {project.stale && <span class="chip">offline, using saved copy</span>}
        </h1>
        {spec.description && <p class="muted pre-line">{spec.description}</p>}
      </header>

      <dl class="facts">
        <div>
          <dt>Endpoints</dt>
          <dd>{total}</dd>
        </div>
        <div>
          <dt>Collections</dt>
          <dd>{spec.collections.length}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>
            {spec.specVersion.startsWith("2") ? "Swagger" : "OpenAPI"}{" "}
            {spec.specVersion}
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd title={project.location}>{SOURCE_LABELS[project.source]}</dd>
        </div>
        <div class="wide">
          <dt>Base URL</dt>
          <dd class="mono">
            {project.liveUrl ?? spec.servers[0] ?? "Not set in spec"}
          </dd>
        </div>
      </dl>

      <button class="secondary env-button" onClick={() => post({ type: "manageEnvs" })}>
        Manage environments
      </button>

      <input
        class="filter"
        type="search"
        placeholder="Filter endpoints"
        aria-label="Filter endpoints"
        value={filter}
        onInput={(event) => setFilter(event.currentTarget.value)}
      />

      {collections.length === 0 && (
        <p class="muted">No endpoints match this filter.</p>
      )}
      {collections.map((collection) => (
        <section class="collection" key={collection.name}>
          <h2>
            {collection.name}
            <span class="count">{collection.endpoints.length}</span>
          </h2>
          {collection.description && (
            <p class="muted">{collection.description}</p>
          )}
          <ul class="endpoint-list">
            {collection.endpoints.map((endpoint) => (
              <li key={endpoint.id}>
                <button
                  class={`endpoint-row ${endpoint.method.toLowerCase()}`}
                  onClick={() =>
                    post({ type: "openEndpoint", endpointId: endpoint.id })
                  }
                >
                  <span class="method-badge">{endpoint.method}</span>
                  <span
                    class={`mono path ${endpoint.deprecated ? "deprecated" : ""}`}
                  >
                    {endpoint.path}
                  </span>
                  <span class="muted summary">{endpoint.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
