# Zero_Human_Monorepo — Improvement Task List

> Generated: 2026-05-10
> Berdasarkan full code review: PRD, REMAINING_TASKS, package.json, docker-compose.yml, Dockerfile
> Updated: tambah TASK-12 (Hermes boundary) berdasarkan analisa arsitektur overlap Hermes vs Paperclip

---

## Implementation Status

Last updated: 2026-05-11

| Task | Status | Notes |
|------|--------|-------|
| TASK-01 | Done | Runtime secrets are mandatory in local and staging Compose files. |
| TASK-02 | Done | Shared env validation is wired into router, brain, and HR services; package-level env READMEs are present. |
| TASK-03 | Done | Zero-Human uses named volumes instead of mounting the whole host repo. |
| TASK-04 | Done | Global executor packages are pinned in the Docker build. |
| TASK-12 | Done | Hermes is documented and configured as internal memory/guidance context. |
| TASK-05 | Done | Cross-platform stack commands and shell scripts were added. |
| TASK-06 | Done | Vitest tests run locally and CI validates both Compose files. |
| TASK-07 | Done | Redis event bus retries and degrades gracefully when unavailable. |
| TASK-08 | Done | PRD status and upstream 9Router references were updated. |
| TASK-09 | Done | `docs/ARCHITECTURE.md` documents the current runtime boundary. |
| TASK-10 | Done | `CHANGELOG.md` and repository metadata were added. |
| TASK-11 | Done | Root `Makefile` provides unified local entry points. |

---

## Verification Snapshot

Last verified: 2026-05-11

| Task | Verification evidence |
|------|-----------------------|
| TASK-01 | `docker-compose.yml` and `deploy/docker-compose.staging.yml` use mandatory Compose secret syntax; `.env.example` and `README.md` document secret setup. |
| TASK-02 | `packages/@zh/sdk/src/env.ts` exports `requireEnv` and `warnEnv`; `packages/@zh/router`, `packages/@zh/brain`, and `packages/@zh/hr` validate required env at startup; each `packages/@zh/*/README.md` documents env contracts. |
| TASK-03 | Zero-Human uses scoped named volumes (`zh-state`, `worktree-source`, `registered-repos`) instead of mounting the whole host repository. |
| TASK-04 | `Dockerfile` pins global executor package versions through build args; `docs/EXECUTOR_VERSIONS.md` documents upgrade checks. |
| TASK-05 | Cross-platform `scripts/run.mjs` dispatches Windows PowerShell or POSIX shell stack scripts from the same package commands. |
| TASK-06 | Vitest coverage exists across SDK, router, brain, and HR; staging CI validates install, build, tests, security scan, and Compose config. |
| TASK-07 | Redis publishing goes through retry/fallback queue helpers and services degrade gracefully when Redis is temporarily unavailable. |
| TASK-08 | PRD status and upstream references were refreshed; Hermes wording now follows the memory/guidance boundary. |
| TASK-09 | `docs/ARCHITECTURE.md` documents topology, service roles, exposed ports, volumes, and task flow. |
| TASK-10 | `CHANGELOG.md` and repository metadata guidance are present. |
| TASK-11 | Root `Makefile` provides canonical `up`, `down`, `logs`, `build`, and `test` commands. |
| TASK-12 | Hermes is documented and configured as internal memory/guidance context; execution remains owned by Zero-Human/Paperclip adapters. |

No open implementation task remains in this tracker.

---

## Daftar Task

| Task | Kategori | Priority | Effort | Impact |
|------|----------|----------|--------|--------|
| [TASK-01](#task-01--fix-hardcoded-secret-fallback-di-docker-composeyml) · Fix secret fallback | Security | 🔴 Critical | ~1 jam | Security |
| [TASK-02](#task-02--tambah-env-var-validation-di-startup-setiap-service) · Env var validation | Security | 🔴 Critical | ~2–3 jam | Stability |
| [TASK-03](#task-03--audit-dan-batasi-volume-mount---repo-di-zero-human-service) · Audit volume mount | Security | 🔴 Critical | ~1–2 jam | Security |
| [TASK-04](#task-04--pin-versi-global-package-install-di-dockerfile) · Pin Dockerfile versions | Build | 🔴 Critical | ~30 menit | Reproducibility |
| [TASK-12](#task-12--tetapkan-boundary-hermes-sebagai-pure-memory-store-opsi-a) · Hermes boundary | Architecture | 🔴 Critical | ~2–3 jam | Clarity + Stability |
| [TASK-05](#task-05--buat-shell-script-paralel-untuk-non-windows-developer) · Cross-platform scripts | DX | 🟡 High | ~2–3 jam | DX |
| [TASK-06](#task-06--setup-test-suite-yang-actual-dan-integrate-ke-ci) · Setup test suite | Quality | 🟡 High | ~4–6 jam | Quality |
| [TASK-07](#task-07--tambah-redis-resilience--retry-logic-dan-graceful-degradation) · Redis resilience | Stability | 🟡 High | ~3–4 jam | Stability |
| [TASK-08](#task-08--perbaiki-prd--update-status-dan-fix-url-upstream-yang-salah) · Fix PRD | Docs | 🟢 Medium | ~30 menit | Docs |
| [TASK-09](#task-09--tambah-architecturemd-yang-up-to-date) · ARCHITECTURE.md | Docs | 🟢 Medium | ~2 jam | Docs |
| [TASK-10](#task-10--tambah-changelog-dan-update-repo-metadata-di-github) · CHANGELOG + metadata | Docs | 🟢 Medium | ~1 jam | Discoverability |
| [TASK-11](#task-11--tambah-makefile-sebagai-unified-entry-point-cross-platform) · Makefile | DX | 🟢 Low | ~1–2 jam | DX |

**Total estimated effort: ~20–28 jam**

---

## 🔴 CRITICAL — Security & Stability

---

### TASK-01 · Fix hardcoded secret fallback di docker-compose.yml

**Priority:** Critical
**Effort:** ~1 jam
**File:** `docker-compose.yml`

**Problem:**
Dua secret punya fallback hardcoded yang sudah diketahui publik (repo ini public):
```yaml
BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:-<removed-public-default>}
ZH_ROUTER_COMPAT_API_KEY: ${ZH_ROUTER_COMPAT_API_KEY:-<removed-public-default>}
```
Siapapun yang clone repo ini dan lupa set `.env` akan langsung jalan dengan secret yang sudah bocor.

**Action:**
1. Hapus semua fallback `:-<value>` dari env var yang bersifat secret
2. Ganti dengan syntax mandatory Docker Compose:
   ```yaml
   BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?BETTER_AUTH_SECRET must be set. Run: openssl rand -hex 32}
   ZH_ROUTER_COMPAT_API_KEY: ${ZH_ROUTER_COMPAT_API_KEY:?ZH_ROUTER_COMPAT_API_KEY must be set}
   ```
3. Update `.env.example` dengan placeholder yang jelas:
   ```env
   # Generate dengan: openssl rand -hex 32
   BETTER_AUTH_SECRET=

   # Key untuk internal service-to-service auth via 9router
   ZH_ROUTER_COMPAT_API_KEY=

   # LLM Provider Keys (minimal salah satu wajib diisi)
   ANTHROPIC_API_KEY=
   OPENROUTER_API_KEY=
   GLM_API_KEY=
   OPENAI_API_KEY=
   ```
4. Tambahkan note di README bagian "Setup" cara generate secret:
   ```bash
   # Generate BETTER_AUTH_SECRET
   openssl rand -hex 32

   # Copy .env.example ke .env lalu isi
   cp .env.example .env
   ```

**Acceptance Criteria:**
- `docker compose up` tanpa `.env` → langsung exit dengan pesan error yang jelas, bukan jalan dengan secret dummy
- `.env.example` punya semua key yang dibutuhkan dengan instruksi jelas

---

### TASK-02 · Tambah env var validation di startup setiap service

**Priority:** Critical
**Effort:** ~2–3 jam
**Files:** `packages/@zh/sdk/src/env.ts` (baru), entry point semua `@zh/*` service

**Problem:**
Tidak ada startup check di level aplikasi. Kalau `ANTHROPIC_API_KEY` kosong atau `REDIS_URL` salah format, service tetap jalan dan baru crash saat pertama kali digunakan — silent fail yang susah di-debug.

**Action:**
1. Buat shared utility di `@zh/sdk`:
   ```typescript
   // packages/@zh/sdk/src/env.ts
   export function requireEnv(keys: string[]): void {
     const missing = keys.filter(k => !process.env[k]?.trim());
     if (missing.length > 0) {
       console.error('[FATAL] Missing required environment variables:');
       missing.forEach(k => console.error(`  - ${k}`));
       console.error('\nCheck your .env file against .env.example');
       process.exit(1);
     }
   }

   export function warnEnv(keys: string[]): void {
     const missing = keys.filter(k => !process.env[k]?.trim());
     if (missing.length > 0) {
       console.warn('[WARN] Optional env vars not set (some features may be disabled):');
       missing.forEach(k => console.warn(`  - ${k}`));
     }
   }
   ```
2. Panggil di entry point setiap service **sebelum** inisialisasi apapun:
   ```typescript
   // packages/@zh/brain/src/index.ts
   import { requireEnv, warnEnv } from '@zh/sdk/env';
   requireEnv(['REDIS_URL', 'ZH_ROUTER_URL', 'ZH_BRAIN_URL', 'PORT']);
   warnEnv(['CODEX_MODEL', 'DOCKER_HOST']);

   // packages/@zh/hr/src/index.ts
   import { requireEnv, warnEnv } from '@zh/sdk/env';
   requireEnv(['REDIS_URL', 'ZH_ROUTER_URL', 'ZH_BRAIN_URL', 'ZH_HR_URL', 'PORT']);
   warnEnv(['ZH_REPO_PATH', 'DISCORD_WEBHOOK_URL']);

   // packages/@zh/router/src/index.ts
   import { requireEnv } from '@zh/sdk/env';
   requireEnv(['REDIS_URL', 'ZH_ROUTER_URL', 'PORT']);
   ```
3. Dokumentasikan env var wajib per service di masing-masing `packages/@zh/*/README.md`

**Acceptance Criteria:**
- Jalankan service tanpa env var wajib → exit dalam <1 detik dengan daftar env yang kurang
- Tidak ada "undefined is not a function" atau silent failure di tengah eksekusi

---

### TASK-03 · Audit dan batasi volume mount `- .:/repo` di zero-human service

**Priority:** Critical
**Effort:** ~1–2 jam
**File:** `docker-compose.yml`

**Problem:**
```yaml
zero-human:
  volumes:
    - .:/repo   # ← mount seluruh working directory ke container
```
Ini expose `.env`, `node_modules`, `.git`, dan semua file lokal developer ke dalam container. Security risk sekaligus bikin behavior tidak konsisten antara dev dan prod.

**Action:**
1. Identifikasi kenapa full mount diperlukan — untuk `ZH_REPO_PATH: /repo` dan `ZH_STATE_PATH: /repo/.zero-human/state`
2. Ganti dengan mount yang spesifik dan minimal:
   ```yaml
   zero-human:
     volumes:
       - zh-state:/app/.zero-human          # state folder saja
       - hr-worktrees:/app/worktrees         # sudah ada
       - worktree-source:/app/worktree-source # sudah ada
       - registered-repos:/app/repositories  # sudah ada
       # HAPUS: - .:/repo
   ```
3. Update env var di docker-compose:
   ```yaml
   ZH_STATE_PATH: /app/.zero-human/state
   ZH_REPO_PATH: /app/worktree-source
   ```
4. Tambahkan `.dockerignore` di root:
   ```dockerignore
   .env
   .env.*
   node_modules
   .git
   *.log
   dist
   ```
5. Tambah named volume baru di bagian `volumes:` bawah:
   ```yaml
   volumes:
     zh-state:
     # ... volume lain yang sudah ada
   ```

**Acceptance Criteria:**
- `docker compose up` tidak lagi mount `.env` ke dalam container
- File lokal developer tidak accessible dari dalam container zero-human
- Stack tetap berjalan normal setelah perubahan ini

---

### TASK-04 · Pin versi global package install di Dockerfile

**Priority:** Critical
**Effort:** ~30 menit
**File:** `Dockerfile`

**Problem:**
```dockerfile
RUN if [ "$SERVICE" = "brain" ]; then npm install -g @openai/codex@latest @anthropic-ai/claude-code@latest; fi
```
`@latest` = non-deterministic build. Setiap `docker build` bisa dapat versi berbeda → breaking changes tanpa peringatan.

**Action:**
1. Pin ke versi spesifik yang sudah ditest:
   ```dockerfile
   ARG CODEX_VERSION=0.1.2504271817
   ARG CLAUDE_CODE_VERSION=1.2.3

   RUN if [ "$SERVICE" = "brain" ]; then \
     npm install -g \
       @openai/codex@${CODEX_VERSION} \
       @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}; \
   fi
   ```
2. Pisahkan jadi multi-stage untuk cache efisiensi:
   ```dockerfile
   FROM node:22-alpine AS base
   WORKDIR /app
   RUN corepack enable
   RUN apk add --no-cache git openssh-client

   FROM base AS brain-tools
   ARG CODEX_VERSION=0.1.2504271817
   ARG CLAUDE_CODE_VERSION=1.2.3
   RUN npm install -g \
     @openai/codex@${CODEX_VERSION} \
     @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

   FROM brain-tools AS service-build
   COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
   COPY config ./config
   COPY packages ./packages
   RUN pnpm install --frozen-lockfile=false
   RUN pnpm --filter @zh/sdk build
   ARG SERVICE
   RUN pnpm --filter @zh/${SERVICE} build
   ENV NODE_ENV=production
   CMD pnpm --filter @zh/${SERVICE} start
   ```
3. Buat `docs/EXECUTOR_VERSIONS.md` untuk track versi dan cara upgrade:
   ```markdown
   # Executor Tool Versions

   | Tool | Version | Last Updated | Check Latest |
   |------|---------|--------------|--------------|
   | @openai/codex | 0.1.2504271817 | 2026-05-10 | `npm show @openai/codex version` |
   | @anthropic-ai/claude-code | 1.2.3 | 2026-05-10 | `npm show @anthropic-ai/claude-code version` |

   ## Cara Upgrade
   1. Cek versi terbaru: `npm show <package> version`
   2. Update ARG di Dockerfile
   3. Test build: `docker build --build-arg SERVICE=brain .`
   4. Update tabel di file ini
   ```

**Acceptance Criteria:**
- Build dua kali dari scratch menghasilkan image yang identik
- Versi executor tercatat dan ada proses upgrade yang jelas

---

### TASK-12 · Tetapkan boundary Hermes sebagai Pure Memory Store (Opsi A)

**Priority:** Critical
**Effort:** ~2–3 jam
**Files:** `docker-compose.yml`, `README.md`, `docs/ARCHITECTURE.md`

**Background & Problem:**
Ada overlap fungsi antara Hermes dan Paperclip — keduanya dirancang sebagai "autonomous agent platform" sendiri. Dalam implementasi aktual, `zh-brain-adapter` sudah menjadi decision maker, bukan Hermes. Namun Hermes masih:
- Di-expose ke host di `:9119` → user bingung ada dua dashboard
- Disebut "Brain Engine" di PRD padahal yang eksekusi adalah `zh-brain-adapter`
- Berpotensi konflik eksekutor dengan Paperclip jika tidak dibatasi

**Pembagian Peran yang Ditetapkan:**

| Service | Peran | Akses |
|---------|-------|-------|
| `hermes` | Persistent Memory Storage | Internal only |
| `paperclip` | Git Worktree + Task Queue Storage | Internal only |
| `zh-brain-adapter` | Satu-satunya Decision Maker & Executor Spawner | Internal only |
| `zero-human` | Control Plane UI | Exposed ke host `:3003` |

**Action:**

**Step 1 — Sembunyikan Hermes dari host (`docker-compose.yml`)**
```yaml
hermes:
  # Hapus bagian ports:
  # ports:
  #   - "9119:9119"

  # Ganti dengan internal expose saja
  expose:
    - "9119"
  # zh-brain-adapter masih bisa akses via http://hermes:9119 (internal network)
  # tapi user tidak bisa buka localhost:9119 dari browser
```

**Step 2 — Update README, hapus Hermes dari "Open these URLs"**

Hapus:
```
- Hermes upstream dashboard: http://localhost:9119
```

Ganti dengan tabel yang jelas:
```markdown
## Accessing the Stack

| URL | Service | Who should access |
|-----|---------|-------------------|
| http://localhost:3003 | Zero-Human Control Plane | User (you) |
| http://localhost:20128 | 9Router AI Gateway | Developer (provider setup) |
| http://localhost:3100 | Paperclip Upstream | Internal — tidak perlu dibuka langsung |

Hermes (memory store) berjalan internal dan tidak di-expose ke host.
Semua interaksi dengan memory dilakukan melalui dashboard :3003.
```

**Step 3 — Audit kode `zh-brain-adapter` — pastikan hanya call Hermes untuk memory**

Pastikan brain adapter **hanya** call Hermes untuk:
- `GET /memory/:agentId` — load memory sebelum task
- `POST /memory/:agentId` — save memory setelah task selesai
- `GET /health` — health check

Kalau ada kode yang call Hermes untuk spawn executor, trigger task, atau operasi lain → pindahkan logic itu ke dalam brain adapter sendiri.

**Step 4 — Update label di health check dashboard zero-human**
```typescript
// Dari:
{ name: 'Hermes Brain', url: 'http://hermes:9119', role: 'brain' }

// Ke:
{ name: 'Hermes Memory', url: 'http://hermes:9119', role: 'memory-store' }
```

**Step 5 — Update PRD dan ARCHITECTURE**

Di semua dokumen, ganti deskripsi Hermes dari "Brain Engine" ke:
```markdown
**Hermes (Memory Store)**
Digunakan sebagai persistent memory backend saja — menyimpan
project context, task history, dan skill confidence antar session.
Decision making dan executor spawning sepenuhnya dilakukan oleh
zh-brain-adapter. Hermes tidak di-expose ke host.
```

**Kenapa Ini Masuk Critical:**

| Risiko tanpa TASK-12 | Setelah TASK-12 |
|----------------------|-----------------|
| User buka Hermes UI langsung → bypass zero-human → state tidak sync | Tidak bisa — port tidak exposed |
| Dua executor jalan untuk task yang sama (Hermes + brain adapter) | Tidak mungkin — hanya brain adapter yang spawn |
| Arsitektur ambigu → sulit onboard contributor baru | Jelas — boundary terdefinisi di docs |
| Sulit swap memory backend di masa depan | Mudah — Hermes hanya storage layer |

**Acceptance Criteria:**
- `localhost:9119` tidak accessible dari browser setelah `docker compose up`
- `localhost:3003` jadi satu-satunya UI yang user perlu tahu
- Task flow tidak berubah — semua masih jalan normal
- `zh-brain-adapter` hanya call Hermes untuk read/write memory

---

## 🟡 STRUCTURAL — Cross-Platform & Developer Experience

---

### TASK-05 · Buat shell script paralel untuk non-Windows developer

**Priority:** High
**Effort:** ~2–3 jam
**Files:** `scripts/*.sh` (baru), `scripts/run.mjs` (baru), `package.json`

**Problem:**
Semua convenience scripts di `package.json` hanya ada versi PowerShell. Developer di Linux/Mac tidak bisa pakai `pnpm stack:start` sama sekali.

**Action:**
1. Buat versi `.sh` untuk semua script:
   ```bash
   # scripts/start-zero-human.sh
   #!/bin/bash
   set -e
   echo "Starting Zero-Human stack..."
   docker compose -p zero-human up -d --build
   echo ""
   echo "Stack started."
   echo "  Dashboard:  http://localhost:3003"
   echo "  9Router:    http://localhost:20128"

   # scripts/stop-zero-human.sh
   #!/bin/bash
   docker compose -p zero-human down
   echo "Stack stopped."

   # scripts/status-zero-human.sh
   #!/bin/bash
   docker compose -p zero-human ps

   # scripts/logs-zero-human.sh
   #!/bin/bash
   FOLLOW=${1:-""}
   if [ "$FOLLOW" = "-Follow" ] || [ "$FOLLOW" = "-f" ]; then
     docker compose -p zero-human logs -f
   else
     docker compose -p zero-human logs --tail=100
   fi
   ```
2. Set executable: `chmod +x scripts/*.sh`

3. Buat `scripts/run.mjs` sebagai cross-platform router:
   ```javascript
   // scripts/run.mjs
   import { execSync } from 'child_process';
   import { platform } from 'os';

   const [,, command, ...args] = process.argv;
   const isWin = platform() === 'win32';
   const ext = isWin ? 'ps1' : 'sh';
   const prefix = isWin ? 'powershell -ExecutionPolicy Bypass -File' : 'bash';
   const scriptPath = `scripts/${command}-zero-human.${ext}`;

   execSync(`${prefix} ${scriptPath} ${args.join(' ')}`, { stdio: 'inherit' });
   ```

4. Update `package.json`:
   ```json
   "stack:start": "node scripts/run.mjs start",
   "stack:stop": "node scripts/run.mjs stop",
   "stack:status": "node scripts/run.mjs status",
   "stack:logs": "node scripts/run.mjs logs",
   "upstream:sync:router": "node scripts/run.mjs sync-upstream router"
   ```

**Acceptance Criteria:**
- `pnpm stack:start` dan `pnpm stack:stop` bisa jalan di Linux, Mac, dan Windows
- Tidak ada instruksi OS-specific tanpa alternatif di README

---

### TASK-06 · Setup test suite yang actual dan integrate ke CI

**Priority:** High
**Effort:** ~4–6 jam
**Files:** `packages/@zh/*/src/__tests__/`, `.github/workflows/ci.yml`

**Problem:**
Script `"test": "pnpm -r test"` ada tapi tidak ada test file. CI bisa pass tanpa test apapun — false confidence.

**Action:**
1. Install Vitest:
   ```bash
   pnpm add -Dw vitest @vitest/coverage-v8
   ```
2. Tambah script di root `package.json`:
   ```json
   "test": "pnpm -r test",
   "test:unit": "pnpm -r test",
   "test:coverage": "pnpm -r test --coverage"
   ```
3. Buat minimal test untuk logic kritis per package:

   **`@zh/sdk` — event schema:**
   ```typescript
   // packages/@zh/sdk/src/__tests__/events.test.ts
   import { describe, it, expect } from 'vitest';
   import { ZHEvent } from '../events';

   describe('ZHEvent', () => {
     it('all required event types exist', () => {
       expect(ZHEvent.TASK_ASSIGNED).toBe('zh:task:assigned');
       expect(ZHEvent.TASK_COMPLETED).toBe('zh:task:completed');
       expect(ZHEvent.QUOTA_EXHAUSTED).toBe('zh:quota:exhausted');
       expect(ZHEvent.COST_THRESHOLD).toBe('zh:cost:threshold');
     });
   });
   ```

   **`@zh/sdk` — env validation:**
   ```typescript
   // packages/@zh/sdk/src/__tests__/env.test.ts
   import { describe, it, expect, vi, beforeEach } from 'vitest';

   describe('requireEnv', () => {
     beforeEach(() => { vi.resetModules(); });

     it('should exit when required env var is missing', async () => {
       const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
       delete process.env.TEST_VAR;
       const { requireEnv } = await import('../env');
       expect(() => requireEnv(['TEST_VAR'])).toThrow('exit');
       expect(mockExit).toHaveBeenCalledWith(1);
     });

     it('should pass when all required env vars are set', async () => {
       process.env.TEST_VAR = 'value';
       const { requireEnv } = await import('../env');
       expect(() => requireEnv(['TEST_VAR'])).not.toThrow();
     });
   });
   ```

   **`@zh/brain` — budget guard:**
   ```typescript
   // packages/@zh/brain/src/__tests__/budget.test.ts
   import { describe, it, expect } from 'vitest';
   import { checkBudget } from '../budget';

   describe('Budget Guard', () => {
     it('blocks dispatch when agent budget exhausted', () => {
       const result = checkBudget({ accumulated: 40, maxBudget: 40 });
       expect(result.allowed).toBe(false);
     });

     it('allows dispatch when under budget', () => {
       const result = checkBudget({ accumulated: 30, maxBudget: 40 });
       expect(result.allowed).toBe(true);
     });

     it('blocks when accumulated exceeds max', () => {
       const result = checkBudget({ accumulated: 45, maxBudget: 40 });
       expect(result.allowed).toBe(false);
     });
   });
   ```

   **`@zh/hr` — task state machine:**
   ```typescript
   // packages/@zh/hr/src/__tests__/task-state.test.ts
   import { describe, it, expect } from 'vitest';
   import { canTransition } from '../task-state';

   describe('Task State Machine', () => {
     it('allows queued → assigned', () => expect(canTransition('queued', 'assigned')).toBe(true));
     it('allows assigned → in_progress', () => expect(canTransition('assigned', 'in_progress')).toBe(true));
     it('allows in_progress → pending_review', () => expect(canTransition('in_progress', 'pending_review')).toBe(true));
     it('blocks done → in_progress', () => expect(canTransition('done', 'in_progress')).toBe(false));
     it('blocks queued → done', () => expect(canTransition('queued', 'done')).toBe(false));
   });
   ```

4. Tambah vitest config per package + coverage threshold:
   ```typescript
   // packages/@zh/*/vitest.config.ts
   import { defineConfig } from 'vitest/config';
   export default defineConfig({
     test: {
       coverage: {
         provider: 'v8',
         threshold: { lines: 60, functions: 60 }
       }
     }
   });
   ```

5. Tambah step ke CI:
   ```yaml
   - name: Run tests
     run: pnpm test
   ```

**Acceptance Criteria:**
- `pnpm test` menjalankan test nyata dan fail kalau ada yang broken
- CI tidak bisa green kalau test fail
- Coverage minimal 60% untuk budget guard, state machine, env validation

---

### TASK-07 · Tambah Redis resilience — retry logic dan graceful degradation

**Priority:** High
**Effort:** ~3–4 jam
**Files:** `packages/@zh/sdk/src/events.ts`, `packages/@zh/sdk/src/fallback-queue.ts` (baru)

**Problem:**
Redis adalah single point of failure. Kalau Redis restart atau kena network blip, seluruh event bus berhenti. Tidak ada retry, tidak ada fallback.

**Action:**
1. Buat publisher dengan exponential backoff di `@zh/sdk`:
   ```typescript
   // packages/@zh/sdk/src/events.ts
   const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

   export async function publishWithRetry(
     redis: Redis,
     event: ZHEvent,
     payload: unknown,
     maxRetries = 3
   ): Promise<void> {
     for (let i = 0; i < maxRetries; i++) {
       try {
         await redis.publish(event, JSON.stringify({
           event,
           timestamp: new Date().toISOString(),
           payload,
           metadata: { version: '1.0' }
         }));
         return;
       } catch (err) {
         if (i === maxRetries - 1) throw err;
         const delay = Math.pow(2, i) * 100; // 100ms → 200ms → 400ms
         console.warn(`[EventBus] Retry ${i + 1}/${maxRetries} in ${delay}ms`);
         await sleep(delay);
       }
     }
   }
   ```

2. Buat in-memory fallback queue:
   ```typescript
   // packages/@zh/sdk/src/fallback-queue.ts
   export class FallbackQueue {
     private queue: Array<{ event: ZHEvent; payload: unknown }> = [];
     private readonly maxSize = 100;

     push(event: ZHEvent, payload: unknown): void {
       if (this.queue.length >= this.maxSize) {
         console.warn('[FallbackQueue] Full — dropping oldest event');
         this.queue.shift();
       }
       this.queue.push({ event, payload });
     }

     drain(publisher: (e: ZHEvent, p: unknown) => Promise<void>): Promise<void>[] {
       const items = [...this.queue];
       this.queue = [];
       return items.map(({ event, payload }) => publisher(event, payload));
     }

     get size() { return this.queue.length; }
   }
   ```

3. Tambah reconnect handler di semua service yang publish ke Redis:
   ```typescript
   const fallbackQueue = new FallbackQueue();

   redis.on('error', (err) => console.error('[Redis] Error:', err.message));
   redis.on('reconnecting', () => console.warn('[Redis] Reconnecting...'));
   redis.on('ready', async () => {
     console.info('[Redis] Connected.');
     if (fallbackQueue.size > 0) {
       console.info(`[Redis] Draining ${fallbackQueue.size} queued events...`);
       await Promise.allSettled(
         fallbackQueue.drain((e, p) => publishWithRetry(redis, e, p))
       );
     }
   });
   ```

4. Ganti semua `redis.publish()` langsung dengan `publishWithRetry()` atau fallback ke queue saat Redis down

**Acceptance Criteria:**
- Matikan Redis container saat stack jalan → services log warning tapi tidak crash
- Nyalakan Redis lagi → event flow resume, fallback queue ter-drain otomatis
- Maksimal 100 event tersimpan di fallback queue (tidak memory leak)

---

## 🟢 QUALITY — Documentation & Maintainability

---

### TASK-08 · Perbaiki PRD — update status dan fix URL upstream yang salah

**Priority:** Medium
**Effort:** ~30 menit
**Files:** `PRD_Zero_Human_Monorepo1.md`, `PRD_REMAINING_TASKS.md`

**Problem:**
- Header masih `Status: Draft` padahal Phase 1–5 sudah complete
- Section 3.3 dan 10.2.1 masih referensi `NousResearch/9Router` — yang benar `decolua/9router`
- Hermes masih disebut "Brain Engine" — setelah TASK-12 harusnya "Memory Store"
- Kedua file PRD ada di root repo, bukan `docs/`

**Action:**
1. Update header:
   ```markdown
   **Status:** Active Development (v0.1 — Phase 1–5 Complete)
   **Last Updated:** 2026-05-10
   ```
2. Global find-replace: `NousResearch/9Router` → `decolua/9router`
3. Update deskripsi Hermes di section 4.3 dan architecture diagram:
   ```markdown
   **@zh/brain (Hermes — Memory Store)**
   Role: Persistent memory backend saja. Decision making dan executor
   spawning dilakukan oleh zh-brain-adapter. Hermes tidak di-expose ke host.
   ```
4. Pindahkan ke `docs/`:
   ```
   docs/
   ├── PRD.md                  ← dari PRD_Zero_Human_Monorepo1.md
   ├── REMAINING_TASKS.md      ← dari PRD_REMAINING_TASKS.md
   ├── ARCHITECTURE.md         ← baru (TASK-09)
   └── EXECUTOR_VERSIONS.md    ← baru (dari TASK-04)
   ```
5. Update README untuk point ke lokasi baru

**Acceptance Criteria:**
- Tidak ada URL upstream yang salah di PRD
- Semua doc ada di `docs/`
- Deskripsi Hermes konsisten dengan TASK-12

---

### TASK-09 · Tambah ARCHITECTURE.md yang up-to-date

**Priority:** Medium
**Effort:** ~2 jam
**File:** `docs/ARCHITECTURE.md` (baru)

**Problem:**
Tidak ada dokumen yang menjelaskan arsitektur *aktual* — terutama kenapa ada adapter layer, siapa yang jadi "otak" sesungguhnya, dan bagaimana 9 service berinteraksi. PRD ada tapi itu dokumen planning yang sudah tidak akurat.

**Action:**
Buat `docs/ARCHITECTURE.md` yang cover:

1. **Service topology aktual** dengan diagram ASCII semua 9 service, port, dan peran
2. **Dua layer yang berbeda:**
   - Upstream services (9router, hermes, paperclip, redis) = third-party
   - Adapter layer (@zh/*) = kode sendiri, wraps upstream
3. **Boundary yang jelas setelah TASK-12:**
   - Hermes = memory storage, internal only
   - zh-brain-adapter = satu-satunya yang spawn executor
   - zero-human = satu-satunya UI
4. **Full task flow sequence** dari "Assign Task" sampai "Merge"
5. **Volume strategy** — apa isi tiap volume dan kenapa persistent
6. **Tabel network exposure** — mana yang bisa dibuka dari host, mana yang internal
7. **Keputusan arsitektur** — kenapa Hermes dijadikan storage-only, bukan active brain

**Acceptance Criteria:**
Developer baru bisa paham full architecture hanya dari baca file ini, tanpa harus reverse engineer `docker-compose.yml`.

---

### TASK-10 · Tambah CHANGELOG dan update repo metadata di GitHub

**Priority:** Medium
**Effort:** ~1 jam
**Files:** `CHANGELOG.md` (baru), GitHub repo settings

**Problem:**
56 commits tapi tidak ada CHANGELOG. Repo tidak punya description, website, atau topics — tidak discoverable.

**Action:**
1. Buat `CHANGELOG.md`:
   ```markdown
   # Changelog

   ## [Unreleased]
   ### Changed
   - Hermes dikonfigurasi sebagai pure memory store (port tidak di-expose ke host)
   - Dockerfile executor versions di-pin untuk deterministic build
   - Tambah env var validation di startup setiap service

   ## [0.1.0] — 2026-05-07
   ### Added
   - Monorepo foundation dengan pnpm workspaces
   - Upstream: 9Router (decolua/9router), Hermes Agent, Paperclip via git subtree
   - @zh/sdk: shared types, event contracts, YAML config loader
   - Docker Compose full stack dengan 9 services dan 1 network
   - Redis pub/sub event bus antar semua adapter
   - docker-socket-proxy untuk restricted Docker API access
   - Real executor v1 & v2: isolated git worktree + Claude Code/Codex CLI
   - Approval workflow: diff endpoint, approve/reject dengan audit trail
   - Persistent brain memory via brain-memory volume
   - Budget alerts, webhook notifications, agent pause/resume UI
   - GitHub Actions upstream sync workflow (weekly, dry-run mode)
   - Zero-Human control plane dashboard di :3003
   ```
2. Update GitHub repo settings:
   - **Description:** `Autonomous AI Company OS — unifies 9Router, Hermes, and Paperclip into a self-operating dev team via Docker`
   - **Topics:** `ai`, `autonomous-agents`, `monorepo`, `docker`, `llm`, `typescript`, `self-hosted`, `claude-code`

**Acceptance Criteria:**
- Repo punya description dan topics yang informatif
- CHANGELOG ada dan akurat

---

### TASK-11 · Tambah Makefile sebagai unified entry point cross-platform

**Priority:** Low
**Effort:** ~1–2 jam
**File:** `Makefile` (baru)

**Problem:**
Terlalu banyak cara menjalankan stack — `pnpm stack:start`, `.ps1` scripts, `docker compose` langsung. Contributor baru tidak tahu mana yang canonical.

**Action:**
Buat `Makefile` untuk Linux/Mac dan WSL:
```makefile
.DEFAULT_GOAL := help

.PHONY: up down restart status logs logs-brain logs-router build install clean test sync-router dev-hr dev-brain help

up: ## Start full stack (build if needed)
	docker compose -p zero-human up -d --build

down: ## Stop full stack
	docker compose -p zero-human down

restart: ## Restart all services without rebuild
	docker compose -p zero-human restart

status: ## Show health status of all services
	docker compose -p zero-human ps

logs: ## Follow all logs (Ctrl+C to exit)
	docker compose -p zero-human logs -f

logs-brain: ## Follow brain adapter logs only
	docker compose -p zero-human logs -f zh-brain-adapter

logs-router: ## Follow router adapter logs only
	docker compose -p zero-human logs -f zh-router-adapter

logs-hr: ## Follow zero-human dashboard logs only
	docker compose -p zero-human logs -f zero-human

build: ## Build all @zh/* packages
	pnpm build

install: ## Install all dependencies
	pnpm install

test: ## Run all tests
	pnpm test

clean: ## Remove all containers and volumes (DESTRUCTIVE — resets all data)
	docker compose -p zero-human down -v

sync-router: ## Sync 9Router upstream
	bash scripts/sync-upstream.sh router

dev-hr: ## Run HR adapter in dev mode (hot reload, port 3003)
	pnpm dev:hr

dev-brain: ## Run Brain adapter in dev mode (port 8080)
	pnpm dev:brain

help: ## Show this help
	@echo ""
	@echo "Zero-Human Monorepo — Available Commands"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*##' Makefile | \
	  awk 'BEGIN{FS=":.*##"}{printf "  \033[36m%-20s\033[0m %s\n",$$1,$$2}'
	@echo ""
```

**Acceptance Criteria:**
- `make up`, `make down`, `make logs` bisa jalan di Linux/Mac/WSL
- `make help` menampilkan semua commands dengan deskripsi
- Makefile jadi referensi utama di README untuk quick start

---

## Urutan Pengerjaan

### Fase 1 — Sebelum demo atau share ke siapapun (~5–8 jam)
```
TASK-01 · Fix secret fallback          (~1 jam)    ← security
TASK-04 · Pin Dockerfile versions      (~30 menit) ← reproducibility
TASK-12 · Hermes boundary              (~2–3 jam)  ← architectural clarity
TASK-03 · Audit volume mount           (~1–2 jam)  ← security
```

### Fase 2 — Stabilitas & Developer Experience (~9–13 jam)
```
TASK-02 · Env var validation           (~2–3 jam)
TASK-05 · Cross-platform scripts       (~2–3 jam)
TASK-07 · Redis resilience             (~3–4 jam)
TASK-11 · Makefile                     (~1–2 jam)
```

### Fase 3 — Quality & Documentation (~7–9 jam)
```
TASK-06 · Test suite                   (~4–6 jam)
TASK-08 · Fix PRD                      (~30 menit)
TASK-09 · ARCHITECTURE.md             (~2 jam)
TASK-10 · CHANGELOG + metadata        (~1 jam)
```

---

> **Catatan:** TASK-12 masuk Fase 1 karena boundary Hermes yang jelas adalah prerequisite untuk semua dokumentasi berikutnya. Kalau TASK-08 dan TASK-09 dikerjakan sebelum TASK-12, dokumen yang dibuat akan langsung outdated.
