# Zero-Human Operations Notes

## Secrets

Keep secrets in `.env` or your deployment secret store. Do not commit `.env` files.

Common keys:
- `ANTHROPIC_API_KEY`
- `OPENROUTER_API_KEY`
- `GLM_API_KEY`
- `OPENAI_API_KEY`
- `DISCORD_WEBHOOK_URL`
- `BETTER_AUTH_SECRET`

## Executors

The `zh-brain-adapter` image installs the Claude Code and Codex CLIs. Agents with `executor: claude-code` try `claude` first and fall back to `codex` when the Claude CLI is unavailable. Agents with `executor: codex` call `codex` directly. The executor runs inside the task worktree and must not commit or push changes.

Mount or configure the relevant CLI credentials for non-interactive execution before expecting fully autonomous edits. When an executor binary is missing, Brain writes an explicit `.zero-human/tasks/<taskId>.md` fallback artifact so the review flow remains visible.

## Brain Memory

Brain persists agent notes, task outcomes, and skill confidence through `HermesCompatibleMemoryStore`. The current backend is `hermes-compatible-file` at `ZH_BRAIN_MEMORY_PATH` and includes a format version so it can migrate cleanly when Hermes exposes a stable external memory API. Brain `/health` and `/api/memory` report the detected upstream MemoryProvider contract and bundled providers.

Before pushing subtree updates, scan diffs for sample OAuth clients, API keys, and tokens:

```powershell
git diff --cached
git grep -n "sk-|GOCSPX|client_secret|api_key|BEGIN .*PRIVATE KEY"
```

## Backup

Docker volumes used by the stack:
- `zero-human_redis-data`
- `zero-human_brain-memory`
- `zero-human_paperclip-pgdata`
- `zero-human_paperclip-data`
- `zero-human_hr-worktrees`
- `zero-human_worktree-source`

Simple local backup pattern:

```powershell
docker run --rm -v zero-human_brain-memory:/data -v ${PWD}/backups:/backup alpine tar czf /backup/brain-memory.tgz -C /data .
docker run --rm -v zero-human_redis-data:/data -v ${PWD}/backups:/backup alpine tar czf /backup/redis-data.tgz -C /data .
docker run --rm -v zero-human_paperclip-data:/data -v ${PWD}/backups:/backup alpine tar czf /backup/paperclip-data.tgz -C /data .
```

Postgres backup:

```powershell
docker compose -p zero-human exec -T paperclip-db pg_dump -U paperclip paperclip > backups/paperclip.sql
```

Restore only into a stopped stack and after saving a fresh backup.

## Docker Socket Risk

The stack exposes Docker through `docker-socket-proxy` instead of mounting `/var/run/docker.sock` into every service. Treat this as privileged access even with endpoint filtering.

Only the proxy service should mount the raw socket. Before production-like use, tighten the allowlist to the exact executor operations required, or move executors to Docker-in-Docker or disposable remote builders.

Do not expose the proxy or raw Docker socket on a public network.
