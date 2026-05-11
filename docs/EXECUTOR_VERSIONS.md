# Executor Versions

Zero-Human pins executor CLIs in `Dockerfile` so Docker builds are reproducible.

| Package | Version | Used by |
| --- | --- | --- |
| `@openai/codex` | `0.130.0` | `zh-brain-adapter` Codex local executor |
| `@anthropic-ai/claude-code` | `2.1.138` | Optional Claude Code adapter support |

Update process:

1. Test the target package versions locally or in a staging Docker build.
2. Update the `CODEX_VERSION` or `CLAUDE_CODE_VERSION` build args in `Dockerfile`.
3. Rebuild the brain image and run the Paperclip adapter environment check.
4. Commit the version bump with a note about why the executor update is safe.
