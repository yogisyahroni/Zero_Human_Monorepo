# Zero-Human Architecture

Zero-Human is the owner control plane for an autonomous company. Paperclip is the company execution board, Codex CLI performs coding work, 9Router is the only AI gateway, and Hermes is the shared memory/operating protocol layer.

## Runtime Services

| Service | Role | Public port |
| --- | --- | --- |
| `zero-human` | Owner dashboard and policy control plane | `3003` |
| `paperclip` | Company board, agents, issues, runs, approvals | `3100` |
| `9router` | Central OpenAI-compatible AI gateway and provider routing | `20128` |
| `zh-brain-adapter` | Zero-Human brain API and Codex execution bridge | internal |
| `zh-router-adapter` | Zero-Human router adapter for health and cost tracking | internal |
| `hermes` | Internal Hermes dashboard/runtime used as shared memory context | internal only |
| `redis` | Event stream and lightweight coordination | `6379` |
| `paperclip-db` | Paperclip Postgres database | internal |

## Control Flow

1. The owner configures roles, skills, MCP tools, repositories, and AI routing in Zero-Human Studio.
2. Zero-Human syncs the owner manifest into Paperclip so agents receive role-specific skills, MCP guidance, and the Hermes Operating Protocol.
3. Paperclip owns work execution: issues, agent runs, comments, approvals, and handoffs.
4. Paperclip invokes Codex CLI through its local adapter.
5. Codex CLI calls 9Router using the configured model combo, usually `combotest`.
6. 9Router decides which configured provider/model handles the request.
7. Hermes supplies memory and intervention guidance through generated Paperclip skills and Zero-Human bridge APIs. Hermes does not directly execute code or bypass Paperclip.
8. Outcomes are written back into Paperclip and summarized into Hermes-compatible memory.

## Boundary Rules

- 9Router is the only AI provider gateway. Other services should not hardcode provider-specific endpoints or models.
- Paperclip is the execution source of truth for agents and issues.
- Codex CLI is the executor for real repository changes.
- Hermes is memory, guidance, and intervention context. It should not become a second agent runner.
- Zero-Human Studio is the owner policy source: role mapping, skill registry, MCP assignment, repo intake, and budget/operations monitoring.

## Repository Mounts

Docker does not mount the whole host repository into the `zero-human` service. Runtime state lives in the `zh-state` volume, worktree source in `worktree-source`, worktrees in `hr-worktrees`, and imported repositories in `registered-repos`.

This keeps host secrets and unrelated files out of the runtime container while still allowing registered repositories to be cloned, synced, and assigned to agents.
