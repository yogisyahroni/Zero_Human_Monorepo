# Codex CLI Executor Setup

Zero-Human uses Codex CLI as the default coding executor. The task flow is:

1. Zero-Human creates an isolated git worktree.
2. Brain asks 9Router for the task execution note and memory context.
3. `zh-brain-adapter` runs `codex exec` inside that worktree.
4. Codex edits files but does not commit or push.
5. Zero-Human shows the diff for human approve/reject.

## Provider Setup

Configure AI provider keys in the 9Router UI:

- Local: `http://localhost:20128`
- Staging: your `ZH_9ROUTER_PUBLIC_URL`, or private access to port `20128`

The brain container routes Codex to 9Router with:

```env
CODEX_OPENAI_BASE_URL=http://9router:20128/v1
CODEX_API_KEY=sk_9router
CODEX_HOME=/root/.codex
```

`CODEX_API_KEY` is the internal bearer token sent to 9Router. Real provider
keys should stay in 9Router.

## Container Setup

Start the stack:

```powershell
docker compose -p zero-human up -d --build
```

Check that Codex exists in the brain container:

```powershell
docker compose -p zero-human exec zh-brain-adapter codex --version
```

Check the brain logs when a task runs:

```powershell
docker compose -p zero-human logs -f zh-brain-adapter
```

Codex state is persisted in the `zero-human_codex-home` Docker volume mounted
at `/root/.codex`.

## Agent Config

Agents that should perform real coding need:

```yaml
executor: "codex"
```

Current defaults:

- `cto`: Codex
- `backend_lead`: Codex
- `maintenance_bot`: bash fallback

Optional model override:

```env
CODEX_MODEL=gpt-5.3-codex
```

Leave `CODEX_MODEL` empty to use the Codex CLI default.

## Smoke Test

After the stack is running, create a small task from the Zero-Human UI at
`http://localhost:3003`. The expected result is:

- task enters an isolated worktree
- `zh-brain-adapter` logs a `codex exec` run
- changed files appear in the task review screen
- user can approve or reject the diff

If Codex cannot authenticate or the 9Router endpoint is incompatible, Brain
will write a fallback artifact under `.zero-human/tasks/<taskId>.md` inside the
task worktree so the review flow remains visible.
