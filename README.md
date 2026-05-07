# Zero-Human Monorepo

Autonomous AI Company Operating System scaffold based on `PRD_Zero_Human_Monorepo1.md`.

This repo now contains both the Zero-Human integration wrappers and the original upstream codebases:

- `@zh/sdk`: shared types, YAML config loader, Redis event contracts
- `@zh/router`: Zero-Human router adapter plus original 9Router source in `packages/@zh/router/upstream`
- `@zh/brain`: Zero-Human brain adapter plus original Hermes Agent source in `packages/@zh/brain/upstream`
- `@zh/hr`: Zero-Human HR/dashboard adapter plus original Paperclip source in `packages/@zh/hr/upstream`
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

The original repositories are imported as git subtrees under each adapter package. The adapter layer stays in `src/` and the upstream source stays in `upstream/`, which keeps Zero-Human integration code separate from upstream code during syncs.

Current upstreams:

- Router: `https://github.com/decolua/9router.git`
- Brain: `https://github.com/NousResearch/hermes-agent.git`
- HR: `https://github.com/paperclipai/paperclip.git`

The PRD referenced `NousResearch/9Router`, but that repository was not available when verified. The matching public upstream is `decolua/9router`.

Check subtree presence:

```powershell
pnpm upstream:status
```

Sync one upstream:

```powershell
.\scripts\sync-upstream.ps1 router
.\scripts\sync-upstream.ps1 brain
.\scripts\sync-upstream.ps1 hr
```

Keep custom integration in `@zh/sdk`, package adapter `src/`, and patch folders so upstream syncs remain reviewable.
