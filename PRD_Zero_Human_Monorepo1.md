# Zero-Human Monorepo
## Autonomous AI Company Operating System

**Version:** 1.0  
**Date:** 7 Mei 2026  
**Status:** Draft

---

## 1. Executive Summary

Zero-Human adalah monorepo yang mengintegrasikan tiga komponen open-source utama — **Paperclip** (orchestration & HR layer), **Hermes Agent** (persistent memory & skill evolution), dan **9Router** (local AI gateway dengan cost optimization) — menjadi satu platform "Zero-Human Company" yang dapat dijalankan secara lokal via Docker.

Platform ini memungkinkan user untuk:
- "Merekrut" AI agents dengan role spesifik (CTO, Engineer, QA)
- Agents belajar dan berkembang seiring waktu melalui persistent memory
- Eksekusi coding otomatis dengan cost minimal (token saver + smart fallback)
- Monitoring & approval via single dashboard

---

## 2. Problem Statement

| Problem | Dampak |
|---------|--------|
| **Fragmented Tools** | Paperclip, Hermes, 9Router jalan terpisah — setup manual, config dobel |
| **No Shared State** | Tiap tool punya state sendiri — task status tidak sinkron antar layer |
| **Upstream Drift** | 3 repo aktif development — fork cepat outdated |
| **Deployment Complexity** | User harus install Node, Python, Go, manage port, env var secara terpisah |

---

## 3. Solution Overview

### 3.1 Design Principles
1. **Modular Monorepo** — 1 repo, tapi tiap layer tetap independen & bisa jalan sendiri
2. **Configuration as Contract** — 1 file `zero-human.yaml` jadi single source of truth
3. **Event-Driven Sync** — Antar layer komunikasi via Redis pub/sub, bukan direct API call
4. **Upstream-Aware** — Struktur repo mendukung sync berkala dari 3 upstream repo

### 3.3 Upstream Repositories

Komponen inti diambil dari 3 repository open-source aktif. Struktur monorepo menggunakan **git subtree** untuk tracking upstream sambil menjaga custom integration code terpisah.

| Package | Upstream Repo | Role | License |
|---------|---------------|------|---------|
| `@zh/router` | [NousResearch/9Router](https://github.com/NousResearch/9Router) | Local AI gateway dengan token saver & smart fallback | MIT |
| `@zh/brain` | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | Persistent memory, skill evolution, subagent spawner | MIT |
| `@zh/hr` | [paperclip-org/paperclip](https://github.com/paperclip-org/paperclip) | Orchestration dashboard, task queue, git worktree | MIT |

**Fork Strategy:**
- Clone upstream ke `packages/@zh/{name}` via `git subtree add`
- Custom patches disimpan di `patches/{name}/` dan di-apply otomatis saat sync
- Integration layer (event bus, config loader) di `@zh/sdk` — tidak modify core upstream

**Clone Commands (Initial Setup):**
```bash
# Add upstream sebagai remote
git remote add upstream-router https://github.com/NousResearch/9Router.git
git remote add upstream-brain https://github.com/NousResearch/hermes-agent.git
git remote add upstream-hr https://github.com/paperclip-org/paperclip.git

# Subtree add (squash history)
git subtree add --prefix=packages/@zh/router upstream-router main --squash
git subtree add --prefix=packages/@zh/brain upstream-brain main --squash
git subtree add --prefix=packages/@zh/hr upstream-hr main --squash
```

**Sync Commands (Weekly):**
```bash
# Pull latest upstream changes
git subtree pull --prefix=packages/@zh/router upstream-router main --squash
git subtree pull --prefix=packages/@zh/brain upstream-brain main --squash
git subtree pull --prefix=packages/@zh/hr upstream-hr main --squash

# Apply custom patches
./scripts/apply-patches.sh
```

---

### 3.2 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      USER INTERFACE                          │
│              (Paperclip React Dashboard :3000)               │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP / WebSocket
┌────────────────────────▼────────────────────────────────────┐
│                    ORCHESTRATOR (HR)                         │
│         Task Queue • Budget Control • Git Worktree           │
│                    (@zh/hr - Paperclip)                      │
└────────────────────────┬────────────────────────────────────┘
                         │ Redis Pub/Sub Events
┌────────────────────────▼────────────────────────────────────┐
│                    BRAIN ENGINE                              │
│    Persistent Memory • Skill Evolution • Subagent Spawner    │
│                  (@zh/brain - Hermes Agent)                  │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP API (localhost:20128)
┌────────────────────────▼────────────────────────────────────┐
│                    AI GATEWAY                                │
│   RTK Token Saver • Smart Fallback • Multi-Provider Route    │
│                  (@zh/router - 9Router)                      │
└────────────────────────┬────────────────────────────────────┘
                         │ LLM APIs
              ┌──────────┴──────────┐
              ▼                     ▼
        ┌─────────┐           ┌──────────┐
        │ Claude  │           │  GLM/    │
        │  Code   │           │  Kiro    │
        └─────────┘           └──────────┘
```

---

## 4. Component Specifications

### 4.1 @zh/sdk (Shared Core)
**Responsibility:** Types, schemas, constants, event contracts

```typescript
// packages/@zh/sdk/src/types.ts
export interface Agent {
  id: string;
  role: 'cto' | 'frontend' | 'backend' | 'qa' | 'devops';
  brain: 'hermes' | 'simple';
  memory: 'persistent' | 'session';
  modelCombo: string;       // referensi ke gateway combo
  executor: 'claude-code' | 'codex' | 'cursor' | 'bash';
  maxBudgetUsd: number;
  status: 'idle' | 'working' | 'reviewing' | 'error';
}

export interface Task {
  id: string;
  agentId: string;
  type: 'architecture' | 'coding' | 'review' | 'test' | 'deploy';
  description: string;
  context?: string[];       // file paths atau memory keys
  priority: 1 | 2 | 3;
  status: 'queued' | 'assigned' | 'in_progress' | 'pending_review' | 'done';
  worktreePath?: string;
  costAccumulated?: number; // USD, tracked by router
}
```

```typescript
// packages/@zh/sdk/src/events.ts
export enum ZHEvent {
  TASK_ASSIGNED = 'zh:task:assigned',
  TASK_COMPLETED = 'zh:task:completed',
  AGENT_SPAWNED = 'zh:agent:spawned',
  SKILL_LEARNED = 'zh:skill:learned',
  QUOTA_EXHAUSTED = 'zh:quota:exhausted',
  COST_THRESHOLD = 'zh:cost:threshold',
}
```

### 4.2 @zh/router (9Router Fork)
**Responsibility:** Local AI gateway, token optimization, provider fallback

**Modifications dari upstream:**
- Tambahin health check endpoint `/health` untuk Docker
- Tambahin metrics endpoint `/metrics` (Prometheus format) buat monitoring cost
- Env var override via `ZH_CONFIG_PATH` (baca dari shared config)

**Key Features:**
- **RTK Token Saver:** Compress tool_result (git diff, file listing) sebelum kirim ke LLM — hemat 20-40% input token
- **Caveman Mode:** Inject terse system prompt — output lebih pendek, hemat 65% output token
- **Smart 3-Tier Fallback:** Subscription -> Cheap ($0.6/1M tokens) -> Free (unlimited)
- **Universal Format Translation:** OpenAI <-> Claude <-> Gemini <-> Cursor <-> Kiro

### 4.3 @zh/brain (Hermes Agent Fork)
**Responsibility:** Persistent memory, skill evolution, cron scheduling, subagent delegation

**Modifications dari upstream:**
- Integrasi dengan `@zh/sdk` event bus (Redis pub/sub)
- API endpoint untuk menerima task dari orchestrator
- Volume mount ke shared Redis untuk cross-session memory
- Docker socket access untuk spawn executor containers

**Key Features:**
- **Persistent Memory:** Ingat project structure, convention, keputusan arsitektur antar session
- **Skill Auto-Evolve:** Task yang berulang di-optimize dari 20 menit -> 8 menit dalam 6 minggu
- **Subagent Spawner:** Delegate coding ke Claude Code, review ke Codex, via 9Router
- **Cron Jobs:** Schedule maintenance tasks, dependency updates, health checks

### 4.4 @zh/hr (Paperclip Fork)
**Responsibility:** Dashboard UI, task queue, approval workflow, budget management, git worktree

**Modifications dari upstream:**
- Ganti direct LLM calls jadi proxy via `@zh/router`
- Tambahin agent profile integration dengan `@zh/brain`
- Unified config loader dari `zero-human.yaml`
- Event publisher ke Redis

**Key Features:**
- **Role-Based Hiring:** Pre-defined templates (CTO, Fullstack, QA, DevOps)
- **Budget Caps:** Per-agent daily/weekly/monthly limits
- **Git Worktree Isolation:** Tiap task jalan di branch terpisah — aman untuk review
- **Approval Gates:** Human-in-the-loop untuk task >$X atau touching critical files

---

## 5. Data Flow & Event Bus

### 5.1 Event Bus Architecture
Semua komunikasi antar service lewat **Redis Pub/Sub** dengan schema JSON:

```json
{
  "event": "zh:task:assigned",
  "timestamp": "2026-05-07T03:15:00Z",
  "payload": {
    "taskId": "task_abc123",
    "agentId": "agent_cto_01",
    "description": "Refactor auth module"
  },
  "metadata": {
    "source": "hr",
    "version": "1.0"
  }
}
```

### 5.2 Typical Task Flow

```
1. User klik "Hire CTO" di Dashboard
   -> HR publish: zh:agent:spawned

2. Brain (Hermes) consume event
   -> Load memory, initialize profile
   -> Publish: zh:agent:ready

3. User assign task via Dashboard
   -> HR create worktree, publish: zh:task:assigned

4. Brain consume task
   -> Evaluate: perlu coding -> spawn Claude Code
   -> Hit Router (9Router) untuk eksekusi

5. Router intercept request
   -> RTK compress -> Caveman mode -> Route ke provider
   -> Track cost, publish: zh:cost:accumulated

6. Claude Code eksekusi di worktree
   -> Modify file, run test, commit

7. Brain review hasil
   -> Update memory, learn new pattern
   -> Publish: zh:task:completed

8. HR consume completion
   -> Update UI, notify user for review
   -> User approve -> merge worktree
```

---

## 6. Configuration Schema

File tunggal `config/zero-human.yaml`:

```yaml
version: "1.0"

company:
  name: "My AI Startup"
  description: "Autonomous dev agency"
  budget_usd: 100                    # Monthly global budget
  currency: "USD"

infrastructure:
  redis_url: "redis://redis:6379"
  docker_socket: "/var/run/docker.sock"
  worktree_base: "/app/worktrees"

gateway:
  port: 20128
  host: "0.0.0.0"
  rtk_token_saver: true
  caveman_mode: true
  log_level: "info"

  providers:
    anthropic:
      api_key: "${ANTHROPIC_API_KEY}"
      priority: 1
    openrouter:
      api_key: "${OPENROUTER_API_KEY}"
      priority: 2
    glm:
      api_key: "${GLM_API_KEY}"
      priority: 3

  combos:
    premium_stack:
      - provider: anthropic
        model: claude-opus-4
      - provider: openrouter
        model: claude-sonnet-4
    cheap_stack:
      - provider: glm
        model: glm-5.1
      - provider: openrouter
        model: gpt-4.1-mini
    free_stack:
      - provider: kiro
        model: claude-sonnet-4.5
        auth: "none"

agents:
  cto:
    role: "cto"
    brain: "hermes"
    memory: "persistent"
    model_combo: "premium_stack"
    executor: "claude-code"
    max_budget_usd: 40
    skills:
      - "architecture"
      - "system_design"
      - "code_review"
    schedule: null                     # On-demand

  backend_lead:
    role: "backend"
    brain: "hermes"
    memory: "persistent"
    model_combo: "cheap_stack"
    executor: "claude-code"
    max_budget_usd: 30
    schedule: null

  maintenance_bot:
    role: "devops"
    brain: "hermes"
    memory: "persistent"
    model_combo: "free_stack"
    executor: "bash"
    max_budget_usd: 5
    schedule: "0 2 * * *"             # Cron: daily 2 AM

orchestrator:
  port: 3000
  host: "0.0.0.0"
  approval_required: true
  approval_threshold_usd: 5.0         # >$5 need human approve
  auto_merge: false                   # Always human review before merge
  log_level: "info"

notifications:
  webhook_url: "${DISCORD_WEBHOOK_URL}"
  events:
    - "zh:task:completed"
    - "zh:cost:threshold"
    - "zh:agent:error"
```

---

## 7. Docker Orchestration

### 7.1 Service Topology

| Service | Image | Ports | Depends On | Volume |
|---------|-------|-------|------------|--------|
| `router` | `@zh/router` | `20128` | — | `router-data` |
| `brain` | `@zh/brain` | `8080` | `router`, `redis` | `brain-memory`, docker socket |
| `hr` | `@zh/hr` | `3000` | `brain`, `router`, `redis` | `hr-worktrees`, docker socket |
| `redis` | `redis:7-alpine` | `6379` | — | `redis-data` |

### 7.2 Network Isolation
Semua service di dalam Docker network `zh-network`. Hanya `hr` (port 3000) dan `router` (port 20128) yang di-expose ke host. `brain` dan `redis` internal only.

### 7.3 Volume Strategy
- **`brain-memory`**: Persistent Hermes memory & skills (`~/.hermes/`)
- **`hr-worktrees`**: Git worktrees untuk tiap task (bisa di-mount ke host untuk editing)
- **`router-data`**: Quota tracking, usage stats, combo configs
- **`redis-data`**: Event log, state cache

---

## 8. Security & Isolation

### 8.1 Agent Isolation
- Tiap task jalan di **git worktree terpisah** — tidak bisa corrupt branch utama
- Executor (Claude Code) jalan dalam **container terpisah** dengan volume read-only ke source code (kecuali worktree aktif)

### 8.2 Budget Protection
- **Per-agent budget cap** — auto-pause kalau limit tercapai
- **Global budget cap** — emergency shutdown semua agent
- **Cost accumulation real-time** — tracked by 9Router per request

### 8.3 Secret Management
- API keys di env var, tidak di-commit
- Docker secrets support untuk production
- 9Router jadi single gateway — API keys tidak perlu di-share ke Hermes/Paperclip

### 8.4 Docker Socket Risk
- Mount `/var/run/docker.sock` hanya untuk `brain` dan `hr`
- Untuk production: ganti dengan **Docker-in-Docker** atau **restricted Docker API proxy**

---

## 9. Development Workflow

### 9.1 Local Development
```bash
# Setup
git clone https://github.com/you/zero-human.git
cd zero-human
pnpm install          # Install shared deps + all packages
pnpm build            # Build @zh/sdk first, then others

# Jalankan semua
docker-compose up --build

# Atau dev mode (hot reload)
pnpm dev:router       # Terminal 1
pnpm dev:brain        # Terminal 2
pnpm dev:hr           # Terminal 3
```

### 9.2 Adding New Agent Role
1. Tambahin di `config/zero-human.yaml` -> agents section
2. Definisikan `model_combo` di gateway -> combos section
3. Restart stack: `docker-compose restart`

### 9.3 Testing Integration
```bash
pnpm test:unit        # Unit test per package
pnpm test:integration # End-to-end task flow test
pnpm test:e2e         # Full Docker compose test
```

---

## 10. Upstream Sync Strategy (Auto-Update)

### 10.1 Realita: 100% Auto-Update Tidak Mungkin
Ketiga upstream repo (Paperclip, Hermes, 9Router) aktif development dengan:
- Breaking changes di API
- Refactor struktur folder
- Dependency version conflict
- Custom integration code di monorepo kita

**Auto-merge tanpa review = guaranteed broken build.**

### 10.2 Strategi: Git Subtree + Patch Queue

Struktur repo:

```
zero-human/
├── packages/
│   ├── @zh/router/          <- git subtree dari 9Router
│   ├── @zh/brain/           <- git subtree dari Hermes
│   └── @zh/hr/              <- git subtree dari Paperclip
├── patches/
│   ├── router/
│   │   ├── 001-docker-healthcheck.patch
│   │   ├── 002-metrics-endpoint.patch
│   │   └── 003-config-loader.patch
│   ├── brain/
│   └── hr/
├── scripts/
│   └── sync-upstream.sh     # Automation script
└── .github/
    └── workflows/
        └── upstream-sync.yml # CI untuk sync
```

### 10.2.1 Upstream Repository Sources

Berikut adalah repository asli (upstream) yang perlu di-fork atau di-pull via git subtree:

| Package | Upstream Repo | URL | Branch | License |
|---------|---------------|-----|--------|---------|
| `@zh/router` | 9Router | `https://github.com/NousResearch/9Router` | `main` | MIT |
| `@zh/brain` | Hermes Agent | `https://github.com/NousResearch/hermes-agent` | `main` | MIT |
| `@zh/hr` | Paperclip | `https://github.com/paperclip-org/paperclip` | `main` | MIT |

**Catatan:** URL repo di atas berdasarkan hasil research. Sebelum fork, verifikasi ulang keberadaan repo karena upstream bisa berubah (rename, archive, atau pindah organisasi).

#### Initial Setup (First Time)

```bash
# 1. Clone monorepo ini
git clone https://github.com/you/zero-human.git
cd zero-human

# 2. Add upstream repos sebagai remote references
git remote add upstream-router https://github.com/NousResearch/9Router.git
git remote add upstream-brain https://github.com/NousResearch/hermes-agent.git
git remote add upstream-hr https://github.com/paperclip-org/paperclip.git

# 3. Pull upstream code ke packages/ via git subtree
git subtree add --prefix=packages/@zh/router upstream-router main --squash
git subtree add --prefix=packages/@zh/brain upstream-brain main --squash
git subtree add --prefix=packages/@zh/hr upstream-hr main --squash

# 4. Apply custom patches
for patch in patches/router/*.patch; do git apply "$patch"; done
for patch in patches/brain/*.patch; do git apply "$patch"; done
for patch in patches/hr/*.patch; do git apply "$patch"; done

# 5. Install dependencies & build
pnpm install
pnpm build
```

#### Directory Structure After Setup

```
zero-human/
├── packages/
│   ├── @zh/sdk/              # Dibuat dari nol (bukan fork)
│   │   └── src/
│   │       ├── types.ts
│   │       ├── events.ts
│   │       └── config.ts
│   │
│   ├── @zh/router/           # Git subtree dari 9Router
│   │   ├── src/              # Code asli upstream
│   │   ├── patches-applied/  # Marker file
│   │   └── ...
│   │
│   ├── @zh/brain/            # Git subtree dari Hermes Agent
│   │   ├── src/              # Code asli upstream
│   │   ├── patches-applied/
│   │   └── ...
│   │
│   └── @zh/hr/               # Git subtree dari Paperclip
│       ├── src/              # Code asli upstream
│       ├── patches-applied/
│       └── ...
│
├── patches/
│   ├── router/
│   │   ├── 001-docker-healthcheck.patch
│   │   ├── 002-metrics-endpoint.patch
│   │   └── 003-config-loader.patch
│   ├── brain/
│   │   ├── 001-redis-event-bus.patch
│   │   ├── 002-mcp-client.patch
│   │   └── 003-subagent-spawner.patch
│   └── hr/
│       ├── 001-router-proxy.patch
│       ├── 002-brain-integration.patch
│       └── 003-config-loader.patch
│
├── scripts/
│   ├── setup.sh              # Initial setup script
│   └── sync-upstream.sh      # Sync automation
│
├── config/
│   └── zero-human.yaml       # Single config file
│
├── docker-compose.yml
├── Makefile
└── README.md
```

#### Setup Script (`scripts/setup.sh`)

```bash
#!/bin/bash
set -e

echo "=== Zero-Human Monorepo Setup ==="

# Check prerequisites
command -v git >/dev/null 2>&1 || { echo "Git required"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "pnpm required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker required"; exit 1; }

# Create directories
mkdir -p packages/@zh
mkdir -p patches/{router,brain,hr}
mkdir -p config

# Add upstream remotes if not exists
git remote get-url upstream-router >/dev/null 2>&1 || git remote add upstream-router https://github.com/NousResearch/9Router.git
git remote get-url upstream-brain >/dev/null 2>&1 || git remote add upstream-brain https://github.com/NousResearch/hermes-agent.git
git remote get-url upstream-hr >/dev/null 2>&1 || git remote add upstream-hr https://github.com/paperclip-org/paperclip.git

# Fetch upstream
git fetch upstream-router
git fetch upstream-brain
git fetch upstream-hr

# Pull via subtree (idempotent - safe to run multiple times)
if [ ! -d "packages/@zh/router/src" ]; then
    echo "Pulling 9Router..."
    git subtree add --prefix=packages/@zh/router upstream-router main --squash
else
    echo "Router already exists, skipping..."
fi

if [ ! -d "packages/@zh/brain/src" ]; then
    echo "Pulling Hermes Agent..."
    git subtree add --prefix=packages/@zh/brain upstream-brain main --squash
else
    echo "Brain already exists, skipping..."
fi

if [ ! -d "packages/@zh/hr/src" ]; then
    echo "Pulling Paperclip..."
    git subtree add --prefix=packages/@zh/hr upstream-hr main --squash
else
    echo "HR already exists, skipping..."
fi

# Create SDK package
if [ ! -d "packages/@zh/sdk" ]; then
    echo "Creating @zh/sdk..."
    mkdir -p packages/@zh/sdk/src
    # Copy template files...
fi

# Apply patches
echo "Applying patches..."
for patch in patches/router/*.patch; do
    [ -f "$patch" ] && git apply "$patch" && echo "Applied: $patch"
done

for patch in patches/brain/*.patch; do
    [ -f "$patch" ] && git apply "$patch" && echo "Applied: $patch"
done

for patch in patches/hr/*.patch; do
    [ -f "$patch" ] && git apply "$patch" && echo "Applied: $patch"
done

# Install & build
echo "Installing dependencies..."
pnpm install

echo "Building packages..."
pnpm build

echo "=== Setup Complete ==="
echo "Run 'docker-compose up --build' to start all services"
```

### 10.3 Automated Sync Pipeline (GitHub Actions)

```yaml
# .github/workflows/upstream-sync.yml
name: Upstream Sync

on:
  schedule:
    - cron: '0 6 * * 1'    # Setiap Senin pagi
  workflow_dispatch:         # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        upstream:
          - { name: router, repo: NousResearch/9Router, branch: main }
          - { name: brain, repo: NousResearch/hermes-agent, branch: main }
          - { name: hr, repo: paperclip-org/paperclip, branch: main }

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Pull upstream subtree
        run: |
          git subtree pull --prefix=packages/@zh/${{ matrix.upstream.name }}             https://github.com/${{ matrix.upstream.repo }}.git             ${{ matrix.upstream.branch }} --squash

      - name: Apply custom patches
        run: |
          for patch in patches/${{ matrix.upstream.name }}/*.patch; do
            git apply "$patch" || echo "PATCH_FAILED: $patch" >> $GITHUB_STEP_SUMMARY
          done

      - name: Test build
        run: |
          cd packages/@zh/${{ matrix.upstream.name }}
          pnpm install
          pnpm build

      - name: Create PR
        uses: peter-evans/create-pull-request@v5
        with:
          title: "sync(upstream): ${{ matrix.upstream.name }} update"
          body: "Automated upstream sync. Review patch conflicts before merge."
          branch: "sync/${{ matrix.upstream.name }}-${{ github.run_id }}"
```

### 10.4 Patch Management Workflow

```bash
# 1. Sync upstream ke branch terpisah
./scripts/sync-upstream.sh router

# 2. Kalau ada conflict, resolve manual
# 3. Update patch files kalau custom code berubah
git diff packages/@zh/router > patches/router/004-new-feature.patch

# 4. Commit patch + test
pnpm test:integration

# 5. Merge ke main via PR
```

### 10.5 Alternatif: Package-Based (Lebih Sustainable)

Kalau upstream rilis versi stabil dengan npm package atau Docker image:

```json
// packages/@zh/hr/package.json
{
  "dependencies": {
    "@paperclip/core": "^2.1.0",      // Official package
    "@zh/sdk": "workspace:*",
    "@zh/router": "workspace:*"
  }
}
```

**Keuntungan:** Tidak perlu subtree sync, cuma `pnpm update` + test.  
**Syarat:** Upstream harus publish package ke npm/registry. Kalau belum, subtree tetap jalan.

### 10.6 Fallback Strategy

| Skenario | Handling |
|----------|----------|
| Upstream breaking API | Sync gagal apply patch -> CI buat PR dengan label `breaking-change` |
| Patch conflict | Script catat file yang conflict -> human resolve |
| Upstream archived | Freeze version, fork resmi jadi canonical |
| Security patch upstream | Fast-track sync, bypass schedule |

---

## 11. Milestones & Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Setup monorepo structure (pnpm workspaces)
- [ ] Fork 3 repo ke packages/ dengan subtree
- [ ] Buat `@zh/sdk` dengan shared types & events
- [ ] Docker Compose jalan, semua service health

### Phase 2: Integration (Week 3-4)
- [ ] Unified config loader (`zero-human.yaml`)
- [ ] Redis event bus antar service
- [ ] Paperclip dashboard bisa lihat Hermes memory status
- [ ] 9Router metrics muncul di dashboard

### Phase 3: Intelligence (Week 5-6)
- [ ] Hermes auto-spawn Claude Code via Docker
- [ ] Skill evolution tracking di dashboard
- [ ] Budget alerts & auto-pause

### Phase 4: Polish (Week 7-8)
- [ ] GitHub Actions sync pipeline
- [ ] Patch management automation
- [ ] Documentation & deployment guide
- [ ] Community release

---

## 12. Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Upstream breaking change | High | High | Subtree + patch queue, tidak auto-merge |
| Docker socket security | Medium | High | Gunakan DinD atau restricted proxy untuk prod |
| Cost overrun LLM | Medium | High | Hard budget caps di 9Router + Paperclip |
| Redis single point of failure | Low | Medium | Backup NATS/RabbitMQ sebagai fallback |
| License conflict | Low | High | Audit license ketiga repo sebelum commercial use |

---

## 13. Kesimpulan

Zero-Human monorepo adalah **integration layer**, bukan rewrite. Kita tidak mengubah core logic Paperclip, Hermes, atau 9Router — kita **menyatukan mereka dengan shared contract (SDK + Config + Events)** dan **memudahkan deployment (Docker Compose)**.

**Untuk auto-update:** Bisa semi-otomatis via GitHub Actions + subtree, tapi **human review wajib** untuk tiap sync. Kalau upstream sudah stabil dan publish npm package, migrasi ke package-based dependencies akan jauh lebih clean.
