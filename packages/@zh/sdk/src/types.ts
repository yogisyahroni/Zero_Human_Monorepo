export type AgentRole = "cto" | "frontend" | "backend" | "qa" | "devops";
export type BrainKind = "hermes" | "simple";
export type MemoryKind = "persistent" | "session";
export type ExecutorKind = "claude-code" | "codex" | "cursor" | "bash";
export type AgentStatus = "idle" | "working" | "reviewing" | "paused" | "error";

export interface Agent {
  id: string;
  role: AgentRole;
  brain: BrainKind;
  memory: MemoryKind;
  modelCombo: string;
  executor: ExecutorKind;
  maxBudgetUsd: number;
  status: AgentStatus;
  skills: string[];
  schedule?: string | null;
  costAccumulatedUsd: number;
}

export type TaskType = "architecture" | "coding" | "review" | "test" | "deploy";
export type TaskStatus =
  | "queued"
  | "assigned"
  | "in_progress"
  | "pending_review"
  | "done"
  | "error";

export interface Task {
  id: string;
  agentId: string;
  type: TaskType;
  description: string;
  context?: string[];
  priority: 1 | 2 | 3;
  status: TaskStatus;
  worktreePath?: string;
  branchName?: string;
  changedFiles?: string[];
  validationCommand?: string;
  validationOutput?: string;
  executorOutput?: string;
  costAccumulated?: number;
  result?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ZHEnvelope<TPayload = unknown> {
  event: ZHEvent;
  timestamp: string;
  payload: TPayload;
  metadata: {
    source: "hr" | "brain" | "router" | "sdk";
    version: string;
  };
}

export enum ZHEvent {
  TASK_ASSIGNED = "zh:task:assigned",
  TASK_STARTED = "zh:task:started",
  TASK_COMPLETED = "zh:task:completed",
  AGENT_SPAWNED = "zh:agent:spawned",
  AGENT_READY = "zh:agent:ready",
  SKILL_LEARNED = "zh:skill:learned",
  QUOTA_EXHAUSTED = "zh:quota:exhausted",
  COST_THRESHOLD = "zh:cost:threshold",
  COST_ACCUMULATED = "zh:cost:accumulated",
  AGENT_ERROR = "zh:agent:error"
}

export interface CompanyConfig {
  name: string;
  description: string;
  budget_usd: number;
  currency: string;
}

export interface ZeroHumanConfig {
  version: string;
  company: CompanyConfig;
  infrastructure: {
    redis_url: string;
    docker_socket: string;
    worktree_base: string;
    services?: {
      router_url: string;
      brain_url: string;
      hr_url: string;
    };
  };
  gateway: {
    port: number;
    host: string;
    rtk_token_saver: boolean;
    caveman_mode: boolean;
    log_level: string;
    providers: Record<string, { api_key?: string; priority: number }>;
    combos: Record<string, Array<{ provider: string; model: string; auth?: string }>>;
  };
  agents: Record<string, {
    role: AgentRole;
    brain: BrainKind;
    memory: MemoryKind;
    model_combo: string;
    executor: ExecutorKind;
    max_budget_usd: number;
    skills?: string[];
    schedule?: string | null;
  }>;
  orchestrator: {
    port: number;
    host: string;
    approval_required: boolean;
    approval_threshold_usd: number;
    auto_merge: boolean;
    log_level: string;
  };
  notifications: {
    webhook_url?: string;
    events: string[];
  };
}
