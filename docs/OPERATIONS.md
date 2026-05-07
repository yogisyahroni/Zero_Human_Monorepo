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

The current development stack still mounts `/var/run/docker.sock` for Paperclip and Brain compatibility. Before production-like use, replace raw socket access with one of:
- a restricted Docker API proxy
- a dedicated Docker-in-Docker executor environment
- an executor service with an explicit allowlist of container operations

Do not expose this stack directly to the internet while raw Docker socket mounts are enabled.

