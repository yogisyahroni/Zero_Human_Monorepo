import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import { Pool, type PoolClient } from "pg";
import {
  agentsFromConfig,
  loadConfig,
  RedisEventBus,
  type Agent,
  type AgentRole,
  type SkillDefinition,
  type Task,
  type TaskType,
  ZHEvent
} from "@zh/sdk";
import { upstreamSources } from "@zh/sdk";

const config = loadConfig();
const app = express();
const companyState = { ...config.company };
const agents = new Map<string, Agent>(agentsFromConfig(config).map((agent) => [agent.id, agent]));
const tasks = new Map<string, Task>();
const events: Array<{ event: string; timestamp: string; summary: string }> = [];
const alerts: Array<{
  id: string;
  event: string;
  scope: "global" | "agent";
  message: string;
  severity: "warning" | "critical";
  timestamp: string;
  delivered: boolean;
  error?: string;
}> = [];
const routerMetrics = { requests: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
const skillProgress = new Map<string, { agentId: string; skill: string; runs: number; confidence: number; lastTaskId?: string; updatedAt: string }>();
const budgetFlags = { thresholdPublished: false, globalPaused: false, pausedAgents: new Set<string>() };
const bus = new RedisEventBus(config.infrastructure.redis_url, "hr");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const execFileAsync = promisify(execFile);
const hostRepoPath = process.env.ZH_REPO_PATH ?? repoRoot;
const sourceRepoPath = process.env.ZH_WORKTREE_SOURCE_PATH ?? hostRepoPath;
const repositoryBasePath = process.env.ZH_REPOSITORY_BASE ?? path.join(path.dirname(sourceRepoPath), "repositories");
const stateDir = process.env.ZH_STATE_PATH ?? path.join(hostRepoPath, ".zero-human", "state");
const budgetOverridesPath = path.join(stateDir, "budget-overrides.json");
const repositoriesPath = path.join(stateDir, "repositories.json");
const hiringRequestsPath = path.join(stateDir, "hiring-requests.json");
const customSkillsPath = path.join(stateDir, "custom-skills.json");
const mcpRegistryPath = path.join(stateDir, "mcp-servers.json");
const mcpMarketplacePath = path.join(stateDir, "mcp-marketplace.json");
const paperclipSyncPath = path.join(stateDir, "paperclip-sync.json");
const paperclipChatSignalsPath = path.join(stateDir, "paperclip-chat-signals.json");
const paperclipHermesInterventionsPath = path.join(stateDir, "paperclip-hermes-interventions.json");
const issuePoliciesPath = path.join(stateDir, "agent-issue-policies.json");
const paperclipDatabaseUrl = process.env.PAPERCLIP_DATABASE_URL ?? process.env.ZH_PAPERCLIP_DATABASE_URL ?? "";
type ServiceHealth = {
  name: string;
  url: string;
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
  details?: unknown;
};
type BrainMemorySummary = {
  ok: boolean;
  agentCount: number;
  entries: number;
  outcomes: number;
  skills: Array<{ agentId: string; skill: string; runs: number; confidence: number; averageDurationMs?: number; lastTaskId?: string; updatedAt: string }>;
  recentNotes: Array<{ agentId: string; note: string }>;
  error?: string;
};
type BrainSkillSummary = BrainMemorySummary["skills"][number];
type BudgetOverrides = {
  globalBudgetUsd?: number;
  agentCaps?: Record<string, number>;
  updatedAt?: string;
};
type RegisteredRepository = {
  id: string;
  name: string;
  url: string;
  branch: string;
  path: string;
  sourceKind?: "work" | "skill_source";
  authType?: "none" | "https-token" | "ssh-key";
  username?: string;
  token?: string;
  sshPrivateKey?: string;
  sshPassphrase?: string;
  status: "ready" | "syncing" | "error";
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
  error?: string;
};
type PublicRepository = Omit<RegisteredRepository, "token" | "sshPrivateKey" | "sshPassphrase">;
type SkillImportReport = {
  id: string;
  repositoryId: string;
  repositoryName: string;
  scanned: number;
  imported: number;
  duplicates: number;
  skipped: Array<{ name: string; sourcePath: string; duplicateOf: string; reason: string }>;
  createdAt: string;
};
type PaperclipSkillSyncReport = {
  id: string;
  companyId?: string;
  registrySkills: number;
  paperclipSkillsBefore: number;
  imported: number;
  updated: number;
  skipped: number;
  unavailable: boolean;
  details: Array<{ skill: string; action: "imported" | "updated" | "skipped"; reason?: string; paperclipKey?: string }>;
  error?: string;
  createdAt: string;
};
type PaperclipRepositorySyncReport = {
  id: string;
  companyId?: string;
  projectId?: string;
  repositoriesReady: number;
  workspacesSynced: number;
  issuesLinked: number;
  unavailable: boolean;
  details: Array<{
    repositoryId: string;
    repositoryName: string;
    workspaceId?: string;
    path: string;
    action: "created" | "updated" | "skipped";
    issuesLinked?: number;
    reason?: string;
  }>;
  error?: string;
  createdAt: string;
};
type HiringRequestStatus = "pending_approval" | "approved" | "rejected";
type HiringRequest = {
  id: string;
  source: "paperclip" | "zero-human-ui" | "api";
  title: string;
  department?: string;
  description?: string;
  requestedRole?: string;
  suggestedRole: AgentRole;
  suggestedSkills: string[];
  suggestedAgentId: string;
  suggestedExecutor: Agent["executor"];
  suggestedModelCombo: string;
  suggestedBudgetUsd: number;
  confidence: number;
  status: HiringRequestStatus;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  decisionNote?: string;
};
type McpTransport = "stdio" | "http" | "sse";
type McpPermissionMode = "read-only" | "write" | "approval-required";
type McpServerConfig = {
  id: string;
  name: string;
  description: string;
  category: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  roles: AgentRole[];
  permissions: {
    mode: McpPermissionMode;
    requiresApproval: string[];
  };
  status: "available" | "installed" | "enabled" | "disabled" | "error";
  installedAt?: string;
  updatedAt?: string;
  lastTestAt?: string;
  lastTestStatus?: "passed" | "failed";
  error?: string;
};
type McpMarketplaceItem = Omit<McpServerConfig, "status" | "installedAt" | "updatedAt" | "lastTestAt" | "lastTestStatus" | "error"> & {
  packageName?: string;
  homepage?: string;
  tags: string[];
};
type PaperclipCodexMcpServer = {
  id: string;
  name: string;
  category: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  permissionMode: McpPermissionMode;
};
type PaperclipSyncStatus = "missing" | "drifted" | "synced";
type PaperclipAgentSyncRecord = {
  agentId: string;
  role: AgentRole;
  desiredName: string;
  desiredHash: string;
  desiredSkills: string[];
  desiredMcpServers: Array<{
    id: string;
    name: string;
    transport: McpTransport;
    permissionMode: McpPermissionMode;
  }>;
  executor: Agent["executor"];
  modelCombo: string;
  status: PaperclipSyncStatus;
  runbook: string;
  paperclipAgentId?: string;
  lastSyncedAt?: string;
  updatedAt: string;
};
type PaperclipSyncState = {
  paperclipUrl: string;
  updatedAt: string;
  records: PaperclipAgentSyncRecord[];
};
type PaperclipChatSignalReport = {
  id: string;
  companyId?: string;
  scanned: number;
  detected: number;
  createdRequests: number;
  ensuredPaperclipAgents: number;
  skippedDuplicates: number;
  processedComments: number;
  unavailable: boolean;
  details: Array<{
    commentId: string;
    issueKey: string;
    issueTitle: string;
    agentName?: string;
    role?: AgentRole;
    action: "hiring_request_created" | "paperclip_agent_created" | "paperclip_agent_exists" | "duplicate_skipped" | "ignored";
    reason: string;
    hiringRequestId?: string;
    paperclipAgentId?: string;
  }>;
  error?: string;
  createdAt: string;
};
type PaperclipHermesBridgeReport = {
  id: string;
  companyId?: string;
  protocolSkillKey: string;
  protocolSkillSynced: boolean;
  agentsScanned: number;
  agentsPatched: number;
  memoryNotesWritten: number;
  unavailable: boolean;
  details: Array<{
    agentId?: string;
    agentName?: string;
    role?: string;
    action: "protocol_synced" | "paperclip_hiring_authority" | "agent_created" | "agent_patched" | "agent_already_ready" | "memory_written" | "skipped";
    reason: string;
  }>;
  error?: string;
  createdAt: string;
};
type PaperclipHermesInterventionTrigger = "blocked_issue" | "missing_disposition" | "failed_run" | "high_churn" | "stale_in_progress";
type PaperclipHermesInterventionReport = {
  id: string;
  companyId?: string;
  scanned: number;
  intervened: number;
  skippedCooldown: number;
  wakeupsQueued: number;
  memoryNotesWritten: number;
  unavailable: boolean;
  details: Array<{
    issueId: string;
    issueKey: string;
    title: string;
    trigger: PaperclipHermesInterventionTrigger;
    action: "commented" | "commented_and_woke_agent" | "cooldown_skipped" | "ignored";
    assignee?: string;
    reason: string;
  }>;
  error?: string;
  createdAt: string;
};
type AgentIssueDecision = "auto_assign" | "triage" | "approval_required" | "blocked";
type AgentIssuePolicy = {
  role: AgentRole;
  canCreateIssue: boolean;
  autoAssign: boolean;
  allowedTaskTypes: TaskType[];
  approvalKeywords: string[];
  triageKeywords: string[];
  maxPriorityWithoutApproval: 1 | 2 | 3;
  defaultDecision: AgentIssueDecision;
  note: string;
};
type AgentIssuePolicyEvaluation = {
  agentId: string;
  role: AgentRole;
  decision: AgentIssueDecision;
  reason: string;
  suggestedTaskType: TaskType;
  suggestedAssignee: string;
  requiresHumanReview: boolean;
};

function addEvent(event: string, summary: string): void {
  events.unshift({ event, timestamp: new Date().toISOString(), summary });
  events.splice(80);
}

function applyBudgetOverrides(overrides: BudgetOverrides | null): void {
  if (!overrides) return;
  if (typeof overrides.globalBudgetUsd === "number" && Number.isFinite(overrides.globalBudgetUsd) && overrides.globalBudgetUsd > 0) {
    companyState.budget_usd = overrides.globalBudgetUsd;
  }
  for (const [agentId, cap] of Object.entries(overrides.agentCaps ?? {})) {
    const agent = agents.get(agentId);
    if (agent && Number.isFinite(cap) && cap > 0) agent.maxBudgetUsd = cap;
  }
}

function loadBudgetOverrides(): void {
  try {
    applyBudgetOverrides(JSON.parse(fs.readFileSync(budgetOverridesPath, "utf8")) as BudgetOverrides);
  } catch {
    applyBudgetOverrides(null);
  }
}

function saveBudgetOverrides(overrides: BudgetOverrides): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(budgetOverridesPath, JSON.stringify({ ...overrides, updatedAt: new Date().toISOString() }, null, 2));
}

function loadCustomSkills(): Record<string, SkillDefinition> {
  try {
    return JSON.parse(fs.readFileSync(customSkillsPath, "utf8")) as Record<string, SkillDefinition>;
  } catch {
    return {};
  }
}

const customSkillRegistry: Record<string, SkillDefinition> = loadCustomSkills();
const skillImportReports: SkillImportReport[] = [];
let latestPaperclipSkillSync: PaperclipSkillSyncReport | null = null;
let latestPaperclipRepositorySync: PaperclipRepositorySyncReport | null = null;
let latestPaperclipChatSignalReport: PaperclipChatSignalReport | null = null;
let latestPaperclipHermesBridgeReport: PaperclipHermesBridgeReport | null = null;
let latestPaperclipHermesInterventionReport: PaperclipHermesInterventionReport | null = null;
let paperclipPool: Pool | null = null;

function activeSkillRegistry(): Record<string, SkillDefinition> {
  return {
    ...(config.skill_registry ?? {}),
    ...customSkillRegistry
  };
}

function getPaperclipPool(): Pool {
  if (!paperclipDatabaseUrl) {
    throw new Error("PAPERCLIP_DATABASE_URL is not configured for Zero-Human.");
  }
  paperclipPool ??= new Pool({ connectionString: paperclipDatabaseUrl });
  return paperclipPool;
}

function paperclipSkillSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/repo_skill_[a-z0-9]+_/g, "")
    .replace(/[_\s/]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `skill-${nanoid(6)}`;
}

function paperclipSkillName(skillId: string, skill: SkillDefinition): string {
  return (skill.triggers[0] ?? skillId)
    .replace(/^repo_skill_[a-z0-9]+_/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveSkillSourcePath(sourcePath?: string): string | null {
  if (!sourcePath) return null;
  const [, relativeOrAbsolute] = sourcePath.includes(":") ? sourcePath.split(/:(.*)/s) : ["", sourcePath];
  const candidate = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.resolve(hostRepoPath, relativeOrAbsolute);
  const sourceCandidate = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.resolve(sourceRepoPath, relativeOrAbsolute);
  if (fs.existsSync(candidate)) return candidate;
  if (fs.existsSync(sourceCandidate)) return sourceCandidate;
  return null;
}

function markdownForPaperclipSkill(skillId: string, skill: SkillDefinition): string {
  const resolvedPath = resolveSkillSourcePath(skill.sourcePath);
  if (resolvedPath && fs.statSync(resolvedPath).isFile()) {
    return fs.readFileSync(resolvedPath, "utf8");
  }
  const name = paperclipSkillName(skillId, skill);
  return [
    "---",
    `name: ${paperclipSkillSlug(skillId)}`,
    `description: ${skill.description || `Zero-Human skill for ${skill.category}`}`,
    "---",
    "",
    `# ${name}`,
    "",
    skill.description || `Use this Zero-Human managed skill for ${skill.category} work.`,
    "",
    "## Role Fit",
    "",
    skill.roles.length ? skill.roles.map((role) => `- ${role}`).join("\n") : "- operations",
    "",
    "## Triggers",
    "",
    skill.triggers.length ? skill.triggers.slice(0, 20).map((trigger) => `- ${trigger}`).join("\n") : "- manual",
    "",
    "## Tools",
    "",
    (skill.tools ?? []).length ? (skill.tools ?? []).map((tool) => `- ${tool}`).join("\n") : "- codex",
    "",
    "## Source",
    "",
    `- Zero-Human registry id: ${skillId}`,
    `- Source: ${skill.source ?? "zero-human"}`,
    skill.sourcePath ? `- Source path: ${skill.sourcePath}` : ""
  ].filter(Boolean).join("\n");
}

function zeroHumanPaperclipSkillKey(skillId: string): string {
  return `zero-human/${paperclipSkillSlug(skillId)}`;
}

function isAgentRole(value: string): value is AgentRole {
  return value in roleSkillCatalog;
}

function fallbackPaperclipSkillName(skillId: string): string {
  return skillId
    .replace(/^repo_skill_[a-z0-9]+_/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fallbackPaperclipSkillMarkdown(skillId: string, role?: AgentRole): string {
  const slug = paperclipSkillSlug(skillId);
  const name = fallbackPaperclipSkillName(skillId);
  return [
    "---",
    `name: ${slug}`,
    `description: Zero-Human role skill${role ? ` for ${role}` : ""}.`,
    "---",
    "",
    `# ${name}`,
    "",
    "This skill is managed by Zero-Human Studio and assigned from the role map.",
    "",
    "## Role Fit",
    "",
    `- ${role ?? "operations"}`,
    "",
    "## Trigger",
    "",
    `- ${skillId}`,
    "",
    "## Operating Rule",
    "",
    "Use this skill only when the current task needs this capability. Prefer the Hermes Operating Protocol before broad exploration."
  ].join("\n");
}

async function upsertZeroHumanPaperclipSkill(
  client: PoolClient,
  companyId: string,
  skillId: string,
  syncedAt: string,
  role?: AgentRole
): Promise<string> {
  const registrySkill = activeSkillRegistry()[skillId];
  const slug = paperclipSkillSlug(skillId);
  const key = zeroHumanPaperclipSkillKey(skillId);
  const name = registrySkill ? paperclipSkillName(skillId, registrySkill) : fallbackPaperclipSkillName(skillId);
  const markdown = registrySkill ? markdownForPaperclipSkill(skillId, registrySkill) : fallbackPaperclipSkillMarkdown(skillId, role);
  await client.query(
    `insert into company_skills
      (company_id, key, slug, name, description, markdown, source_type, source_locator, source_ref, trust_level, compatibility, file_inventory, metadata)
     values ($1, $2, $3, $4, $5, $6, 'zero_human_registry', $7, $8, 'markdown_only', 'compatible', $9::jsonb, $10::jsonb)
     on conflict (company_id, key) do update set
       slug = excluded.slug,
       name = excluded.name,
       description = excluded.description,
       markdown = excluded.markdown,
       source_type = excluded.source_type,
       source_locator = excluded.source_locator,
       source_ref = excluded.source_ref,
       file_inventory = excluded.file_inventory,
       metadata = excluded.metadata,
       updated_at = now()`,
    [
      companyId,
      key,
      slug,
      name,
      registrySkill?.description || `Zero-Human role skill${role ? ` for ${role}` : ""}.`,
      markdown,
      registrySkill?.sourcePath ?? registrySkill?.source ?? "zero-human-role-map",
      skillId,
      JSON.stringify(registrySkill?.sourcePath ? [{ path: registrySkill.sourcePath, kind: "skill" }] : []),
      JSON.stringify({
        zeroHumanSkillId: skillId,
        category: registrySkill?.category ?? "role",
        roles: registrySkill?.roles ?? (role ? [role] : []),
        triggers: registrySkill?.triggers ?? [skillId],
        tools: registrySkill?.tools ?? [],
        syncedAt
      })
    ]
  );
  return key;
}

async function resolvePaperclipCompanyId(client: PoolClient): Promise<string> {
  if (process.env.PAPERCLIP_COMPANY_ID) return process.env.PAPERCLIP_COMPANY_ID;
  const companyResult = await client.query<{ id: string }>(
    "select id from companies order by created_at desc, updated_at desc limit 1"
  );
  if (companyResult.rows[0]?.id) return companyResult.rows[0].id;
  const agentResult = await client.query<{ company_id: string }>(
    "select company_id from agents order by created_at desc, updated_at desc nulls last limit 1"
  );
  if (agentResult.rows[0]?.company_id) return agentResult.rows[0].company_id;
  throw new Error("No Paperclip company found. Complete Paperclip onboarding first.");
}

async function resolvePaperclipProjectId(client: PoolClient, companyId: string): Promise<string> {
  if (process.env.PAPERCLIP_PROJECT_ID) return process.env.PAPERCLIP_PROJECT_ID;
  const projectResult = await client.query<{ id: string }>(
    "select id from projects where company_id = $1 and archived_at is null order by updated_at desc, created_at desc limit 1",
    [companyId]
  );
  if (projectResult.rows[0]?.id) return projectResult.rows[0].id;
  throw new Error("No Paperclip project found. Create or open a Paperclip project first.");
}

async function syncSkillsToPaperclip(): Promise<PaperclipSkillSyncReport> {
  const report: PaperclipSkillSyncReport = {
    id: `paperclip_skills_${nanoid(8)}`,
    registrySkills: Object.keys(activeSkillRegistry()).length,
    paperclipSkillsBefore: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    unavailable: false,
    details: [],
    createdAt: new Date().toISOString()
  };
  if (!paperclipDatabaseUrl) {
    report.unavailable = true;
    report.error = "PAPERCLIP_DATABASE_URL is not configured.";
    latestPaperclipSkillSync = report;
    return report;
  }
  const client = await getPaperclipPool().connect();
  try {
    const companyId = await resolvePaperclipCompanyId(client);
    report.companyId = companyId;
    const existingResult = await client.query<{
      key: string;
      slug: string;
      name: string;
      markdown: string;
    }>("select key, slug, name, markdown from company_skills where company_id = $1", [companyId]);
    report.paperclipSkillsBefore = existingResult.rows.length;
    const existingByKey = new Map(existingResult.rows.map((row) => [row.key, row]));
    const existingSlugOrName = new Set(
      existingResult.rows
        .filter((row) => !row.key.startsWith("zero-human/"))
        .flatMap((row) => [row.slug.toLowerCase(), row.name.toLowerCase()])
    );
    const existingHashes = new Set(
      existingResult.rows
        .filter((row) => !row.key.startsWith("zero-human/"))
        .map((row) => createHash("sha256").update(row.markdown).digest("hex"))
    );

    for (const [skillId, skill] of Object.entries(activeSkillRegistry()).sort(([a], [b]) => a.localeCompare(b))) {
      if (skill.status === "disabled") continue;
      const slug = paperclipSkillSlug(skillId);
      const key = `zero-human/${slug}`;
      const name = paperclipSkillName(skillId, skill);
      const markdown = markdownForPaperclipSkill(skillId, skill);
      const hash = createHash("sha256").update(markdown).digest("hex");
      const existing = existingByKey.get(key);
      if (!existing && (existingSlugOrName.has(slug) || existingSlugOrName.has(name.toLowerCase()) || existingHashes.has(hash))) {
        report.skipped += 1;
        report.details.push({ skill: skillId, action: "skipped", reason: "duplicate Paperclip skill", paperclipKey: key });
        continue;
      }
      await client.query(
        `insert into company_skills
          (company_id, key, slug, name, description, markdown, source_type, source_locator, source_ref, trust_level, compatibility, file_inventory, metadata)
         values ($1, $2, $3, $4, $5, $6, 'zero_human_registry', $7, $8, 'markdown_only', 'compatible', $9::jsonb, $10::jsonb)
         on conflict (company_id, key) do update set
           slug = excluded.slug,
           name = excluded.name,
           description = excluded.description,
           markdown = excluded.markdown,
           source_type = excluded.source_type,
           source_locator = excluded.source_locator,
           source_ref = excluded.source_ref,
           file_inventory = excluded.file_inventory,
           metadata = excluded.metadata,
           updated_at = now()`,
        [
          companyId,
          key,
          slug,
          name,
          skill.description || `Zero-Human skill for ${skill.category}`,
          markdown,
          skill.sourcePath ?? skill.source ?? "zero-human-registry",
          skillId,
          JSON.stringify(skill.sourcePath ? [{ path: skill.sourcePath, kind: "skill" }] : []),
          JSON.stringify({
            zeroHumanSkillId: skillId,
            category: skill.category,
            roles: skill.roles,
            triggers: skill.triggers,
            tools: skill.tools ?? [],
            syncedAt: report.createdAt
          })
        ]
      );
      if (existing) report.updated += 1;
      else report.imported += 1;
      report.details.push({ skill: skillId, action: existing ? "updated" : "imported", paperclipKey: key });
    }
    latestPaperclipSkillSync = report;
    return report;
  } catch (error) {
    report.unavailable = true;
    report.error = (error as Error).message;
    latestPaperclipSkillSync = report;
    return report;
  } finally {
    client.release();
  }
}

function publicPaperclipSkillSyncReport(): PaperclipSkillSyncReport {
  const report = latestPaperclipSkillSync ?? {
    id: "paperclip_skills_not_run",
    registrySkills: Object.keys(activeSkillRegistry()).length,
    paperclipSkillsBefore: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    unavailable: !paperclipDatabaseUrl,
    details: [],
    error: paperclipDatabaseUrl ? undefined : "PAPERCLIP_DATABASE_URL is not configured.",
    createdAt: new Date(0).toISOString()
  } satisfies PaperclipSkillSyncReport;
  return {
    ...report,
    details: report.details.slice(0, 60)
  };
}

const hermesProtocolSkillKey = "zero-human/hermes-operating-protocol";
const hermesProtocolSkillSlug = "hermes-operating-protocol";

function hermesOperatingProtocolMarkdown(memory: BrainMemorySummary): string {
  const topSkills = memory.skills
    .slice(0, 12)
    .map((skill) => `- ${skill.agentId}: ${skill.skill} (${skill.runs} runs, confidence ${skill.confidence})`);
  const recentNotes = memory.recentNotes
    .slice(0, 8)
    .map((note) => `- ${note.agentId}: ${note.note}`);
  const readyRepos = readyWorkRepositories().slice(0, 8).map((repo) => `- ${repo.name}: ${repo.path} (${repo.branch})`);
  return [
    "# Hermes Operating Protocol",
    "",
    "Use this skill on every Paperclip run. Hermes is the shared company memory and cost guardrail for Zero-Human.",
    "",
    "## Cost discipline",
    "",
    "- Start from the issue title, issue body, assigned role, repository workspace, and this protocol. Do not rediscover the whole company from scratch.",
    "- Before broad exploration, list the minimum facts needed and inspect only the highest-signal files first.",
    "- Prefer targeted commands such as `pwd`, `ls`, `git status`, `rg`, and small file reads. Avoid repeated full-tree scans.",
    "- Treat `blocked` as an escalation state, not a stopping state. First diagnose the blocker, then either fix it, delegate it, request a needed role, or ask the owner for one concrete decision.",
    "- Do not post repeated planning-only comments. Every run should either change state, attach evidence, delegate, request approval, or close/block the issue.",
    "- A comment that says work will be created later is not completion. If the issue asks for a roadmap, create a Paperclip document or concrete sub-issues in the same run.",
    "- Only set blocked when there is a real external blocker after diagnosis. If the blocker can be handled by another role, create or request that agent and delegate instead of stopping.",
    "- If Paperclip creates a recovery blocker, resolve or explain that blocker first, then continue the original issue. Do not keep the original issue blocked only because a previous run missed disposition.",
    "- When blocked by missing repo, missing credentials, unclear owner, or missing role, produce one concrete recovery action: verify the expected path/secret/owner, create a child issue for the right role, or emit `ZH_ESCALATION` for hiring.",
    "",
    "## Required Paperclip disposition",
    "",
    "- For roadmap/planning work: attach a document or create child issues, then set disposition to `in_review` or `done`.",
    "- For implementation work: attach changed files or evidence, then set disposition to `in_review` or `done`.",
    "- For blocked work: name the missing owner/path/credential, record what was checked, and set disposition to `blocked` only with a concrete unblocker or `ZH_ESCALATION`.",
    "- For delegated work: create child issues with assignees and set disposition to `delegated` or `in_review`.",
    "",
    "## Required Git delivery",
    "",
    "- If the task changes repository code, completion is not valid until the change is committed and pushed to the `staging` branch.",
    "- Before pushing, run the smallest relevant verification command available for the repo, then run `git status --short` and include the result summary in the final comment.",
    "- Preferred delivery command is `git push origin HEAD:staging`. If the repo is already on `staging`, `git push origin staging` is acceptable.",
    "- If push fails because of credentials, protected branch rules, missing remote, or network, set disposition to `blocked` with the exact git error and the next owner/action. Do not mark the issue done.",
    "- If the task is planning, research, or discussion only and no files changed, explicitly write `git_push: not_applicable` in `ZH_OUTCOME`.",
    "",
    "## Required output markers",
    "",
    "When work finishes, add a concise comment using this exact shape so Hermes can learn:",
    "",
    "```text",
    "ZH_OUTCOME:",
    "status: done|blocked|in_review|delegated",
    "summary: <one or two sentences>",
    "files: <comma separated files or none>",
    "git_push: pushed_to_staging|not_applicable|blocked",
    "skills_used: <comma separated skills>",
    "next: <clear next owner/action or none>",
    "```",
    "",
    "When a new employee/agent is needed, add:",
    "",
    "```text",
    "ZH_ESCALATION:",
    "type: hire_agent",
    "role: <role id or title>",
    "reason: <why current agent cannot continue>",
    "handoff: <first concrete task for the new agent>",
    "```",
    "",
    "If the current agent has permission to create agents, create the needed agent directly and then delegate a child issue. Do not wait for manual owner input unless budget, credentials, or business direction is required.",
    "",
    "## Current Hermes memory snapshot",
    "",
    topSkills.length ? topSkills.join("\n") : "- No learned skills yet.",
    "",
    "## Recent memory notes",
    "",
    recentNotes.length ? recentNotes.join("\n") : "- No recent Hermes notes yet.",
    "",
    "## Ready work repositories",
    "",
    readyRepos.length ? readyRepos.join("\n") : "- No ready work repositories synced yet."
  ].join("\n");
}

async function rememberInHermes(agentId: string, note: string): Promise<boolean> {
  const brainUrl = config.infrastructure.services?.brain_url;
  if (!brainUrl) return false;
  try {
    const response = await fetch(`${brainUrl.replace(/\/$/, "")}/api/memory/remember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, note })
    });
    return response.ok;
  } catch {
    return false;
  }
}

function paperclipAdapterConfig(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function findZeroHumanAgentForPaperclipAgent(row: { name: string; role: string }): Agent | undefined {
  const normalizedName = slug(row.name);
  const normalizedRole = slug(row.role);
  const exact = Array.from(agents.values()).find((agent) =>
    slug(agent.id) === normalizedName ||
    slug(agent.role) === normalizedRole ||
    slug(agent.id) === normalizedRole
  );
  if (exact) return exact;

  const aliases: Record<string, AgentRole> = {
    chief_technology_officer: "cto",
    technical_lead: "cto",
    engineer: "backend",
    backend_engineer: "backend",
    frontend_engineer: "frontend",
    quality_engineer: "qa",
    qa_engineer: "qa",
    devops_engineer: "devops",
    designer: "design",
    ux_designer: "design",
    uxdesigner: "design",
    product_designer: "design",
    brand_designer: "design",
    chief_marketing_officer: "marketing",
    cmo: "marketing",
    marketer: "marketing",
    growth_marketer: "marketing",
    customer_success: "support",
    support: "support",
    finance_ops: "finance",
    finance_operations: "finance",
    operations: "operations"
  };
  const aliasedRole = aliases[normalizedRole] ?? aliases[normalizedName];
  return aliasedRole ? Array.from(agents.values()).find((agent) => agent.role === aliasedRole) : undefined;
}

function paperclipNativeDesiredSkillsForRole(row: { name: string; role: string }): string[] {
  const normalizedName = slug(row.name);
  const normalizedRole = slug(row.role);
  if (normalizedName === "ceo" || normalizedRole === "ceo") {
    return [
      "paperclipai/paperclip/diagnose-why-work-stopped",
      "paperclipai/paperclip/paperclip",
      "paperclipai/paperclip/paperclip-converting-plans-to-tasks",
      "paperclipai/paperclip/paperclip-create-agent",
      "paperclipai/paperclip/para-memory-files"
    ];
  }
  return [];
}

function codexMcpServerPayload(server: McpServerConfig): PaperclipCodexMcpServer {
  return {
    id: server.id,
    name: server.name,
    category: server.category,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    env: server.env,
    permissionMode: server.permissions.mode
  };
}

function mergeMcpServers(...groups: PaperclipCodexMcpServer[][]): PaperclipCodexMcpServer[] {
  const byId = new Map<string, PaperclipCodexMcpServer>();
  for (const server of groups.flat()) byId.set(server.id, server);
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function mandatoryMcpServers(): PaperclipCodexMcpServer[] {
  const sequentialThinking = publicMcpServers().find((server) => server.id === "sequential-thinking");
  return sequentialThinking ? [codexMcpServerPayload(sequentialThinking)] : [];
}

function enabledMcpServersForAgent(agent: Agent): PaperclipCodexMcpServer[] {
  const roleServers = publicMcpServers()
    .filter((server) => server.status === "enabled" && server.roles.includes(agent.role))
    .map(codexMcpServerPayload);
  return mergeMcpServers(mandatoryMcpServers(), roleServers);
}

function paperclipNativeMcpServersForRole(row: { name: string; role: string }): PaperclipCodexMcpServer[] {
  const zeroHumanAgent = findZeroHumanAgentForPaperclipAgent(row);
  return zeroHumanAgent ? enabledMcpServersForAgent(zeroHumanAgent) : mandatoryMcpServers();
}

type PaperclipAgentRow = {
  id: string;
  name: string;
  role: string;
  title: string | null;
  status?: string | null;
  adapter_type: string;
  adapter_config: unknown;
  runtime_config: unknown;
  permissions: unknown;
};

function paperclipAgentTitle(agent: Agent): string {
  const titles: Record<AgentRole, string> = {
    cto: "Chief Technology Officer",
    frontend: "Frontend Engineer",
    backend: "Backend Engineer",
    qa: "Quality Engineer",
    devops: "DevOps Engineer",
    product: "Product Manager",
    design: "Brand and Product Designer",
    marketing: "Growth Marketer",
    sales: "Sales Lead",
    support: "Customer Success",
    finance: "Finance Operations",
    operations: "Operations Lead",
    research: "Research Analyst",
    legal: "Legal and Compliance"
  };
  return titles[agent.role] ?? agent.id.replaceAll("_", " ");
}

function paperclipAgentIcon(agent: Agent): string {
  const icons: Record<AgentRole, string> = {
    cto: "Cpu",
    frontend: "Monitor",
    backend: "Database",
    qa: "ShieldCheck",
    devops: "Server",
    product: "ClipboardList",
    design: "PenTool",
    marketing: "TrendingUp",
    sales: "Handshake",
    support: "Headphones",
    finance: "DollarSign",
    operations: "Workflow",
    research: "Search",
    legal: "Scale"
  };
  return icons[agent.role] ?? "Bot";
}

function paperclipAgentCapabilities(agent: Agent): string {
  const roleSkills = desiredSkillsForAgentProfile(agent).slice(0, 10).join(", ");
  const mcp = enabledMcpServersForAgent(agent).map((server) => server.name).join(", ") || "none";
  return [
    `Zero-Human ${agent.role} role managed by the owner manifest.`,
    `Executor: ${agent.executor}. Model combo: ${agent.modelCombo}.`,
    `Primary skills: ${roleSkills || "role triage"}.`,
    `MCP access: ${mcp}.`,
    "Use Hermes Operating Protocol before broad exploration, then execute or delegate concrete work."
  ].join(" ");
}

function paperclipManagerRoleForAgent(agent: Agent): AgentRole | "ceo" | undefined {
  if (["frontend", "backend", "qa", "devops"].includes(agent.role)) return "cto";
  if (agent.role === "design") return "product";
  if (agent.role === "sales") return "marketing";
  if (agent.role === "support") return "operations";
  return "ceo";
}

async function resolvePaperclipReportsTo(
  client: PoolClient,
  companyId: string,
  agent: Agent,
  ceoId?: string
): Promise<string | null> {
  const managerRole = paperclipManagerRoleForAgent(agent);
  if (!managerRole) return null;
  if (managerRole === "ceo") return ceoId ?? null;
  const manager = await client.query<{ id: string }>(
    `select id::text
       from agents
      where company_id = $1
        and (lower(role) = lower($2) or lower(name) = lower($2))
      order by created_at asc
      limit 1`,
    [companyId, managerRole]
  );
  return manager.rows[0]?.id ?? ceoId ?? null;
}

async function desiredPaperclipSkillKeysForAgent(client: PoolClient, companyId: string, agent: Agent, syncedAt: string): Promise<string[]> {
  const zeroHumanSkillKeys: string[] = [];
  for (const skillId of desiredSkillsForAgentProfile(agent)) {
    zeroHumanSkillKeys.push(await upsertZeroHumanPaperclipSkill(client, companyId, skillId, syncedAt, agent.role));
  }
  return Array.from(new Set([
    hermesProtocolSkillKey,
    ...paperclipNativeDesiredSkillsForRole({ name: agent.id, role: agent.role }),
    ...zeroHumanSkillKeys
  ]));
}

async function ensurePaperclipAgentForZeroHumanAgent(
  client: PoolClient,
  companyId: string,
  agent: Agent,
  syncedAt: string,
  reason = "Zero-Human role exists but Paperclip agent is missing."
): Promise<{ id: string; created: boolean; name: string; role: string }> {
  const ceoResult = await client.query<PaperclipAgentRow>(
    `select id::text, name, role, title, adapter_type, adapter_config, runtime_config, permissions
       from agents
      where company_id = $1 and lower(role) = 'ceo'
      order by created_at asc
      limit 1`,
    [companyId]
  );
  const ceo = ceoResult.rows[0];
  const reportsTo = await resolvePaperclipReportsTo(client, companyId, agent, ceo?.id);
  const existing = await client.query<{ id: string; name: string; role: string }>(
    `select id::text, name, role
       from agents
      where company_id = $1
        and (lower(role) = lower($2) or lower(name) = lower($3) or lower(name) = lower($4))
      order by created_at asc
      limit 1`,
    [companyId, agent.role, agent.id, agent.id.replaceAll("_", " ")]
  );
  if (existing.rows[0]) {
    await client.query(
      `update agents
          set reports_to = $3::uuid,
              title = coalesce(nullif(title, ''), $4),
              capabilities = case
                when capabilities is null or capabilities = '' then $5
                else capabilities
              end,
              updated_at = now()
        where company_id = $1 and id = $2::uuid`,
      [companyId, existing.rows[0].id, reportsTo, paperclipAgentTitle(agent), paperclipAgentCapabilities(agent)]
    );
    markPaperclipAgentSynced(agent.id, existing.rows[0].id);
    return { ...existing.rows[0], created: false };
  }

  const baseConfig = paperclipAdapterConfig(ceo?.adapter_config);
  const desiredSkills = await desiredPaperclipSkillKeysForAgent(client, companyId, agent, syncedAt);
  const desiredMcpServers = enabledMcpServersForAgent(agent);
  const adapterConfig: Record<string, unknown> = {
    ...baseConfig,
    model: typeof baseConfig.model === "string" && baseConfig.model.trim() ? baseConfig.model : "combotest",
    paperclipSkillSync: {
      ...paperclipAdapterConfig(baseConfig.paperclipSkillSync),
      desiredSkills
    },
    zeroHumanMcpSync: {
      ...paperclipAdapterConfig(baseConfig.zeroHumanMcpSync),
      source: "zero-human-role-map",
      syncedAt,
      servers: desiredMcpServers
    }
  };
  delete adapterConfig.instructionsFilePath;
  delete adapterConfig.instructionsRootPath;
  delete adapterConfig.instructionsEntryFile;
  delete adapterConfig.instructionsBundleMode;

  const runtimeConfig = {
    heartbeat: {
      enabled: true,
      wakeOnDemand: true,
      maxConcurrentRuns: agent.role === "cto" ? 6 : 3
    }
  };
  const permissions = ["ceo", "cto", "product", "operations"].includes(agent.role)
    ? { canCreateAgents: true }
    : { canCreateAgents: false };
  const inserted = await client.query<{ id: string; name: string; role: string }>(
    `insert into agents
      (company_id, name, role, title, icon, status, reports_to, capabilities, adapter_type, adapter_config, runtime_config, budget_monthly_cents, permissions, metadata)
     values ($1, $2, $3, $4, $5, 'idle', $6::uuid, $7, $8, $9::jsonb, $10::jsonb, $11, $12::jsonb, $13::jsonb)
     returning id::text, name, role`,
    [
      companyId,
      agent.id.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      agent.role,
      paperclipAgentTitle(agent),
      paperclipAgentIcon(agent),
      reportsTo,
      paperclipAgentCapabilities(agent),
      ceo?.adapter_type ?? "codex_local",
      JSON.stringify(adapterConfig),
      JSON.stringify(runtimeConfig),
      Math.round(agent.maxBudgetUsd * 100),
      JSON.stringify(permissions),
      JSON.stringify({
        zeroHumanManaged: true,
        zeroHumanAgentId: agent.id,
        zeroHumanRole: agent.role,
        zeroHumanReason: reason,
        syncedAt
      })
    ]
  );
  const row = inserted.rows[0];
  markPaperclipAgentSynced(agent.id, row.id);
  return { ...row, created: true };
}

async function syncHermesBridgeToPaperclip(): Promise<PaperclipHermesBridgeReport> {
  const report: PaperclipHermesBridgeReport = {
    id: `paperclip_hermes_${nanoid(8)}`,
    protocolSkillKey: hermesProtocolSkillKey,
    protocolSkillSynced: false,
    agentsScanned: 0,
    agentsPatched: 0,
    memoryNotesWritten: 0,
    unavailable: false,
    details: [],
    createdAt: new Date().toISOString()
  };
  if (!paperclipDatabaseUrl) {
    report.unavailable = true;
    report.error = "PAPERCLIP_DATABASE_URL is not configured.";
    latestPaperclipHermesBridgeReport = report;
    return report;
  }

  const memory = await brainMemoryStatus();
  const markdown = hermesOperatingProtocolMarkdown(memory);
  const client = await getPaperclipPool().connect();
  try {
    const companyId = await resolvePaperclipCompanyId(client);
    report.companyId = companyId;
    await client.query("begin");
    await client.query(
      `insert into company_skills
        (company_id, key, slug, name, description, markdown, source_type, source_locator, source_ref, trust_level, compatibility, file_inventory, metadata)
       values ($1, $2, $3, $4, $5, $6, 'zero_human_hermes', 'zero-human-hermes-bridge', 'hermes-operating-protocol', 'markdown_only', 'compatible', $7::jsonb, $8::jsonb)
       on conflict (company_id, key) do update set
         slug = excluded.slug,
         name = excluded.name,
         description = excluded.description,
         markdown = excluded.markdown,
         source_type = excluded.source_type,
         source_locator = excluded.source_locator,
         source_ref = excluded.source_ref,
         file_inventory = excluded.file_inventory,
         metadata = excluded.metadata,
         updated_at = now()`,
      [
        companyId,
        hermesProtocolSkillKey,
        hermesProtocolSkillSlug,
        "Hermes Operating Protocol",
        "Shared Zero-Human memory, delegation, and token guardrails for Paperclip agents.",
        markdown,
        JSON.stringify([{ path: "zero-human/hermes-operating-protocol", kind: "generated-skill" }]),
        JSON.stringify({
          zeroHumanBridge: true,
          memoryOk: memory.ok,
          memoryEntries: memory.entries,
          memoryOutcomes: memory.outcomes,
          syncedAt: report.createdAt
        })
      ]
    );
    report.protocolSkillSynced = true;
    report.details.push({ action: "protocol_synced", reason: "Hermes protocol skill upserted in Paperclip." });

    report.details.push({
      action: "paperclip_hiring_authority",
      reason: "Zero-Human did not create missing agents during bridge sync; Paperclip remains the hiring and execution authority."
    });

    const agentResult = await client.query<{ id: string; name: string; role: string; title: string | null; status: string; adapter_config: unknown }>(
      "select id::text, name, role, title, status, adapter_config from agents where company_id = $1 and status <> 'terminated' order by created_at asc",
      [companyId]
    );
    report.agentsScanned = agentResult.rows.length;
    for (const row of agentResult.rows) {
      const configValue = paperclipAdapterConfig(row.adapter_config);
      const syncValue = paperclipAdapterConfig(configValue.paperclipSkillSync);
      const existingDesired = Array.isArray(syncValue.desiredSkills)
        ? syncValue.desiredSkills.map(String).filter(Boolean)
        : [];
      const zeroHumanAgent = findZeroHumanAgentForPaperclipAgent(row);
      const desiredZeroHumanSkillIds = desiredSkillIdsForPaperclipAgent(row, zeroHumanAgent);
      const zeroHumanSkillKeys = desiredZeroHumanSkillIds.map(zeroHumanPaperclipSkillKey);
      const nativeSkillKeys = paperclipNativeDesiredSkillsForRole(row);
      const desiredMcpServers = zeroHumanAgent
        ? enabledMcpServersForAgent(zeroHumanAgent)
        : paperclipNativeMcpServersForRole(row);
      const desiredSkills = Array.from(new Set([
        hermesProtocolSkillKey,
        ...nativeSkillKeys,
        ...zeroHumanSkillKeys,
        ...existingDesired
      ]));
      const existingMcpSync = paperclipAdapterConfig(configValue.zeroHumanMcpSync);
      const existingMcpServers = Array.isArray(existingMcpSync.servers)
        ? existingMcpSync.servers
        : [];
      const desiredUnchanged =
        sameStringSet(existingDesired, desiredSkills)
        && sameStringSet(mcpServerIds(existingMcpServers), desiredMcpServers.map((server) => server.id));
      if (desiredUnchanged) {
        report.details.push({
          agentId: row.id,
          agentName: row.name,
          role: row.role,
          action: "agent_already_ready",
          reason: zeroHumanAgent
            ? `Agent already has Hermes protocol, ${zeroHumanSkillKeys.length} Zero-Human role skills, and ${desiredMcpServers.length} MCP servers selected.`
            : `Agent already has Hermes protocol, ${nativeSkillKeys.length} Paperclip native role skills, and ${desiredMcpServers.length} native MCP servers selected. No matching Zero-Human role was found for extra skill mapping.`
        });
        continue;
      }
      for (const skillId of desiredZeroHumanSkillIds) {
        await upsertZeroHumanPaperclipSkill(client, companyId, skillId, report.createdAt, zeroHumanAgent?.role ?? "backend");
      }
      const nextConfig = {
        ...configValue,
        paperclipSkillSync: {
          ...syncValue,
          desiredSkills
        },
        zeroHumanMcpSync: {
          ...existingMcpSync,
          source: "zero-human-role-map",
          syncedAt: report.createdAt,
          servers: desiredMcpServers
        }
      };
      await client.query(
        "update agents set adapter_config = $3::jsonb, updated_at = now() where company_id = $1 and id = $2",
        [companyId, row.id, JSON.stringify(nextConfig)]
      );
      report.agentsPatched += 1;
      report.details.push({
        agentId: row.id,
        agentName: row.name,
        role: row.role,
        action: "agent_patched",
        reason: zeroHumanAgent
          ? `Hermes protocol, ${zeroHumanSkillKeys.length} Zero-Human role skills, and ${desiredMcpServers.length} MCP servers selected from ${zeroHumanAgent.id}.`
          : `Hermes protocol, ${nativeSkillKeys.length} Paperclip native role skills, and ${desiredMcpServers.length} native MCP servers selected. No matching Zero-Human role was found for extra skill mapping.`
      });
    }
    await client.query("commit");

    if (report.agentsPatched > 0 && await rememberInHermes("zero_human_owner", `Paperclip Hermes bridge synced: ${report.agentsPatched}/${report.agentsScanned} agents patched with ${hermesProtocolSkillKey}.`)) {
      report.memoryNotesWritten += 1;
      report.details.push({ action: "memory_written", reason: "Bridge sync note persisted in Hermes memory." });
    }
    latestPaperclipHermesBridgeReport = report;
    return report;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    report.unavailable = true;
    report.error = (error as Error).message;
    latestPaperclipHermesBridgeReport = report;
    return report;
  } finally {
    client.release();
  }
}

function publicPaperclipHermesBridgeReport(): PaperclipHermesBridgeReport {
  const report = latestPaperclipHermesBridgeReport ?? {
    id: "paperclip_hermes_not_synced",
    protocolSkillKey: hermesProtocolSkillKey,
    protocolSkillSynced: false,
    agentsScanned: 0,
    agentsPatched: 0,
    memoryNotesWritten: 0,
    unavailable: !paperclipDatabaseUrl,
    details: [],
    error: paperclipDatabaseUrl ? undefined : "PAPERCLIP_DATABASE_URL is not configured.",
    createdAt: new Date(0).toISOString()
  } satisfies PaperclipHermesBridgeReport;
  return {
    ...report,
    details: report.details.slice(0, 60)
  };
}

function sameStringSet(a: string[], b: string[]): boolean {
  const left = Array.from(new Set(a)).sort();
  const right = Array.from(new Set(b)).sort();
  return JSON.stringify(left) === JSON.stringify(right);
}

function mcpServerIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((server) => {
      if (typeof server === "string") return server;
      if (server && typeof server === "object" && "id" in server) return String((server as { id?: unknown }).id ?? "");
      return "";
    })
    .filter(Boolean);
}

let paperclipHermesAutoSyncRunning = false;
let paperclipHermesAutoSyncQueued = false;

async function runPaperclipHermesAutoSync(reason: string): Promise<void> {
  if (paperclipHermesAutoSyncRunning) {
    paperclipHermesAutoSyncQueued = true;
    return;
  }
  paperclipHermesAutoSyncRunning = true;
  paperclipHermesAutoSyncQueued = false;
  try {
    const report = await syncHermesBridgeToPaperclip();
    if (report.unavailable) {
      addEvent("paperclip_hermes_auto_sync", `Auto sync skipped: ${report.error}`);
    } else if (report.agentsPatched > 0) {
      addEvent("paperclip_hermes_auto_sync", `Auto sync patched ${report.agentsPatched}/${report.agentsScanned} Paperclip agents (${reason}).`);
    }
  } catch (error) {
    addEvent("paperclip_hermes_auto_sync", `Auto sync failed: ${(error as Error).message}`);
  } finally {
    paperclipHermesAutoSyncRunning = false;
    if (paperclipHermesAutoSyncQueued) {
      setTimeout(() => void runPaperclipHermesAutoSync("queued"), 1000);
    }
  }
}

function schedulePaperclipHermesAutoSync(reason: string): void {
  if (!paperclipDatabaseUrl) return;
  if (paperclipHermesAutoSyncQueued) return;
  paperclipHermesAutoSyncQueued = true;
  setTimeout(() => void runPaperclipHermesAutoSync(reason), 1500);
}

let paperclipHermesMonitorRunning = false;
let paperclipHermesMonitorQueued = false;

async function runPaperclipHermesMonitor(reason: string): Promise<void> {
  if (paperclipHermesMonitorRunning) {
    paperclipHermesMonitorQueued = true;
    return;
  }
  paperclipHermesMonitorRunning = true;
  paperclipHermesMonitorQueued = false;
  try {
    const report = await scanPaperclipHermesInterventions();
    if (report.unavailable) {
      addEvent("paperclip_hermes_live_brain", `Hermes live brain skipped: ${report.error}`);
    } else if (report.intervened > 0 || report.wakeupsQueued > 0) {
      addEvent(
        "paperclip_hermes_live_brain",
        `Hermes live brain intervened on ${report.intervened}/${report.scanned} Paperclip issues and queued ${report.wakeupsQueued} wakeups (${reason}).`
      );
    }
  } catch (error) {
    addEvent("paperclip_hermes_live_brain", `Hermes live brain failed: ${(error as Error).message}`);
  } finally {
    paperclipHermesMonitorRunning = false;
    if (paperclipHermesMonitorQueued) {
      setTimeout(() => void runPaperclipHermesMonitor("queued"), 1000);
    }
  }
}

function schedulePaperclipHermesMonitor(reason: string): void {
  if (!paperclipDatabaseUrl) return;
  if (paperclipHermesMonitorQueued) return;
  paperclipHermesMonitorQueued = true;
  setTimeout(() => void runPaperclipHermesMonitor(reason), 2500);
}

function readyWorkRepositories(): RegisteredRepository[] {
  return Array.from(repositories.values())
    .filter((repository) => (repository.sourceKind ?? "work") === "work" && repository.status === "ready")
    .sort((a, b) => a.name.localeCompare(b.name));
}

function repositorySearchTokens(repository: RegisteredRepository): string[] {
  const repoNameFromUrl = repository.url.split(/[/:]/).pop()?.replace(/\.git$/i, "");
  return Array.from(new Set([repository.id, repository.name, repoNameFromUrl].filter(Boolean).map((value) => value!.toLowerCase())));
}

async function syncRepositoriesToPaperclip(): Promise<PaperclipRepositorySyncReport> {
  const readyRepositories = readyWorkRepositories();
  const report: PaperclipRepositorySyncReport = {
    id: `paperclip_repositories_${nanoid(8)}`,
    repositoriesReady: readyRepositories.length,
    workspacesSynced: 0,
    issuesLinked: 0,
    unavailable: false,
    details: [],
    createdAt: new Date().toISOString()
  };
  if (!paperclipDatabaseUrl) {
    report.unavailable = true;
    report.error = "PAPERCLIP_DATABASE_URL is not configured.";
    latestPaperclipRepositorySync = report;
    return report;
  }
  const client = await getPaperclipPool().connect();
  try {
    const companyId = await resolvePaperclipCompanyId(client);
    const projectId = await resolvePaperclipProjectId(client, companyId);
    report.companyId = companyId;
    report.projectId = projectId;
    if (readyRepositories.length === 0) {
      latestPaperclipRepositorySync = report;
      return report;
    }

    await client.query("begin");
    const primaryRepository = readyRepositories[0];
    for (const repository of readyRepositories) {
      const sharedWorkspaceKey = `zero-human:${repository.id}`;
      const metadata = {
        source: "zero-human",
        repositoryId: repository.id,
        repositoryName: repository.name,
        syncedAt: report.createdAt
      };
      const existing = await client.query<{ id: string }>(
        "select id from project_workspaces where company_id = $1 and shared_workspace_key = $2 limit 1",
        [companyId, sharedWorkspaceKey]
      );
      const isPrimary = repository.id === primaryRepository.id;
      let workspaceId = existing.rows[0]?.id;
      let action: "created" | "updated" = "updated";
      if (workspaceId) {
        await client.query(
          `update project_workspaces
             set project_id = $3,
                 name = $4,
                 cwd = $5,
                 repo_url = $6,
                 repo_ref = $7,
                 default_ref = $7,
                 source_type = 'zero_human_repository',
                 visibility = 'default',
                 is_primary = $8,
                 metadata = $9::jsonb,
                 updated_at = now()
           where company_id = $1 and shared_workspace_key = $2`,
          [companyId, sharedWorkspaceKey, projectId, repository.name, repository.path, repository.url, repository.branch, isPrimary, JSON.stringify(metadata)]
        );
      } else {
        action = "created";
        const created = await client.query<{ id: string }>(
          `insert into project_workspaces
            (company_id, project_id, name, cwd, repo_url, repo_ref, default_ref, metadata, is_primary, source_type, shared_workspace_key)
           values ($1, $2, $3, $4, $5, $6, $6, $7::jsonb, $8, 'zero_human_repository', $9)
           returning id`,
          [companyId, projectId, repository.name, repository.path, repository.url, repository.branch, JSON.stringify(metadata), isPrimary, sharedWorkspaceKey]
        );
        workspaceId = created.rows[0].id;
      }
      if (isPrimary) {
        await client.query("update project_workspaces set is_primary = false where company_id = $1 and project_id = $2 and id <> $3", [
          companyId,
          projectId,
          workspaceId
        ]);
        await client.query(
          `update projects
             set execution_workspace_policy = jsonb_build_object(
                   'enabled', true,
                   'defaultMode', 'shared_workspace',
                   'defaultProjectWorkspaceId', $3::text,
                   'workspaceStrategy', jsonb_build_object('type', 'project_primary')
                 ),
                 updated_at = now()
           where company_id = $1 and id = $2`,
          [companyId, projectId, workspaceId]
        );
      }

      const tokens = repositorySearchTokens(repository);
      const linked = await client.query(
        `with recursive matched_issues as (
           select id
             from issues
            where company_id = $1
              and project_id = $2
              and exists (
                select 1 from unnest($3::text[]) token
                where lower(coalesce(title, '') || ' ' || coalesce(description, '')) like '%' || token || '%'
              )
           union
           select child.id
             from issues child
             join matched_issues parent on child.parent_id = parent.id
            where child.company_id = $1
              and child.project_id = $2
         )
         update issues
           set project_workspace_id = $4,
               execution_workspace_id = null,
               execution_workspace_preference = 'shared_workspace',
               execution_workspace_settings = jsonb_build_object('mode', 'shared_workspace'),
               updated_at = now()
         where company_id = $1
           and project_id = $2
           and (
             project_workspace_id is null
             or project_workspace_id <> $4
             or execution_workspace_preference is distinct from 'shared_workspace'
           )
           and id in (select id from matched_issues)`,
        [companyId, projectId, tokens, workspaceId]
      );
      const issueCount = linked.rowCount ?? 0;
      report.workspacesSynced += 1;
      report.issuesLinked += issueCount;
      report.details.push({
        repositoryId: repository.id,
        repositoryName: repository.name,
        workspaceId,
        path: repository.path,
        action,
        issuesLinked: issueCount
      });
    }
    await client.query("commit");
    latestPaperclipRepositorySync = report;
    return report;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    report.unavailable = true;
    report.error = (error as Error).message;
    latestPaperclipRepositorySync = report;
    return report;
  } finally {
    client.release();
  }
}

function publicPaperclipRepositorySyncReport(): PaperclipRepositorySyncReport {
  const report = latestPaperclipRepositorySync ?? {
    id: "paperclip_repositories_not_run",
    repositoriesReady: readyWorkRepositories().length,
    workspacesSynced: 0,
    issuesLinked: 0,
    unavailable: !paperclipDatabaseUrl,
    details: [],
    error: paperclipDatabaseUrl ? undefined : "PAPERCLIP_DATABASE_URL is not configured.",
    createdAt: new Date(0).toISOString()
  } satisfies PaperclipRepositorySyncReport;
  return {
    ...report,
    details: report.details.slice(0, 20)
  };
}

function loadProcessedPaperclipChatSignals(): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(paperclipChatSignalsPath, "utf8")) as { processedCommentIds?: string[] };
    return new Set(raw.processedCommentIds ?? []);
  } catch {
    return new Set();
  }
}

function saveProcessedPaperclipChatSignals(processedCommentIds: Set<string>): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    paperclipChatSignalsPath,
    JSON.stringify({ processedCommentIds: Array.from(processedCommentIds), updatedAt: new Date().toISOString() }, null, 2)
  );
}

function inferRoleFromPaperclipChat(text: string): AgentRole | null {
  const normalized = text.toLowerCase();
  const roleMatches: Array<[AgentRole, RegExp]> = [
    ["cto", /\b(cto|chief technology|technical lead|tech lead)\b/],
    ["backend", /\b(backend|api|database|server)\b/],
    ["frontend", /\b(frontend|front end|react|ui engineer|web engineer)\b/],
    ["devops", /\b(devops|deployment|docker|infra|ci\/cd|ci cd)\b/],
    ["qa", /\b(qa|tester|quality|e2e|regression)\b/],
    ["product", /\b(product manager|pm|prd|roadmap)\b/],
    ["design", /\b(designer|design|ux|ui\/ux|brand)\b/],
    ["marketing", /\b(marketing|growth|seo|campaign)\b/],
    ["support", /\b(support|customer success|cs|customer)\b/],
    ["finance", /\b(finance|budget|accounting|unit economics)\b/],
    ["operations", /\b(operations|ops|process|backoffice)\b/],
    ["research", /\b(research|market research|analyst)\b/],
    ["legal", /\b(legal|license|privacy|compliance)\b/]
  ];
  return roleMatches.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}

function extractPaperclipHiringSignal(body: string): { role: AgentRole; reason: string } | null {
  const normalized = body.toLowerCase();
  const explicitHiringIntent =
    /\b(hire|hiring|add|create|butuh|tambah)\s+(a\s+|an\s+|the\s+)?[a-z ]{0,40}\b(agent|role|engineer|designer|marketer|manager|cto)\b/.test(normalized) ||
    /\b(no|missing|need|needs|needed)\s+(a\s+|an\s+|the\s+)?[a-z ]{0,40}\b(agent|role|engineer|designer|marketer|manager|cto)\b/.test(normalized) ||
    /\b(cto|designer|marketer|backend engineer|frontend engineer|qa engineer|devops engineer)\s+(agent\s+)?(is\s+)?(missing|needed|required|pending approval)\b/.test(normalized) ||
    /\b(hire request|hiring request|approval to hire)\b/.test(normalized);
  const role = inferRoleFromPaperclipChat(normalized);
  if (!explicitHiringIntent) return null;
  if (!role) return null;
  return { role, reason: body.replace(/\s+/g, " ").trim().slice(0, 500) };
}

function publicPaperclipChatSignalReport(): PaperclipChatSignalReport {
  const report = latestPaperclipChatSignalReport ?? {
    id: "paperclip_chat_not_scanned",
    scanned: 0,
    detected: 0,
    createdRequests: 0,
    ensuredPaperclipAgents: 0,
    skippedDuplicates: 0,
    processedComments: loadProcessedPaperclipChatSignals().size,
    unavailable: !paperclipDatabaseUrl,
    details: [],
    error: paperclipDatabaseUrl ? undefined : "PAPERCLIP_DATABASE_URL is not configured.",
    createdAt: new Date(0).toISOString()
  } satisfies PaperclipChatSignalReport;
  return {
    ...report,
    details: report.details.slice(0, 20)
  };
}

function loadPaperclipHermesInterventionState(): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(paperclipHermesInterventionsPath, "utf8")) as { lastIntervenedAt?: Record<string, string> };
    return raw.lastIntervenedAt ?? {};
  } catch {
    return {};
  }
}

function savePaperclipHermesInterventionState(lastIntervenedAt: Record<string, string>): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    paperclipHermesInterventionsPath,
    JSON.stringify({ lastIntervenedAt, updatedAt: new Date().toISOString() }, null, 2)
  );
}

function hermesInterventionCooldownMs(trigger: PaperclipHermesInterventionTrigger): number {
  if (trigger === "high_churn") return 45 * 60 * 1000;
  if (trigger === "stale_in_progress") return 30 * 60 * 1000;
  return 20 * 60 * 1000;
}

function isPaperclipRecoveryIssueTitle(title: string): boolean {
  return /^(Recover missing next step|Review productivity|Resolve checkout conflict|.+ recovery audit)/i.test(title.trim());
}

function publicPaperclipHermesInterventionReport(): PaperclipHermesInterventionReport {
  const report = latestPaperclipHermesInterventionReport ?? {
    id: "paperclip_hermes_interventions_not_run",
    scanned: 0,
    intervened: 0,
    skippedCooldown: 0,
    wakeupsQueued: 0,
    memoryNotesWritten: 0,
    unavailable: !paperclipDatabaseUrl,
    details: [],
    error: paperclipDatabaseUrl ? undefined : "PAPERCLIP_DATABASE_URL is not configured.",
    createdAt: new Date(0).toISOString()
  } satisfies PaperclipHermesInterventionReport;
  return {
    ...report,
    details: report.details.slice(0, 20)
  };
}

function choosePaperclipHermesTrigger(row: {
  status: string;
  run_status: string | null;
  run_error: string | null;
  error_code: string | null;
  liveness_state: string | null;
  liveness_reason: string | null;
  failed_runs_hour: number;
  agent_comments_hour: number;
  missing_disposition: boolean;
  updated_at: string;
}): PaperclipHermesInterventionTrigger | null {
  if (row.missing_disposition) return "missing_disposition";
  if (row.status === "blocked") return "blocked_issue";
  if (["failed", "error"].includes(row.run_status ?? "") || row.run_error || row.error_code) return "failed_run";
  if (row.failed_runs_hour >= 3 || row.agent_comments_hour >= 8) return "high_churn";
  const updatedAt = new Date(row.updated_at).getTime();
  if (row.status === "in_progress" && Number.isFinite(updatedAt) && Date.now() - updatedAt > 10 * 60 * 1000) return "stale_in_progress";
  return null;
}

function paperclipHermesGuidance(input: {
  issueKey: string;
  title: string;
  status: string;
  trigger: PaperclipHermesInterventionTrigger;
  assignee?: string | null;
  runStatus?: string | null;
  livenessReason?: string | null;
  nextAction?: string | null;
}): string {
  const reasonLine = input.livenessReason || input.nextAction || input.runStatus || input.status;
  const triggerGuidance: Record<PaperclipHermesInterventionTrigger, string> = {
    blocked_issue: "Blocked is an escalation state, not a stopping state. Diagnose the blocker, then fix it, delegate it, hire/request the missing role, or ask the owner one concrete decision.",
    missing_disposition: "The run finished without a valid disposition. Add a concrete disposition now: done, in_review, delegated, blocked with unblocker, or cancelled.",
    failed_run: "Do not retry the same broad prompt. Read the failing run evidence, narrow the next command, and either repair the config/code or delegate to the role that can.",
    high_churn: "This issue is showing churn. Stop broad exploration, summarize known facts, pick the smallest next action, and create a child issue if another role is needed.",
    stale_in_progress: "The issue has been in progress without fresh movement. Reconfirm the current workspace and next action, then produce an artifact, delegation, or explicit blocker."
  };
  return [
    "ZH_HERMES_INTERVENTION",
    "",
    `Issue: ${input.issueKey} - ${input.title}`,
    `Trigger: ${input.trigger}`,
    `Assignee: ${input.assignee ?? "unassigned"}`,
    `Observed: ${reasonLine}`,
    "",
    triggerGuidance[input.trigger],
    "",
    "Required next response:",
    "- State the smallest verified fact you checked.",
    "- Take one concrete action: create/update artifact, delegate child issue, request/hire the missing role, or ask one owner decision.",
    "- Before stopping, set the Paperclip issue disposition/status explicitly: done, in_review, delegated, blocked with a named unblocker, or cancelled.",
    "- If repository code changed, verify, commit, and push to `origin HEAD:staging`; if push fails, block with the exact git error.",
    "- Finish with `ZH_OUTCOME` including status, summary, files/artifacts, git_push, skills_used, and next.",
    "",
    "Hermes memory and Zero-Human role/MCP guidance are available in this agent's skills. Use them before broad repo scans."
  ].join("\n");
}

async function scanPaperclipHermesInterventions(): Promise<PaperclipHermesInterventionReport> {
  const report: PaperclipHermesInterventionReport = {
    id: `paperclip_hermes_live_${nanoid(8)}`,
    scanned: 0,
    intervened: 0,
    skippedCooldown: 0,
    wakeupsQueued: 0,
    memoryNotesWritten: 0,
    unavailable: false,
    details: [],
    createdAt: new Date().toISOString()
  };
  if (!paperclipDatabaseUrl) {
    report.unavailable = true;
    report.error = "PAPERCLIP_DATABASE_URL is not configured.";
    latestPaperclipHermesInterventionReport = report;
    return report;
  }
  const state = loadPaperclipHermesInterventionState();
  const client = await getPaperclipPool().connect();
  try {
    const companyId = await resolvePaperclipCompanyId(client);
    report.companyId = companyId;
    const candidates = await client.query<{
      issue_id: string;
      issue_key: string;
      title: string;
      status: string;
      priority: string;
      updated_at: string;
      assignee_agent_id: string | null;
      assignee_name: string | null;
      assignee_role: string | null;
      run_status: string | null;
      run_error: string | null;
      error_code: string | null;
      liveness_state: string | null;
      liveness_reason: string | null;
      next_action: string | null;
      failed_runs_hour: number;
      agent_comments_hour: number;
      missing_disposition: boolean;
      recent_hermes_intervention: boolean;
    }>(
      `with issue_signals as (
         select i.id::text as issue_id,
                coalesce(i.identifier, 'issue-' || i.issue_number::text, i.id::text) as issue_key,
                i.title,
                i.status,
                i.priority,
                i.updated_at::text as updated_at,
                i.assignee_agent_id::text as assignee_agent_id,
                a.name as assignee_name,
                a.role as assignee_role,
                hr.status as run_status,
                hr.error as run_error,
                hr.error_code,
                hr.liveness_state,
                hr.liveness_reason,
                hr.next_action,
                (select count(*)::int
                   from heartbeat_runs r
                  where r.company_id = i.company_id
                    and r.agent_id = i.assignee_agent_id
                    and r.created_at > now() - interval '1 hour'
                    and (r.status in ('failed', 'error') or coalesce(r.exit_code, 0) <> 0 or r.error is not null)) as failed_runs_hour,
                (select count(*)::int
                   from issue_comments c
                  where c.company_id = i.company_id
                    and c.issue_id = i.id
                    and c.author_agent_id = i.assignee_agent_id
                    and c.created_at > now() - interval '1 hour') as agent_comments_hour,
                exists (
                  select 1
                    from issue_comments c
                   where c.company_id = i.company_id
                     and c.issue_id = i.id
                     and c.author_type = 'system'
                     and c.body ilike '%MISSING ISSUE DISPOSITION%'
                     and c.created_at > now() - interval '6 hours'
                ) as missing_disposition,
                exists (
                  select 1
                    from issue_comments c
                   where c.company_id = i.company_id
                     and c.issue_id = i.id
                     and c.metadata->>'source' = 'zero-human-hermes-live-brain'
                     and c.created_at > now() - interval '2 hours'
                ) as recent_hermes_intervention
           from issues i
           left join agents a on a.id = i.assignee_agent_id
           left join heartbeat_runs hr on hr.id = i.execution_run_id
          where i.company_id = $1
            and i.hidden_at is null
            and i.status not in ('done', 'cancelled')
            and i.title !~* '^(Recover missing next step|Review productivity|Resolve checkout conflict|.+ recovery audit)'
       )
       select *
         from issue_signals
        where status = 'blocked'
           or missing_disposition
           or run_status in ('failed', 'error')
           or run_error is not null
           or error_code is not null
           or failed_runs_hour >= 3
           or agent_comments_hour >= 8
           or (status = 'in_progress' and updated_at::timestamptz < now() - interval '10 minutes')
        order by
          case priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
          updated_at::timestamptz desc
        limit 25`,
      [companyId]
    );
    report.scanned = candidates.rows.length;
    let interventionsThisScan = 0;
    for (const row of candidates.rows) {
      const trigger = choosePaperclipHermesTrigger(row);
      if (!trigger) continue;
      if (isPaperclipRecoveryIssueTitle(row.title)) {
        report.details.push({
          issueId: row.issue_id,
          issueKey: row.issue_key,
          title: row.title,
          trigger,
          action: "ignored",
          assignee: row.assignee_name ?? undefined,
          reason: "Skipped Paperclip recovery/meta issue to avoid recovery loops."
        });
        continue;
      }
      const stateKey = `${row.issue_id}:${trigger}`;
      const last = state[stateKey] ? new Date(state[stateKey]).getTime() : 0;
      if (row.recent_hermes_intervention || (last && Date.now() - last < hermesInterventionCooldownMs(trigger))) {
        report.skippedCooldown += 1;
        report.details.push({
          issueId: row.issue_id,
          issueKey: row.issue_key,
          title: row.title,
          trigger,
          action: "cooldown_skipped",
          assignee: row.assignee_name ?? undefined,
          reason: row.recent_hermes_intervention
            ? "Hermes already left live-brain guidance recently in Paperclip."
            : "Hermes already intervened recently for this trigger."
        });
        continue;
      }
      if (interventionsThisScan >= 3) {
        report.details.push({
          issueId: row.issue_id,
          issueKey: row.issue_key,
          title: row.title,
          trigger,
          action: "ignored",
          assignee: row.assignee_name ?? undefined,
          reason: "Scan intervention cap reached; this issue can be handled by the next cycle."
        });
        continue;
      }
      const body = paperclipHermesGuidance({
        issueKey: row.issue_key,
        title: row.title,
        status: row.status,
        trigger,
        assignee: row.assignee_name,
        runStatus: row.run_status,
        livenessReason: row.liveness_reason,
        nextAction: row.next_action
      });
      const metadata = {
        source: "zero-human-hermes-live-brain",
        trigger,
        reportId: report.id,
        createdAt: report.createdAt
      };
      await client.query(
        "insert into issue_comments (company_id, issue_id, body, author_type, metadata) values ($1, $2, $3, 'system', $4::jsonb)",
        [companyId, row.issue_id, body, JSON.stringify(metadata)]
      );
      let wokeAgent = false;
      const shouldWakeAgent = row.assignee_agent_id && trigger !== "blocked_issue" && trigger !== "missing_disposition";
      if (shouldWakeAgent) {
        const idempotencyKey = `zh-hermes:${row.issue_id}:${trigger}:${Math.floor(Date.now() / hermesInterventionCooldownMs(trigger))}`;
        const wake = await client.query(
          `insert into agent_wakeup_requests
             (company_id, agent_id, source, trigger_detail, reason, payload, status, requested_by_actor_type, requested_by_actor_id, idempotency_key)
           select $1, $2, 'zero_human_hermes_live_brain', $3, $4, $5::jsonb, 'queued', 'system', 'zero-human-hermes', $6
            where not exists (
              select 1 from agent_wakeup_requests
               where company_id = $1
                 and agent_id = $2
                 and idempotency_key = $6
                 and status in ('queued', 'claimed')
            )`,
          [
            companyId,
            row.assignee_agent_id,
            `${trigger} on ${row.issue_key}`,
            `Hermes intervention queued for ${row.issue_key}: ${trigger}`,
            JSON.stringify({ issueId: row.issue_id, issueKey: row.issue_key, trigger, guidance: body }),
            idempotencyKey
          ]
        );
        wokeAgent = (wake.rowCount ?? 0) > 0;
        if (wokeAgent) report.wakeupsQueued += 1;
      }
      state[stateKey] = report.createdAt;
      report.intervened += 1;
      interventionsThisScan += 1;
      if (await rememberInHermes("zero_human_owner", `Hermes live brain intervened on ${row.issue_key} (${trigger}) assigned to ${row.assignee_name ?? "unassigned"}.`)) {
        report.memoryNotesWritten += 1;
      }
      report.details.push({
        issueId: row.issue_id,
        issueKey: row.issue_key,
        title: row.title,
        trigger,
        action: wokeAgent ? "commented_and_woke_agent" : "commented",
        assignee: row.assignee_name ?? undefined,
        reason: `Inserted Hermes guidance${wokeAgent ? " and queued assignee wakeup" : ""}.`
      });
    }
    savePaperclipHermesInterventionState(state);
    latestPaperclipHermesInterventionReport = report;
    return report;
  } catch (error) {
    report.unavailable = true;
    report.error = (error as Error).message;
    latestPaperclipHermesInterventionReport = report;
    return report;
  } finally {
    client.release();
  }
}

async function scanPaperclipChatSignals(): Promise<PaperclipChatSignalReport> {
  const processedCommentIds = loadProcessedPaperclipChatSignals();
  const report: PaperclipChatSignalReport = {
    id: `paperclip_chat_${nanoid(8)}`,
    scanned: 0,
    detected: 0,
    createdRequests: 0,
    ensuredPaperclipAgents: 0,
    skippedDuplicates: 0,
    processedComments: processedCommentIds.size,
    unavailable: false,
    details: [],
    createdAt: new Date().toISOString()
  };
  if (!paperclipDatabaseUrl) {
    report.unavailable = true;
    report.error = "PAPERCLIP_DATABASE_URL is not configured.";
    latestPaperclipChatSignalReport = report;
    return report;
  }
  const client = await getPaperclipPool().connect();
  try {
    const companyId = await resolvePaperclipCompanyId(client);
    report.companyId = companyId;
    const comments = await client.query<{
      comment_id: string;
      issue_key: string;
      issue_title: string;
      body: string;
      agent_name: string | null;
    }>(
      `select c.id::text as comment_id,
              coalesce(i.identifier, 'issue-' || i.issue_number::text, i.id::text) as issue_key,
              i.title as issue_title,
              c.body,
              a.name as agent_name
         from issue_comments c
         join issues i on i.id = c.issue_id
         left join agents a on a.id = c.author_agent_id
        where c.company_id = $1
          and c.author_agent_id is not null
          and c.body is not null
        order by c.created_at desc
        limit 250`,
      [companyId]
    );
    report.scanned = comments.rows.length;
    for (const comment of comments.rows.reverse()) {
      if (processedCommentIds.has(comment.comment_id)) continue;
      const signal = extractPaperclipHiringSignal(comment.body);
      if (!signal) continue;
      report.detected += 1;
      const wantsAdditionalAgent = /\b(another|additional|second|extra|more|tambahan|lagi)\b/i.test(comment.body);
      const existingRoleAgent = Array.from(agents.values()).find((agent) => agent.role === signal.role);
      if (existingRoleAgent && !wantsAdditionalAgent) {
        const ensured = await ensurePaperclipAgentForZeroHumanAgent(
          client,
          companyId,
          existingRoleAgent,
          report.createdAt,
          `Paperclip chat requested ${signal.role}: ${signal.reason}`
        );
        if (ensured.created) report.ensuredPaperclipAgents += 1;
        processedCommentIds.add(comment.comment_id);
        report.details.push({
          commentId: comment.comment_id,
          issueKey: comment.issue_key,
          issueTitle: comment.issue_title,
          agentName: comment.agent_name ?? undefined,
          role: signal.role,
          action: ensured.created ? "paperclip_agent_created" : "paperclip_agent_exists",
          reason: ensured.created
            ? `${existingRoleAgent.id} already exists in Zero-Human and has now been created in Paperclip.`
            : `${existingRoleAgent.id} already exists in Zero-Human and Paperclip as ${ensured.name}.`,
          paperclipAgentId: ensured.id
        });
        continue;
      }
      const alreadyRequested = Array.from(hiringRequests.values()).some((request) =>
        request.source === "paperclip" &&
        request.status === "pending_approval" &&
        (request.description?.includes(comment.comment_id) || request.suggestedRole === signal.role)
      );
      processedCommentIds.add(comment.comment_id);
      if (alreadyRequested) {
        report.skippedDuplicates += 1;
        report.details.push({
          commentId: comment.comment_id,
          issueKey: comment.issue_key,
          issueTitle: comment.issue_title,
          agentName: comment.agent_name ?? undefined,
          role: signal.role,
          action: "duplicate_skipped",
          reason: "A matching Paperclip hiring request is already pending."
        });
        continue;
      }
      const now = new Date().toISOString();
      const mapped = mapHireRequest({
        title: `${signal.role.toUpperCase()} requested from Paperclip chat`,
        department: signal.role,
        requestedRole: signal.role,
        description: [
          `Paperclip ${comment.issue_key}: ${comment.issue_title}`,
          `Agent: ${comment.agent_name ?? "unknown"}`,
          `Signal: ${signal.reason}`,
          `Paperclip comment: ${comment.comment_id}`
        ].join("\n")
      });
      const request: HiringRequest = {
        id: `hire_${nanoid(8)}`,
        source: "paperclip",
        status: "pending_approval",
        createdAt: now,
        updatedAt: now,
        ...mapped
      };
      hiringRequests.set(request.id, request);
      report.createdRequests += 1;
      report.details.push({
        commentId: comment.comment_id,
        issueKey: comment.issue_key,
        issueTitle: comment.issue_title,
        agentName: comment.agent_name ?? undefined,
        role: signal.role,
        action: "hiring_request_created",
        reason: signal.reason,
        hiringRequestId: request.id
      });
    }
    report.processedComments = processedCommentIds.size;
    saveProcessedPaperclipChatSignals(processedCommentIds);
    if (report.createdRequests > 0) saveHiringRequests();
    latestPaperclipChatSignalReport = report;
    return report;
  } catch (error) {
    report.unavailable = true;
    report.error = (error as Error).message;
    latestPaperclipChatSignalReport = report;
    return report;
  } finally {
    client.release();
  }
}

function saveCustomSkills(): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(customSkillsPath, JSON.stringify(customSkillRegistry, null, 2));
}

loadBudgetOverrides();

function sanitizeRepositoryId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || `repo-${nanoid(6)}`;
}

function defaultRepository(): RegisteredRepository {
  return {
    id: "default",
    name: "Zero Human Monorepo",
    url: hostRepoPath,
    branch: "main",
    path: sourceRepoPath,
    sourceKind: "work",
    status: "ready",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

function loadRepositories(): Map<string, RegisteredRepository> {
  try {
    const raw = JSON.parse(fs.readFileSync(repositoriesPath, "utf8")) as RegisteredRepository[];
    return new Map(raw.filter((repo) => repo.id !== "default").map((repo) => [repo.id, repo]));
  } catch {
    return new Map();
  }
}

const repositories = loadRepositories();

function saveRepositories(): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(repositoriesPath, JSON.stringify(Array.from(repositories.values()), null, 2));
}

function publicRepository(repository: RegisteredRepository): PublicRepository {
  const { token: _token, sshPrivateKey: _sshPrivateKey, sshPassphrase: _sshPassphrase, ...safeRepository } = repository;
  return safeRepository;
}

function listRepositories(): PublicRepository[] {
  return [defaultRepository(), ...Array.from(repositories.values()).sort((a, b) => a.name.localeCompare(b.name))].map(publicRepository);
}

function getRepository(repositoryId?: string): RegisteredRepository {
  if (!repositoryId || repositoryId === "default") return defaultRepository();
  const repository = repositories.get(repositoryId);
  if (!repository) throw new Error(`Repository ${repositoryId} is not registered`);
  return repository;
}

function isCloneableRepositoryUrl(value: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/i.test(value.trim());
}

const roleSkillCatalog: Record<Agent["role"], string[]> = {
  cto: ["architecture", "system_design", "technical_strategy", "code_review"],
  frontend: ["ui_implementation", "react", "accessibility", "state_management"],
  backend: ["api_design", "database", "integration", "testing"],
  qa: ["test_planning", "regression_testing", "e2e_validation", "risk_analysis"],
  devops: ["docker", "ci_cd", "deployment", "health_checks"],
  product: ["product_strategy", "prd_writing", "roadmap_planning"],
  design: ["design_system", "ux_research", "visual_design"],
  marketing: ["content_strategy", "campaign_planning", "seo"],
  sales: ["sales_enablement", "proposal_writing", "customer_discovery"],
  support: ["support_triage", "customer_docs", "feedback_analysis"],
  finance: ["budget_tracking", "vendor_analysis", "unit_economics"],
  operations: ["process_design", "vendor_analysis", "budget_tracking"],
  research: ["feedback_analysis", "market_research", "competitive_analysis"],
  legal: ["legal_review", "privacy_review", "license_review"]
};

const taskSkillCatalog: Record<TaskType, string[]> = {
  architecture: ["architecture", "system_design", "technical_strategy"],
  coding: ["implementation", "code_editing", "repository_navigation"],
  review: ["code_review", "risk_analysis", "test_gap_analysis"],
  test: ["testing", "test_automation", "regression_testing"],
  deploy: ["deployment", "ci_cd", "release_validation"]
};

const highRiskIssueKeywords = [
  "deploy",
  "release",
  "production",
  "payment",
  "billing",
  "invoice",
  "security",
  "secret",
  "credential",
  "delete",
  "drop",
  "migration",
  "privacy",
  "legal",
  "token",
  "ssh key"
];

const triageIssueKeywords = [
  "unclear",
  "unknown",
  "investigate",
  "research",
  "follow up",
  "customer",
  "complaint",
  "priority"
];

const defaultIssuePolicies: Record<AgentRole, AgentIssuePolicy> = {
  cto: {
    role: "cto",
    canCreateIssue: true,
    autoAssign: true,
    allowedTaskTypes: ["architecture", "coding", "review", "test", "deploy"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 2,
    defaultDecision: "auto_assign",
    note: "CTO may create and route engineering issues, but high-risk work still requires owner review."
  },
  frontend: {
    role: "frontend",
    canCreateIssue: true,
    autoAssign: false,
    allowedTaskTypes: ["coding", "review", "test"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 2,
    defaultDecision: "triage",
    note: "Frontend agents may create implementation and QA follow-up issues; routing stays triaged."
  },
  backend: {
    role: "backend",
    canCreateIssue: true,
    autoAssign: false,
    allowedTaskTypes: ["coding", "review", "test"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 2,
    defaultDecision: "triage",
    note: "Backend agents may raise code, API, and database issues; migrations require approval."
  },
  qa: {
    role: "qa",
    canCreateIssue: true,
    autoAssign: false,
    allowedTaskTypes: ["review", "test"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 2,
    defaultDecision: "triage",
    note: "QA agents create bug and validation issues; execution is assigned after triage."
  },
  devops: {
    role: "devops",
    canCreateIssue: true,
    autoAssign: false,
    allowedTaskTypes: ["review", "test", "deploy"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 1,
    defaultDecision: "approval_required",
    note: "DevOps can raise infrastructure work, but deploy and production changes need approval."
  },
  product: {
    role: "product",
    canCreateIssue: true,
    autoAssign: true,
    allowedTaskTypes: ["architecture", "review", "test"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 2,
    defaultDecision: "auto_assign",
    note: "Product can convert roadmap and customer needs into Paperclip issues."
  },
  design: {
    role: "design",
    canCreateIssue: true,
    autoAssign: false,
    allowedTaskTypes: ["architecture", "review"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 2,
    defaultDecision: "triage",
    note: "Design can open UX and brand work, then route to product or frontend."
  },
  marketing: {
    role: "marketing",
    canCreateIssue: true,
    autoAssign: false,
    allowedTaskTypes: ["architecture", "review"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 2,
    defaultDecision: "triage",
    note: "Marketing can create campaign and content issues; engineering work is triaged."
  },
  sales: {
    role: "sales",
    canCreateIssue: true,
    autoAssign: false,
    allowedTaskTypes: ["architecture", "review"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 2,
    defaultDecision: "triage",
    note: "Sales can raise customer opportunity and proposal issues."
  },
  support: {
    role: "support",
    canCreateIssue: true,
    autoAssign: false,
    allowedTaskTypes: ["review", "test"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 2,
    defaultDecision: "triage",
    note: "Support can create bug reports and customer follow-ups for triage."
  },
  finance: {
    role: "finance",
    canCreateIssue: true,
    autoAssign: false,
    allowedTaskTypes: ["architecture", "review"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 1,
    defaultDecision: "approval_required",
    note: "Finance can raise budget and vendor issues; spending changes require approval."
  },
  operations: {
    role: "operations",
    canCreateIssue: true,
    autoAssign: false,
    allowedTaskTypes: ["architecture", "review", "test"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 2,
    defaultDecision: "triage",
    note: "Operations can create process and backoffice issues."
  },
  research: {
    role: "research",
    canCreateIssue: true,
    autoAssign: false,
    allowedTaskTypes: ["architecture", "review"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 2,
    defaultDecision: "triage",
    note: "Research can create discovery issues that feed product and technical planning."
  },
  legal: {
    role: "legal",
    canCreateIssue: true,
    autoAssign: false,
    allowedTaskTypes: ["review"],
    approvalKeywords: highRiskIssueKeywords,
    triageKeywords: triageIssueKeywords,
    maxPriorityWithoutApproval: 1,
    defaultDecision: "approval_required",
    note: "Legal can create review issues; execution requires human approval."
  }
};

function loadIssuePolicies(): Map<AgentRole, AgentIssuePolicy> {
  try {
    const raw = JSON.parse(fs.readFileSync(issuePoliciesPath, "utf8")) as AgentIssuePolicy[];
    return new Map(raw.map((policy) => [policy.role, { ...defaultIssuePolicies[policy.role], ...policy }]));
  } catch {
    return new Map(Object.values(defaultIssuePolicies).map((policy) => [policy.role, policy]));
  }
}

const issuePolicies = loadIssuePolicies();

function saveIssuePolicies(): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(issuePoliciesPath, JSON.stringify(Array.from(issuePolicies.values()), null, 2));
}

function publicIssuePolicies(): AgentIssuePolicy[] {
  return Array.from(issuePolicies.values()).sort((a, b) => a.role.localeCompare(b.role));
}

function inferIssueTaskType(title: string, description: string, requestedType?: TaskType): TaskType {
  if (requestedType) return requestedType;
  const text = `${title} ${description}`.toLowerCase();
  if (/\b(deploy|release|container|docker|ci|staging|production)\b/.test(text)) return "deploy";
  if (/\b(test|qa|e2e|regression|validate|bug)\b/.test(text)) return "test";
  if (/\b(review|audit|security|risk|legal)\b/.test(text)) return "review";
  if (/\b(plan|architecture|roadmap|prd|design)\b/.test(text)) return "architecture";
  return "coding";
}

function evaluateAgentIssuePolicy(input: {
  agentId: string;
  title: string;
  description?: string;
  type?: TaskType;
  priority?: 1 | 2 | 3;
}): AgentIssuePolicyEvaluation {
  const agent = agents.get(input.agentId);
  if (!agent) throw new Error(`Unknown agent ${input.agentId}`);
  const policy = issuePolicies.get(agent.role) ?? defaultIssuePolicies[agent.role];
  const title = input.title.trim();
  const description = input.description?.trim() ?? "";
  const type = inferIssueTaskType(title, description, input.type);
  const priority = input.priority ?? 2;
  const lowered = `${title} ${description}`.toLowerCase();
  const highRiskHit = policy.approvalKeywords.find((keyword) => lowered.includes(keyword.toLowerCase()));
  const triageHit = policy.triageKeywords.find((keyword) => lowered.includes(keyword.toLowerCase()));

  if (!policy.canCreateIssue) {
    return {
      agentId: agent.id,
      role: agent.role,
      decision: "blocked",
      reason: "This role is not allowed to create issues.",
      suggestedTaskType: type,
      suggestedAssignee: agent.id,
      requiresHumanReview: true
    };
  }
  if (!policy.allowedTaskTypes.includes(type)) {
    return {
      agentId: agent.id,
      role: agent.role,
      decision: "triage",
      reason: `${agent.role} can create issues, but ${type} needs routing by owner/CEO/PM.`,
      suggestedTaskType: type,
      suggestedAssignee: agent.id,
      requiresHumanReview: true
    };
  }
  if (highRiskHit || priority > policy.maxPriorityWithoutApproval) {
    return {
      agentId: agent.id,
      role: agent.role,
      decision: "approval_required",
      reason: highRiskHit ? `Matched high-risk keyword '${highRiskHit}'.` : `Priority P${priority} exceeds this role approval limit.`,
      suggestedTaskType: type,
      suggestedAssignee: agent.id,
      requiresHumanReview: true
    };
  }
  if (triageHit || !policy.autoAssign) {
    return {
      agentId: agent.id,
      role: agent.role,
      decision: "triage",
      reason: triageHit ? `Matched triage keyword '${triageHit}'.` : "This role creates issues into triage by default.",
      suggestedTaskType: type,
      suggestedAssignee: agent.id,
      requiresHumanReview: true
    };
  }
  return {
    agentId: agent.id,
    role: agent.role,
    decision: policy.defaultDecision,
    reason: policy.note,
    suggestedTaskType: type,
    suggestedAssignee: agent.id,
    requiresHumanReview: policy.defaultDecision !== "auto_assign"
  };
}

function loadHiringRequests(): Map<string, HiringRequest> {
  try {
    const raw = JSON.parse(fs.readFileSync(hiringRequestsPath, "utf8")) as HiringRequest[];
    return new Map(raw.map((request) => [request.id, request]));
  } catch {
    return new Map();
  }
}

const hiringRequests = loadHiringRequests();

function saveHiringRequests(): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(hiringRequestsPath, JSON.stringify(Array.from(hiringRequests.values()), null, 2));
}

function sanitizeAgentId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_ -]+/g, "").replace(/\s+/g, "_").replace(/-+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || `agent_${nanoid(6)}`;
}

function ascii(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value: string): string {
  return ascii(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

function parseSkillFrontmatter(raw: string): { name?: string; description?: string; category?: string; tags: string[]; tools: string[] } {
  const meta = { tags: [] as string[], tools: [] as string[] };
  if (!raw.startsWith("---")) {
    return {
      ...meta,
      name: raw.match(/^#\s+(.+)$/m)?.[1],
      description: raw.match(/^>\s*(.+)$/m)?.[1]
    };
  }
  const end = raw.indexOf("\n---", 3);
  const text = end === -1 ? "" : raw.slice(3, end);
  const arrayValue = (key: string) => {
    const match = text.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]`, "m"));
    return match?.[1]?.split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean) ?? [];
  };
  return {
    name: text.match(/^name:\s*["']?([^"'\n]+)["']?/m)?.[1] ?? raw.match(/^#\s+(.+)$/m)?.[1],
    description: text.match(/^description:\s*["']?([^"'\n]+)["']?/m)?.[1],
    category: text.match(/^category:\s*["']?([^"'\n]+)["']?/m)?.[1],
    tags: arrayValue("tags"),
    tools: arrayValue("requires_toolsets")
  };
}

const skillCategoryRules: Array<[RegExp, string]> = [
  [/frontend|react|web|ui|ux|component|css|html|browser/, "web-development"],
  [/design|figma|brand|creative|image|video|presentation|slide/, "creative"],
  [/docker|kubernetes|deploy|ci|cloud|server|infra|terminal|shell/, "devops"],
  [/security|auth|secret|credential|password|privacy|license|legal/, "security"],
  [/marketing|seo|content|campaign|growth|sales|crm/, "marketing"],
  [/finance|billing|payment|invoice|accounting|budget/, "finance"],
  [/research|search|crawl|scrape|analysis|paper|data/, "research"],
  [/test|qa|validation|playwright|e2e/, "qa"],
  [/product|roadmap|prd|spec|planning|strategy/, "product"],
  [/support|docs|customer|ticket|feedback/, "support"]
];

const skillRoleRules: Array<[RegExp, AgentRole[]]> = [
  [/android|kotlin|mobile|react native|flutter|ios|swift/, ["frontend", "backend", "qa", "cto"]],
  [/frontend|react|web|ui|ux|css|browser|accessibility/, ["frontend", "design", "qa"]],
  [/design|figma|brand|creative|image|video/, ["design", "marketing", "product"]],
  [/backend|api|database|server|integration|sdk/, ["backend", "cto", "qa"]],
  [/docker|kubernetes|deploy|ci|infra|terminal|shell/, ["devops", "backend", "cto"]],
  [/security|auth|secret|credential|password|privacy|license|legal/, ["legal", "devops", "cto"]],
  [/marketing|seo|content|campaign|growth/, ["marketing", "sales", "product"]],
  [/sales|crm|proposal|customer/, ["sales", "support", "marketing"]],
  [/finance|billing|payment|invoice|accounting|budget/, ["finance", "operations", "legal"]],
  [/research|search|crawl|scrape|analysis|paper|data/, ["research", "product", "marketing"]],
  [/support|docs|ticket|feedback/, ["support", "operations", "product"]]
];

const baseMcpMarketplace: McpMarketplaceItem[] = [
  {
    id: "github",
    name: "GitHub MCP",
    description: "Repository, issue, pull request, and code review tools for engineering agents.",
    category: "coding",
    packageName: "@modelcontextprotocol/server-github",
    homepage: "https://github.com/modelcontextprotocol/servers",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${secret:GITHUB_TOKEN}" },
    roles: ["cto", "backend", "frontend", "qa", "devops", "product"],
    permissions: { mode: "approval-required", requiresApproval: ["delete", "merge", "release"] },
    tags: ["repo", "issues", "pull-request", "code"]
  },
  {
    id: "filesystem",
    name: "Filesystem MCP",
    description: "Controlled file read/write access for local workspace automation.",
    category: "coding",
    packageName: "@modelcontextprotocol/server-filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/app/repositories"],
    env: {},
    roles: ["cto", "backend", "frontend", "qa", "devops", "design"],
    permissions: { mode: "approval-required", requiresApproval: ["write", "delete"] },
    tags: ["files", "workspace", "local"]
  },
  {
    id: "postgres",
    name: "Postgres MCP",
    description: "Database inspection and query execution for backend, analytics, and finance roles.",
    category: "database",
    packageName: "@modelcontextprotocol/server-postgres",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "${secret:POSTGRES_URL}"],
    env: {},
    roles: ["backend", "devops", "finance", "operations"],
    permissions: { mode: "approval-required", requiresApproval: ["write", "migration", "delete"] },
    tags: ["database", "sql", "analytics"]
  },
  {
    id: "figma",
    name: "Figma MCP",
    description: "Design file context, components, tokens, and handoff data for product design work.",
    category: "design",
    packageName: "figma-developer-mcp",
    transport: "stdio",
    command: "npx",
    args: ["-y", "figma-developer-mcp"],
    env: { FIGMA_API_KEY: "${secret:FIGMA_API_KEY}" },
    roles: ["design", "frontend", "product", "marketing"],
    permissions: { mode: "read-only", requiresApproval: [] },
    tags: ["design", "handoff", "tokens"]
  },
  {
    id: "browser",
    name: "Browser MCP",
    description: "Browser automation for QA validation, research, and UI smoke checks.",
    category: "automation",
    packageName: "@playwright/mcp",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp"],
    env: {},
    roles: ["qa", "frontend", "product", "marketing", "research"],
    permissions: { mode: "approval-required", requiresApproval: ["form-submit", "purchase", "login"] },
    tags: ["browser", "qa", "research"]
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking MCP",
    description: "Structured step-by-step reasoning tools for planning, decomposition, and difficult problem solving.",
    category: "reasoning",
    packageName: "@modelcontextprotocol/server-sequential-thinking",
    homepage: "https://github.com/modelcontextprotocol/servers",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    env: {},
    roles: Object.keys(roleSkillCatalog) as AgentRole[],
    permissions: { mode: "read-only", requiresApproval: [] },
    tags: ["thinking", "planning", "reasoning", "research"]
  },
  {
    id: "slack",
    name: "Slack MCP",
    description: "Team communication, channel search, and stakeholder updates for backoffice agents.",
    category: "backoffice",
    packageName: "@modelcontextprotocol/server-slack",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    env: { SLACK_BOT_TOKEN: "${secret:SLACK_BOT_TOKEN}", SLACK_TEAM_ID: "${secret:SLACK_TEAM_ID}" },
    roles: ["operations", "support", "marketing", "sales", "product"],
    permissions: { mode: "approval-required", requiresApproval: ["send-message", "invite", "archive"] },
    tags: ["chat", "support", "ops"]
  }
];

function loadCustomMcpMarketplace(): McpMarketplaceItem[] {
  try {
    const raw = JSON.parse(fs.readFileSync(mcpMarketplacePath, "utf8")) as McpMarketplaceItem[];
    return raw.filter((item) => item.id && item.name);
  } catch {
    return [];
  }
}

const customMcpMarketplace = new Map<string, McpMarketplaceItem>(loadCustomMcpMarketplace().map((item) => [item.id, item]));

function saveCustomMcpMarketplace(): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(mcpMarketplacePath, JSON.stringify(Array.from(customMcpMarketplace.values()), null, 2));
}

function listMcpMarketplace(): McpMarketplaceItem[] {
  const entries = new Map<string, McpMarketplaceItem>();
  for (const item of baseMcpMarketplace) entries.set(item.id, item);
  for (const item of customMcpMarketplace.values()) entries.set(item.id, item);
  return Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function loadMcpServers(): Map<string, McpServerConfig> {
  try {
    const raw = JSON.parse(fs.readFileSync(mcpRegistryPath, "utf8")) as McpServerConfig[];
    return new Map(raw.map((server) => [server.id, server]));
  } catch {
    return new Map();
  }
}

const mcpServers = loadMcpServers();

function ensureMandatoryMcpRegistry(): void {
  const item = baseMcpMarketplace.find((entry) => entry.id === "sequential-thinking");
  if (!item || mcpServers.has(item.id)) return;
  const now = new Date().toISOString();
  mcpServers.set(item.id, {
    ...item,
    status: "enabled",
    installedAt: now,
    updatedAt: now
  });
  saveMcpServers();
}

function saveMcpServers(): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(mcpRegistryPath, JSON.stringify(Array.from(mcpServers.values()), null, 2));
}

ensureMandatoryMcpRegistry();

function publicMcpServers(): McpServerConfig[] {
  return Array.from(mcpServers.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function validateMcpConfig(server: McpServerConfig): void {
  if (!server.id?.trim() || !/^[a-z0-9._-]+$/.test(server.id)) throw new Error("MCP id must use lowercase letters, numbers, dot, underscore, or dash");
  if (!server.name?.trim()) throw new Error("MCP name is required");
  if (!["stdio", "http", "sse"].includes(server.transport)) throw new Error("MCP transport must be stdio, http, or sse");
  if (server.transport === "stdio" && !server.command?.trim()) throw new Error("stdio MCP requires a command");
  if (server.transport !== "stdio" && !server.url?.trim()) throw new Error("http/sse MCP requires a URL");
  if (!Array.isArray(server.roles) || server.roles.length === 0) throw new Error("MCP must be assigned to at least one role");
  for (const role of server.roles) {
    if (!(role in roleSkillCatalog)) throw new Error(`Unknown role: ${role}`);
  }
}

function normalizeMcpMarketplaceItem(input: unknown): McpMarketplaceItem {
  const raw = input as Partial<McpMarketplaceItem> & {
    server?: Partial<McpMarketplaceItem>;
    config?: Partial<McpMarketplaceItem>;
    mcp?: Partial<McpMarketplaceItem>;
  };
  const source = { ...raw.server, ...raw.config, ...raw.mcp, ...raw };
  const id = sanitizeRepositoryId(String(source.id ?? source.name ?? source.packageName ?? `mcp-${nanoid(6)}`));
  const name = ascii(source.name ?? id.replaceAll("-", " "));
  const transport = source.transport === "http" || source.transport === "sse" ? source.transport : "stdio";
  const tags = Array.isArray(source.tags) ? source.tags.map(String).map(slug).filter(Boolean) : [];
  const roles = Array.isArray(source.roles)
    ? source.roles.filter((role): role is AgentRole => typeof role === "string" && role in roleSkillCatalog)
    : [];
  const item: McpMarketplaceItem = {
    id,
    name,
    description: ascii(source.description ?? `Custom MCP server ${name}.`),
    category: slug(source.category ?? tags[0] ?? "custom").replaceAll("_", "-"),
    packageName: source.packageName,
    homepage: source.homepage,
    transport,
    command: transport === "stdio" ? (source.command ?? "npx") : undefined,
    args: Array.isArray(source.args) ? source.args.map(String) : [],
    url: transport === "stdio" ? undefined : source.url,
    env: source.env && typeof source.env === "object" ? Object.fromEntries(Object.entries(source.env).map(([key, value]) => [key, String(value)])) : {},
    roles: roles.length ? roles : ["operations"],
    permissions: {
      mode: source.permissions?.mode ?? "approval-required",
      requiresApproval: Array.isArray(source.permissions?.requiresApproval) ? source.permissions.requiresApproval.map(String) : []
    },
    tags
  };
  validateMcpConfig({ ...item, status: "available" });
  return item;
}

function extractMcpRegistryItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  for (const key of ["items", "servers", "mcps", "marketplace", "packages"]) {
    if (Array.isArray(record?.[key])) return record[key] as unknown[];
  }
  if (record && typeof record === "object") return [record];
  return [];
}

function mcpManifestForAgent(agent: Agent): string {
  const enabled = enabledMcpServersForAgent(agent);
  if (enabled.length === 0) return "MCP tools: none assigned.";
  const rows = enabled.map((server) => {
    const toolRef = server.transport === "stdio"
      ? `${server.command} ${(server.args ?? []).join(" ")}`.trim()
      : server.url ?? "";
    return `- ${server.name} (${server.category}, ${server.permissionMode}): ${toolRef}`;
  });
  return ["MCP tools assigned to this role:", ...rows].join("\n");
}

function paperclipUrl(): string {
  return config.infrastructure.services?.hr_url?.replace(/\/$/, "") ?? "http://paperclip:3100";
}

function loadPaperclipSyncState(): PaperclipSyncState {
  try {
    const raw = JSON.parse(fs.readFileSync(paperclipSyncPath, "utf8")) as Partial<PaperclipSyncState>;
    return {
      paperclipUrl: raw.paperclipUrl ?? paperclipUrl(),
      updatedAt: raw.updatedAt ?? new Date(0).toISOString(),
      records: Array.isArray(raw.records) ? raw.records as PaperclipAgentSyncRecord[] : []
    };
  } catch {
    return {
      paperclipUrl: paperclipUrl(),
      updatedAt: new Date(0).toISOString(),
      records: []
    };
  }
}

function emptyPaperclipSyncState(): PaperclipSyncState {
  return {
    paperclipUrl: paperclipUrl(),
    updatedAt: new Date().toISOString(),
    records: []
  };
}

function savePaperclipSyncState(state: PaperclipSyncState): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(paperclipSyncPath, JSON.stringify(state, null, 2));
}

function resetPaperclipSyncState(): PaperclipSyncState {
  const state = emptyPaperclipSyncState();
  savePaperclipSyncState(state);
  return state;
}

function desiredSkillsForAgentProfile(agent: Agent): string[] {
  const registrySkills = Object.entries(activeSkillRegistry())
    .filter(([, definition]) => definition.roles.includes(agent.role))
    .map(([skill]) => skill);
  return Array.from(new Set([
    ...roleSkillCatalog[agent.role],
    ...agent.skills,
    ...registrySkills
  ])).sort();
}

function searchableWords(value: string): Set<string> {
  const expanded = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .toLowerCase();
  return new Set(expanded.split(/\W+/).filter((word) => word.length >= 3));
}

function paperclipAgentSkillContext(row: { name: string; role: string; title?: string | null }, agent?: Agent): Set<string> {
  return searchableWords([
    row.name,
    row.role,
    row.title ?? "",
    agent?.id ?? "",
    agent?.role ?? "",
    ...(agent?.skills ?? [])
  ].join(" "));
}

function registrySkillsForPaperclipAgent(row: { name: string; role: string; title?: string | null }, agent?: Agent): string[] {
  const context = paperclipAgentSkillContext(row, agent);
  const matched = Object.entries(activeSkillRegistry()).filter(([skillId, definition]) => {
    if (agent && definition.roles.includes(agent.role)) return true;
    const searchable = searchableWords([
      skillId,
      definition.category,
      definition.description,
      definition.sourcePath ?? "",
      ...(definition.triggers ?? []),
      ...(definition.tools ?? [])
    ].join(" "));
    for (const word of context) {
      if (searchable.has(word)) return true;
    }
    for (const word of searchable) {
      if (context.has(word)) return true;
    }
    return false;
  });
  return matched.map(([skillId]) => skillId).sort();
}

function desiredSkillIdsForPaperclipAgent(row: { name: string; role: string; title?: string | null }, agent?: Agent): string[] {
  const roleSkills = agent ? desiredSkillsForAgentProfile(agent) : [];
  return Array.from(new Set([
    ...roleSkills,
    ...registrySkillsForPaperclipAgent(row, agent)
  ])).sort();
}

function enabledMcpForAgent(agent: Agent): PaperclipAgentSyncRecord["desiredMcpServers"] {
  return enabledMcpServersForAgent(agent)
    .map((server) => ({
      id: server.id,
      name: server.name,
      transport: server.transport,
      permissionMode: server.permissionMode
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function paperclipRunbook(agent: Agent, skills: string[], tools: PaperclipAgentSyncRecord["desiredMcpServers"]): string {
  return [
    `Create or update Paperclip agent '${agent.id}' for role '${agent.role}'.`,
    `Adapter: ${agent.executor}. Model combo: ${agent.modelCombo}.`,
    `Hermes supplies memory, skill selection, and MCP guidance before Codex execution.`,
    `Required skill set: ${skills.slice(0, 18).join(", ") || "none"}.`,
    `Assigned MCP: ${tools.map((tool) => tool.name).join(", ") || "none"}. Sequential Thinking MCP is mandatory for every agent as the baseline thinking pattern.`,
    "Delivery rule: if this agent changes repo code, it must verify, commit, and push to `origin HEAD:staging` before marking work done. If push is impossible, mark the issue blocked with the exact git error.",
    "If Paperclip does not have this agent yet, create it first, then mark this Zero-Human sync record as applied."
  ].join("\n");
}

function buildPaperclipSyncRecord(agent: Agent, previous?: PaperclipAgentSyncRecord): PaperclipAgentSyncRecord {
  const desiredSkills = desiredSkillsForAgentProfile(agent);
  const desiredMcpServers = enabledMcpForAgent(agent);
  const desired = {
    agentId: agent.id,
    role: agent.role,
    desiredSkills,
    desiredMcpServers,
    executor: agent.executor,
    modelCombo: agent.modelCombo
  };
  const desiredHash = stableHash(desired);
  const status: PaperclipSyncStatus = !previous
    ? "missing"
    : previous.desiredHash === desiredHash
      ? previous.status
      : "drifted";
  return {
    agentId: agent.id,
    role: agent.role,
    desiredName: agent.id.replaceAll("_", " "),
    desiredHash,
    desiredSkills,
    desiredMcpServers,
    executor: agent.executor,
    modelCombo: agent.modelCombo,
    status,
    paperclipAgentId: previous?.paperclipAgentId,
    lastSyncedAt: status === "synced" ? previous?.lastSyncedAt : undefined,
    updatedAt: new Date().toISOString(),
    runbook: paperclipRunbook(agent, desiredSkills, desiredMcpServers)
  };
}

function refreshPaperclipSyncState(): PaperclipSyncState {
  const previous = new Map(loadPaperclipSyncState().records.map((record) => [record.agentId, record]));
  const state: PaperclipSyncState = {
    paperclipUrl: paperclipUrl(),
    updatedAt: new Date().toISOString(),
    records: Array.from(agents.values())
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((agent) => buildPaperclipSyncRecord(agent, previous.get(agent.id)))
  };
  savePaperclipSyncState(state);
  return state;
}

function markPaperclipAgentSynced(agentId: string, paperclipAgentId?: string): PaperclipSyncState {
  const state = refreshPaperclipSyncState();
  const record = state.records.find((item) => item.agentId === agentId);
  if (!record) throw new Error(`Unknown agent ${agentId}`);
  record.status = "synced";
  record.paperclipAgentId = paperclipAgentId?.trim() || record.paperclipAgentId || agentId;
  record.lastSyncedAt = new Date().toISOString();
  record.updatedAt = record.lastSyncedAt;
  state.updatedAt = record.updatedAt;
  savePaperclipSyncState(state);
  return state;
}

function paperclipManifestForAgent(agent: Agent): string {
  const record = loadPaperclipSyncState().records.find((item) => item.agentId === agent.id);
  if (!record) return "Paperclip sync: reset. Generate a new owner manifest from Zero-Human Studio only when you are ready to align Paperclip agents.";
  return [
    `Paperclip sync: ${record.status}`,
    `Paperclip agent: ${record.paperclipAgentId ?? record.desiredName}`,
    `Owner manifest hash: ${record.desiredHash}`
  ].join("\n");
}

function inferSkillCategory(text: string, fallbackPath: string, explicit?: string): string {
  if (explicit) return slug(explicit).replaceAll("_", "-");
  for (const [pattern, category] of skillCategoryRules) {
    if (pattern.test(text)) return category;
  }
  const pathParts = fallbackPath.split(/[\\/]/).filter(Boolean);
  return slug(pathParts.find((part) => part.toLowerCase() !== "skills" && part.toLowerCase() !== "skill.md") ?? "operations").replaceAll("_", "-");
}

function inferSkillRoles(text: string): AgentRole[] {
  const roles = new Set<AgentRole>();
  for (const [pattern, mappedRoles] of skillRoleRules) {
    if (pattern.test(text)) mappedRoles.forEach((role) => roles.add(role));
  }
  if (roles.size === 0) roles.add("operations");
  return Array.from(roles).slice(0, 5);
}

function inferSkillTriggers(name: string, category: string, relativePath: string, tags: string[], description: string): string[] {
  const words = [
    name,
    category,
    ...relativePath.split(/[\\/_.-]/),
    ...tags,
    ...description.toLowerCase().split(/\W+/).filter((word) => word.length > 4)
  ];
  return Array.from(new Set(words.map(slug).filter(Boolean))).slice(0, 12);
}

function requiresSkillApproval(text: string): boolean {
  return /admin|auth|billing|browser|credential|database|deploy|docker|email|finance|git|legal|password|payment|privacy|secret|security|shell|ssh|terminal|token/i.test(text);
}

function descriptionWords(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/\W+/).filter((word) => word.length > 4));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = Array.from(a).filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function findDuplicateSkill(key: string, candidate: SkillDefinition): { duplicateOf: string; reason: string } | null {
  const registry = activeSkillRegistry();
  if (registry[key]) return { duplicateOf: key, reason: "same generated key" };
  const sourcePath = candidate.sourcePath?.toLowerCase();
  const candidateName = candidate.triggers[0]?.toLowerCase() ?? key.replace(/^repo_skill_/, "");
  const candidateTriggers = new Set(candidate.triggers.map((trigger) => trigger.toLowerCase()));
  const candidateDescription = descriptionWords(candidate.description);
  for (const [existingKey, existing] of Object.entries(registry)) {
    if (sourcePath && existing.sourcePath?.toLowerCase() === sourcePath) {
      return { duplicateOf: existingKey, reason: "same source path" };
    }
    const existingSlug = slug(existingKey);
    const existingSourceSlug = slug(existing.sourcePath ?? "");
    if (existingSlug === candidateName || existingSlug.endsWith(`_${candidateName}`) || existingSourceSlug === candidateName || existingSourceSlug.endsWith(`_${candidateName}`)) {
      return { duplicateOf: existingKey, reason: "same skill name" };
    }
    const sharedTriggers = existing.triggers.filter((trigger) => candidateTriggers.has(trigger.toLowerCase())).length;
    const similarity = jaccard(candidateDescription, descriptionWords(existing.description));
    if (sharedTriggers >= 4 && similarity >= 0.45) {
      return { duplicateOf: existingKey, reason: "similar triggers and description" };
    }
  }
  return null;
}

function walkSkillFiles(root: string): string[] {
  const ignored = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage"]);
  const files: string[] = [];
  function walk(current: string): void {
    if (files.length >= 1000) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      if (entry.isFile() && entry.name.toLowerCase() === "skill.md") files.push(fullPath);
    }
  }
  walk(root);
  return files;
}

function importSkillsFromRepository(repository: RegisteredRepository, subPath = ""): SkillImportReport {
  const scanRoot = path.resolve(repository.path, subPath);
  const resolvedRepoPath = path.resolve(repository.path);
  if (scanRoot !== resolvedRepoPath && !scanRoot.startsWith(`${resolvedRepoPath}${path.sep}`)) {
    throw new Error("Skill path must stay inside the selected repository");
  }
  if (!fs.existsSync(scanRoot)) throw new Error(`Skill path does not exist: ${subPath || "."}`);
  const report: SkillImportReport = {
    id: `skills_${nanoid(8)}`,
    repositoryId: repository.id,
    repositoryName: repository.name,
    scanned: 0,
    imported: 0,
    duplicates: 0,
    skipped: [],
    createdAt: new Date().toISOString()
  };
  for (const filePath of walkSkillFiles(scanRoot)) {
    const raw = fs.readFileSync(filePath, "utf8");
    const relativePath = path.relative(repository.path, filePath).replaceAll(path.sep, "/");
    const meta = parseSkillFrontmatter(raw);
    const fallbackName = path.basename(path.dirname(filePath));
    const name = slug(meta.name ?? fallbackName);
    const description = ascii(meta.description ?? raw.match(/^#\s+(.+)$/m)?.[1] ?? `Skill imported from ${repository.name}/${relativePath}.`);
    const text = `${name} ${description} ${meta.tags.join(" ")} ${relativePath}`.toLowerCase();
    const category = inferSkillCategory(text, relativePath, meta.category);
    const skill: SkillDefinition = {
      category,
      description,
      roles: inferSkillRoles(text),
      triggers: inferSkillTriggers(name, category, relativePath, meta.tags, description),
      tools: Array.from(new Set([...meta.tools.map(slug).filter(Boolean), "repo-skill"])).slice(0, 8),
      status: "available",
      requiresApproval: requiresSkillApproval(text),
      source: "repo-import",
      sourcePath: `${repository.id}:${relativePath}`
    };
    const keyBase = `repo_skill_${sanitizeRepositoryId(repository.id)}_${name}`;
    let key = keyBase;
    let counter = 2;
    while (customSkillRegistry[key]) key = `${keyBase}_${counter++}`;
    report.scanned += 1;
    const duplicate = findDuplicateSkill(key, skill);
    if (duplicate) {
      report.duplicates += 1;
      report.skipped.push({ name, sourcePath: skill.sourcePath ?? relativePath, ...duplicate });
      continue;
    }
    customSkillRegistry[key] = skill;
    report.imported += 1;
  }
  saveCustomSkills();
  skillImportReports.unshift(report);
  skillImportReports.splice(20);
  return report;
}

function roleModelCombo(role: AgentRole): string {
  return ["cto", "backend", "frontend", "qa", "devops", "product", "design"].includes(role) ? "cheap_stack" : "free_stack";
}

function roleExecutor(role: AgentRole): Agent["executor"] {
  return ["finance", "support", "operations"].includes(role) ? "bash" : "codex";
}

function roleBudget(role: AgentRole): number {
  if (["cto", "backend", "frontend", "devops"].includes(role)) return 15;
  if (["product", "design", "marketing", "qa"].includes(role)) return 10;
  return 5;
}

function skillsForRole(role: AgentRole, description: string): string[] {
  const lowered = description.toLowerCase();
  const registryRoleSkills = Object.entries(activeSkillRegistry())
    .filter(([, definition]) => definition.roles.includes(role))
    .map(([skill]) => skill);
  const registryTriggerSkills = Object.entries(activeSkillRegistry())
    .filter(([, definition]) => definition.triggers.some((trigger) => lowered.includes(trigger.toLowerCase())))
    .map(([skill]) => skill);
  return Array.from(new Set([
    ...registryRoleSkills,
    ...roleSkillCatalog[role],
    ...registryTriggerSkills
  ])).slice(0, 8);
}

function mapHireRequest(input: { title: string; department?: string; description?: string; requestedRole?: string }): Omit<HiringRequest, "id" | "source" | "status" | "createdAt" | "updatedAt"> {
  const text = [input.title, input.department, input.description, input.requestedRole].filter(Boolean).join(" ").toLowerCase();
  const roles = Object.keys(roleSkillCatalog) as AgentRole[];
  const forcedRole = roles.find((role) => role === input.requestedRole?.toLowerCase());
  const scored = roles.map((role) => {
    const direct = text.includes(role) ? 4 : 0;
    const configuredSkillHits = roleSkillCatalog[role].filter((skill) => text.includes(skill.replaceAll("_", " "))).length;
    const registryHits = Object.values(activeSkillRegistry()).filter((definition) =>
      definition.roles.includes(role) && (
        text.includes(definition.category.toLowerCase()) ||
        definition.triggers.some((trigger) => text.includes(trigger.toLowerCase())) ||
        definition.description.toLowerCase().split(/\W+/).some((word) => word.length > 5 && text.includes(word))
      )
    ).length;
    return { role, score: direct + configuredSkillHits * 2 + registryHits };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0] ?? { role: "operations" as AgentRole, score: 0 };
  const suggestedRole = forcedRole ?? (best.score > 0 ? best.role : "operations");
  const suggestedSkills = skillsForRole(suggestedRole, text);
  const titleId = sanitizeAgentId(input.title);
  let suggestedAgentId = titleId;
  let counter = 2;
  while (agents.has(suggestedAgentId)) {
    suggestedAgentId = `${titleId}_${counter++}`;
  }
  return {
    title: input.title.trim(),
    department: input.department?.trim() || undefined,
    description: input.description?.trim() || undefined,
    requestedRole: input.requestedRole?.trim() || undefined,
    suggestedRole,
    suggestedSkills,
    suggestedAgentId,
    suggestedExecutor: roleExecutor(suggestedRole),
    suggestedModelCombo: roleModelCombo(suggestedRole),
    suggestedBudgetUsd: roleBudget(suggestedRole),
    confidence: Number(Math.min(0.95, 0.45 + best.score * 0.08).toFixed(2))
  };
}

function activateHiringRequest(request: HiringRequest): Agent {
  const agent: Agent = {
    id: request.suggestedAgentId,
    role: request.suggestedRole,
    brain: "hermes",
    memory: "persistent",
    modelCombo: request.suggestedModelCombo,
    executor: request.suggestedExecutor,
    maxBudgetUsd: request.suggestedBudgetUsd,
    status: "idle",
    skills: request.suggestedSkills,
    schedule: null,
    costAccumulatedUsd: 0
  };
  agents.set(agent.id, agent);
  return agent;
}

for (const request of hiringRequests.values()) {
  if (request.status === "approved" && !agents.has(request.suggestedAgentId)) {
    activateHiringRequest(request);
  }
}

function inferRequiredSkills(agent: Agent, type: TaskType, description: string): string[] {
  const lowered = description.toLowerCase();
  const registryRoleSkills = Object.entries(activeSkillRegistry())
    .filter(([, definition]) => definition.roles.includes(agent.role))
    .map(([skill]) => skill);
  const registryTriggerSkills = Object.entries(activeSkillRegistry())
    .filter(([, definition]) => definition.triggers.some((trigger) => lowered.includes(trigger.toLowerCase())))
    .map(([skill]) => skill);
  return Array.from(new Set([
    ...registryRoleSkills,
    ...roleSkillCatalog[agent.role],
    ...agent.skills,
    ...taskSkillCatalog[type],
    ...registryTriggerSkills,
    lowered.match(/\b(ui|frontend|react|css|layout|browser)\b/) ? "frontend_implementation" : "",
    lowered.match(/\b(api|backend|database|server|auth|endpoint)\b/) ? "backend_integration" : "",
    lowered.match(/\b(docker|container|compose|deploy|ci|github action)\b/) ? "devops_delivery" : "",
    lowered.match(/\b(test|qa|e2e|validation|bug|error|fix)\b/) ? "quality_validation" : "",
    lowered.match(/\b(memory|skill|agent|role|hermes)\b/) ? "agent_memory_orchestration" : ""
  ].filter(Boolean))).slice(0, 10);
}

function roleGuidance(agent: Agent, requiredSkills: string[]): string {
  return [
    "Zero-Human Owner policy: this manifest is the source of truth for Paperclip, Hermes, and Codex execution.",
    `Role: ${agent.role}`,
    `Executor: ${agent.executor}`,
    `Required skills: ${requiredSkills.join(", ")}`,
    paperclipManifestForAgent(agent),
    mcpManifestForAgent(agent),
    "Hermes must select relevant memory, skills, and MCP context before the executor edits or validates.",
    "Stay inside this role and use the relevant skills before editing or validating.",
    "If work becomes blocked, diagnose the blocker and either fix it, delegate to the correct role, request/hire the missing agent, or ask for one explicit owner decision. Do not leave a blocked issue without a concrete unblocker."
  ].join("\n");
}

async function sendNotification(event: string, message: string, payload: Record<string, unknown>): Promise<{ delivered: boolean; error?: string }> {
  const webhookUrl = config.notifications.webhook_url?.trim();
  if (!webhookUrl || !webhookUrl.startsWith("http")) return { delivered: false };
  if (!config.notifications.events.includes(event)) return { delivered: false };

  const body = webhookUrl.includes("discord")
    ? { content: `**${event}**\n${message}`, embeds: [{ description: JSON.stringify(payload, null, 2).slice(0, 3800) }] }
    : { event, message, payload, timestamp: new Date().toISOString() };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return { delivered: false, error: `Webhook returned HTTP ${response.status}` };
    return { delivered: true };
  } catch (error) {
    return { delivered: false, error: (error as Error).message };
  }
}

async function addBudgetAlert(
  event: ZHEvent.COST_THRESHOLD | ZHEvent.QUOTA_EXHAUSTED,
  scope: "global" | "agent",
  message: string,
  severity: "warning" | "critical",
  payload: Record<string, unknown>
): Promise<void> {
  const delivery = await sendNotification(event, message, payload);
  alerts.unshift({
    id: `alert_${nanoid(8)}`,
    event,
    scope,
    message,
    severity,
    timestamp: new Date().toISOString(),
    delivered: delivery.delivered,
    error: delivery.error
  });
  alerts.splice(50);
  addEvent(event, message);
}

function sanitizeRef(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._/-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function resolveWorktreePath(agentId: string, taskId: string): string {
  const base = path.isAbsolute(config.infrastructure.worktree_base)
    ? config.infrastructure.worktree_base
    : path.resolve(repoRoot, config.infrastructure.worktree_base);
  return path.join(base, agentId, taskId);
}

function makeAskPassScript(repository: RegisteredRepository): string | null {
  if (repository.authType !== "https-token" || !repository.token) return null;
  const scriptPath = path.join(stateDir, "tmp", `askpass-${repository.id}-${nanoid(6)}.sh`);
  const username = JSON.stringify(repository.username?.trim() || "x-access-token");
  const token = JSON.stringify(repository.token);
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, `#!/bin/sh\ncase "$1" in\n*Username*) printf %s ${username} ;;\n*Password*) printf %s ${token} ;;\n*) printf %s ${token} ;;\nesac\n`, "utf8");
  fs.chmodSync(scriptPath, 0o700);
  return scriptPath;
}

function makeSshKeyFile(repository: RegisteredRepository): string | null {
  if (repository.authType !== "ssh-key" || !repository.sshPrivateKey) return null;
  const keyPath = path.join(stateDir, "tmp", `ssh-${repository.id}-${nanoid(6)}`);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, `${repository.sshPrivateKey.trim()}\n`, "utf8");
  fs.chmodSync(keyPath, 0o600);
  return keyPath;
}

async function withRepositoryGitEnv<T>(repository: RegisteredRepository, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const askPassPath = makeAskPassScript(repository);
  const sshKeyPath = makeSshKeyFile(repository);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0"
  };
  if (askPassPath) env.GIT_ASKPASS = askPassPath;
  if (sshKeyPath) {
    const passphraseNote = repository.sshPassphrase ? " -o BatchMode=no" : "";
    env.GIT_SSH_COMMAND = `ssh -i "${sshKeyPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new${passphraseNote}`;
  }
  try {
    return await fn(env);
  } finally {
    if (askPassPath) fs.rmSync(askPassPath, { force: true });
    if (sshKeyPath) fs.rmSync(sshKeyPath, { force: true });
  }
}

async function runGit(args: string[], cwd = sourceRepoPath, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    env,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });
  return [stdout, stderr].filter(Boolean).join("\n").trim();
}

async function ensureSourceRepo(repository = defaultRepository()): Promise<void> {
  if (fs.existsSync(path.join(repository.path, ".git"))) {
    await withRepositoryGitEnv(repository, async (env) => {
      await runGit(["fetch", "origin"], repository.path, env).catch(() => "");
      await runGit(["reset", "--hard", `origin/${repository.branch}`], repository.path, env).catch(() => "");
    });
    await runGit(["config", "user.email", "zero-human@example.local"], repository.path);
    await runGit(["config", "user.name", "Zero-Human"], repository.path);
    return;
  }

  if (repository.id !== "default") {
    throw new Error(`Repository ${repository.name} has not been cloned yet`);
  }

  if (!fs.existsSync(path.join(repository.url, ".git"))) {
    throw new Error(`Source repo at ${repository.url} does not contain .git`);
  }

  fs.mkdirSync(path.dirname(repository.path), { recursive: true });
  await withRepositoryGitEnv(repository, async (env) => {
    await execFileAsync("git", ["clone", repository.url, repository.path], {
      env,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
  });
  await runGit(["config", "user.email", "zero-human@example.local"], repository.path);
  await runGit(["config", "user.name", "Zero-Human"], repository.path);
}

async function syncRegisteredRepository(repository: RegisteredRepository): Promise<RegisteredRepository> {
  repository.status = "syncing";
  repository.updatedAt = new Date().toISOString();
  repository.error = undefined;
  saveRepositories();
  try {
    fs.mkdirSync(path.dirname(repository.path), { recursive: true });
    await withRepositoryGitEnv(repository, async (env) => {
      if (fs.existsSync(path.join(repository.path, ".git"))) {
        await runGit(["fetch", "origin"], repository.path, env);
        await runGit(["checkout", repository.branch], repository.path, env).catch(() => runGit(["checkout", "-B", repository.branch, `origin/${repository.branch}`], repository.path, env));
        await runGit(["pull", "--ff-only", "origin", repository.branch], repository.path, env);
      } else {
        await execFileAsync("git", ["clone", "--branch", repository.branch, repository.url, repository.path], {
          env,
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024
        });
      }
    });
    await runGit(["config", "user.email", "zero-human@example.local"], repository.path);
    await runGit(["config", "user.name", "Zero-Human"], repository.path);
    repository.status = "ready";
    repository.lastSyncAt = new Date().toISOString();
  } catch (error) {
    repository.status = "error";
    repository.error = (error as Error).message;
  }
  repository.updatedAt = new Date().toISOString();
  repositories.set(repository.id, repository);
  saveRepositories();
  return repository;
}

async function createTaskWorktree(agentId: string, taskId: string, repositoryId?: string): Promise<{ worktreePath: string; branchName: string; repository: RegisteredRepository }> {
  const repository = getRepository(repositoryId);
  if (repository.status !== "ready") throw new Error(`Repository ${repository.name} is ${repository.status}`);
  await ensureSourceRepo(repository);

  const worktreePath = resolveWorktreePath(agentId, taskId);
  const branchName = sanitizeRef(`zh/${agentId}/${taskId}`);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  await runGit(["config", "--global", "--add", "safe.directory", repository.path]);
  await runGit(["worktree", "add", "-b", branchName, worktreePath, "HEAD"], repository.path);
  return { worktreePath, branchName, repository };
}

function requireTaskWorktree(task: Task): string {
  if (!task.worktreePath) throw new Error("Task does not have a worktreePath");
  return task.worktreePath;
}

async function taskDiff(task: Task): Promise<{ status: string; diff: string }> {
  const worktreePath = requireTaskWorktree(task);
  await runGit(["add", "-N", "."], worktreePath).catch(() => "");
  const status = await runGit(["status", "--short"], worktreePath);
  const diff = await runGit(["diff", "--", "."], worktreePath);
  return { status, diff };
}

async function cleanupWorktree(task: Task): Promise<void> {
  const repository = getRepository(task.repositoryId);
  if (task.worktreePath) {
    await runGit(["worktree", "remove", "--force", task.worktreePath], repository.path).catch(() => "");
  }
  if (task.branchName) {
    await runGit(["branch", "-D", task.branchName], repository.path).catch(() => "");
  }
  await runGit(["worktree", "prune"], repository.path).catch(() => "");
}

function writeApprovalPatch(task: Task, commit: string, patchContent: string): string {
  const patchDir = path.join(hostRepoPath, ".zero-human", "approved");
  fs.mkdirSync(patchDir, { recursive: true });
  const patchPath = path.join(patchDir, `${task.id}-${commit.slice(0, 12)}.patch`);
  fs.writeFileSync(patchPath, patchContent, "utf8");
  return patchPath;
}

async function applyApprovedCommitToHost(task: Task, commit: string, patchContent: string): Promise<{ status: "applied" | "patch_written" | "skipped"; output: string; hostCommit?: string; patchPath?: string }> {
  const repository = getRepository(task.repositoryId);
  if (repository.id !== "default") {
    return {
      status: "skipped",
      output: `Merged into registered repository clone at ${repository.path}. Push from that clone when ready.`
    };
  }
  if (path.resolve(hostRepoPath) === path.resolve(sourceRepoPath)) {
    return { status: "skipped", output: "Source repo is the host repo; no export step needed." };
  }
  if (!fs.existsSync(path.join(hostRepoPath, ".git"))) {
    const patchPath = writeApprovalPatch(task, commit, patchContent);
    return { status: "patch_written", patchPath, output: `Host repo is unavailable; wrote patch to ${patchPath}.` };
  }

  await runGit(["config", "--global", "--add", "safe.directory", hostRepoPath]).catch(() => "");
  const hostStatus = await runGit(["status", "--short"], hostRepoPath);
  if (hostStatus.trim()) {
    const patchPath = writeApprovalPatch(task, commit, patchContent);
    return {
      status: "patch_written",
      patchPath,
      output: `Host repo has uncommitted changes; wrote patch to ${patchPath} instead of cherry-picking.`
    };
  }

  try {
    const refToFetch = task.branchName ?? commit;
    await runGit(["fetch", sourceRepoPath, refToFetch], hostRepoPath);
    const output = await runGit(["cherry-pick", "FETCH_HEAD"], hostRepoPath);
    const hostCommit = await runGit(["rev-parse", "--short", "HEAD"], hostRepoPath);
    return { status: "applied", output, hostCommit };
  } catch (error) {
    await runGit(["cherry-pick", "--abort"], hostRepoPath).catch(() => "");
    const patchPath = writeApprovalPatch(task, commit, patchContent);
    return {
      status: "patch_written",
      patchPath,
      output: `Host cherry-pick failed: ${(error as Error).message}. Wrote patch to ${patchPath}.`
    };
  }
}

async function approveWorktree(task: Task): Promise<{ commit: string; mergeOutput: string; hostOutput: string; hostCommit?: string; hostStatus: string; patchPath?: string }> {
  const repository = getRepository(task.repositoryId);
  const worktreePath = requireTaskWorktree(task);
  await runGit(["add", "-A"], worktreePath);
  const status = await runGit(["status", "--short"], worktreePath);
  if (!status.trim()) throw new Error("No worktree changes to approve");

  await runGit(["commit", "-m", `task: ${task.id}`], worktreePath);
  const commit = await runGit(["rev-parse", "HEAD"], worktreePath);
  const shortCommit = await runGit(["rev-parse", "--short", "HEAD"], worktreePath);
  const patchContent = await runGit(["format-patch", "-1", "--stdout", commit], worktreePath);
  await runGit(["checkout", repository.branch], repository.path).catch(() => "");
  const mergeOutput = task.branchName
    ? await runGit(["merge", "--no-ff", task.branchName, "-m", `merge: ${task.id}`], repository.path)
    : "No branchName recorded; commit remains in task worktree.";
  const hostApply = await applyApprovedCommitToHost(task, commit, patchContent);
  return {
    commit: shortCommit,
    mergeOutput,
    hostOutput: hostApply.output,
    hostCommit: hostApply.hostCommit,
    hostStatus: hostApply.status,
    patchPath: hostApply.patchPath
  };
}

async function maybeAutoApprove(task: Task): Promise<void> {
  if (config.orchestrator.approval_required || !config.orchestrator.auto_merge) return;
  if (task.status !== "pending_review") return;
  if (currentSpend() >= companyState.budget_usd) return;

  try {
    const approved = await approveWorktree(task);
    await cleanupWorktree(task);
    task.status = "done";
    task.hostCommit = approved.hostCommit;
    task.hostApplyStatus = approved.hostStatus as Task["hostApplyStatus"];
    task.hostPatchPath = approved.patchPath;
    task.result = `${task.result ?? ""} Auto-approved commit ${approved.commit}. Host export: ${approved.hostOutput}`.trim();
    task.updatedAt = new Date().toISOString();
    const agent = agents.get(task.agentId);
    if (agent) agent.status = "idle";
    addEvent("zh:task:auto_approved", `Auto-approved ${task.id}`);
  } catch (error) {
    task.status = "error";
    task.result = `Auto-approve failed: ${(error as Error).message}`;
    task.updatedAt = new Date().toISOString();
    addEvent(ZHEvent.AGENT_ERROR, `Auto-approve failed for ${task.id}`);
  }
}

function currentSpend(): number {
  const agentSpent = Array.from(agents.values()).reduce((sum, agent) => sum + agent.costAccumulatedUsd, 0);
  return Math.max(agentSpent, routerMetrics.costUsd);
}

async function enforceBudget(reason: string): Promise<void> {
  const globalSpent = currentSpend();
  if (globalSpent >= companyState.budget_usd && !budgetFlags.globalPaused) {
    budgetFlags.globalPaused = true;
    for (const agent of agents.values()) agent.status = "paused";
    const payload = { scope: "global", spent: globalSpent, limit: companyState.budget_usd, reason };
    await addBudgetAlert(ZHEvent.QUOTA_EXHAUSTED, "global", `Global budget exhausted: $${globalSpent.toFixed(4)} / $${companyState.budget_usd}`, "critical", payload);
    if (bus.connected) await bus.publish(ZHEvent.QUOTA_EXHAUSTED, payload);
    return;
  }

  const threshold = config.orchestrator.approval_threshold_usd;
  if (threshold > 0 && globalSpent >= threshold && !budgetFlags.thresholdPublished) {
    budgetFlags.thresholdPublished = true;
    const payload = { scope: "global", spent: globalSpent, limit: threshold, reason };
    await addBudgetAlert(ZHEvent.COST_THRESHOLD, "global", `Approval threshold crossed: $${globalSpent.toFixed(4)} / $${threshold}`, "warning", payload);
    if (bus.connected) await bus.publish(ZHEvent.COST_THRESHOLD, payload);
  }

  for (const agent of agents.values()) {
    if (agent.costAccumulatedUsd >= agent.maxBudgetUsd && agent.status !== "paused" && !budgetFlags.pausedAgents.has(agent.id)) {
      budgetFlags.pausedAgents.add(agent.id);
      agent.status = "paused";
      const payload = { scope: "agent", agentId: agent.id, spent: agent.costAccumulatedUsd, limit: agent.maxBudgetUsd, reason };
      await addBudgetAlert(ZHEvent.QUOTA_EXHAUSTED, "agent", `${agent.id} paused at $${agent.costAccumulatedUsd.toFixed(4)} / $${agent.maxBudgetUsd}`, "critical", payload);
      if (bus.connected) await bus.publish(ZHEvent.QUOTA_EXHAUSTED, payload);
    }
  }
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readHermesVersion(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.match(/^version = "([^"]+)"/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

function upstreamStatus() {
  return upstreamSources.map((source) => {
    const absolutePath = path.join(repoRoot, source.prefix);
    const packageJson = readJson(path.join(absolutePath, "package.json"));
    const pyprojectVersion = readHermesVersion(path.join(absolutePath, "pyproject.toml"));
    const configuredUrl =
      source.name === "router" ? config.infrastructure.services?.router_url :
      source.name === "brain" ? config.infrastructure.services?.brain_url :
      source.name === "hr" ? config.infrastructure.services?.hr_url :
      source.defaultUrl;
    return {
      ...source,
      present: fs.existsSync(absolutePath),
      absolutePath,
      configuredUrl,
      packageName: packageJson?.name ?? null,
      version: packageJson?.version ?? pyprojectVersion ?? null
    };
  });
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, body };
}

async function checkService(name: string, baseUrl: string, healthPath: string): Promise<ServiceHealth> {
  const started = Date.now();
  const url = `${baseUrl.replace(/\/$/, "")}${healthPath}`;
  try {
    const { status, body } = await fetchJson(url);
    return {
      name,
      url,
      ok: status >= 200 && status < 400,
      status,
      latencyMs: Date.now() - started,
      details: body
    };
  } catch (error) {
    return {
      name,
      url,
      ok: false,
      latencyMs: Date.now() - started,
      error: (error as Error).message
    };
  }
}

async function serviceHealth(): Promise<ServiceHealth[]> {
  const services = config.infrastructure.services;
  if (!services) return [];
  return Promise.all([
    checkService("router-adapter", services.router_url, "/health"),
    checkService("brain-adapter", services.brain_url, "/health"),
    checkService("paperclip", services.hr_url, "/api/health")
  ]);
}

async function brainMemoryStatus(): Promise<BrainMemorySummary> {
  const brainUrl = config.infrastructure.services?.brain_url;
  if (!brainUrl) return { ok: false, agentCount: 0, entries: 0, outcomes: 0, skills: [], recentNotes: [], error: "Brain URL is not configured" };
  try {
    const { body } = await fetchJson(`${brainUrl.replace(/\/$/, "")}/api/memory`);
    const memory = body as {
      notes?: Record<string, string[]>;
      outcomes?: unknown[];
      skills?: BrainSkillSummary[];
    };
    const legacyMemory = body as Record<string, string[]>;
    const notes: Record<string, string[]> = memory.notes ?? legacyMemory;
    const skills: BrainSkillSummary[] = Array.isArray(memory.skills) ? memory.skills : [];
    const outcomes = Array.isArray(memory.outcomes) ? memory.outcomes.length : 0;
    return {
      ok: true,
      agentCount: Object.keys(notes).length,
      entries: Object.values(notes).reduce((sum, agentNotes) => sum + agentNotes.length, 0),
      outcomes,
      skills,
      recentNotes: Object.entries(notes).flatMap(([agentId, agentNotes]) =>
        agentNotes.slice(0, 2).map((note: string) => ({ agentId, note }))
      ).slice(0, 8)
    };
  } catch (error) {
    return { ok: false, agentCount: 0, entries: 0, outcomes: 0, skills: [], recentNotes: [], error: (error as Error).message };
  }
}

bus.on("*", (message) => addEvent(message.event, `${message.metadata.source} published ${message.event}`));
bus.on<Task>(ZHEvent.TASK_STARTED, (message) => {
  const task = tasks.get(message.payload.id) ?? tasks.get((message.payload as unknown as { taskId: string }).taskId);
  if (!task) return;
  task.status = "in_progress";
  task.updatedAt = new Date().toISOString();
  const agent = agents.get(task.agentId);
  if (agent) agent.status = "working";
});
bus.on<Task>(ZHEvent.TASK_COMPLETED, async (message) => {
  const previous = tasks.get(message.payload.id);
  const reportedCost = Math.max(message.payload.costAccumulated ?? 0, previous?.costAccumulated ?? 0);
  const task = { ...message.payload, costAccumulated: reportedCost };
  tasks.set(task.id, task);
  const agent = agents.get(task.agentId);
  if (agent) {
    if (agent.status !== "paused") agent.status = "reviewing";
    agent.costAccumulatedUsd += Math.max(0, reportedCost - (previous?.costAccumulated ?? 0));
  }
  await maybeAutoApprove(task);
});
bus.on<{ costUsd: number; inputTokens: number; outputTokens: number; agentId?: string; taskId?: string }>(ZHEvent.COST_ACCUMULATED, async (message) => {
  routerMetrics.requests += 1;
  routerMetrics.costUsd += message.payload.costUsd;
  routerMetrics.inputTokens += message.payload.inputTokens;
  routerMetrics.outputTokens += message.payload.outputTokens;
  if (message.payload.agentId) {
    const agent = agents.get(message.payload.agentId);
    if (agent) agent.costAccumulatedUsd += message.payload.costUsd;
  }
  if (message.payload.taskId) {
    const task = tasks.get(message.payload.taskId);
    if (task) task.costAccumulated = Number(((task.costAccumulated ?? 0) + message.payload.costUsd).toFixed(6));
  }
  await enforceBudget("router-cost-event");
});
bus.on<{ agentId: string }>(ZHEvent.AGENT_READY, (message) => {
  const agent = agents.get(message.payload.agentId);
  if (agent && agent.status !== "paused") agent.status = "idle";
});
bus.on<{ agentId: string; role?: string; skill: string; taskId?: string; confidence?: number; afterConfidence?: number; runs?: number }>(ZHEvent.SKILL_LEARNED, (message) => {
  const key = `${message.payload.agentId}:${message.payload.skill}`;
  const existing = skillProgress.get(key);
  const runs = message.payload.runs ?? (existing?.runs ?? 0) + 1;
  const confidence = message.payload.afterConfidence ?? Number((((existing?.confidence ?? 0.55) + (message.payload.confidence ?? 0.65)) / 2).toFixed(2));
  skillProgress.set(key, {
    agentId: message.payload.agentId,
    skill: message.payload.skill,
    runs,
    confidence,
    lastTaskId: message.payload.taskId,
    updatedAt: new Date().toISOString()
  });
  addEvent(ZHEvent.SKILL_LEARNED, `${message.payload.agentId} improved ${message.payload.skill}`);
});

bus.connect().then(() => {
  console.log("[hr] connected to Redis event bus");
}).catch((error) => {
  console.warn(`[hr] Redis unavailable, dashboard runs in demo mode: ${error.message}`);
});

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "@zh/hr", redis: bus.connected });
});

app.get("/api/paperclip/sync", (_req, res) => {
  res.json(loadPaperclipSyncState());
});

app.post("/api/paperclip/sync", (_req, res) => {
  const state = refreshPaperclipSyncState();
  addEvent("paperclip_sync_manifest", `Prepared Paperclip owner manifest for ${state.records.length} agents.`);
  res.json(state);
});

app.delete("/api/paperclip/sync", (_req, res) => {
  const state = resetPaperclipSyncState();
  addEvent("paperclip_sync_reset", "Cleared the Zero-Human Paperclip owner manifest.");
  res.json(state);
});

app.post("/api/paperclip/sync/:agentId/applied", (req, res) => {
  try {
    const state = markPaperclipAgentSynced(req.params.agentId, typeof req.body?.paperclipAgentId === "string" ? req.body.paperclipAgentId : undefined);
    addEvent("paperclip_agent_synced", `Marked ${req.params.agentId} as applied in Paperclip.`);
    res.json(state);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.get("/api/paperclip/skills/sync", (_req, res) => {
  res.json(publicPaperclipSkillSyncReport());
});

app.post("/api/paperclip/skills/sync", async (_req, res) => {
  const report = await syncSkillsToPaperclip();
  addEvent(
    "paperclip_skill_sync",
    report.unavailable
      ? `Paperclip skill sync unavailable: ${report.error}`
      : `Synced ${report.imported} new and ${report.updated} updated Zero-Human skills to Paperclip.`
  );
  if (!report.unavailable) schedulePaperclipHermesAutoSync("paperclip skill sync");
  res.status(report.unavailable ? 503 : 200).json(report);
});

app.get("/api/paperclip/repositories/sync", (_req, res) => {
  res.json(publicPaperclipRepositorySyncReport());
});

app.post("/api/paperclip/repositories/sync", async (_req, res) => {
  const report = await syncRepositoriesToPaperclip();
  addEvent(
    "paperclip_repository_sync",
    report.unavailable
      ? `Paperclip repository sync unavailable: ${report.error}`
      : `Synced ${report.workspacesSynced} Paperclip workspaces and linked ${report.issuesLinked} issues`
  );
  res.status(report.unavailable ? 503 : 200).json(report);
});

app.get("/api/paperclip/chat/signals", (_req, res) => {
  res.json(publicPaperclipChatSignalReport());
});

app.post("/api/paperclip/chat/signals/scan", async (_req, res) => {
  const report = await scanPaperclipChatSignals();
  addEvent(
    "paperclip_chat_signal_scan",
    report.unavailable
      ? `Paperclip chat scan unavailable: ${report.error}`
      : `Scanned ${report.scanned} Paperclip comments, ensured ${report.ensuredPaperclipAgents} Paperclip agents, and created ${report.createdRequests} hiring requests.`
  );
  res.status(report.unavailable ? 503 : 200).json(report);
});

app.get("/api/paperclip/hermes/sync", (_req, res) => {
  res.json(publicPaperclipHermesBridgeReport());
});

app.post("/api/paperclip/hermes/sync", async (_req, res) => {
  const report = await syncHermesBridgeToPaperclip();
  addEvent(
    "paperclip_hermes_bridge",
    report.unavailable
      ? `Paperclip Hermes bridge unavailable: ${report.error}`
      : `Hermes bridge synced to ${report.agentsPatched}/${report.agentsScanned} Paperclip agents.`
  );
  res.status(report.unavailable ? 503 : 200).json(report);
});

app.get("/api/paperclip/hermes/interventions", (_req, res) => {
  res.json(publicPaperclipHermesInterventionReport());
});

app.post("/api/paperclip/hermes/interventions/scan", async (_req, res) => {
  const report = await scanPaperclipHermesInterventions();
  addEvent(
    "paperclip_hermes_live_brain",
    report.unavailable
      ? `Hermes live brain unavailable: ${report.error}`
      : `Hermes live brain scanned ${report.scanned} Paperclip issues and intervened on ${report.intervened}.`
  );
  res.status(report.unavailable ? 503 : 200).json(report);
});

app.get("/api/issue-policies", (_req, res) => {
  res.json(publicIssuePolicies());
});

app.put("/api/issue-policies/:role", (req, res) => {
  const role = req.params.role as AgentRole;
  if (!(role in roleSkillCatalog)) return res.status(404).json({ error: "Unknown role" });
  const current = issuePolicies.get(role) ?? defaultIssuePolicies[role];
  const input = req.body as Partial<AgentIssuePolicy>;
  const next: AgentIssuePolicy = {
    ...current,
    ...input,
    role,
    allowedTaskTypes: Array.isArray(input.allowedTaskTypes)
      ? input.allowedTaskTypes.filter((type): type is TaskType => Object.keys(taskSkillCatalog).includes(type as string))
      : current.allowedTaskTypes,
    approvalKeywords: Array.isArray(input.approvalKeywords) ? input.approvalKeywords.map(String).filter(Boolean) : current.approvalKeywords,
    triageKeywords: Array.isArray(input.triageKeywords) ? input.triageKeywords.map(String).filter(Boolean) : current.triageKeywords,
    maxPriorityWithoutApproval: input.maxPriorityWithoutApproval === 1 || input.maxPriorityWithoutApproval === 2 || input.maxPriorityWithoutApproval === 3
      ? input.maxPriorityWithoutApproval
      : current.maxPriorityWithoutApproval,
    defaultDecision: ["auto_assign", "triage", "approval_required", "blocked"].includes(input.defaultDecision ?? "")
      ? input.defaultDecision as AgentIssueDecision
      : current.defaultDecision
  };
  issuePolicies.set(role, next);
  saveIssuePolicies();
  addEvent("zh:issue-policy:updated", `Updated issue policy for ${role}`);
  res.json(next);
});

app.post("/api/agent-issues/evaluate", (req, res) => {
  try {
    const { agentId, title, description, type, priority } = req.body as {
      agentId?: string;
      title?: string;
      description?: string;
      type?: TaskType;
      priority?: 1 | 2 | 3;
    };
    if (!agentId || !title?.trim()) return res.status(400).json({ error: "agentId and title are required" });
    res.json(evaluateAgentIssuePolicy({ agentId, title, description, type, priority }));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.get("/api/state", async (_req, res) => {
  const totalAgentBudget = Array.from(agents.values()).reduce((sum, agent) => sum + agent.maxBudgetUsd, 0);
  const spent = currentSpend();
  const [health, memory] = await Promise.all([serviceHealth(), brainMemoryStatus()]);
  const paperclipSync = loadPaperclipSyncState();
  const memorySkills = memory.skills.map((skill) => ({
    agentId: skill.agentId,
    skill: skill.skill,
    runs: skill.runs,
    confidence: skill.confidence,
    lastTaskId: skill.lastTaskId,
    updatedAt: skill.updatedAt
  }));
  const liveSkillKeys = new Set(skillProgress.keys());
  const mergedSkillProgress = [
    ...Array.from(skillProgress.values()),
    ...memorySkills.filter((skill) => !liveSkillKeys.has(`${skill.agentId}:${skill.skill}`))
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json({
    company: companyState,
    infrastructure: {
      redisUrl: config.infrastructure.redis_url,
      worktreeBase: config.infrastructure.worktree_base,
      services: config.infrastructure.services
    },
    policies: config.orchestrator,
    agents: Array.from(agents.values()),
    tasks: Array.from(tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    events,
    routerMetrics,
    serviceHealth: health,
    brainMemory: memory,
    skillProgress: mergedSkillProgress,
    alerts,
    upstreams: upstreamStatus(),
    repositories: listRepositories(),
    paperclipSync,
    paperclipSkillSync: publicPaperclipSkillSyncReport(),
    paperclipRepositorySync: publicPaperclipRepositorySyncReport(),
    paperclipChatSignals: publicPaperclipChatSignalReport(),
    paperclipHermesBridge: publicPaperclipHermesBridgeReport(),
    paperclipHermesInterventions: publicPaperclipHermesInterventionReport(),
    issuePolicies: publicIssuePolicies(),
    mcpMarketplace: listMcpMarketplace(),
    mcpServers: publicMcpServers(),
    skillRegistry: activeSkillRegistry(),
    skillImports: skillImportReports,
    hiringRequests: Array.from(hiringRequests.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    budget: {
      global: companyState.budget_usd,
      allocated: totalAgentBudget,
      spent: Number(spent.toFixed(4)),
      currency: companyState.currency
    },
    combos: config.gateway.combos
  });
});

app.post("/api/repositories", async (req, res) => {
  const { name, url, branch, authType, username, token, sshPrivateKey, sourceKind } = (req.body ?? {}) as {
    name?: string;
    url?: string;
    branch?: string;
    sourceKind?: "work" | "skill_source";
    authType?: "none" | "https-token" | "ssh-key";
    username?: string;
    token?: string;
    sshPrivateKey?: string;
  };
  const repoUrl = url?.trim() ?? "";
  const repoName = name?.trim() || repoUrl.split(/[\/:]/).pop()?.replace(/\.git$/, "") || "Repository";
  const repoBranch = branch?.trim() || "main";
  const repoAuthType = authType ?? "none";
  const repoSourceKind = sourceKind === "skill_source" ? "skill_source" : "work";
  if (!isCloneableRepositoryUrl(repoUrl)) {
    return res.status(400).json({ error: "Repository URL must be a Git URL, for example https://github.com/org/repo.git" });
  }
  if (repoAuthType === "https-token" && !token?.trim()) {
    return res.status(400).json({ error: "HTTPS token auth requires a token" });
  }
  if (repoAuthType === "ssh-key" && !sshPrivateKey?.includes("PRIVATE KEY")) {
    return res.status(400).json({ error: "SSH key auth requires a private key" });
  }

  const baseId = sanitizeRepositoryId(repoName);
  let id = baseId;
  let counter = 2;
  while (repositories.has(id) || id === "default") {
    id = `${baseId}-${counter++}`;
  }

  const now = new Date().toISOString();
  const repository: RegisteredRepository = {
    id,
    name: repoName,
    url: repoUrl,
    branch: repoBranch,
    path: repoSourceKind === "skill_source" ? path.join(repositoryBasePath, "skill-sources", id) : path.join(repositoryBasePath, id),
    sourceKind: repoSourceKind,
    authType: repoAuthType,
    username: username?.trim() || undefined,
    token: repoAuthType === "https-token" ? token : undefined,
    sshPrivateKey: repoAuthType === "ssh-key" ? sshPrivateKey : undefined,
    status: "syncing",
    createdAt: now,
    updatedAt: now
  };
  repositories.set(repository.id, repository);
  saveRepositories();
  const synced = await syncRegisteredRepository(repository);
  if (synced.status === "error") return res.status(502).json(publicRepository(synced));
  if ((synced.sourceKind ?? "work") === "work") await syncRepositoriesToPaperclip();
  addEvent(repoSourceKind === "skill_source" ? "zh:skill-source:registered" : "zh:repository:registered", `Registered ${synced.name}`);
  res.status(201).json(publicRepository(synced));
});

app.post("/api/repositories/:repositoryId/sync", async (req, res) => {
  try {
    const repository = getRepository(req.params.repositoryId);
    if (repository.id === "default") {
      await ensureSourceRepo(repository);
      return res.json(publicRepository(repository));
    }
    const synced = await syncRegisteredRepository(repository);
    if (synced.status === "error") return res.status(502).json(publicRepository(synced));
    if ((synced.sourceKind ?? "work") === "work") await syncRepositoriesToPaperclip();
    addEvent("zh:repository:synced", `Synced ${synced.name}`);
    res.json(publicRepository(synced));
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});

app.post("/api/skills/import-repo", async (req, res) => {
  const { repositoryId, path: skillPath } = (req.body ?? {}) as { repositoryId?: string; path?: string };
  try {
    const repository = getRepository(repositoryId);
    if (repository.id !== "default") await ensureSourceRepo(repository);
    const report = importSkillsFromRepository(repository, skillPath?.trim() ?? "");
    addEvent("zh:skills:imported", `Imported ${report.imported}/${report.scanned} skills from ${repository.name}`);
    schedulePaperclipHermesAutoSync("skill import");
    res.status(201).json(report);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/mcp/install", (req, res) => {
  const { marketplaceId } = (req.body ?? {}) as { marketplaceId?: string };
  const item = listMcpMarketplace().find((entry) => entry.id === marketplaceId);
  if (!item) return res.status(404).json({ error: "MCP marketplace item not found" });
  const now = new Date().toISOString();
  const existing = mcpServers.get(item.id);
  const server: McpServerConfig = {
    ...item,
    env: { ...(item.env ?? {}), ...(existing?.env ?? {}) },
    roles: existing?.roles ?? item.roles,
    permissions: existing?.permissions ?? item.permissions,
    status: existing?.status === "enabled" ? "enabled" : "installed",
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    lastTestAt: existing?.lastTestAt,
    lastTestStatus: existing?.lastTestStatus,
    error: undefined
  };
  try {
    validateMcpConfig(server);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
  mcpServers.set(server.id, server);
  saveMcpServers();
  addEvent("zh:mcp:installed", `Installed ${server.name}`);
  schedulePaperclipHermesAutoSync("mcp install");
  res.status(201).json(server);
});

app.post("/api/mcp/custom", (req, res) => {
  try {
    const now = new Date().toISOString();
    const parsed = normalizeMcpMarketplaceItem(req.body);
    const server: McpServerConfig = {
      ...parsed,
      status: "installed",
      installedAt: now,
      updatedAt: now
    };
    validateMcpConfig(server);
    mcpServers.set(server.id, server);
    customMcpMarketplace.set(parsed.id, parsed);
    saveMcpServers();
    saveCustomMcpMarketplace();
    addEvent("zh:mcp:custom_installed", `Installed custom MCP ${server.name}`);
    schedulePaperclipHermesAutoSync("custom mcp install");
    res.status(201).json(server);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/mcp/marketplace/import-url", async (req, res) => {
  const { url } = (req.body ?? {}) as { url?: string };
  const registryUrl = url?.trim() ?? "";
  if (!/^https?:\/\//i.test(registryUrl)) return res.status(400).json({ error: "Registry URL must start with http:// or https://" });
  try {
    const { body } = await fetchJson(registryUrl);
    const imported: McpMarketplaceItem[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    for (const item of extractMcpRegistryItems(body)) {
      try {
        const normalized = normalizeMcpMarketplaceItem(item);
        customMcpMarketplace.set(normalized.id, normalized);
        imported.push(normalized);
      } catch (error) {
        skipped.push({ name: String((item as { name?: unknown })?.name ?? "unknown"), reason: (error as Error).message });
      }
    }
    saveCustomMcpMarketplace();
    addEvent("zh:mcp:marketplace_imported", `Imported ${imported.length} MCP marketplace entries`);
    res.status(201).json({ imported: imported.length, skipped, marketplace: listMcpMarketplace() });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.put("/api/mcp/:serverId", (req, res) => {
  const existing = mcpServers.get(req.params.serverId);
  if (!existing) return res.status(404).json({ error: "MCP server not found" });
  const next = { ...existing, ...(req.body ?? {}), id: existing.id, updatedAt: new Date().toISOString() } as McpServerConfig;
  try {
    validateMcpConfig(next);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
  mcpServers.set(next.id, next);
  saveMcpServers();
  addEvent("zh:mcp:updated", `Updated ${next.name}`);
  schedulePaperclipHermesAutoSync("mcp update");
  res.json(next);
});

app.post("/api/mcp/:serverId/test", (req, res) => {
  const server = mcpServers.get(req.params.serverId);
  if (!server) return res.status(404).json({ error: "MCP server not found" });
  try {
    validateMcpConfig(server);
    const missingSecrets = Object.entries(server.env ?? {})
      .filter(([, value]) => /^\$\{secret:[A-Z0-9_]+\}$/.test(value))
      .map(([key]) => key);
    server.lastTestAt = new Date().toISOString();
    server.lastTestStatus = missingSecrets.length ? "failed" : "passed";
    server.error = missingSecrets.length ? `Missing secret values: ${missingSecrets.join(", ")}` : undefined;
    mcpServers.set(server.id, server);
    saveMcpServers();
    res.status(missingSecrets.length ? 422 : 200).json({
      ...server,
      message: missingSecrets.length
        ? "MCP config is valid, but secrets must be filled before runtime use."
        : "MCP config is ready for role assignment."
    });
  } catch (error) {
    server.lastTestAt = new Date().toISOString();
    server.lastTestStatus = "failed";
    server.error = (error as Error).message;
    mcpServers.set(server.id, server);
    saveMcpServers();
    res.status(400).json(server);
  }
});

app.post("/api/agents/:agentId/hire", async (req, res) => {
  const agent = agents.get(req.params.agentId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  agent.status = "idle";
  addEvent(ZHEvent.AGENT_SPAWNED, `Hired ${agent.id}`);
  if (bus.connected) await bus.publish(ZHEvent.AGENT_SPAWNED, { agentId: agent.id });
  res.json(agent);
});

app.post("/api/hiring/requests", (req, res) => {
  const { title, department, description, requestedRole, source } = (req.body ?? {}) as {
    title?: string;
    department?: string;
    description?: string;
    requestedRole?: string;
    source?: "paperclip" | "zero-human-ui" | "api";
  };
  if (!title?.trim()) return res.status(400).json({ error: "title is required" });
  const now = new Date().toISOString();
  const mapped = mapHireRequest({ title, department, description, requestedRole });
  const request: HiringRequest = {
    id: `hire_${nanoid(8)}`,
    source: source ?? "api",
    status: "pending_approval",
    createdAt: now,
    updatedAt: now,
    ...mapped
  };
  hiringRequests.set(request.id, request);
  saveHiringRequests();
  addEvent("zh:hiring:requested", `Mapped ${request.title} to ${request.suggestedRole}`);
  res.status(201).json(request);
});

app.post("/api/hiring/requests/:requestId/approve", async (req, res) => {
  const request = hiringRequests.get(req.params.requestId);
  if (!request) return res.status(404).json({ error: "Hiring request not found" });
  if (request.status !== "pending_approval") return res.status(409).json({ error: `Request is already ${request.status}` });
  const overrides = (req.body ?? {}) as Partial<Pick<HiringRequest, "suggestedAgentId" | "suggestedRole" | "suggestedSkills" | "suggestedExecutor" | "suggestedModelCombo" | "suggestedBudgetUsd">> & { decisionNote?: string };
  Object.assign(request, {
    ...overrides,
    suggestedAgentId: sanitizeAgentId(overrides.suggestedAgentId ?? request.suggestedAgentId),
    suggestedSkills: overrides.suggestedSkills?.length ? overrides.suggestedSkills : request.suggestedSkills,
    status: "approved" as HiringRequestStatus,
    decidedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    decisionNote: overrides.decisionNote
  });
  if (agents.has(request.suggestedAgentId)) return res.status(409).json({ error: `Agent ${request.suggestedAgentId} already exists` });
  const agent = activateHiringRequest(request);
  saveHiringRequests();
  addEvent("zh:hiring:approved", `Approved ${agent.id} for ${agent.role}`);
  if (bus.connected) await bus.publish(ZHEvent.AGENT_SPAWNED, { agentId: agent.id });
  res.json({ request, agent });
});

app.post("/api/hiring/requests/:requestId/reject", (req, res) => {
  const request = hiringRequests.get(req.params.requestId);
  if (!request) return res.status(404).json({ error: "Hiring request not found" });
  if (request.status !== "pending_approval") return res.status(409).json({ error: `Request is already ${request.status}` });
  const { decisionNote } = (req.body ?? {}) as { decisionNote?: string };
  request.status = "rejected";
  request.decisionNote = decisionNote;
  request.decidedAt = new Date().toISOString();
  request.updatedAt = new Date().toISOString();
  saveHiringRequests();
  addEvent("zh:hiring:rejected", `Rejected ${request.title}`);
  res.json(request);
});

app.post("/api/agents/:agentId/resume", async (req, res) => {
  const agent = agents.get(req.params.agentId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const { resetCost } = (req.body ?? {}) as { resetCost?: boolean };
  if (resetCost) agent.costAccumulatedUsd = 0;
  if (currentSpend() >= companyState.budget_usd) return res.status(423).json({ error: "Global budget is still exhausted" });
  if (agent.costAccumulatedUsd >= agent.maxBudgetUsd) return res.status(423).json({ error: `${agent.id} is still over its budget cap` });
  agent.status = "idle";
  budgetFlags.pausedAgents.delete(agent.id);
  addEvent("zh:agent:resumed", `Resumed ${agent.id}`);
  res.json(agent);
});

app.post("/api/budget", (req, res) => {
  const { globalBudgetUsd, agentCaps } = (req.body ?? {}) as {
    globalBudgetUsd?: number;
    agentCaps?: Record<string, number>;
  };
  const nextGlobalBudget = Number(globalBudgetUsd);
  if (!Number.isFinite(nextGlobalBudget) || nextGlobalBudget <= 0) {
    return res.status(400).json({ error: "globalBudgetUsd must be a positive number" });
  }

  const nextAgentCaps: Record<string, number> = {};
  for (const agent of agents.values()) {
    const rawCap = agentCaps?.[agent.id] ?? agent.maxBudgetUsd;
    const cap = Number(rawCap);
    if (!Number.isFinite(cap) || cap <= 0) {
      return res.status(400).json({ error: `${agent.id} budget cap must be a positive number` });
    }
    nextAgentCaps[agent.id] = cap;
  }

  const overrides = { globalBudgetUsd: nextGlobalBudget, agentCaps: nextAgentCaps };
  applyBudgetOverrides(overrides);
  saveBudgetOverrides(overrides);
  if (currentSpend() < companyState.budget_usd) budgetFlags.globalPaused = false;
  for (const agent of agents.values()) {
    if (agent.costAccumulatedUsd < agent.maxBudgetUsd) budgetFlags.pausedAgents.delete(agent.id);
  }
  addEvent("zh:budget:updated", `Budget caps updated: global $${companyState.budget_usd}`);
  res.json({
    company: companyState,
    agents: Array.from(agents.values()).map((agent) => ({
      id: agent.id,
      maxBudgetUsd: agent.maxBudgetUsd,
      costAccumulatedUsd: agent.costAccumulatedUsd,
      status: agent.status
    }))
  });
});

app.post("/api/tasks", async (req, res) => {
  const { agentId, type, description, priority, context, repositoryId } = req.body as {
    agentId?: string;
    type?: TaskType;
    description?: string;
    priority?: 1 | 2 | 3;
    context?: string[];
    repositoryId?: string;
  };
  if (!agentId || !agents.has(agentId)) return res.status(400).json({ error: "Valid agentId is required" });
  if (!description?.trim()) return res.status(400).json({ error: "description is required" });
  const selectedAgent = agents.get(agentId);
  if (!selectedAgent) return res.status(400).json({ error: "Valid agentId is required" });
  if (selectedAgent?.status === "paused") return res.status(423).json({ error: `${agentId} is paused by budget protection` });
  if (currentSpend() >= companyState.budget_usd) return res.status(423).json({ error: "Global budget is exhausted" });
  const taskType = type ?? "coding";
  const requiredSkills = inferRequiredSkills(selectedAgent, taskType, description.trim());

  const now = new Date().toISOString();
  const id = `task_${nanoid(8)}`;
  let worktree: { worktreePath: string; branchName: string; repository: RegisteredRepository };
  try {
    worktree = await createTaskWorktree(agentId, id, repositoryId);
  } catch (error) {
    addEvent(ZHEvent.AGENT_ERROR, `Failed to create worktree for ${agentId}: ${(error as Error).message}`);
    return res.status(500).json({ error: `Failed to create worktree: ${(error as Error).message}` });
  }

  const task: Task = {
    id,
    agentId,
    type: taskType,
    description: description.trim(),
    context: context ?? [],
    requiredSkills,
    roleGuidance: roleGuidance(selectedAgent, requiredSkills),
    priority: priority ?? 2,
    status: "assigned",
    repositoryId: worktree.repository.id,
    repositoryName: worktree.repository.name,
    repositoryPath: worktree.repository.path,
    worktreePath: worktree.worktreePath,
    branchName: worktree.branchName,
    validationCommand: "git status --short",
    costAccumulated: 0,
    createdAt: now,
    updatedAt: now
  };
  tasks.set(task.id, task);
  const agent = agents.get(agentId);
  if (agent) agent.status = "working";
  addEvent(ZHEvent.TASK_ASSIGNED, `Assigned ${task.id} to ${agentId}`);
  if (bus.connected) {
    await bus.publish(ZHEvent.TASK_ASSIGNED, task);
  } else {
    setTimeout(() => {
      const current = tasks.get(task.id);
      if (!current || current.status === "done") return;
      current.status = "pending_review";
      current.result = "Demo mode completed this task without Redis. Start Docker Compose for Brain-driven execution.";
      current.costAccumulated = 0.03;
      current.updatedAt = new Date().toISOString();
      const currentAgent = agents.get(current.agentId);
      if (currentAgent) {
        currentAgent.status = "reviewing";
        currentAgent.costAccumulatedUsd += current.costAccumulated;
      }
      addEvent(ZHEvent.TASK_COMPLETED, `Demo completed ${current.id}`);
      void maybeAutoApprove(current);
    }, 1200);
  }
  res.status(201).json(task);
});

app.get("/api/tasks/:taskId/diff", async (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  try {
    res.json(await taskDiff(task));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/tasks/:taskId/diff", async (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  try {
    res.json(await taskDiff(task));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/tasks/:taskId/approve", async (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (task.status === "error") return res.status(409).json({ error: "Cannot approve a failed task" });
  if (currentSpend() >= companyState.budget_usd) return res.status(423).json({ error: "Global budget is exhausted" });
  try {
    const approved = await approveWorktree(task);
    await cleanupWorktree(task);
    task.hostCommit = approved.hostCommit;
    task.hostApplyStatus = approved.hostStatus as Task["hostApplyStatus"];
    task.hostPatchPath = approved.patchPath;
    task.result = `${task.result ?? ""} Approved commit ${approved.commit}. ${approved.mergeOutput} Host export: ${approved.hostOutput}`.trim();
  } catch (error) {
    task.status = "error";
    task.result = `Approve failed: ${(error as Error).message}`;
    task.updatedAt = new Date().toISOString();
    addEvent(ZHEvent.AGENT_ERROR, `Approve failed for ${task.id}`);
    return res.status(500).json({ error: (error as Error).message, task });
  }
  task.status = "done";
  task.updatedAt = new Date().toISOString();
  const agent = agents.get(task.agentId);
  if (agent) agent.status = "idle";
  addEvent("zh:task:approved", `Approved ${task.id}`);
  res.json(task);
});

app.post("/api/tasks/:taskId/reject", async (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  await cleanupWorktree(task);
  task.status = "error";
  task.result = "Rejected by human reviewer; worktree was cleaned up.";
  task.updatedAt = new Date().toISOString();
  const agent = agents.get(task.agentId);
  if (agent) agent.status = "idle";
  addEvent("zh:task:rejected", `Rejected ${task.id}`);
  res.json(task);
});

const webDist = path.resolve(__dirname, "../web/dist");
app.use(express.static(webDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"));
});

const port = Number(process.env.PORT ?? config.orchestrator.port);
const paperclipHermesAutoSyncIntervalMs = Number(process.env.PAPERCLIP_HERMES_SYNC_INTERVAL_MS ?? 120000);
const paperclipHermesMonitorIntervalMs = Number(process.env.PAPERCLIP_HERMES_MONITOR_INTERVAL_MS ?? 60000);
app.listen(port, config.orchestrator.host, () => {
  console.log(`[hr] listening on http://${config.orchestrator.host}:${port}`);
  schedulePaperclipHermesAutoSync("startup");
  schedulePaperclipHermesMonitor("startup");
  if (Number.isFinite(paperclipHermesAutoSyncIntervalMs) && paperclipHermesAutoSyncIntervalMs > 0) {
    const timer = setInterval(() => schedulePaperclipHermesAutoSync("periodic"), paperclipHermesAutoSyncIntervalMs);
    if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") timer.unref();
  }
  if (Number.isFinite(paperclipHermesMonitorIntervalMs) && paperclipHermesMonitorIntervalMs > 0) {
    const timer = setInterval(() => schedulePaperclipHermesMonitor("periodic"), paperclipHermesMonitorIntervalMs);
    if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") timer.unref();
  }
});
