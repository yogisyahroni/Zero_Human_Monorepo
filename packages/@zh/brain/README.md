# @zh/brain

Brain adapter for Zero-Human. It is the internal executor bridge and task
decision boundary. Hermes is consumed as memory/guidance context only; executor
spawning stays in this adapter and is routed through 9Router-compatible Codex
configuration.

## Required Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port for the brain adapter. |
| `REDIS_URL` | Redis connection string for task and memory events. |
| `ZH_ROUTER_URL` | Internal URL for the router adapter / AI gateway boundary. |
| `ZH_BRAIN_URL` | Canonical internal URL for this brain adapter. |
| `CODEX_API_KEY` | API key used by Codex-compatible executor calls. In local stacks this is usually the internal 9Router key. |

## Optional Environment

| Variable | Purpose |
| --- | --- |
| `CODEX_MODEL` | Explicit Codex model override. Leave unset to let 9Router combo routing decide. |
| `DOCKER_HOST` | Docker API endpoint when executor actions need container access. |
| `ZH_EXECUTOR_TIMEOUT_MS` | Executor timeout in milliseconds. |
| `ZH_BRAIN_MEMORY_PATH` | Local fallback path for Hermes-compatible memory snapshots. |
| `CODEX_OPENAI_BASE_URL` | Codex-compatible base URL override. Defaults to `http://9router:20128/v1`. |
| `OPENAI_BASE_URL` | Secondary Codex-compatible base URL fallback. |
| `CODEX_HOME` | Codex home directory inside the container. |
| `OPENAI_API_KEY` | Fallback key if `CODEX_API_KEY` is unavailable. |
| `CLAUDE_CONFIG_DIR` | Claude Code config directory for Claude adapter runs. |

## Local Checks

```bash
pnpm --filter @zh/brain build
pnpm --filter @zh/brain test
```
