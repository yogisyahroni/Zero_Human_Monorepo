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
- Real executor v1: HR creates isolated git worktrees from an internal Docker clone, Brain writes executor artifacts, captures changed files, and runs validation.
- Real executor v2: Brain invokes Claude Code/Codex CLI in the task worktree when available, with explicit fallback artifacts when not configured.
- Approval v1: diff endpoint, approve commit/merge into internal source clone, and reject cleanup endpoints.
- Persistent Brain memory v1: notes, task outcomes, and skill confidence are stored in the `brain-memory` volume and shown in the dashboard.
- Hermes-compatible memory store: Brain uses a versioned store adapter aligned with the upstream MemoryProvider contract and reports native contract availability through health/memory APIs.
- Budget notification v1: cost threshold/quota events create dashboard alerts, optionally send configured webhooks, and paused agents can be resumed.

## Priority 1: Real Executor Flow

Goal: make tasks edit code in isolated worktrees instead of stopping at `pending_review` with a planning note.

Tasks:
- [x] Add worktree manager in `@zh/hr`.
- [x] Create a unique git branch/worktree for every task.
- [x] Persist `worktreePath` and `branchName` on task records.
- [x] Add executor handoff payload from HR to Brain.
- [x] Mount only the task worktree as writable for the Brain executor v1.
- [x] Capture executor output and attach summary to task result.
- [x] Run configured validation command before marking task `pending_review`.
- [x] Replace Brain executor v1 artifact writer with real Claude Code/Codex container execution.

Acceptance criteria:
- Dispatching a coding task creates an isolated git worktree in Docker.
- Executor changes files only inside that worktree.
- Task result includes changed files, validation output, and next review action.
- Main branch remains untouched until human approval.

## Priority 2: Approval And Merge

Goal: turn the current approval button into a real review gate.

Tasks:
- [x] Add `POST /api/tasks/:taskId/diff` to show worktree diff.
- [x] Add `POST /api/tasks/:taskId/approve` merge behavior for the internal source clone.
- [x] Add `POST /api/tasks/:taskId/reject` cleanup behavior.
- [x] Respect `orchestrator.auto_merge` and `approval_required`.
- [x] Block merge if validation failed or budget exceeded.
- [x] Add host-repo export/apply flow for approved internal-clone commits.

Acceptance criteria:
- Dashboard can display task diff.
- Approve merges worktree branch into main or records manual merge instructions.
- Reject leaves a clear audit event and removes/archives the worktree.

## Priority 3: Hermes Memory And Skill Evolution

Goal: make memory and skills useful beyond the current telemetry counter.

Tasks:
- [x] Persist Brain memory to the mounted `brain-memory` volume.
- [x] Store task outcomes by agent, skill, files touched, and validation result.
- [x] Feed recent memory into future task prompts.
- [x] Track skill confidence from repeated successful task types.
- [x] Show per-agent memory notes and learned skills in dashboard.
- [x] Publish richer `zh:skill:learned` payload with before/after timing.
- [x] Detect Hermes upstream MemoryProvider contract availability and expose it through Brain health/memory APIs.
- [x] Replace the ad hoc JSON memory store with a Hermes-compatible memory store adapter that can swap to native APIs when exposed.

Acceptance criteria:
- Restarting Brain does not erase agent memory.
- Repeated tasks show increasing skill history.
- Brain uses prior task notes in router prompt.

## Priority 4: Budget Alerts And Notifications

Goal: make cost protection operational.

Tasks:
- [x] Send configured webhook notification for `zh:cost:threshold`.
- [x] Send configured webhook notification for `zh:quota:exhausted`.
- [x] Add budget policy tests for per-agent and global caps.
- [x] Add dashboard alert row for paused agents and blocked dispatches.
- [x] Add reset/resume endpoint for manually unpausing an agent.
- [x] Add UI for editing budget caps without editing `zero-human.yaml`.

Acceptance criteria:
- Crossing threshold emits event, dashboard alert, and webhook when configured.
- Exhausting budget pauses dispatch.
- User can resume an agent after adjusting/resetting budget state.

## Priority 5: Patch Queue And Upstream Sync Hardening

Goal: make upstream updates reviewable and repeatable.

Tasks:
- [x] Create `patches/router`, `patches/brain`, and `patches/hr` patch marker files.
- [x] Add script to regenerate patch files from local integration changes.
- [x] Add CI summary for failed patch apply.
- [x] Add sync dry-run mode.
- [x] Document the real upstream replacements currently used:
  - `decolua/9router`
  - `NousResearch/hermes-agent`
  - `paperclipai/paperclip`
- [x] Add automated dry-run sync check to CI without opening a PR.

Acceptance criteria:
- Weekly sync creates a PR when upstream changes.
- Patch failures are visible in GitHub summary and fail the workflow.
- Local developer can run dry-run sync without mutating main branch.

## Priority 6: Production Security

Goal: reduce Docker socket risk before any production-like usage.

Tasks:
- [x] Replace raw Docker socket mount with restricted Docker API proxy or DinD.
- [x] Move secrets to `.env` and document required keys.
- [x] Add secret scanning notes for upstream subtree updates.
- [x] Add service-level healthchecks to `docker-compose.yml`.
- [x] Add backup/restore notes for Redis, Paperclip DB, and Brain memory volumes.

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
