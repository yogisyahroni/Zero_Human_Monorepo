# @zh/router

Router adapter for the Zero-Human stack. This package exposes the local routing
API used by the dashboard and adapters, records usage/cost events, and keeps
the 9Router gateway boundary behind the Zero-Human service contract.

## Required Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port for the router adapter. |
| `REDIS_URL` | Redis connection string for the shared event bus. |
| `ZH_ROUTER_URL` | Canonical internal URL for this router adapter. |

## Optional Environment

| Variable | Purpose |
| --- | --- |
| `ZH_CONFIG_PATH` | Override path for the Zero-Human YAML config. |
| `ZH_ROUTER_COMPAT_API_KEY` | Optional bearer token forwarded to compatibility endpoints. |

## Local Checks

```bash
pnpm --filter @zh/router build
pnpm --filter @zh/router test
```
