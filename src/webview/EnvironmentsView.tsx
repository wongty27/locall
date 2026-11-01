import { useEffect, useState } from "preact/hooks";
import type { Environment, EnvironmentVariable } from "../model";
import { post } from "./api";

export function EnvironmentsView({
  initial,
  active,
  projectName,
}: {
  initial: Environment[];
  active?: string;
  projectName?: string;
}) {
  const [environments, setEnvironments] = useState(initial);
  // After a save, show stored state so typed secrets don't stay in the form.
  useEffect(() => setEnvironments(initial), [initial]);

  const duplicate = (index: number) => {
    const source = environments[index];
    const names = new Set(environments.map((item) => item.name));
    let name = `${source.name} copy`;
    for (let count = 2; names.has(name); count++) {
      name = `${source.name} copy ${count}`;
    }
    setEnvironments([
      ...environments.slice(0, index + 1),
      {
        name,
        copiedFrom: source.copiedFrom ?? source.name,
        variables: source.variables.map((variable) => ({ ...variable })),
      },
      ...environments.slice(index + 1),
    ]);
  };

  const update = (index: number, next: Environment) =>
    setEnvironments(
      environments.map((item, i) => (i === index ? next : item)),
    );
  const updateVariable = (
    env: number,
    row: number,
    patch: Partial<EnvironmentVariable>,
  ) =>
    update(env, {
      ...environments[env],
      variables: environments[env].variables.map((item, i) =>
        i === row ? { ...item, ...patch } : item,
      ),
    });

  return (
    <main class="page">
      <header class="overview-header">
        <h1>Environments{projectName ? `: ${projectName}` : ""}</h1>
        <p class="muted">
          {projectName
            ? "These environments apply only to this project. "
            : "These environments apply to requests outside any project. "}
          Use variables as <code>{"{{name}}"}</code> in any request field. Define{" "}
          <code>baseUrl</code> to override the URL from the spec. Secret values
          go in VS Code's secret storage. Other values are saved to{" "}
          <code>.locall/environments.json</code>, which you can commit.
        </p>
      </header>

      {environments.map((environment, envIndex) => (
        <section class="env-card" key={envIndex}>
          <div class="env-title">
            <input
              aria-label="Environment name"
              placeholder="Environment name"
              value={environment.name}
              onInput={(event) =>
                update(envIndex, {
                  ...environment,
                  name: event.currentTarget.value,
                })
              }
            />
            {environment.name === active && <span class="chip live">Active</span>}
            <button class="ghost" onClick={() => duplicate(envIndex)}>
              Duplicate
            </button>
            <button
              class="ghost"
              onClick={() =>
                setEnvironments(environments.filter((_, i) => i !== envIndex))
              }
            >
              Delete
            </button>
          </div>
          <table class="kv">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Value</th>
                <th class="narrow">Secret</th>
                <th class="narrow" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {environment.variables.map((variable, row) => (
                <tr key={row}>
                  <td>
                    <input
                      aria-label="Variable name"
                      value={variable.key}
                      onInput={(event) =>
                        updateVariable(envIndex, row, {
                          key: event.currentTarget.value,
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Variable value"
                      // Preact's input types don't accept a type chosen at runtime.
                      type={(variable.secret ? "password" : "text") as "text"}
                      placeholder={
                        variable.secret && variable.hasValue
                          ? "Saved. Leave blank to keep it."
                          : ""
                      }
                      value={variable.value}
                      onInput={(event) =>
                        updateVariable(envIndex, row, {
                          value: event.currentTarget.value,
                        })
                      }
                    />
                  </td>
                  <td class="center">
                    <input
                      type="checkbox"
                      aria-label="Secret"
                      checked={variable.secret}
                      onChange={(event) =>
                        updateVariable(envIndex, row, {
                          secret: event.currentTarget.checked,
                        })
                      }
                    />
                  </td>
                  <td class="center">
                    <button
                      class="ghost icon"
                      aria-label="Remove variable"
                      onClick={() =>
                        update(envIndex, {
                          ...environment,
                          variables: environment.variables.filter(
                            (_, i) => i !== row,
                          ),
                        })
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            class="ghost"
            onClick={() =>
              update(envIndex, {
                ...environment,
                variables: [
                  ...environment.variables,
                  { key: "", value: "", secret: false },
                ],
              })
            }
          >
            + Add variable
          </button>
        </section>
      ))}

      {environments.length === 0 && (
        <p class="muted">
          No environments yet. Add one such as Local or Staging.
        </p>
      )}

      <div class="actions">
        <button
          class="secondary"
          onClick={() =>
            setEnvironments([
              ...environments,
              {
                name: environments.length ? "" : "Local",
                variables: [
                  {
                    key: "baseUrl",
                    value: "http://localhost:3000",
                    secret: false,
                  },
                ],
              },
            ])
          }
        >
          + Add environment
        </button>
        <button
          class="primary"
          onClick={() => post({ type: "saveEnvs", environments })}
        >
          Save
        </button>
      </div>
    </main>
  );
}
