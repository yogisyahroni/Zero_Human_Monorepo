# Zero-Human Monorepo

Autonomous AI Company Operating System that unifies 9Router, Hermes Agent, and Paperclip into one Docker-managed execution company.

Zero-Human Studio is the owner monitoring surface. Paperclip is the company control plane and execution board. Codex CLI performs real repository work. 9Router is the AI gateway. Hermes is the live memory and guidance brain that keeps agents from repeating context, wasting tokens, or getting stuck in loops.

## What Is Included

- `@zh/sdk`: shared types, YAML config loader, Redis event contracts, env validation, and resilient event helpers.
- `@zh/router`: Zero-Human router adapter plus original 9Router source in `packages/@zh/router/upstream`.
- `@zh/brain`: Zero-Human brain adapter plus original Hermes Agent source in `packages/@zh/brain/upstream`.
- `@zh/hr`: Zero-Human Studio, Paperclip bridge, owner dashboard, repository intake, execution monitor, skills/MCP automation, and Paperclip sync.
- `docker-compose.yml`: Redis, 9Router, Hermes, Paperclip, Postgres, adapter services, Docker socket proxy, and Zero-Human Studio on one network.

## Core Workflow

1. Owner opens Paperclip at <http://localhost:3100> for company control: issues, hiring, meetings, assignments, routines, goals, and execution state.
2. Owner opens Zero-Human Studio at <http://localhost:3003> for realtime monitoring, file-change visibility, Codex/Paperclip run inspection, Hermes memory, guardrails, and 9Router health.
3. Paperclip owns repositories, company roles, skills, MCP tools, issues, and agent execution.
4. Zero-Human audits Paperclip state and reports drift or recommendations without mutating Paperclip control data by default.
5. Codex CLI runs inside the Paperclip/container environment and edits the target repository.
6. Hermes injects memory, skills, MCP guidance, blocker recovery hints, meeting summaries, and token guardrails.
7. 9Router receives all AI calls through combo names such as `combotest`; provider/model routing stays inside 9Router.
8. Zero-Human Studio shows realtime owner status, active work, blockers, guardrails, cost, repo state, meetings, and execution monitor data.

## Main Features

### Zero-Human Studio

- Owner dashboard with live/stale state, company health, active tasks, blockers, owner decisions, repository readiness, memory, and cost watch.
- Execution Monitor for Paperclip/Codex runs with transcript, duration, root error, owner action, artifacts, changed files, and diff summary.
- Monitoring-first repository visibility for Paperclip workspaces and codebase changes.
- Skills and MCP audit surfaces that show recommended mappings and drift; Paperclip remains responsible for applying operational changes.
- Paperclip bridge panel that audits org/skill/MCP guidance without rewriting Paperclip hierarchy, hiring, issues, or heartbeat settings by default.
- Deep links into Paperclip, Hermes, and 9Router so the owner can jump to the right system quickly.

### Paperclip Integration

- Paperclip remains the company execution board and hiring authority.
- Agent creation, hiring requests, issues, routines, goals, meetings, and run state live in Paperclip.
- Zero-Human bridge is idempotent and monitoring-only by default: it audits canonical roles and guidance without creating agents, pausing agents, or rewriting Paperclip hierarchy.
- Canonical hierarchy recommendations keep CEO at the top, C-level leaders under CEO, leads under their department, and specialists under leads; Paperclip is the source of truth for applying changes.
- Duplicate CEO/CTO-style roles are detected and reported instead of silently multiplied.
- Paperclip issues can still be created directly from Paperclip UI; Zero-Human policy and Hermes guidance still apply to subsequent agent runs.

### Hermes Live Brain

- Hermes is memory/guidance, not a second executor.
- It stores meeting summaries, role learnings, skill signals, task outcomes, and persistent notes.
- Hermes guidance is injected into Paperclip/Codex runs before execution.
- It watches for repeated blockers, missing dispositions, stale meetings, high-churn retries, and high-cost runs.
- Interventions are rate-limited so Hermes nudges the company without spamming comments every few seconds.

### Skills And MCP Automation

- New hires should receive role-relevant skills from Paperclip; Zero-Human audits and recommends role/skill/MCP mappings.
- Imported skills can be deduped and mapped to existing roles, but Paperclip remains the operational source of truth.
- Android, backend, product, design, marketing, finance, support, QA, and DevOps-style skills can be mapped by role metadata.
- Sequential Thinking MCP is mandatory for every agent as the baseline thinking pattern.
- Role-specific MCP tools, such as Filesystem, Postgres, Browser, or other marketplace entries, are recommended based on role needs.
- Zero-Human reports Paperclip skill/MCP drift after new agent hires or skill imports instead of silently changing agent configuration.

### Meeting Rooms

- Paperclip has meeting room support for division, cross-division, and owner review rooms.
- Meetings have participants, agenda, transcript, decisions, action items, artifacts, linked issues, and lifecycle state.
- Meeting closure requires a disposition such as `decision_recorded`, `issues_created`, `blocked_by_owner`, `hiring_requested`, or `no_action`.
- Meeting outcomes can create child issues, record decisions, or request hires through Paperclip.
- Hermes stores meeting summaries and uses them as future company memory.

### Reliability And Cost Guardrails

- Blocked tasks are treated as escalation states, not final stop states.
- Agents are guided to diagnose, delegate, request/hire missing roles, ask the owner for a concrete decision, or close with evidence.
- High-cost runs and repeated planning loops trigger owner-visible warnings.
- Meetings cannot remain active forever without an outcome.
- Guardrails preserve 9Router combo routing. App code requests combo names; provider/model selection remains in 9Router.

### 9Router Gateway

- 9Router is the single AI provider gateway for Hermes, Paperclip, Codex CLI, and Zero-Human adapters.
- Configure provider keys, free models, paid models, and routing combos in the 9Router UI at <http://localhost:20128>.
- The app should use combo names such as `combotest`, not hardcoded provider/model names.
- If 9Router API key protection is enabled, use the generated 9Router gateway key as `ZH_ROUTER_COMPAT_API_KEY`.

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

Set `ZH_ROUTER_COMPAT_API_KEY` to the API key created in the 9Router UI when `Require API key` is enabled. This is the gateway token used by Hermes, Paperclip, Zero-Human adapters, and Codex when they call 9Router.

If you run Codex-compatible tools from the host, set `CODEX_API_KEY` to the same value and keep `OPENAI_BASE_URL` / `CODEX_OPENAI_BASE_URL` pointed at:

```text
http://localhost:20128/v1
```

Do not put the 9Router gateway token into provider key fields such as `OPENAI_API_KEY`. Configure real provider keys in the 9Router UI, or put bootstrap provider keys in `.env` for 9Router only.

Install and build locally:

```powershell
pnpm install
pnpm build
```

Start the full stack:

```powershell
pnpm stack:start
```

Or raw Docker Compose:

```powershell
docker compose -p zero-human up -d --build
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

## Local URLs

- Zero-Human Studio: <http://localhost:3003>
- 9Router: <http://localhost:20128>
- Paperclip: <http://localhost:3100>

Hermes runs on the Docker network as an internal memory/guidance service. Normal owner workflow should start from Zero-Human Studio; adapter services reach Hermes through Docker service URLs.

## Environment Setup

Use `.env.example` as the template for local `.env`.

Important variables:

- `BETTER_AUTH_SECRET`: required by Paperclip auth.
- `ZH_ROUTER_COMPAT_API_KEY`: 9Router gateway key used by internal services.
- `CODEX_MODEL`: default combo/model request sent through 9Router, normally `combotest`.
- `OPENAI_BASE_URL` / `CODEX_OPENAI_BASE_URL`: should point to 9Router.
- Provider keys such as `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `GLM_API_KEY`, or `OPENAI_API_KEY`: optional bootstrap values for 9Router/provider setup.

Runtime secrets are not committed. Keep `.env` local and update `.env.example` only with safe placeholders and instructions.

## Docker Services

The local stack runs these services:

- `zero-human`: owner Studio and HR adapter on port `3003`.
- `paperclip`: company execution board on port `3100`.
- `paperclip-db`: Postgres database for Paperclip.
- `9router`: AI gateway on port `20128`.
- `hermes`: memory/guidance brain on port `9119`.
- `zh-router-adapter`: Zero-Human router adapter.
- `zh-brain-adapter`: Zero-Human brain/memory adapter.
- `redis`: event bus and realtime coordination on port `6379`.
- `docker-socket-proxy`: restricted Docker API proxy for container introspection.

Persistent data is stored in named Docker volumes:

- `paperclip-pgdata`
- `paperclip-data`
- `router-data`
- `brain-memory`
- `redis-data`
- `zh-state`
- `registered-repos`
- `worktree-source`
- `hr-worktrees`
- `codex-home`

## Development Commands

```powershell
pnpm dev:router
pnpm dev:brain
pnpm dev:hr
```

`pnpm dev:hr` starts the API at port `3003` and Vite at port `3001`.

Run tests and typechecks:

```powershell
pnpm test
pnpm --filter @zh/hr typecheck
pnpm --filter @zh/hr build
```

Useful Docker commands:

```powershell
docker compose -p zero-human ps
docker compose -p zero-human logs -f zero-human
docker compose -p zero-human logs -f paperclip
docker compose -p zero-human logs -f 9router
```

## Deployment Notes

The GitHub Actions staging workflow validates:

- frontend build
- admin/auth/routing service tests
- migrations
- dependency audit
- secret pattern scan
- Docker image build/push
- staging deployment hooks
- E2E browser validation

For a private deployment:

1. Copy `.env.example` to `.env`.
2. Set `BETTER_AUTH_SECRET`.
3. Configure 9Router provider keys and combos.
4. Set `ZH_ROUTER_COMPAT_API_KEY` if 9Router API keys are required.
5. Run `docker compose -p zero-human up -d --build`.
6. Open Zero-Human Studio and use repository intake to register the target repo.

## Upstream Notes

The original repositories are imported as git subtrees under each adapter package. Adapter code stays in `src/`; upstream source stays in `upstream/`. This keeps Zero-Human integration reviewable during upstream syncs.

Current upstreams:

- Router: `https://github.com/decolua/9router.git`
- Brain: `https://github.com/NousResearch/hermes-agent.git`
- HR: `https://github.com/paperclipai/paperclip.git`

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

Dry-run a sync:

```powershell
.\scripts\sync-upstream.ps1 router -DryRun
```

Regenerate a patch from local upstream edits:

```powershell
.\scripts\regenerate-patches.ps1 router -Name docker-healthcheck
```

Keep custom integration in `@zh/sdk`, adapter package `src/`, and patch folders so upstream syncs remain reviewable.

## More Documentation

- `docs/ARCHITECTURE.md`: service boundaries and task flow.
- `docs/CODEX_SETUP.md`: Codex CLI setup and smoke tests.
- `docs/EXECUTOR_VERSIONS.md`: pinned executor versions and upgrade guidance.
- `docs/ZH_IMPROVEMENT_TASKS.md`: completed hardening and feature task history.
- `PRD_Zero_Human_Monorepo1.md`: original product requirements.
