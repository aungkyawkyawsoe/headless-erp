# Local dev — AIO Sandbox + Factory

An **isolated container** where an AI agent can run shell / code / browser, then call this factory's
API or MCP. Recommended for local development of the "code mode" workflow (see
`docs/superpowers/specs/2026-09-25-mcp-factory-control-plane-design.md` §P3).

> **Why AIO Sandbox** (vs Alibaba Open Sandbox / Tencent Cube): one Docker container, MCP-native
> (browser/file/shell/markitdown), and built for agent dev loops — the lightest match for local work.
> The others are a framework and a production-grade service (hardware isolation, sub-60ms starts) — use
> those only when you need scale/isolation beyond local. For **production on Cloudflare**, the natural path
> is the **Cloudflare Sandbox SDK** (`@cloudflare/sandbox`), not a self-hosted container.

## 1. Run it

```bash
docker compose -f sandbox/docker-compose.yml up -d
# → http://localhost:8080
```

Requires Docker running and ~2 GB free for the image. The container is bound to `127.0.0.1` only.

| Service                                 | URL                                                   |
| --------------------------------------- | ----------------------------------------------------- |
| Dashboard                               | http://localhost:8080/index.html                      |
| API docs (OpenAPI)                      | http://localhost:8080/v1/docs                         |
| **MCP** (browser/file/shell/markitdown) | http://localhost:8080/mcp                             |
| VSCode Server                           | http://localhost:8080/code-server/                    |
| Terminal                                | http://localhost:8080/terminal                        |
| VNC browser                             | http://localhost:8080/vnc/index.html?autoconnect=true |

Point any MCP-capable agent at the sandbox:

```json
{ "mcp": { "aio-sandbox": { "type": "remote", "url": "http://localhost:8080/mcp", "enabled": true } } }
```

## 2. Reach the factory from inside the sandbox

The factory dev server runs on the **host** (`pnpm dev` → `:8788`). From inside the container use
`host.docker.internal` (already mapped in the compose file):

| From                     | Factory URL                        |
| ------------------------ | ---------------------------------- |
| Host / agent on the host | `http://localhost:8788`            |
| Inside the sandbox       | `http://host.docker.internal:8788` |

The agent authenticates with a bearer token — local dev uses `dev-token` (works only when `IS_DEV=true`,
never in production). Create a **scoped** machine key for anything non-local.

## 3. Code mode (one script, many operations)

`sandbox/factory-code-mode.mjs` is the reference: it discovers capabilities, `plan_manifest` (no write),
`apply_manifest` (governed), then `query`.

```bash
# inside the sandbox
FACTORY_URL=http://host.docker.internal:8788 FACTORY_TOKEN=dev-token node factory-code-mode.mjs
# or on the host
FACTORY_URL=http://localhost:8788 FACTORY_TOKEN=dev-token node sandbox/factory-code-mode.mjs
```

The agent can also drive the factory's own MCP (`http://localhost:8788/api/mcp`) directly. It is added to
`opencode.json` as **Factory API (MCP)** — restart opencode after changing any config.

## 4. Security

- **Do not** put factory credentials (D1/R2, `ADMIN_PASSWORD`, `JWT_SECRET`) in the sandbox. The sandbox
  reaches the factory only over HTTP with a scoped bearer.
- Keep `SANDBOX_API_KEY` set for anything beyond your machine; bind to `127.0.0.1` (done).
- The sandbox is **dev-grade** isolation (shared kernel / Docker). For untrusted multi-tenant execution use
  hardware-isolated sandboxes (e.g. Tencent Cube) or a managed sandbox.

## 5. Production

This container is **not** a production dependency of the API worker. Production code-mode — if you ever
want it — runs on a Cloudflare-native sandbox binding (`infra/env.*` → `pnpm gen:infra`), admin-gated and
audited. For most deployments, production does **not** need code execution at all: build in dev/staging
with `plan_manifest`/`apply_manifest`, and ship schema in production through IaC/review.
