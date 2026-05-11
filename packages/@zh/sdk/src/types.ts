export type AgentRole =
  | "cto"
  | "frontend"
  | "backend"
  | "qa"
  | "devops"
  | "product"
  | "design"
  | "marketing"
  | "sales"
  | "support"
  | "finance"
  | "operations"
  | "research"
  | "legal";
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
  requiredSkills?: string[];
  roleGuidance?: string;
  priority: 1 | 2 | 3;
  status: TaskStatus;
  repositoryId?: string;
  repositoryName?: string;
  repositoryPath?: string;
  worktreePath?: string;
  branchName?: string;
  changedFiles?: string[];
  validationCommand?: string;
  validationOutput?: string;
  executorOutput?: string;
  hostCommit?: string;
  hostApplyStatus?: "applied" | "patch_written" | "skipped";
  hostPatchPath?: string;
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

export interface MeetingSummaryMemoryPayload {
  roomId: string;
  companyId: string;
  version: string;
  title: string;
  division?: string | null;
  status: "closed" | "archived";
  summary?: string | null;
  decisions: string[];
  blockers: string[];
  actionItems: string[];
  roleNeeds: string[];
  skillSignals: string[];
  participantAgentIds: string[];
  projectId?: string | null;
  issueId?: string | null;
  outcome?: Record<string, unknown> | null;
  closedAt?: string | null;
  updatedAt: string;
}

export enum ZHEvent {
  TASK_ASSIGNED = "zh:task:assigned",
  TASK_STARTED = "zh:task:started",
  TASK_COMPLETED = "zh:task:completed",
  AGENT_SPAWNED = "zh:agent:spawned",
  AGENT_READY = "zh:agent:ready",
  SKILL_LEARNED = "zh:skill:learned",
  MEETING_SUMMARY = "zh:meeting:summary",
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

export interface SkillDefinition {
  category: string;
  description: string;
  roles: AgentRole[];
  triggers: string[];
  tools?: string[];
  status?: "available" | "disabled";
  requiresApproval?: boolean;
  source?: string;
  sourcePath?: string;
  installs?: number;
  isOfficial?: boolean;
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
  skill_registry?: Record<string, SkillDefinition>;
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
