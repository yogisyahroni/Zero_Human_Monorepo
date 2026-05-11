# Zero-Human Monorepo

Autonomous AI Company Operating System scaffold based on `PRD_Zero_Human_Monorepo1.md`.

This repo now contains both the Zero-Human integration wrappers and the original upstream codebases:

- `@zh/sdk`: shared types, YAML config loader, Redis event contracts
- `@zh/router`: Zero-Human router adapter plus original 9Router source in `packages/@zh/router/upstream`
- `@zh/brain`: Zero-Human brain adapter plus original Hermes Agent source in `packages/@zh/brain/upstream`
- `@zh/hr`: Zero-Human HR/dashboard adapter plus original Paperclip source in `packages/@zh/hr/upstream`
- `docker-compose.yml`: Redis, router, brain, and HR dashboard on one network

## Run Locally

Create a local `.env` before starting the Docker stack:

```powershell
Copy-Item .env.example .env
```

Generate and set `BETTER_AUTH_SECRET`:

```powershell
[System.Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

On shells with OpenSSL:

```bash
openssl rand -hex 32
```

Set `ZH_ROUTER_COMPAT_API_KEY` to a private internal token used by services when
they call 9Router. Configure real provider keys in the 9Router UI, or put a
bootstrap provider key in `.env` for 9Router only.

```powershell
pnpm install
pnpm build
pnpm dev:hr
```

For the full microservices stack, use the one-shot launcher:

```powershell
.\scripts\start-zero-human.ps1
```

Or via pnpm:

```powershell
pnpm stack:start
```

Stop everything:

```powershell
pnpm stack:stop
```

Check containers:

```powershell
pnpm stack:status
```

Follow logs:

```powershell
.\scripts\logs-zero-human.ps1 -Follow
```

Raw Docker Compose still works:

```powershell
docker compose -p zero-human up -d --build
```

Open:

- Zero-Human control plane: <http://localhost:3003>
- 9Router upstream: <http://localhost:20128>
- Paperclip upstream: <http://localhost:3100>

Hermes runs inside the Docker network as memory and operating-protocol context.
It is intentionally not exposed on a host port; Zero-Human and Paperclip reach
it through internal service URLs.

Set up AI providers from the 9Router UI at <http://localhost:20128>. 9Router is
the central AI gateway for Hermes, Paperclip, and Zero-Human; other services
only call 9Router through internal URLs. Environment provider keys in `.env`
are bootstrap/fallback values for 9Router, not separate provider configuration
for every service.

Codex CLI is the default coding executor for real worktree edits. See
`docs/CODEX_SETUP.md` for container setup and smoke-test steps.

The three upstream projects run as independent Docker services. Zero-Human
adapter services run alongside them and communicate through Redis plus the
configured service URLs.

See `docs/ARCHITECTURE.md` for the current service boundary: Zero-Human owns
policy, Paperclip owns execution, Codex CLI edits repositories, 9Router routes
AI calls, and Hermes supplies memory/guidance rather than acting as a second
executor.

## Development Services

```powershell
pnpm dev:router
pnpm dev:brain
pnpm dev:hr
```

`pnpm dev:hr` starts the API at port `3003` and Vite at port `3001`.

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

Dry-run a sync without keeping changes:

```powershell
.\scripts\sync-upstream.ps1 router -DryRun
```

Regenerate a patch from local upstream edits:

```powershell
.\scripts\regenerate-patches.ps1 router -Name docker-healthcheck
```

Keep custom integration in `@zh/sdk`, package adapter `src/`, and patch folders so upstream syncs remain reviewable.
