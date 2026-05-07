import cors from "cors";
import express from "express";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { agentsFromConfig, loadConfig, RedisEventBus, type Agent, Task, upstreamSources, ZHEvent } from "@zh/sdk";

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
const memoryPath = process.env.ZH_BRAIN_MEMORY_PATH ?? "/root/.hermes/zero-human-memory.json";
const executorTimeoutMs = Number(process.env.ZH_EXECUTOR_TIMEOUT_MS ?? 15 * 60 * 1000);

type SkillMemory = {
  agentId: string;
  skill: string;
  runs: number;
  confidence: number;
  averageDurationMs: number;
  updatedAt: string;
};

type TaskOutcome = {
  taskId: string;
  agentId: string;
  type: string;
  description: string;
  changedFiles: string[];
  validationPassed: boolean;
  durationMs: number;
  updatedAt: string;
};

type PersistedMemory = {
  notes: Record<string, string[]>;
  outcomes: TaskOutcome[];
  skills: Record<string, SkillMemory>;
};

const persisted: PersistedMemory = loadMemory();

app.use(cors());
app.use(express.json());

function hermesMemoryContractStatus(): {
  mode: "json-fallback" | "native-contract-detected";
  stableApi: boolean;
  providerInterface: boolean;
  managerInterface: boolean;
  bundledProviders: string[];
  note: string;
} {
  const upstreamRoot = path.join(repoRoot, "packages/@zh/brain/upstream");
  const providerInterface = fsSync.existsSync(path.join(upstreamRoot, "agent/memory_provider.py"));
  const managerInterface = fsSync.existsSync(path.join(upstreamRoot, "agent/memory_manager.py"));
  const pluginsDir = path.join(upstreamRoot, "plugins/memory");
  const bundledProviders = fsSync.existsSync(pluginsDir)
    ? fsSync.readdirSync(pluginsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && fsSync.existsSync(path.join(pluginsDir, entry.name, "__init__.py")))
      .map((entry) => entry.name)
    : [];
  const contractDetected = providerInterface && managerInterface;
  return {
    mode: contractDetected ? "native-contract-detected" : "json-fallback",
    stableApi: false,
    providerInterface,
    managerInterface,
    bundledProviders,
    note: contractDetected
      ? "Hermes exposes an in-process MemoryProvider contract, but no stable HTTP/task memory API is available to replace the adapter JSON store yet."
      : "Hermes native memory contract was not found; Brain is using its JSON fallback store."
  };
}

function loadMemory(): PersistedMemory {
  try {
    if (!fsSync.existsSync(memoryPath)) return { notes: {}, outcomes: [], skills: {} };
    const parsed = JSON.parse(fsSync.readFileSync(memoryPath, "utf8")) as Partial<PersistedMemory>;
    return {
      notes: parsed.notes ?? {},
      outcomes: parsed.outcomes ?? [],
      skills: parsed.skills ?? {}
    };
  } catch (error) {
    console.warn(`[brain] failed to load memory: ${(error as Error).message}`);
    return { notes: {}, outcomes: [], skills: {} };
  }
}

async function saveMemory(): Promise<void> {
  await fs.mkdir(path.dirname(memoryPath), { recursive: true });
  await fs.writeFile(memoryPath, JSON.stringify(persisted, null, 2), "utf8");
}

function remember(agentId: string, note: string): void {
  const notes = persisted.notes[agentId] ?? memory.get(agentId) ?? [];
  notes.unshift(`${new Date().toISOString()} ${note}`);
  persisted.notes[agentId] = notes.slice(0, 50);
  memory.set(agentId, notes.slice(0, 20));
  void saveMemory();
}

function recentMemory(agentId: string): string {
  const notes = (persisted.notes[agentId] ?? []).slice(0, 5);
  const outcomes = persisted.outcomes.filter((outcome) => outcome.agentId === agentId).slice(0, 5);
  const skills = Object.values(persisted.skills)
    .filter((skill) => skill.agentId === agentId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  return [
    notes.length ? `Recent notes:\n${notes.map((note) => `- ${note}`).join("\n")}` : "",
    outcomes.length ? `Recent outcomes:\n${outcomes.map((outcome) => `- ${outcome.type} ${outcome.taskId}: ${outcome.validationPassed ? "passed" : "needs review"}; files=${outcome.changedFiles.join(", ") || "none"}`).join("\n")}` : "",
    skills.length ? `Learned skills:\n${skills.map((skill) => `- ${skill.skill}: ${Math.round(skill.confidence * 100)}% over ${skill.runs} runs`).join("\n")}` : ""
  ].filter(Boolean).join("\n\n") || "No prior memory for this agent yet.";
}

function recordOutcome(task: Task, changedFiles: string[], validationOutput: string, durationMs: number): {
  beforeConfidence: number;
  afterConfidence: number;
  runs: number;
} {
  const key = `${task.agentId}:${task.type}`;
  const existing = persisted.skills[key];
  const validationPassed = !validationOutput.toLowerCase().includes("fatal") && !validationOutput.toLowerCase().includes("error:");
  const runs = (existing?.runs ?? 0) + 1;
  const beforeConfidence = existing?.confidence ?? 0.55;
  const afterConfidence = Number(Math.min(0.98, beforeConfidence + (validationPassed ? 0.04 : 0.01)).toFixed(2));
  const averageDurationMs = Math.round((((existing?.averageDurationMs ?? durationMs) * (runs - 1)) + durationMs) / runs);

  persisted.skills[key] = {
    agentId: task.agentId,
    skill: task.type,
    runs,
    confidence: afterConfidence,
    averageDurationMs,
    updatedAt: new Date().toISOString()
  };
  persisted.outcomes.unshift({
    taskId: task.id,
    agentId: task.agentId,
    type: task.type,
    description: task.description,
    changedFiles,
    validationPassed,
    durationMs,
    updatedAt: new Date().toISOString()
  });
  persisted.outcomes.splice(100);
  void saveMemory();
  return { beforeConfidence, afterConfidence, runs };
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
            content: [
              "You are the Zero-Human Brain adapter. Produce a concise execution note for the task queue.",
              "Use persistent memory when it helps avoid repeating mistakes."
            ].join(" ")
          },
          {
            role: "user",
            content: [
              `Agent role: ${agentRole}`,
              `Task type: ${task.type}`,
              `Priority: P${task.priority}`,
              `Task: ${task.description}`,
              "",
              "Persistent memory:",
              recentMemory(task.agentId)
            ].join("\n")
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

async function executableAvailable(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ["--version"], {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

async function runProcess(bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<string> {
  const { stdout, stderr } = await execFileAsync(bin, args, {
    cwd,
    windowsHide: true,
    timeout: executorTimeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, ...env }
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

function executorPrompt(task: Task, agent: Agent, executionNote: string): string {
  return [
    "You are executing a Zero-Human task inside an isolated git worktree.",
    "Edit files only inside the current working directory.",
    "Keep the change small, reviewable, and aligned with the existing code style.",
    "Do not commit changes. Do not push. Leave the worktree ready for human review.",
    "",
    `Agent: ${task.agentId}`,
    `Role: ${agent.role}`,
    `Task type: ${task.type}`,
    `Priority: P${task.priority}`,
    `Branch: ${task.branchName ?? "unknown"}`,
    "",
    "Task:",
    task.description,
    "",
    "Persistent memory and router note:",
    executionNote
  ].join("\n");
}

async function writeFallbackArtifact(task: Task, executionNote: string, reason: string): Promise<string> {
  const worktreePath = assertWorktreePath(task.worktreePath);
  const outputDir = path.join(worktreePath, ".zero-human", "tasks");
  const outputPath = path.join(outputDir, `${task.id}.md`);
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
    "## Executor Fallback",
    reason,
    "",
    "## Router Execution Note",
    executionNote,
    "",
    "## Next Review Action",
    "Install or configure the requested executor, then rerun this task if code changes are required."
  ].join("\n");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, content, "utf8");
  return `Fallback artifact written to ${path.relative(worktreePath, outputPath)}`;
}

async function runCodexExecutor(prompt: string, worktreePath: string): Promise<string | null> {
  if (!(await executableAvailable("codex"))) return null;
  return runProcess("codex", [
    "exec",
    "--full-auto",
    "--skip-git-repo-check",
    prompt
  ], worktreePath, {
    CODEX_HOME: process.env.CODEX_HOME ?? "/root/.codex"
  });
}

async function runClaudeExecutor(prompt: string, worktreePath: string): Promise<string | null> {
  if (!(await executableAvailable("claude"))) return null;
  return runProcess("claude", [
    "-p",
    prompt,
    "--dangerously-skip-permissions"
  ], worktreePath, {
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? "/root/.claude"
  });
}

async function runBashExecutor(task: Task, executionNote: string, worktreePath: string): Promise<string> {
  return writeFallbackArtifact(task, executionNote, `Executor bash recorded the task inside ${worktreePath}.`);
}

async function runTaskExecutor(task: Task, agent: Agent, executionNote: string): Promise<{
  changedFiles: string[];
  validationCommand: string;
  validationOutput: string;
  executorOutput: string;
}> {
  const worktreePath = assertWorktreePath(task.worktreePath);
  const validationCommand = task.validationCommand ?? "git status --short";
  await execFileAsync("git", ["config", "--global", "--add", "safe.directory", worktreePath], { windowsHide: true });
  await execFileAsync("git", ["config", "--global", "--add", "safe.directory", "/repo"], { windowsHide: true }).catch(() => undefined);
  const prompt = executorPrompt(task, agent, executionNote);
  let executorOutput: string | null = null;

  if (agent.executor === "codex") {
    executorOutput = await runCodexExecutor(prompt, worktreePath);
  } else if (agent.executor === "claude-code") {
    executorOutput = await runClaudeExecutor(prompt, worktreePath);
    if (!executorOutput) executorOutput = await runCodexExecutor(prompt, worktreePath);
  } else if (agent.executor === "bash") {
    executorOutput = await runBashExecutor(task, executionNote, worktreePath);
  }

  if (!executorOutput) {
    executorOutput = await writeFallbackArtifact(
      task,
      executionNote,
      `Executor ${agent.executor} is not available in this container.`
    );
  }

  const validationOutput = await runCommand(validationCommand, worktreePath);
  return {
    changedFiles: await changedFiles(worktreePath),
    validationCommand,
    validationOutput,
    executorOutput
  };
}

async function handleTask(task: Task): Promise<void> {
  const startedAt = Date.now();
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
  let executorResult: Awaited<ReturnType<typeof runTaskExecutor>>;
  try {
    executorResult = await runTaskExecutor(task, agent, executionNote);
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
  const durationMs = Date.now() - startedAt;
  const skill = recordOutcome(task, executorResult.changedFiles, executorResult.validationOutput, durationMs);
  remember(agent.id, `Handled ${task.type} task ${task.id}: ${task.description}; files=${executorResult.changedFiles.join(", ") || "none"}; duration=${durationMs}ms`);
  await bus.publish(ZHEvent.SKILL_LEARNED, {
    agentId: agent.id,
    skill: task.type,
    taskId: task.id,
    confidence: skill.afterConfidence,
    beforeConfidence: skill.beforeConfidence,
    afterConfidence: skill.afterConfidence,
    runs: skill.runs,
    durationMs,
    changedFiles: executorResult.changedFiles,
    validationPassed: !executorResult.validationOutput.toLowerCase().includes("fatal")
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
    memoryContract: hermesMemoryContractStatus(),
    upstream: upstreamSources.find((source) => source.name === "brain")
  });
});

app.get("/api/memory", (_req, res) => {
  res.json({
    notes: persisted.notes,
    outcomes: persisted.outcomes,
    skills: Object.values(persisted.skills),
    native: hermesMemoryContractStatus()
  });
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
