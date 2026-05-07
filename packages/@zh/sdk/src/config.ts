import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { Agent, ZeroHumanConfig } from "./types.js";

const configSchema = z.object({
  version: z.string(),
  company: z.object({
    name: z.string(),
    description: z.string(),
    budget_usd: z.number(),
    currency: z.string()
  }),
  infrastructure: z.object({
    redis_url: z.string(),
    docker_socket: z.string(),
    worktree_base: z.string(),
    services: z.object({
      router_url: z.string(),
      brain_url: z.string(),
      hr_url: z.string()
    }).optional()
  }),
  gateway: z.object({
    port: z.number(),
    host: z.string(),
    rtk_token_saver: z.boolean(),
    caveman_mode: z.boolean(),
    log_level: z.string(),
    providers: z.record(z.object({ api_key: z.string().optional(), priority: z.number() })),
    combos: z.record(z.array(z.object({
      provider: z.string(),
      model: z.string(),
      auth: z.string().optional()
    })))
  }),
  agents: z.record(z.object({
    role: z.enum(["cto", "frontend", "backend", "qa", "devops", "product", "design", "marketing", "sales", "support", "finance", "operations", "research", "legal"]),
    brain: z.enum(["hermes", "simple"]),
    memory: z.enum(["persistent", "session"]),
    model_combo: z.string(),
    executor: z.enum(["claude-code", "codex", "cursor", "bash"]),
    max_budget_usd: z.number(),
    skills: z.array(z.string()).optional(),
    schedule: z.string().nullable().optional()
  })),
  skill_registry: z.record(z.object({
    category: z.string(),
    description: z.string(),
    roles: z.array(z.enum(["cto", "frontend", "backend", "qa", "devops", "product", "design", "marketing", "sales", "support", "finance", "operations", "research", "legal"])),
    triggers: z.array(z.string()),
    tools: z.array(z.string()).optional()
  })).optional(),
  orchestrator: z.object({
    port: z.number(),
    host: z.string(),
    approval_required: z.boolean(),
    approval_threshold_usd: z.number(),
    auto_merge: z.boolean(),
    log_level: z.string()
  }),
  notifications: z.object({
    webhook_url: z.string().optional(),
    events: z.array(z.string())
  })
});

function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)(?::-(.*?))?\}/gi, (_, name: string, fallback = "") => {
    return process.env[name] ?? fallback;
  });
}

function expandObject<T>(input: T): T {
  if (typeof input === "string") return expandEnv(input) as T;
  if (Array.isArray(input)) return input.map(expandObject) as T;
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, expandObject(value)])
    ) as T;
  }
  return input;
}

export function resolveConfigPath(configPath = process.env.ZH_CONFIG_PATH): string {
  if (configPath) return path.resolve(configPath);

  let current = process.cwd();
  while (true) {
    const candidate = path.join(current, "config", "zero-human.yaml");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return path.resolve("config/zero-human.yaml");
}

export function loadConfig(configPath?: string): ZeroHumanConfig {
  const resolved = resolveConfigPath(configPath);
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = expandObject(yaml.load(raw));
  return configSchema.parse(parsed);
}

export function agentsFromConfig(config: ZeroHumanConfig): Agent[] {
  return Object.entries(config.agents).map(([id, agent]) => ({
    id,
    role: agent.role,
    brain: agent.brain,
    memory: agent.memory,
    modelCombo: agent.model_combo,
    executor: agent.executor,
    maxBudgetUsd: agent.max_budget_usd,
    status: "idle",
    skills: agent.skills ?? [],
    schedule: agent.schedule ?? null,
    costAccumulatedUsd: 0
  }));
}
