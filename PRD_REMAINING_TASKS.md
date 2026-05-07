# Zero-Human PRD Remaining Tasks

Last updated: 2026-05-07

This file is the durable handoff tracker for work that remains after the initial Zero-Human monorepo integration. Keep it updated whenever a task is completed so future Codex sessions can continue without relying on chat context.

## Current Status

Done:
- Monorepo foundation with pnpm workspaces.
- Upstream source imported under `packages/@zh/*/upstream`.
- Docker Compose starts Redis, 9Router, Hermes, Paperclip, adapters, and Zero-Human dashboard.
- Shared `@zh/sdk` config, types, event bus, and upstream metadata.
- HR dashboard on port `3003`.
- Redis event flow: HR task assignment -> Brain handling -> Router cost event -> HR dashboard.
- Live service health for router adapter, brain adapter, and Paperclip.
- Basic budget tracking and auto-pause guard.
- Basic skill telemetry via `zh:skill:learned`.
- GitHub upstream sync workflow exists at `.github/workflows/upstream-sync.yml`.

## Priority 1: Real Executor Flow

Goal: make tasks edit code in isolated worktrees instead of stopping at `pending_review` with a planning note.

Tasks:
- [ ] Add worktree manager in `@zh/hr`.
- [ ] Create a unique git branch/worktree for every task.
- [ ] Persist `worktreePath` and `branchName` on task records.
- [ ] Add executor handoff payload from Brain to Claude Code/Codex container.
- [ ] Mount only the task worktree as writable for executor containers.
- [ ] Capture executor stdout/stderr and attach summary to task result.
- [ ] Run configured validation command before marking task `pending_review`.

Acceptance criteria:
- Dispatching a coding task creates a visible git worktree.
- Executor changes files only inside that worktree.
- Task result includes changed files, test output, and next review action.
- Main branch remains untouched until human approval.

## Priority 2: Approval And Merge

Goal: turn the current approval button into a real review gate.

Tasks:
- [ ] Add `POST /api/tasks/:taskId/diff` to show worktree diff.
- [ ] Add `POST /api/tasks/:taskId/approve` merge behavior.
- [ ] Add `POST /api/tasks/:taskId/reject` cleanup behavior.
- [ ] Respect `orchestrator.auto_merge` and `approval_required`.
- [ ] Block merge if validation failed or budget exceeded.

Acceptance criteria:
- Dashboard can display task diff.
- Approve merges worktree branch into main or records manual merge instructions.
- Reject leaves a clear audit event and removes/archives the worktree.

## Priority 3: Hermes Memory And Skill Evolution

Goal: make memory and skills useful beyond the current telemetry counter.

Tasks:
- [ ] Persist Brain memory to the mounted `brain-memory` volume.
- [ ] Store task outcomes by agent, skill, files touched, and validation result.
- [ ] Feed recent memory into future task prompts.
- [ ] Track skill confidence from repeated successful task types.
- [ ] Show per-agent memory notes and learned skills in dashboard.
- [ ] Publish richer `zh:skill:learned` payload with before/after timing.

Acceptance criteria:
- Restarting containers does not erase agent memory.
- Repeated tasks show increasing skill history.
- Brain uses prior task notes in router prompt.

## Priority 4: Budget Alerts And Notifications

Goal: make cost protection operational.

Tasks:
- [ ] Send configured webhook notification for `zh:cost:threshold`.
- [ ] Send configured webhook notification for `zh:quota:exhausted`.
- [ ] Add budget policy tests for per-agent and global caps.
- [ ] Add dashboard alert row for paused agents and blocked dispatches.
- [ ] Add reset/resume endpoint for manually unpausing an agent.

Acceptance criteria:
- Crossing threshold emits event and webhook.
- Exhausting budget pauses dispatch.
- User can resume an agent after adjusting budget.

## Priority 5: Patch Queue And Upstream Sync Hardening

Goal: make upstream updates reviewable and repeatable.

Tasks:
- [ ] Create `patches/router`, `patches/brain`, and `patches/hr` patch marker files.
- [ ] Add script to regenerate patch files from local integration changes.
- [ ] Add CI summary for failed patch apply.
- [ ] Add sync dry-run mode.
- [ ] Document the real upstream replacements currently used:
  - `decolua/9router`
  - `NousResearch/hermes-agent`
  - `paperclipai/paperclip`

Acceptance criteria:
- Weekly sync creates a PR when upstream changes.
- Patch failures are visible in GitHub summary.
- Local developer can run dry-run sync without mutating main branch.

## Priority 6: Production Security

Goal: reduce Docker socket risk before any production-like usage.

Tasks:
- [ ] Replace raw Docker socket mount with restricted Docker API proxy or DinD.
- [ ] Move secrets to `.env` and document required keys.
- [ ] Add secret scanning notes for upstream subtree updates.
- [ ] Add service-level healthchecks to `docker-compose.yml`.
- [ ] Add backup/restore notes for Redis, Paperclip DB, and Brain memory volumes.

Acceptance criteria:
- Executors cannot access host Docker unrestricted.
- Secrets are not committed.
- Stack has healthchecks and documented recovery path.

## Useful Commands

```powershell
pnpm --filter @zh/router build
pnpm --filter @zh/brain build
pnpm --filter @zh/hr build
pnpm --filter @zh/router test
pnpm --filter @zh/brain test
pnpm --filter @zh/hr test
docker compose -p zero-human ps
docker compose -p zero-human up -d --build
```

## Latest Known Runtime

Dashboard:
- `http://localhost:3003`

Exposed services:
- 9Router upstream: `http://localhost:20128`
- Hermes dashboard: `http://localhost:9119`
- Paperclip upstream: `http://localhost:3100`
- Zero-Human dashboard: `http://localhost:3003`

