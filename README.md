# Zero-Human Monorepo

Autonomous AI Company Operating System scaffold based on `PRD_Zero_Human_Monorepo1.md`.

This repo currently implements the Phase 1 foundation:

- `@zh/sdk`: shared types, YAML config loader, Redis event contracts
- `@zh/router`: local AI gateway stub with `/health`, `/metrics`, and OpenAI-compatible `/v1/chat/completions`
- `@zh/brain`: Hermes-style task consumer with persistent-memory shaped API
- `@zh/hr`: Paperclip-style dashboard, task queue, approval workflow, and budget overview
- `docker-compose.yml`: Redis, router, brain, and HR dashboard on one network

## Run Locally

```powershell
pnpm install
pnpm build
pnpm dev:hr
```

For the full event-driven stack:

```powershell
docker compose up --build
```

Open:

- HR dashboard: <http://localhost:3000>
- Router health: <http://localhost:20128/health>
- Router metrics: <http://localhost:20128/metrics>

## Development Services

```powershell
pnpm dev:router
pnpm dev:brain
pnpm dev:hr
```

`pnpm dev:hr` starts the API at port `3000` and Vite at port `3001`.

## Upstream Notes

The PRD names three upstream projects. As of the initial scaffold, the dashboard and service contracts are implemented locally so the product can run before subtree imports are added.

Current likely upstreams:

- Router: `https://github.com/NousResearch/9Router.git`
- Brain: `https://github.com/NousResearch/hermes-agent.git`
- HR: `https://github.com/paperclipai/paperclip.git`

Use `scripts/setup.ps1` to add remotes, then add subtree imports when ready. Keep custom integration in `@zh/sdk` and patch folders so upstream syncs remain reviewable.
