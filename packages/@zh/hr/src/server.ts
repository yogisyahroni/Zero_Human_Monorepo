import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { nanoid } from "nanoid";
import {
  agentsFromConfig,
  loadConfig,
  RedisEventBus,
  type Agent,
  type Task,
  type TaskType,
  ZHEvent
} from "@zh/sdk";
import { upstreamSources } from "@zh/sdk";

const config = loadConfig();
const app = express();
const agents = new Map<string, Agent>(agentsFromConfig(config).map((agent) => [agent.id, agent]));
const tasks = new Map<string, Task>();
const events: Array<{ event: string; timestamp: string; summary: string }> = [];
const routerMetrics = { requests: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
const skillProgress = new Map<string, { agentId: string; skill: string; runs: number; confidence: number; lastTaskId?: string; updatedAt: string }>();
const budgetFlags = { thresholdPublished: false, globalPaused: false };
const bus = new RedisEventBus(config.infrastructure.redis_url, "hr");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
type ServiceHealth = {
  name: string;
  url: string;
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
  details?: unknown;
};

function addEvent(event: string, summary: string): void {
  events.unshift({ event, timestamp: new Date().toISOString(), summary });
  events.splice(80);
}

function currentSpend(): number {
  const agentSpent = Array.from(agents.values()).reduce((sum, agent) => sum + agent.costAccumulatedUsd, 0);
  return Math.max(agentSpent, routerMetrics.costUsd);
}

async function enforceBudget(reason: string): Promise<void> {
  const globalSpent = currentSpend();
  if (globalSpent >= config.company.budget_usd && !budgetFlags.globalPaused) {
    budgetFlags.globalPaused = true;
    for (const agent of agents.values()) agent.status = "paused";
    addEvent(ZHEvent.QUOTA_EXHAUSTED, `Global budget exhausted: $${globalSpent.toFixed(4)} / $${config.company.budget_usd}`);
    if (bus.connected) await bus.publish(ZHEvent.QUOTA_EXHAUSTED, { scope: "global", spent: globalSpent, limit: config.company.budget_usd, reason });
    return;
  }

  const threshold = config.orchestrator.approval_threshold_usd;
  if (threshold > 0 && globalSpent >= threshold && !budgetFlags.thresholdPublished) {
    budgetFlags.thresholdPublished = true;
    addEvent(ZHEvent.COST_THRESHOLD, `Approval threshold crossed: $${globalSpent.toFixed(4)} / $${threshold}`);
    if (bus.connected) await bus.publish(ZHEvent.COST_THRESHOLD, { scope: "global", spent: globalSpent, limit: threshold, reason });
  }

  for (const agent of agents.values()) {
    if (agent.costAccumulatedUsd >= agent.maxBudgetUsd && agent.status !== "paused") {
      agent.status = "paused";
      addEvent(ZHEvent.QUOTA_EXHAUSTED, `${agent.id} paused at $${agent.costAccumulatedUsd.toFixed(4)} / $${agent.maxBudgetUsd}`);
      if (bus.connected) await bus.publish(ZHEvent.QUOTA_EXHAUSTED, { scope: "agent", agentId: agent.id, spent: agent.costAccumulatedUsd, limit: agent.maxBudgetUsd, reason });
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

async function brainMemoryStatus(): Promise<{ ok: boolean; agentCount: number; entries: number; error?: string }> {
  const brainUrl = config.infrastructure.services?.brain_url;
  if (!brainUrl) return { ok: false, agentCount: 0, entries: 0, error: "Brain URL is not configured" };
  try {
    const { body } = await fetchJson(`${brainUrl.replace(/\/$/, "")}/api/memory`);
    const memory = body as Record<string, string[]>;
    return {
      ok: true,
      agentCount: Object.keys(memory).length,
      entries: Object.values(memory).reduce((sum, notes) => sum + notes.length, 0)
    };
  } catch (error) {
    return { ok: false, agentCount: 0, entries: 0, error: (error as Error).message };
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
bus.on<Task>(ZHEvent.TASK_COMPLETED, (message) => {
  const previous = tasks.get(message.payload.id);
  const reportedCost = Math.max(message.payload.costAccumulated ?? 0, previous?.costAccumulated ?? 0);
  const task = { ...message.payload, costAccumulated: reportedCost };
  tasks.set(task.id, task);
  const agent = agents.get(task.agentId);
  if (agent) {
    if (agent.status !== "paused") agent.status = "reviewing";
    agent.costAccumulatedUsd += Math.max(0, reportedCost - (previous?.costAccumulated ?? 0));
  }
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
bus.on<{ agentId: string; skill: string; taskId?: string; confidence?: number }>(ZHEvent.SKILL_LEARNED, (message) => {
  const key = `${message.payload.agentId}:${message.payload.skill}`;
  const existing = skillProgress.get(key);
  const runs = (existing?.runs ?? 0) + 1;
  const confidence = Number((((existing?.confidence ?? 0.55) + (message.payload.confidence ?? 0.65)) / 2).toFixed(2));
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
  res.json({
    company: config.company,
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
    skillProgress: Array.from(skillProgress.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    upstreams: upstreamStatus(),
    budget: {
      global: config.company.budget_usd,
      allocated: totalAgentBudget,
      spent: Number(spent.toFixed(4)),
      currency: config.company.currency
    },
    combos: config.gateway.combos
  });
});

app.post("/api/agents/:agentId/hire", async (req, res) => {
  const agent = agents.get(req.params.agentId);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  agent.status = "idle";
  addEvent(ZHEvent.AGENT_SPAWNED, `Hired ${agent.id}`);
  if (bus.connected) await bus.publish(ZHEvent.AGENT_SPAWNED, { agentId: agent.id });
  res.json(agent);
});

app.post("/api/tasks", async (req, res) => {
  const { agentId, type, description, priority, context } = req.body as {
    agentId?: string;
    type?: TaskType;
    description?: string;
    priority?: 1 | 2 | 3;
    context?: string[];
  };
  if (!agentId || !agents.has(agentId)) return res.status(400).json({ error: "Valid agentId is required" });
  if (!description?.trim()) return res.status(400).json({ error: "description is required" });
  const selectedAgent = agents.get(agentId);
  if (selectedAgent?.status === "paused") return res.status(423).json({ error: `${agentId} is paused by budget protection` });
  if (currentSpend() >= config.company.budget_usd) return res.status(423).json({ error: "Global budget is exhausted" });

  const now = new Date().toISOString();
  const task: Task = {
    id: `task_${nanoid(8)}`,
    agentId,
    type: type ?? "coding",
    description: description.trim(),
    context: context ?? [],
    priority: priority ?? 2,
    status: "assigned",
    worktreePath: path.join(config.infrastructure.worktree_base, agentId, now.slice(0, 10)),
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
    }, 1200);
  }
  res.status(201).json(task);
});

app.post("/api/tasks/:taskId/approve", (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  task.status = "done";
  task.updatedAt = new Date().toISOString();
  const agent = agents.get(task.agentId);
  if (agent) agent.status = "idle";
  addEvent("zh:task:approved", `Approved ${task.id}`);
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
