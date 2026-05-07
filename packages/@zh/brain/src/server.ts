import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { agentsFromConfig, loadConfig, RedisEventBus, Task, upstreamSources, ZHEvent } from "@zh/sdk";

const config = loadConfig();
const app = express();
const agents = new Map(agentsFromConfig(config).map((agent) => [agent.id, agent]));
const memory = new Map<string, string[]>();
const activeTasks = new Map<string, Task>();
const bus = new RedisEventBus(config.infrastructure.redis_url, "brain");
const routerUrl = config.infrastructure.services?.router_url?.replace(/\/$/, "") ?? "";
const hermesUrl = config.infrastructure.services?.brain_url?.replace(/\/$/, "") ?? "";
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

app.use(cors());
app.use(express.json());

function remember(agentId: string, note: string): void {
  const notes = memory.get(agentId) ?? [];
  notes.unshift(`${new Date().toISOString()} ${note}`);
  memory.set(agentId, notes.slice(0, 20));
}

async function checkHermes(): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!hermesUrl) return { ok: false, error: "Hermes URL is not configured" };
  try {
    const response = await fetch(hermesUrl, { signal: AbortSignal.timeout(2500) });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

async function askRouter(task: Task, agentRole: string): Promise<string> {
  if (!routerUrl) {
    return "Router URL is not configured, so Brain recorded the task without an LLM planning pass.";
  }

  try {
    const response = await fetch(`${routerUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer sk_9router",
        "x-zh-combo": agents.get(task.agentId)?.modelCombo ?? "cheap_stack",
        "x-zh-agent-id": task.agentId,
        "x-zh-task-id": task.id
      },
      body: JSON.stringify({
        model: agents.get(task.agentId)?.modelCombo ?? "zero-human-auto",
        messages: [
          {
            role: "system",
            content: "You are the Zero-Human Brain adapter. Produce a concise execution note for the task queue."
          },
          {
            role: "user",
            content: `Agent role: ${agentRole}\nTask type: ${task.type}\nPriority: P${task.priority}\nTask: ${task.description}`
          }
        ]
      })
    });
    const body = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: unknown;
    };
    return body.choices?.[0]?.message?.content?.trim() || `Router returned HTTP ${response.status}; Brain kept the task in review for manual follow-up.`;
  } catch (error) {
    return `Router bridge failed: ${(error as Error).message}. Brain kept the task in review for manual follow-up.`;
  }
}

function resolveWorktreeBase(): string {
  return path.isAbsolute(config.infrastructure.worktree_base)
    ? config.infrastructure.worktree_base
    : path.resolve(repoRoot, config.infrastructure.worktree_base);
}

function assertWorktreePath(worktreePath?: string): string {
  if (!worktreePath) throw new Error("Task does not include a worktreePath");
  const resolved = path.resolve(worktreePath);
  const base = resolveWorktreeBase();
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Refusing to execute outside worktree base: ${resolved}`);
  }
  return resolved;
}

async function runCommand(command: string, cwd: string): Promise<string> {
  const [bin, ...args] = command.split(" ").filter(Boolean);
  if (!bin) return "";
  const { stdout, stderr } = await execFileAsync(bin, args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return [stdout, stderr].filter(Boolean).join("\n").trim();
}

async function changedFiles(worktreePath: string): Promise<string[]> {
  const output = await runCommand("git status --short", worktreePath);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^.. /, ""));
}

async function runLocalExecutor(task: Task, executionNote: string): Promise<{
  changedFiles: string[];
  validationCommand: string;
  validationOutput: string;
  executorOutput: string;
}> {
  const worktreePath = assertWorktreePath(task.worktreePath);
  const outputDir = path.join(worktreePath, ".zero-human", "tasks");
  const outputPath = path.join(outputDir, `${task.id}.md`);
  const validationCommand = task.validationCommand ?? "git status --short";
  const content = [
    `# ${task.id}`,
    "",
    `Agent: ${task.agentId}`,
    `Type: ${task.type}`,
    `Priority: P${task.priority}`,
    `Branch: ${task.branchName ?? "unknown"}`,
    "",
    "## Request",
    task.description,
    "",
    "## Router Execution Note",
    executionNote,
    "",
    "## Next Review Action",
    "Review this worktree diff from the Zero-Human dashboard, then approve or reject the task."
  ].join("\n");

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, content, "utf8");
  await execFileAsync("git", ["config", "--global", "--add", "safe.directory", worktreePath], { windowsHide: true });
  await execFileAsync("git", ["config", "--global", "--add", "safe.directory", "/repo"], { windowsHide: true }).catch(() => undefined);
  const validationOutput = await runCommand(validationCommand, worktreePath);
  return {
    changedFiles: await changedFiles(worktreePath),
    validationCommand,
    validationOutput,
    executorOutput: `Wrote ${path.relative(worktreePath, outputPath)}`
  };
}

async function handleTask(task: Task): Promise<void> {
  const agent = agents.get(task.agentId);
  if (!agent) {
    await bus.publish(ZHEvent.AGENT_ERROR, { taskId: task.id, message: `Unknown agent ${task.agentId}` });
    return;
  }

  agent.status = "working";
  activeTasks.set(task.id, { ...task, status: "in_progress", updatedAt: new Date().toISOString() });
  await bus.publish(ZHEvent.TASK_STARTED, { ...task, status: "in_progress", updatedAt: new Date().toISOString() });

  const [hermes, executionNote] = await Promise.all([
    checkHermes(),
    askRouter(task, agent.role)
  ]);
  let executorResult: Awaited<ReturnType<typeof runLocalExecutor>>;
  try {
    executorResult = await runLocalExecutor(task, executionNote);
  } catch (error) {
    const failed: Task = {
      ...task,
      status: "error",
      result: `Executor failed: ${(error as Error).message}`,
      updatedAt: new Date().toISOString()
    };
    activeTasks.set(task.id, failed);
    agent.status = "error";
    await bus.publish(ZHEvent.AGENT_ERROR, { taskId: task.id, agentId: task.agentId, message: failed.result });
    await bus.publish(ZHEvent.TASK_COMPLETED, failed);
    return;
  }

  const completed: Task = {
    ...task,
    status: "pending_review",
    result: [
      `${agent.role.toUpperCase()} prepared this ${task.type} task through the Hermes/Router bridge.`,
      `Hermes dashboard: ${hermes.ok ? `online (${hermes.status})` : `unavailable (${hermes.error ?? hermes.status ?? "unknown"})`}.`,
      `Router note: ${executionNote}`,
      `Executor: ${executorResult.executorOutput}`,
      `Validation: ${executorResult.validationCommand}`
    ].join(" "),
    changedFiles: executorResult.changedFiles,
    validationCommand: executorResult.validationCommand,
    validationOutput: executorResult.validationOutput,
    executorOutput: executorResult.executorOutput,
    costAccumulated: 0,
    updatedAt: new Date().toISOString()
  };
  activeTasks.set(task.id, completed);
  agent.status = "reviewing";
  remember(agent.id, `Handled ${task.type} task ${task.id}: ${task.description}`);
  await bus.publish(ZHEvent.SKILL_LEARNED, {
    agentId: agent.id,
    skill: task.type,
    taskId: task.id,
    confidence: 0.72
  });
  await bus.publish(ZHEvent.TASK_COMPLETED, completed);
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
    routerUrl,
    hermesUrl,
    upstream: upstreamSources.find((source) => source.name === "brain")
  });
});

app.get("/api/memory", (_req, res) => {
  res.json(Object.fromEntries(memory));
});

app.get("/api/tasks", (_req, res) => {
  res.json(Array.from(activeTasks.values()));
});

app.post("/api/tasks", async (req, res) => {
  const now = new Date().toISOString();
  const task = {
    ...req.body,
    id: req.body.id ?? `brain_${Date.now()}`,
    type: req.body.type ?? "coding",
    priority: req.body.priority ?? 2,
    status: "assigned",
    context: req.body.context ?? [],
    costAccumulated: req.body.costAccumulated ?? 0,
    createdAt: req.body.createdAt ?? now,
    updatedAt: now
  } as Task;
  if (!task.agentId || !task.description) {
    return res.status(400).json({ error: "agentId and description are required" });
  }
  activeTasks.set(task.id, task);
  void handleTask(task);
  res.status(202).json(task);
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, "0.0.0.0", () => {
  console.log(`[brain] listening on http://0.0.0.0:${port}`);
});
