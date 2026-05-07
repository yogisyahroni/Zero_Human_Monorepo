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

const config = loadConfig();
const app = express();
const agents = new Map<string, Agent>(agentsFromConfig(config).map((agent) => [agent.id, agent]));
const tasks = new Map<string, Task>();
const events: Array<{ event: string; timestamp: string; summary: string }> = [];
const routerMetrics = { requests: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
const bus = new RedisEventBus(config.infrastructure.redis_url, "hr");

function addEvent(event: string, summary: string): void {
  events.unshift({ event, timestamp: new Date().toISOString(), summary });
  events.splice(80);
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
  const task = message.payload;
  tasks.set(task.id, task);
  const agent = agents.get(task.agentId);
  if (agent) {
    agent.status = "reviewing";
    agent.costAccumulatedUsd += task.costAccumulated ?? 0;
  }
});
bus.on<{ costUsd: number; inputTokens: number; outputTokens: number }>(ZHEvent.COST_ACCUMULATED, (message) => {
  routerMetrics.requests += 1;
  routerMetrics.costUsd += message.payload.costUsd;
  routerMetrics.inputTokens += message.payload.inputTokens;
  routerMetrics.outputTokens += message.payload.outputTokens;
});
bus.on<{ agentId: string }>(ZHEvent.AGENT_READY, (message) => {
  const agent = agents.get(message.payload.agentId);
  if (agent) agent.status = "idle";
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

app.get("/api/state", (_req, res) => {
  const totalAgentBudget = Array.from(agents.values()).reduce((sum, agent) => sum + agent.maxBudgetUsd, 0);
  const spent = Array.from(agents.values()).reduce((sum, agent) => sum + agent.costAccumulatedUsd, 0) + routerMetrics.costUsd;
  res.json({
    company: config.company,
    infrastructure: {
      redisUrl: config.infrastructure.redis_url,
      worktreeBase: config.infrastructure.worktree_base
    },
    policies: config.orchestrator,
    agents: Array.from(agents.values()),
    tasks: Array.from(tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    events,
    routerMetrics,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, "../web/dist");
app.use(express.static(webDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(webDist, "index.html"));
});

const port = Number(process.env.PORT ?? config.orchestrator.port);
app.listen(port, config.orchestrator.host, () => {
  console.log(`[hr] listening on http://${config.orchestrator.host}:${port}`);
});
