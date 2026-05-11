# @zh/hr

Zero-Human owner/control-plane service. It serves the Studio UI, owns the
company manifest, synchronizes Paperclip agents/skills/MCP guidance, manages
repository intake, and coordinates Hermes memory guidance for Paperclip runs.

## Required Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port for the HR/control-plane API. |
| `REDIS_URL` | Redis connection string for the event bus. |
| `ZH_ROUTER_URL` | Internal router adapter URL. |
| `ZH_BRAIN_URL` | Internal brain adapter URL. |
| `ZH_HR_URL` | Canonical internal URL for this service. |
| `PAPERCLIP_DATABASE_URL` | PostgreSQL connection string for Paperclip sync state. |

## Optional Environment

| Variable | Purpose |
| --- | --- |
| `DOCKER_HOST` | Docker API endpoint for container-aware repository and Paperclip operations. |
| `PAPERCLIP_HERMES_SYNC_INTERVAL_MS` | Interval for automatic Paperclip/Hermes manifest sync. |
| `PAPERCLIP_HERMES_MONITOR_INTERVAL_MS` | Interval for Paperclip issue monitoring and Hermes intervention guidance. |
| `ZH_REPO_PATH` | Primary repository/workspace path used by the control plane. |
| `ZH_WORKTREE_SOURCE_PATH` | Source path for worktree operations. |
| `ZH_REPOSITORY_BASE` | Base directory for registered external repositories. |
| `ZH_STATE_PATH` | Persistent Zero-Human state directory. |
| `ZH_PAPERCLIP_DATABASE_URL` | Backward-compatible fallback for `PAPERCLIP_DATABASE_URL`. |
| `PAPERCLIP_CONTAINER_NAME` | Paperclip container name used by Docker-assisted operations. |
| `PAPERCLIP_COMPANY_ID` | Explicit Paperclip company ID override. |
| `PAPERCLIP_PROJECT_ID` | Explicit Paperclip project ID override. |
| `ZH_MAX_REGISTRY_SKILLS_PER_AGENT` | Maximum registry skills auto-assigned per agent. |
| `ZH_MAX_MANUAL_PAPERCLIP_SKILLS_PER_AGENT` | Maximum manual Paperclip skills preserved per agent. |

## Local Checks

```bash
pnpm --filter @zh/hr build
pnpm --filter @zh/hr test
```
