# Locall

A fully local API client for VS Code, with no account or sign-in. Locall lists the APIs in your Swagger and OpenAPI files, finds the ones running on your machine, and lets you send requests to them.

## Features

- **Multiple projects**: finds every `api.json`, `swagger.json` and `openapi.json` in your workspace, including multi-root workspaces. You can also add spec files from anywhere with **Add Spec File**.
- **Collections**: endpoints are grouped by their OpenAPI tag. Untagged endpoints go under "Default".
- **Localhost detection**: checks common ports for running APIs and their specs, and marks matching projects as live.
- **Request builder**: parameters, headers, body and auth (bearer, basic, API key), pre-filled from the spec.
- **Environments per project**: each project has its own environments and active environment. Use `{{variables}}` in any request field, with secrets kept in VS Code's secret storage.
- **Response viewer, history and search**: see status, time, size, body and headers. Reopen past requests, copy any request as cURL, and search endpoints across projects.

Swagger 2.0 and OpenAPI 3.x JSON files are supported. YAML and multipart file uploads aren't supported yet.

## Settings

| Setting | Default | Description |
|---|---|---|
| `locall.detection.enabled` | `true` | Look for running APIs on localhost. |
| `locall.detection.ports` | 3000, 3001, 4000, 5000, 5173, 8000, 8080, 8081, 8888, 9000 | Ports to check. |

## Where your data goes

Locall has no backend or telemetry. It only sends requests you send yourself, plus detection checks to loopback addresses (`GET` requests to common spec paths, such as `/openapi.json`, on the ports above).

| Data | Location |
|---|---|
| Environments and saved requests | `.locall/` in your first workspace folder, which you can commit |
| History | VS Code's extension storage, never in your project |
| Secret variables and saved auth values | VS Code's secret storage |

Locall removes auth values and values of common secret fields, such as `Authorization` or `api_key`, before saving requests or history. **Request bodies are saved as written**, so use a `{{variable}}` for any secret in a body.

## Development

```bash
pnpm install
pnpm test
```

Press **F5** in VS Code to run the extension.
