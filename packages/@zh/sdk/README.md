# @zh/sdk

Shared contracts for Zero-Human packages: config loading, environment
validation, Redis event bus helpers, upstream metadata, task types, and role
configuration utilities.

## Required Environment

This package does not require service-level runtime variables by itself. It
exports `requireEnv` and `warnEnv` so each service can validate its own contract
before initialization.

## Optional Environment

| Variable | Purpose |
| --- | --- |
| `ZH_CONFIG_PATH` | Optional config path consumed by `loadConfig`. |

## Local Checks

```bash
pnpm --filter @zh/sdk build
pnpm --filter @zh/sdk test
```
