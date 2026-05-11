# Changelog

All notable Zero-Human Monorepo changes are tracked here.

## 2026-05-11

- Added the improvement task list to `docs/ZH_IMPROVEMENT_TASKS.md`.
- Hardened Docker and staging Compose secret handling by requiring runtime
  secrets instead of using public dummy fallbacks.
- Limited Zero-Human container mounts and moved runtime state to named volumes.
- Kept Hermes internal to the Docker network and documented the service
  boundary between Zero-Human, Paperclip, Codex CLI, 9Router, and Hermes.
- Pinned global executor package versions used in the Docker build.
- Added startup environment validation helpers in `@zh/sdk` and wired them into
  Zero-Human services.
- Added cross-platform stack command wrappers and shell script entry points.
- Added Vitest-based unit tests and Redis graceful-degradation coverage.
- Updated PRD status notes and upstream router references.
