import cors from "cors";
import express from "express";
import { agentsFromConfig, loadConfig, RedisEventBus, Task, upstreamSources, ZHEvent } from "@zh/sdk";

const config = loadConfig();
const app = express();
const agents = new Map(agentsFromConfig(config).map((agent) => [agent.id, agent]));
const memory = new Map<string, string[]>();
const activeTasks = new Map<string, Task>();
const bus = new RedisEventBus(config.infrastructure.redis_url, "brain");

app.use(cors());
app.use(express.json());

function remember(agentId: string, note: string): void {
  const notes = memory.get(agentId) ?? [];
  notes.unshift(`${new Date().toISOString()} ${note}`);
  memory.set(agentId, notes.slice(0, 20));
}

async function handleTask(task: Task): Promise<void> {
  const agent = agents.get(task.agentId);
  if (!agent) {
    await bus.publish(ZHEvent.AGENT_ERROR, { taskId: task.id, message: `Unknown agent ${task.agentId}` });
    return;
  }

  agent.status = "working";
  activeTasks.set(task.id, { ...task, status: "in_progress", updatedAt: new Date().toISOString() });
  await bus.publish(ZHEvent.TASK_STARTED, { taskId: task.id, agentId: task.agentId });

  const delayMs = task.type === "architecture" ? 900 : 1300;
  setTimeout(async () => {
    const completed: Task = {
      ...task,
      status: "pending_review",
      result: `${agent.role.toUpperCase()} completed a simulated ${task.type} run. Next step: review worktree and connect real executor.`,
      costAccumulated: Number((0.02 + Math.random() * 0.08).toFixed(4)),
      updatedAt: new Date().toISOString()
    };
    activeTasks.set(task.id, completed);
    agent.status = "reviewing";
    agent.costAccumulatedUsd += completed.costAccumulated ?? 0;
    remember(agent.id, `Handled ${task.type} task ${task.id}: ${task.description}`);
    await bus.publish(ZHEvent.TASK_COMPLETED, completed);
  }, delayMs);
}

bus.on<Task>(ZHEvent.TASK_ASSIGNED, async (message) => handleTask(message.payload));
bus.on<{ agentId: string }>(ZHEvent.AGENT_SPAWNED, async (message) => {
  const agent = agents.get(message.payload.agentId);
  if (!agent) return;
  agent.status = "idle";
  remember(agent.id, "Agent profile initialized by HR.");
  await bus.publish(ZHEvent.AGENT_READY, { agentId: agent.id });
});

bus.connect().then(() => {
  console.log("[brain] connected to Redis event bus");
}).catch((error) => {
  console.warn(`[brain] Redis unavailable, task automation disabled: ${error.message}`);
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "@zh/brain",
    redis: bus.connected,
    agents: agents.size,
    upstream: upstreamSources.find((source) => source.name === "brain")
  });
});

app.get("/api/memory", (_req, res) => {
  res.json(Object.fromEntries(memory));
});

app.get("/api/tasks", (_req, res) => {
  res.json(Array.from(activeTasks.values()));
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, "0.0.0.0", () => {
  console.log(`[brain] listening on http://0.0.0.0:${port}`);
});
