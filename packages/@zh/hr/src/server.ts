import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
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

function activeSkillRegistry(): Record<string, SkillDefinition> {
  return {
    ...(config.skill_registry ?? {}),
    ...customSkillRegistry
  };
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
  const suggestedRole = best.score > 0 ? best.role : "operations";
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
    `Role: ${agent.role}`,
    `Executor: ${agent.executor}`,
    `Required skills: ${requiredSkills.join(", ")}`,
    "Stay inside this role and use the relevant skills before editing or validating."
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

app.get("/api/state", async (_req, res) => {
  const totalAgentBudget = Array.from(agents.values()).reduce((sum, agent) => sum + agent.maxBudgetUsd, 0);
  const spent = currentSpend();
  const [health, memory] = await Promise.all([serviceHealth(), brainMemoryStatus()]);
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
    res.status(201).json(report);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
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
app.listen(port, config.orchestrator.host, () => {
  console.log(`[hr] listening on http://${config.orchestrator.host}:${port}`);
});
