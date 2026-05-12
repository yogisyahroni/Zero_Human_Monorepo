import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BadgeDollarSign,
  Brain,
  Check,
  CircuitBoard,
  Download,
  FolderGit2,
  Gauge,
  GitBranch,
  PackageSearch,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Save,
  ShieldCheck,
  TerminalSquare,
  Users
} from "lucide-react";
import "./styles.css";

type ViewId = "operations" | "agents" | "memory" | "gateway" | "mcp" | "workroom";

type Agent = {
  id: string;
  role: string;
  brain: string;
  memory: string;
  modelCombo: string;
  executor: string;
  maxBudgetUsd: number;
  status: string;
  skills: string[];
  costAccumulatedUsd: number;
};

type Task = {
  id: string;
  agentId: string;
  type: string;
  description: string;
  requiredSkills?: string[];
  roleGuidance?: string;
  priority: 1 | 2 | 3;
  status: string;
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
  status: "ready" | "syncing" | "error";
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
  error?: string;
};

type HiringRequest = {
  id: string;
  source: "paperclip" | "zero-human-ui" | "api";
  title: string;
  department?: string;
  description?: string;
  requestedRole?: string;
  suggestedRole: string;
  suggestedSkills: string[];
  suggestedAgentId: string;
  suggestedExecutor: string;
  suggestedModelCombo: string;
  suggestedBudgetUsd: number;
  confidence: number;
  status: "pending_approval" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
  decisionNote?: string;
};

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

type McpServerConfig = {
  id: string;
  name: string;
  description: string;
  category: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  roles: string[];
  permissions: {
    mode: "read-only" | "write" | "approval-required";
    requiresApproval: string[];
  };
  status: "available" | "installed" | "enabled" | "disabled" | "error";
  packageName?: string;
  homepage?: string;
  tags?: string[];
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

type PaperclipSyncRecord = {
  agentId: string;
  role: string;
  desiredName: string;
  desiredHash: string;
  desiredSkills: string[];
  desiredMcpServers: Array<{
    id: string;
    name: string;
    transport: "stdio" | "http" | "sse";
    permissionMode: "read-only" | "write" | "approval-required";
  }>;
  executor: string;
  modelCombo: string;
  status: "missing" | "drifted" | "synced";
  runbook: string;
  paperclipAgentId?: string;
  lastSyncedAt?: string;
  updatedAt: string;
};

type PaperclipSyncState = {
  paperclipUrl: string;
  updatedAt: string;
  records: PaperclipSyncRecord[];
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
type PaperclipChatSignalReport = {
  id: string;
  companyId?: string;
  scanned: number;
  detected: number;
  createdRequests: number;
  skippedDuplicates: number;
  processedComments: number;
  unavailable: boolean;
  details: Array<{
    commentId: string;
    issueKey: string;
    issueTitle: string;
    agentName?: string;
    role?: string;
    action: "hiring_request_created" | "duplicate_skipped" | "ignored";
    reason: string;
    hiringRequestId?: string;
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
    action: "protocol_synced" | "paperclip_hiring_authority" | "agent_created" | "agent_patched" | "agent_already_ready" | "hierarchy_patched" | "duplicate_detected" | "memory_written" | "skipped";
    reason: string;
  }>;
  error?: string;
  createdAt: string;
};
type PaperclipHermesInterventionTrigger =
  | "blocked_issue"
  | "missing_disposition"
  | "failed_run"
  | "high_churn"
  | "stale_in_progress"
  | "high_cost_run"
  | "stale_meeting";
type PaperclipHermesInterventionReport = {
  id: string;
  companyId?: string;
  scanned: number;
  intervened: number;
  skippedCooldown: number;
  wakeupsQueued: number;
  memoryNotesWritten: number;
  meetingsScanned: number;
  meetingsFlagged: number;
  highCostRuns: number;
  comboPolicy: { configuredCombos: string[]; defaultCombo: string; note: string };
  unavailable: boolean;
  details: Array<{
    issueId?: string;
    issueKey?: string;
    title?: string;
    meetingId?: string;
    meetingTitle?: string;
    trigger: PaperclipHermesInterventionTrigger;
    action: "commented" | "commented_and_woke_agent" | "cooldown_skipped" | "ignored" | "owner_notified";
    assignee?: string;
    metric?: string;
    reason: string;
  }>;
  error?: string;
  createdAt: string;
};

type HermesAgentMemoryPanel = {
  agentId: string;
  role: string;
  executor: string;
  modelCombo: string;
  memoryInjected: boolean;
  memoryNoteCount: number;
  recentMemory: Array<{ agentId: string; note: string }>;
  skillsAssigned: string[];
  mcpAssigned: Array<{ id: string; name: string; status: string; mandatory: boolean }>;
  learnedOutcomes: number;
  failedLearning: number;
  confidence: number;
  relevance: number;
  status: "ready" | "partial" | "missing";
  lastLearnedAt?: string;
};

type RouterMonitor = {
  ok: boolean;
  activeCombo: string;
  configuredCombos: string[];
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  modelDistribution: Array<{
    combo: string;
    provider: string;
    model: string;
    active: boolean;
    configured: boolean;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  providerFallbacks: Array<{
    provider: string;
    requests: number;
    fallbackCount: number;
    failureCount: number;
    status: "ok" | "fallback" | "failed" | "idle";
    lastModel?: string;
  }>;
  failedProviders: Array<{ provider: string; failures: number; reason: string }>;
  spikeGuardrail: {
    status: "ok" | "warning" | "critical";
    reason: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    highCostRuns: number;
    thresholdTokens: number;
    thresholdCostUsd: number;
  };
  updatedAt: string;
};

type AgentIssueDecision = "auto_assign" | "triage" | "approval_required" | "blocked";
type AgentIssuePolicy = {
  role: string;
  canCreateIssue: boolean;
  autoAssign: boolean;
  allowedTaskTypes: string[];
  approvalKeywords: string[];
  triageKeywords: string[];
  maxPriorityWithoutApproval: 1 | 2 | 3;
  defaultDecision: AgentIssueDecision;
  note: string;
};
type AgentIssuePolicyEvaluation = {
  agentId: string;
  role: string;
  decision: AgentIssueDecision;
  reason: string;
  suggestedTaskType: string;
  suggestedAssignee: string;
  requiresHumanReview: boolean;
};
type WorkroomRun = {
  id: string;
  shortId: string;
  status: string;
  agentName: string;
  agentRole: string;
  issueKey?: string;
  issueTitle?: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
  durationSec?: number;
  model?: string;
  adapterType?: string;
  invocationSource?: string;
  repo?: string;
  commandStatus: string;
  tokenEstimate: number;
  rootError?: string;
  recommendedAction?: string;
  workingDir?: string;
  workspaceReady: boolean;
  terminal: string[];
  fileChanges: Array<{ path: string; status: string }>;
  diffStat: string[];
  artifacts: Array<{ type: "document" | "code" | "config" | "asset" | "other"; path: string; title: string }>;
  gitError?: string;
};
type WorkroomState = {
  ok: boolean;
  companyId?: string;
  company?: PaperclipCompanyMonitor;
  updatedAt: string;
  activeRuns: number;
  changedFiles: number;
  unavailable: boolean;
  error?: string;
  runs: WorkroomRun[];
};

type PaperclipCompanySummary = {
  id: string;
  issuePrefix: string;
  name: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  agentCount: number;
  activeAgentCount: number;
  issueCount: number;
  openIssueCount: number;
  runCount: number;
  activeRunCount: number;
};

type PaperclipCompanyMonitor = {
  ok: boolean;
  paperclipUrl: string;
  source: "env" | "latest" | "fallback" | "unavailable";
  selectedCompanyId?: string;
  selectedIssuePrefix?: string;
  selectedName?: string;
  warning?: string;
  error?: string;
  duplicateNameWarnings: string[];
  companies: PaperclipCompanySummary[];
};

type MonitoringDiagnosticItem = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  action?: string;
  href?: string;
};

type MonitoringDiagnostics = {
  ok: boolean;
  mode: "monitoring_only" | "controls_enabled";
  generatedAt: string;
  selectedCompanyId?: string;
  selectedIssuePrefix?: string;
  selectedName?: string;
  items: MonitoringDiagnosticItem[];
  links: {
    paperclipDashboard: string;
    paperclipOrg: string;
    paperclipIssues: string;
    routerUsage: string;
    hermesLogs: string;
  };
};

type RealtimeState = {
  status: "connecting" | "live" | "fallback" | "stale";
  lastSeenAt: string;
  message: string;
};

type State = {
  company: { name: string; description: string; budget_usd: number; currency: string };
  infrastructure: {
    redisUrl: string;
    worktreeBase: string;
    services?: { router_url?: string; brain_url?: string; hr_url?: string };
  };
  policies: { approval_required: boolean; approval_threshold_usd: number; auto_merge: boolean };
  agents: Agent[];
  tasks: Task[];
  events: Array<{ id?: string; event: string; timestamp: string; summary: string; source?: string; agentId?: string; issueKey?: string }>;
  alerts: Array<{
    id: string;
    event: string;
    scope: "global" | "agent";
    message: string;
    severity: "warning" | "critical";
    timestamp: string;
    delivered: boolean;
    error?: string;
  }>;
  routerMetrics: { requests: number; costUsd: number; inputTokens: number; outputTokens: number };
  skillProgress: Array<{
    agentId: string;
    skill: string;
    runs: number;
    confidence: number;
    lastTaskId?: string;
    updatedAt: string;
  }>;
  serviceHealth: Array<{
    name: string;
    url: string;
    ok: boolean;
    status?: number;
    latencyMs?: number;
    error?: string;
  }>;
  brainMemory: {
    ok: boolean;
    agentCount: number;
    entries: number;
    outcomes: number;
    skills: Array<{ agentId: string; skill: string; runs: number; confidence: number; averageDurationMs?: number; updatedAt: string }>;
    recentNotes: Array<{ agentId: string; note: string }>;
    error?: string;
  };
  paperclipCompany: PaperclipCompanyMonitor;
  monitoringDiagnostics: MonitoringDiagnostics;
  hermesAgentMemory: HermesAgentMemoryPanel[];
  routerMonitor: RouterMonitor;
  upstreams: Array<{
    name: string;
    displayName: string;
    repository: string;
    branch: string;
    prefix: string;
    defaultUrl: string;
    configuredUrl: string;
    containerPort: number;
    role: string;
    present: boolean;
    packageName: string | null;
    version: string | null;
  }>;
  repositories: RegisteredRepository[];
  paperclipSync: PaperclipSyncState;
  paperclipSkillSync: PaperclipSkillSyncReport;
  paperclipRepositorySync: PaperclipRepositorySyncReport;
  paperclipChatSignals: PaperclipChatSignalReport;
  paperclipHermesBridge: PaperclipHermesBridgeReport;
  paperclipHermesInterventions: PaperclipHermesInterventionReport;
  issuePolicies: AgentIssuePolicy[];
  mcpMarketplace: McpMarketplaceItem[];
  mcpServers: McpServerConfig[];
  hiringRequests: HiringRequest[];
  skillImports: SkillImportReport[];
  skillRegistry: Record<string, {
    category: string;
    description: string;
    roles: string[];
    triggers: string[];
    tools?: string[];
    status?: "available" | "disabled";
    requiresApproval?: boolean;
    source?: string;
    sourcePath?: string;
    installs?: number;
    isOfficial?: boolean;
  }>;
  budget: { global: number; allocated: number; spent: number; currency: string };
  combos: Record<string, Array<{ provider: string; model: string }>>;
};

const fallbackState: State = {
  company: { name: "Zero-Human", description: "Loading console", budget_usd: 0, currency: "USD" },
  infrastructure: { redisUrl: "", worktreeBase: "", services: {} },
  policies: { approval_required: true, approval_threshold_usd: 0, auto_merge: false },
  agents: [],
  tasks: [],
  events: [],
  alerts: [],
  routerMetrics: { requests: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 },
  skillProgress: [],
  serviceHealth: [],
  brainMemory: { ok: false, agentCount: 0, entries: 0, outcomes: 0, skills: [], recentNotes: [] },
  paperclipCompany: {
    ok: false,
    paperclipUrl: "",
    source: "unavailable",
    duplicateNameWarnings: [],
    companies: []
  },
  monitoringDiagnostics: {
    ok: false,
    mode: "monitoring_only",
    generatedAt: "",
    items: [],
    links: {
      paperclipDashboard: "http://localhost:3100/dashboard",
      paperclipOrg: "http://localhost:3100/org",
      paperclipIssues: "http://localhost:3100/issues",
      routerUsage: "http://localhost:20128/dashboard/usage",
      hermesLogs: "http://localhost:9119/logs"
    }
  },
  hermesAgentMemory: [],
  routerMonitor: {
    ok: false,
    activeCombo: "",
    configuredCombos: [],
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    modelDistribution: [],
    providerFallbacks: [],
    failedProviders: [],
    spikeGuardrail: {
      status: "ok",
      reason: "",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      highCostRuns: 0,
      thresholdTokens: 0,
      thresholdCostUsd: 0
    },
    updatedAt: ""
  },
  upstreams: [],
  repositories: [],
  paperclipSync: { paperclipUrl: "", updatedAt: "", records: [] },
  paperclipSkillSync: {
    id: "paperclip_skills_not_run",
    registrySkills: 0,
    paperclipSkillsBefore: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    unavailable: false,
    details: [],
    createdAt: ""
  },
  paperclipRepositorySync: {
    id: "paperclip_repositories_not_run",
    repositoriesReady: 0,
    workspacesSynced: 0,
    issuesLinked: 0,
    unavailable: false,
    details: [],
    createdAt: ""
  },
  paperclipChatSignals: {
    id: "paperclip_chat_not_scanned",
    scanned: 0,
    detected: 0,
    createdRequests: 0,
    skippedDuplicates: 0,
    processedComments: 0,
    unavailable: false,
    details: [],
    createdAt: ""
  },
  paperclipHermesBridge: {
    id: "paperclip_hermes_not_synced",
    protocolSkillKey: "zero-human/hermes-operating-protocol",
    protocolSkillSynced: false,
    agentsScanned: 0,
    agentsPatched: 0,
    memoryNotesWritten: 0,
    unavailable: false,
    details: [],
    createdAt: ""
  },
  paperclipHermesInterventions: {
    id: "paperclip_hermes_interventions_not_run",
    scanned: 0,
    intervened: 0,
    skippedCooldown: 0,
    wakeupsQueued: 0,
    memoryNotesWritten: 0,
    meetingsScanned: 0,
    meetingsFlagged: 0,
    highCostRuns: 0,
    comboPolicy: { configuredCombos: [], defaultCombo: "", note: "" },
    unavailable: false,
    details: [],
    createdAt: ""
  },
  issuePolicies: [],
  mcpMarketplace: [],
  mcpServers: [],
  hiringRequests: [],
  skillImports: [],
  skillRegistry: {},
  budget: { global: 0, allocated: 0, spent: 0, currency: "USD" },
  combos: {}
};
const fallbackWorkroom: WorkroomState = {
  ok: false,
  updatedAt: "",
  activeRuns: 0,
  changedFiles: 0,
  unavailable: true,
  runs: []
};

function money(value: number): string {
  return `$${value.toFixed(value >= 10 ? 0 : 3)}`;
}

const views: Array<{ id: ViewId; label: string; eyebrow: string; title: string; description: string; icon: React.ReactNode }> = [
  {
    id: "operations",
    label: "Operations",
    eyebrow: "Owner observability",
    title: "Owner dashboard",
    description: "Monitor Paperclip company health, decisions, blockers, cost, repositories, and execution links.",
    icon: <Activity size={19} />
  },
  {
    id: "agents",
    label: "Agents",
    eyebrow: "Workforce",
    title: "Agent bench",
    description: "Monitor Paperclip workforce, role drift, skills, MCP readiness, and hiring signals. Hiring happens in Paperclip.",
    icon: <Users size={19} />
  },
  {
    id: "memory",
    label: "Memory",
    eyebrow: "Hermes brain",
    title: "Persistent memory",
    description: "Inspect learned skills, recent notes, outcomes, and the Redis event trail feeding Hermes.",
    icon: <Brain size={19} />
  },
  {
    id: "gateway",
    label: "Gateway",
    eyebrow: "AI routing",
    title: "9Router gateway monitor",
    description: "Observe repository and workspace readiness, service health, upstream code, and model combo routing.",
    icon: <RadioTower size={19} />
  },
  {
    id: "mcp",
    label: "MCP",
    eyebrow: "Tool marketplace",
    title: "MCP monitor",
    description: "Inspect installed MCP servers and role mapping. Paperclip receives the execution guidance.",
    icon: <PackageSearch size={19} />
  },
  {
    id: "workroom",
    label: "Execution",
    eyebrow: "Live monitor",
    title: "Execution Monitor",
    description: "Inspect Paperclip/Codex runs, terminal output, workspace paths, errors, artifacts, and files changed by agents.",
    icon: <TerminalSquare size={19} />
  }
];

function App() {
  const [state, setState] = useState<State>(fallbackState);
  const [workroom, setWorkroom] = useState<WorkroomState>(fallbackWorkroom);
  const [realtime, setRealtime] = useState<RealtimeState>({
    status: "connecting",
    lastSeenAt: "",
    message: "Connecting owner dashboard stream"
  });
  const [activeView, setActiveView] = useState<ViewId>("operations");
  const [selectedWorkroomRunId, setSelectedWorkroomRunId] = useState("");
  const [workroomFilters, setWorkroomFilters] = useState({
    query: "",
    agent: "all",
    status: "all",
    flag: "all"
  });
  const [selectedAgent, setSelectedAgent] = useState("cto");
  const [description, setDescription] = useState("Create an architecture plan for the authentication module.");
  const [type, setType] = useState("architecture");
  const [priority, setPriority] = useState<1 | 2 | 3>(2);
  const [repositoryId, setRepositoryId] = useState("default");
  const [repoDraft, setRepoDraft] = useState({
    name: "",
    url: "",
    branch: "main",
    sourceKind: "work" as "work" | "skill_source",
    authType: "none" as "none" | "https-token" | "ssh-key",
    username: "",
    token: "",
    sshPrivateKey: ""
  });
  const [skillSourceDraft, setSkillSourceDraft] = useState({
    name: "",
    url: "",
    branch: "main",
    sourceKind: "skill_source" as "work" | "skill_source",
    authType: "none" as "none" | "https-token" | "ssh-key",
    username: "",
    token: "",
    sshPrivateKey: ""
  });
  const [repoError, setRepoError] = useState("");
  const [skillSourceError, setSkillSourceError] = useState("");
  const [skillImportDraft, setSkillImportDraft] = useState({ repositoryId: "default", path: "" });
  const [skillImportError, setSkillImportError] = useState("");
  const [latestSkillImport, setLatestSkillImport] = useState<SkillImportReport | null>(null);
  const [paperclipSkillSyncError, setPaperclipSkillSyncError] = useState("");
  const [paperclipRepositorySyncError, setPaperclipRepositorySyncError] = useState("");
  const [paperclipChatSignalError, setPaperclipChatSignalError] = useState("");
  const [paperclipHermesBridgeError, setPaperclipHermesBridgeError] = useState("");
  const [paperclipHermesInterventionError, setPaperclipHermesInterventionError] = useState("");
  const [mcpQuery, setMcpQuery] = useState("");
  const [selectedMcpId, setSelectedMcpId] = useState("");
  const [mcpJsonDraft, setMcpJsonDraft] = useState("");
  const [mcpRegistryUrl, setMcpRegistryUrl] = useState("");
  const [customMcpDraft, setCustomMcpDraft] = useState(JSON.stringify({
    id: "custom-mcp",
    name: "Custom MCP",
    description: "Paste an MCP JSON config here.",
    category: "custom",
    transport: "stdio",
    command: "npx",
    args: ["-y", "package-name"],
    env: {},
    roles: ["operations"],
    permissions: { mode: "approval-required", requiresApproval: [] },
    tags: ["custom"]
  }, null, 2));
  const [mcpError, setMcpError] = useState("");
  const [mcpMessage, setMcpMessage] = useState("");
  const [issuePolicyDraft, setIssuePolicyDraft] = useState({
    agentId: "cto",
    title: "Fix flaky checkout test",
    description: "Agent found a follow-up issue while reviewing the repository.",
    type: "coding",
    priority: 2 as 1 | 2 | 3
  });
  const [issuePolicyEvaluation, setIssuePolicyEvaluation] = useState<AgentIssuePolicyEvaluation | null>(null);
  const [issuePolicyError, setIssuePolicyError] = useState("");
  const [hireDraft, setHireDraft] = useState({
    title: "Brand Strategist",
    department: "Marketing",
    description: "Plan launch messaging, campaign channels, and visual handoff with design.",
    requestedRole: ""
  });
  const [busy, setBusy] = useState(false);
  const [diffs, setDiffs] = useState<Record<string, { status: string; diff: string }>>({});
  const [budgetDraft, setBudgetDraft] = useState<{ globalBudgetUsd: string; agentCaps: Record<string, string> }>({
    globalBudgetUsd: "",
    agentCaps: {}
  });

  async function refresh(mode: "manual" | "fallback" = "manual") {
    const response = await fetch("/api/state");
    const body = await response.json();
    setState(body);
    setRealtime((current) => ({
      status: current.status === "live" && mode === "manual" ? "live" : mode === "fallback" ? "fallback" : current.status,
      lastSeenAt: new Date().toISOString(),
      message: mode === "fallback" ? "Polling fallback refreshed owner state" : "Manual refresh complete"
    }));
  }

  async function refreshWorkroom() {
    const response = await fetch("/api/workroom");
    setWorkroom(await response.json());
  }

  useEffect(() => {
    let closed = false;
    let lastSeen = Date.now();
    let source: EventSource | null = null;
    refresh("fallback").catch((error) => {
      if (!closed) {
        setRealtime({
          status: "stale",
          lastSeenAt: new Date().toISOString(),
          message: `Initial state fetch failed: ${(error as Error).message}`
        });
      }
    });

    if ("EventSource" in window) {
      source = new EventSource("/api/state/stream");
      source.addEventListener("connected", () => {
        lastSeen = Date.now();
        setRealtime({
          status: "live",
          lastSeenAt: new Date().toISOString(),
          message: "Connected to owner dashboard stream"
        });
      });
      source.addEventListener("state", (event) => {
        lastSeen = Date.now();
        const payload = JSON.parse((event as MessageEvent).data) as { state?: State; reason?: string; emittedAt?: string };
        if (payload.state) setState(payload.state);
        setRealtime({
          status: "live",
          lastSeenAt: payload.emittedAt ?? new Date().toISOString(),
          message: payload.reason ? `Live update: ${payload.reason}` : "Live update received"
        });
      });
      source.addEventListener("stream-error", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { error?: string; emittedAt?: string };
        setRealtime({
          status: "fallback",
          lastSeenAt: payload.emittedAt ?? new Date().toISOString(),
          message: payload.error ?? "Realtime stream reported an error; polling fallback remains active"
        });
      });
      source.onerror = () => {
        if (closed) return;
        setRealtime((current) => ({
          status: Date.now() - lastSeen > 30000 ? "stale" : "fallback",
          lastSeenAt: current.lastSeenAt,
          message: "Realtime stream reconnecting; polling fallback is active"
        }));
      };
    } else {
      setRealtime({
        status: "fallback",
        lastSeenAt: new Date().toISOString(),
        message: "Browser does not support realtime streams; using polling fallback"
      });
    }

    const fallbackInterval = window.setInterval(() => {
      if (Date.now() - lastSeen > 12000) void refresh("fallback");
    }, 15000);
    const staleInterval = window.setInterval(() => {
      if (Date.now() - lastSeen > 30000) {
        setRealtime((current) => ({
          ...current,
          status: "stale",
          message: "Owner dashboard stream is stale; last known data is shown"
        }));
      }
    }, 5000);

    return () => {
      closed = true;
      source?.close();
      window.clearInterval(fallbackInterval);
      window.clearInterval(staleInterval);
    };
  }, []);

  useEffect(() => {
    let closed = false;
    let lastSeen = Date.now();
    let source: EventSource | null = null;
    refreshWorkroom().catch(() => undefined);
    if ("EventSource" in window) {
      source = new EventSource("/api/workroom/stream");
      source.addEventListener("workroom", (event) => {
        lastSeen = Date.now();
        const payload = JSON.parse((event as MessageEvent).data) as { workroom?: WorkroomState };
        if (payload.workroom) setWorkroom(payload.workroom);
      });
      source.onerror = () => {
        if (!closed && Date.now() - lastSeen > 15000) void refreshWorkroom().catch(() => undefined);
      };
    }
    const interval = window.setInterval(() => {
      if (Date.now() - lastSeen > 15000) void refreshWorkroom().catch(() => undefined);
    }, 12000);
    return () => {
      closed = true;
      source?.close();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!state.agents.length || budgetDraft.globalBudgetUsd) return;
    setBudgetDraft({
      globalBudgetUsd: String(state.budget.global),
      agentCaps: Object.fromEntries(state.agents.map((agent) => [agent.id, String(agent.maxBudgetUsd)]))
    });
  }, [budgetDraft.globalBudgetUsd, state.agents, state.budget.global]);

  const activeTasks = useMemo(
    () => state.tasks.filter((task) => task.status !== "done").length,
    [state.tasks]
  );
  const selectedAgentProfile = state.agents.find((agent) => agent.id === selectedAgent);
  const budgetRemaining = Math.max(0, state.budget.global - state.budget.spent);
  const pausedAgents = state.agents.filter((agent) => agent.status === "paused").length;
  const currentView = views.find((view) => view.id === activeView) ?? views[0];
  const realtimeAge = realtime.lastSeenAt
    ? Math.max(0, Math.round((Date.now() - new Date(realtime.lastSeenAt).getTime()) / 1000))
    : null;
  const roleSkillRows = state.agents.map((agent) => ({
    agent,
    learned: state.skillProgress.filter((skill) => skill.agentId === agent.id)
  }));
  const registryEntries = Object.entries(state.skillRegistry);
  const registryCategories = Array.from(new Set(registryEntries.map(([, skill]) => skill.category))).sort();
  const pendingHiring = state.hiringRequests.filter((request) => request.status === "pending_approval");
  const workRepositories = state.repositories.filter((repo) => (repo.sourceKind ?? "work") === "work");
  const skillSourceRepositories = state.repositories.filter((repo) => repo.sourceKind === "skill_source");
  const installedMcpIds = new Set(state.mcpServers.map((server) => server.id));
  const selectedMcp = state.mcpServers.find((server) => server.id === selectedMcpId) ?? state.mcpServers[0];
  const filteredMarketplace = state.mcpMarketplace.filter((item) => {
    const haystack = [item.name, item.description, item.category, ...(item.tags ?? []), item.packageName].join(" ").toLowerCase();
    return haystack.includes(mcpQuery.toLowerCase());
  });
  const workroomAgents = Array.from(new Set(workroom.runs.map((run) => run.agentName).filter(Boolean))).sort();
  const workroomStatuses = Array.from(new Set(workroom.runs.map((run) => run.status).filter(Boolean))).sort();
  const filteredWorkroomRuns = workroom.runs.filter((run) => {
    const query = workroomFilters.query.trim().toLowerCase();
    const haystack = [
      run.agentName,
      run.agentRole,
      run.issueKey,
      run.issueTitle,
      run.repo,
      run.workingDir,
      run.model,
      run.commandStatus,
      run.rootError
    ].join(" ").toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesAgent = workroomFilters.agent === "all" || run.agentName === workroomFilters.agent;
    const matchesStatus = workroomFilters.status === "all" || run.status === workroomFilters.status;
    const isLongRunning = ["running", "queued"].includes(run.status) && (run.durationSec ?? 0) > 900;
    const matchesFlag =
      workroomFilters.flag === "all" ||
      (workroomFilters.flag === "failed" && ["failed", "error", "cancelled"].includes(run.status)) ||
      (workroomFilters.flag === "long" && isLongRunning) ||
      (workroomFilters.flag === "high-token" && run.tokenEstimate >= 50000) ||
      (workroomFilters.flag === "changed" && run.fileChanges.length > 0);
    return matchesQuery && matchesAgent && matchesStatus && matchesFlag;
  });
  const selectedWorkroomRun =
    filteredWorkroomRuns.find((run) => run.id === selectedWorkroomRunId) ??
    workroom.runs.find((run) => run.id === selectedWorkroomRunId) ??
    filteredWorkroomRuns[0] ??
    workroom.runs[0];
  const serviceUrl = (value: string | undefined, fallback: string) => (value && value.trim() ? value.replace(/\/$/, "") : fallback);
  const paperclipBaseUrl = serviceUrl(state.infrastructure.services?.hr_url, "http://localhost:3100");
  const hermesBaseUrl = serviceUrl(state.infrastructure.services?.brain_url, "http://localhost:9119");
  const routerBaseUrl = serviceUrl(state.infrastructure.services?.router_url, "http://localhost:20128");
  const activePaperclipCompany = state.paperclipCompany;
  const paperclipCompanyPrefix = activePaperclipCompany.selectedIssuePrefix ? `/${activePaperclipCompany.selectedIssuePrefix}` : "";
  const paperclipDashboardUrl = `${paperclipBaseUrl}${paperclipCompanyPrefix}/dashboard`;
  const paperclipOrgUrl = `${paperclipBaseUrl}${paperclipCompanyPrefix}/org`;
  const paperclipIssuesUrl = `${paperclipBaseUrl}${paperclipCompanyPrefix}/issues`;
  const monitoringDiagnostics = state.monitoringDiagnostics;
  const zeroHumanControlsVisible = false;
  const blockedTasks = state.tasks.filter((task) => ["blocked", "error"].includes(task.status));
  const pendingApprovals = state.tasks.filter((task) => ["pending_review", "review", "in_review"].includes(task.status));
  const activeRuns = workroom.runs.filter((run) => ["running", "queued"].includes(run.status));
  const failedRuns = workroom.runs.filter((run) => ["failed", "error", "cancelled"].includes(run.status));
  const highTokenRuns = workroom.runs.filter((run) => (run.tokenEstimate ?? 0) >= 50000);
  const repoErrors = workRepositories.filter((repo) => repo.status === "error");
  const guardrailDetails = state.paperclipHermesInterventions.details;
  const ownerDecisionCount =
    pendingHiring.length +
    pendingApprovals.length +
    state.alerts.length +
    guardrailDetails.filter((item) => ["missing_disposition", "stale_meeting", "high_cost_run", "blocked_issue"].includes(item.trigger)).length;
  const recentMemory = state.brainMemory.recentNotes.slice(0, 3);
  const hermesReadyAgents = state.hermesAgentMemory.filter((agent) => agent.status === "ready").length;
  const hermesMemoryInjected = state.hermesAgentMemory.filter((agent) => agent.memoryInjected).length;
  const routerSpike = state.routerMonitor.spikeGuardrail;

  useEffect(() => {
    if (!workRepositories.some((repo) => repo.id === repositoryId)) {
      setRepositoryId(workRepositories[0]?.id ?? "default");
    }
  }, [repositoryId, workRepositories]);

  useEffect(() => {
    if (state.agents.length && !state.agents.some((agent) => agent.id === issuePolicyDraft.agentId)) {
      setIssuePolicyDraft((current) => ({ ...current, agentId: state.agents[0].id }));
    }
  }, [issuePolicyDraft.agentId, state.agents]);

  useEffect(() => {
    if (!skillSourceRepositories.some((repo) => repo.id === skillImportDraft.repositoryId)) {
      setSkillImportDraft((current) => ({ ...current, repositoryId: skillSourceRepositories[0]?.id ?? "" }));
    }
  }, [skillImportDraft.repositoryId, skillSourceRepositories]);

  useEffect(() => {
    if (!selectedMcpId && state.mcpServers.length > 0) {
      setSelectedMcpId(state.mcpServers[0].id);
    }
  }, [selectedMcpId, state.mcpServers]);

  useEffect(() => {
    if (selectedMcp) {
      setMcpJsonDraft(JSON.stringify(selectedMcp, null, 2));
    }
  }, [selectedMcp?.id, selectedMcp?.updatedAt, selectedMcp?.status, selectedMcp?.lastTestAt]);

  async function hire(agentId: string) {
    setBusy(true);
    await fetch(`/api/agents/${agentId}/hire`, { method: "POST" });
    await refresh();
    setBusy(false);
  }

  async function resume(agentId: string) {
    setBusy(true);
    await fetch(`/api/agents/${agentId}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resetCost: true })
    });
    await refresh();
    setBusy(false);
  }

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: selectedAgent, type, description, priority, repositoryId })
    });
    setDescription("");
    await refresh();
    setBusy(false);
  }

  async function createHireRequest(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    await fetch("/api/hiring/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...hireDraft, source: "zero-human-ui" })
    });
    setHireDraft({ title: "", department: "", description: "", requestedRole: "" });
    await refresh();
    setBusy(false);
  }

  async function approveHireRequest(requestId: string) {
    setBusy(true);
    await fetch(`/api/hiring/requests/${requestId}/approve`, { method: "POST" });
    await refresh();
    setBusy(false);
  }

  async function rejectHireRequest(requestId: string) {
    setBusy(true);
    await fetch(`/api/hiring/requests/${requestId}/reject`, { method: "POST" });
    await refresh();
    setBusy(false);
  }

  async function addRepository(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setRepoError("");
    const response = await fetch("/api/repositories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...repoDraft, sourceKind: "work" })
    });
    const body = await response.json();
    if (!response.ok) {
      setRepoError(body.error ?? body.error ?? "Failed to register repository");
    } else {
      setRepositoryId(body.id);
      setRepoDraft({ name: "", url: "", branch: "main", sourceKind: "work", authType: "none", username: "", token: "", sshPrivateKey: "" });
    }
    await refresh();
    setBusy(false);
  }

  async function addSkillSource(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSkillSourceError("");
    const response = await fetch("/api/repositories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...skillSourceDraft, sourceKind: "skill_source" })
    });
    const body = await response.json();
    if (!response.ok) {
      setSkillSourceError(body.error ?? "Failed to register skill source");
    } else {
      setSkillImportDraft((current) => ({ ...current, repositoryId: body.id }));
      setSkillSourceDraft({ name: "", url: "", branch: "main", sourceKind: "skill_source", authType: "none", username: "", token: "", sshPrivateKey: "" });
    }
    await refresh();
    setBusy(false);
  }

  async function syncRepository(id: string) {
    setBusy(true);
    await fetch(`/api/repositories/${id}/sync`, { method: "POST" });
    await refresh();
    setBusy(false);
  }

  async function syncPaperclipRepositories() {
    setBusy(true);
    setPaperclipRepositorySyncError("");
    const response = await fetch("/api/paperclip/repositories/sync", { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setPaperclipRepositorySyncError(body.error ?? "Failed to sync repositories to Paperclip");
    }
    await refresh();
    setBusy(false);
  }

  async function importRepoSkills(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSkillImportError("");
    setLatestSkillImport(null);
    const response = await fetch("/api/skills/import-repo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(skillImportDraft)
    });
    const body = await response.json();
    if (!response.ok) {
      setSkillImportError(body.error ?? "Failed to import skills");
    } else {
      setLatestSkillImport(body);
    }
    await refresh();
    setBusy(false);
  }

  async function syncPaperclipSkills() {
    setBusy(true);
    setPaperclipSkillSyncError("");
    const response = await fetch("/api/paperclip/skills/sync", { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setPaperclipSkillSyncError(body.error ?? "Failed to sync skills to Paperclip");
    }
    await refresh();
    setBusy(false);
  }

  async function scanPaperclipChatSignals() {
    setBusy(true);
    setPaperclipChatSignalError("");
    const response = await fetch("/api/paperclip/chat/signals/scan", { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setPaperclipChatSignalError(body.error ?? "Failed to scan Paperclip chat signals");
    }
    await refresh();
    setBusy(false);
  }

  async function syncPaperclipHermesBridge() {
    setBusy(true);
    setPaperclipHermesBridgeError("");
    const response = await fetch("/api/paperclip/hermes/sync", { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setPaperclipHermesBridgeError(body.error ?? "Failed to sync Hermes bridge to Paperclip");
    }
    await refresh();
    setBusy(false);
  }

  async function scanPaperclipHermesInterventions() {
    setBusy(true);
    setPaperclipHermesInterventionError("");
    const response = await fetch("/api/paperclip/hermes/interventions/scan", { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setPaperclipHermesInterventionError(body.error ?? "Failed to scan Hermes guardrails");
    }
    await refresh();
    setBusy(false);
  }

  async function installMcp(marketplaceId: string) {
    setBusy(true);
    setMcpError("");
    setMcpMessage("");
    const response = await fetch("/api/mcp/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketplaceId })
    });
    const body = await response.json();
    if (!response.ok) {
      setMcpError(body.error ?? "Failed to install MCP");
    } else {
      setSelectedMcpId(body.id);
      setMcpMessage(`${body.name} installed. Fill secrets, enable it, then test.`);
    }
    await refresh();
    setBusy(false);
  }

  async function importMcpRegistry(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMcpError("");
    setMcpMessage("");
    const response = await fetch("/api/mcp/marketplace/import-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: mcpRegistryUrl })
    });
    const body = await response.json();
    if (!response.ok) {
      setMcpError(body.error ?? "Failed to import MCP registry");
    } else {
      setMcpMessage(`Imported ${body.imported} MCP entries${body.skipped?.length ? `, skipped ${body.skipped.length}` : ""}.`);
      setMcpRegistryUrl("");
    }
    await refresh();
    setBusy(false);
  }

  async function installCustomMcp(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMcpError("");
    setMcpMessage("");
    try {
      const parsed = JSON.parse(customMcpDraft);
      const response = await fetch("/api/mcp/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed)
      });
      const body = await response.json();
      if (!response.ok) {
        setMcpError(body.error ?? "Failed to install custom MCP");
      } else {
        setSelectedMcpId(body.id);
        setMcpMessage(`${body.name} installed from custom JSON.`);
      }
    } catch (error) {
      setMcpError(`Invalid JSON: ${(error as Error).message}`);
    }
    await refresh();
    setBusy(false);
  }

  async function saveMcpJson() {
    if (!selectedMcp) return;
    setBusy(true);
    setMcpError("");
    setMcpMessage("");
    try {
      const parsed = JSON.parse(mcpJsonDraft) as McpServerConfig;
      const response = await fetch(`/api/mcp/${selectedMcp.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed)
      });
      const body = await response.json();
      if (!response.ok) {
        setMcpError(body.error ?? "Failed to save MCP JSON");
      } else {
        setMcpMessage(`${body.name} saved.`);
      }
    } catch (error) {
      setMcpError(`Invalid JSON: ${(error as Error).message}`);
    }
    await refresh();
    setBusy(false);
  }

  async function updateMcpStatus(server: McpServerConfig, status: McpServerConfig["status"]) {
    setBusy(true);
    setMcpError("");
    setMcpMessage("");
    const response = await fetch(`/api/mcp/${server.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...server, status })
    });
    const body = await response.json();
    if (!response.ok) {
      setMcpError(body.error ?? "Failed to update MCP");
    } else {
      setMcpMessage(`${body.name} is ${body.status}.`);
    }
    await refresh();
    setBusy(false);
  }

  async function testMcp(serverId: string) {
    setBusy(true);
    setMcpError("");
    setMcpMessage("");
    const response = await fetch(`/api/mcp/${serverId}/test`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setMcpError(body.message ?? body.error ?? body.error ?? "MCP test failed");
    } else {
      setMcpMessage(body.message ?? "MCP test passed.");
    }
    await refresh();
    setBusy(false);
  }

  async function syncPaperclipManifest() {
    setBusy(true);
    await fetch("/api/paperclip/sync", { method: "POST" });
    await refresh();
    setBusy(false);
  }

  async function resetPaperclipManifest() {
    setBusy(true);
    await fetch("/api/paperclip/sync", { method: "DELETE" });
    await refresh();
    setBusy(false);
  }

  async function markPaperclipApplied(agentId: string) {
    setBusy(true);
    await fetch(`/api/paperclip/sync/${agentId}/applied`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperclipAgentId: agentId })
    });
    await refresh();
    setBusy(false);
  }

  async function evaluateIssuePolicy(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setIssuePolicyError("");
    setIssuePolicyEvaluation(null);
    const response = await fetch("/api/agent-issues/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(issuePolicyDraft)
    });
    const body = await response.json();
    if (!response.ok) {
      setIssuePolicyError(body.error ?? "Issue policy evaluation failed");
    } else {
      setIssuePolicyEvaluation(body);
    }
    setBusy(false);
  }

  async function approve(taskId: string) {
    setBusy(true);
    await fetch(`/api/tasks/${taskId}/approve`, { method: "POST" });
    await refresh();
    setBusy(false);
  }

  async function loadDiff(taskId: string) {
    setBusy(true);
    const response = await fetch(`/api/tasks/${taskId}/diff`);
    const diff = await response.json();
    setDiffs((current) => ({ ...current, [taskId]: diff }));
    setBusy(false);
  }

  async function reject(taskId: string) {
    setBusy(true);
    await fetch(`/api/tasks/${taskId}/reject`, { method: "POST" });
    await refresh();
    setBusy(false);
  }

  async function saveBudget(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    await fetch("/api/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        globalBudgetUsd: Number(budgetDraft.globalBudgetUsd),
        agentCaps: Object.fromEntries(Object.entries(budgetDraft.agentCaps).map(([agentId, cap]) => [agentId, Number(cap)]))
      })
    });
    await refresh();
    setBusy(false);
  }

  return (
    <main className="shell">
      <aside className="rail">
        <div className="mark"><CircuitBoard size={22} /></div>
        {views.map((view) => (
          <button
            className={activeView === view.id ? "active" : ""}
            title={view.label}
            aria-label={view.label}
            aria-pressed={activeView === view.id}
            onClick={() => setActiveView(view.id)}
            key={view.id}
          >
            {view.icon}
          </button>
        ))}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Autonomous company OS</p>
            <h1>{state.company.name}</h1>
            <p>{state.company.description}</p>
          </div>
          <div className="topbarActions">
            <div className={`realtimeBadge ${realtime.status}`} title={realtime.message}>
              <span />
              <strong>{realtime.status === "live" ? "Live" : realtime.status === "stale" ? "Stale" : realtime.status === "fallback" ? "Fallback" : "Connecting"}</strong>
              <small>{realtimeAge === null ? "waiting" : `${realtimeAge}s ago`}</small>
            </div>
            <button className="iconText" onClick={() => refresh("manual")} disabled={busy}>
              <RefreshCw size={17} /> Sync
            </button>
          </div>
        </header>

        <section className="viewHeader">
          <div>
            <p className="eyebrow">{currentView.eyebrow}</p>
            <h2>{currentView.title}</h2>
            <p>{currentView.description}</p>
          </div>
          <div className="viewTabs" aria-label="Zero Human sections">
            {views.map((view) => (
              <button
                className={activeView === view.id ? "active" : ""}
                onClick={() => setActiveView(view.id)}
                key={view.id}
              >
                {view.icon} {view.label}
              </button>
            ))}
          </div>
        </section>

        <section className="companyMonitor">
          <div>
            <p className="eyebrow">Paperclip source of truth</p>
            <h2>{activePaperclipCompany.selectedName ?? "No active Paperclip company"}</h2>
            <p>
              {activePaperclipCompany.selectedIssuePrefix ? `${activePaperclipCompany.selectedIssuePrefix} · ` : ""}
              {activePaperclipCompany.selectedCompanyId ?? activePaperclipCompany.error ?? "Configure PAPERCLIP_COMPANY_ID or complete Paperclip onboarding."}
            </p>
          </div>
          <div className="companyMonitorActions">
            <Status value={activePaperclipCompany.ok ? activePaperclipCompany.source : "unavailable"} />
            <a className="buttonLink" href={paperclipDashboardUrl} target="_blank" rel="noreferrer">Open Paperclip</a>
            <a className="buttonLink" href={paperclipOrgUrl} target="_blank" rel="noreferrer">Org</a>
            <a className="buttonLink" href={paperclipIssuesUrl} target="_blank" rel="noreferrer">Issues</a>
          </div>
          {(activePaperclipCompany.warning || activePaperclipCompany.duplicateNameWarnings.length > 0) && (
            <div className="companyWarnings">
              {(activePaperclipCompany.duplicateNameWarnings.length > 0
                ? activePaperclipCompany.duplicateNameWarnings
                : [activePaperclipCompany.warning]
              )
                .filter(Boolean)
                .map((warning) => <span key={warning}>{warning}</span>)}
            </div>
          )}
          <div className="companyList">
            {activePaperclipCompany.companies.slice(0, 4).map((company) => (
              <article className={company.id === activePaperclipCompany.selectedCompanyId ? "selected" : ""} key={company.id}>
                <strong>{company.name}</strong>
                <span>{company.issuePrefix || "no prefix"} · {company.activeAgentCount}/{company.agentCount} agents · {company.openIssueCount} open issues</span>
              </article>
            ))}
          </div>
        </section>

        <section className="monitoringDiagnostics">
          <div className="monitoringDiagnosticsHead">
            <div>
              <p className="eyebrow">Monitoring diagnostics</p>
              <h2>{monitoringDiagnostics.ok ? "Runtime wiring looks observable" : "Runtime wiring needs attention"}</h2>
              <p>
                {monitoringDiagnostics.selectedIssuePrefix ? `${monitoringDiagnostics.selectedIssuePrefix} · ` : ""}
                {monitoringDiagnostics.selectedName ?? "Paperclip company not selected"} · {monitoringDiagnostics.generatedAt ? timeAgo(monitoringDiagnostics.generatedAt) : "waiting"}
              </p>
            </div>
            <Status value={monitoringDiagnostics.mode === "monitoring_only" ? "monitoring only" : "controls enabled"} />
          </div>
          <div className="diagnosticGrid">
            {(monitoringDiagnostics.items.length > 0
              ? monitoringDiagnostics.items
              : [{
                id: "diagnostics-loading",
                severity: "info" as const,
                title: "Waiting for diagnostics",
                detail: "Zero-Human is waiting for the next realtime state snapshot.",
                action: "Keep this panel open; it updates from the owner state stream."
              }]
            ).map((item) => (
              <article className={`diagnosticItem ${item.severity}`} key={item.id}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                {item.action && <small>{item.action}</small>}
                {item.href && <a className="buttonLink compact" href={item.href} target="_blank" rel="noreferrer">Open</a>}
              </article>
            ))}
          </div>
          <div className="companyMonitorActions">
            <a className="buttonLink compact" href={monitoringDiagnostics.links.paperclipDashboard} target="_blank" rel="noreferrer">Paperclip</a>
            <a className="buttonLink compact" href={monitoringDiagnostics.links.hermesLogs} target="_blank" rel="noreferrer">Hermes logs</a>
            <a className="buttonLink compact" href={monitoringDiagnostics.links.routerUsage} target="_blank" rel="noreferrer">9Router usage</a>
          </div>
        </section>

        <section className="metrics">
          <Metric icon={<BadgeDollarSign />} label="Budget spent" value={`${money(state.budget.spent)} / ${money(state.budget.global)}`} />
          <Metric icon={<Users />} label="Agents online" value={`${state.agents.length}`} />
          <Metric icon={<GitBranch />} label="Active tasks" value={`${activeTasks}`} />
          <Metric icon={<RadioTower />} label="Router cost" value={money(state.routerMetrics.costUsd)} />
          <Metric icon={<FolderGit2 />} label="Repos ready" value={`${workRepositories.filter((repo) => repo.status === "ready").length}`} />
        </section>

        {(activeView === "operations" || activeView === "gateway") && (
          <section className="serviceStrip">
            {state.serviceHealth.map((service) => (
              <article className="servicePill" key={service.name}>
                <div>
                  <strong>{service.name}</strong>
                  <span>{service.status ?? "offline"} · {service.latencyMs ?? 0}ms</span>
                </div>
                <Status value={service.ok ? "online" : "error"} />
              </article>
            ))}
            <article className="servicePill">
              <div>
                <strong>hermes memory</strong>
                <span>{state.brainMemory.entries} notes · {state.brainMemory.outcomes} outcomes</span>
              </div>
              <Status value={state.brainMemory.ok ? "online" : "error"} />
            </article>
          </section>
        )}

        {state.alerts.length > 0 && (
          <section className="alertStrip">
            {state.alerts.slice(0, 3).map((alert) => (
              <article className={`alertItem ${alert.severity}`} key={alert.id}>
                <div>
                  <strong>{alert.event}</strong>
                  <span>{alert.message}</span>
                </div>
                <small>{alert.delivered ? "webhook sent" : alert.error ?? "local alert"}</small>
              </article>
            ))}
          </section>
        )}

        <section className="grid">
          {activeView === "operations" && (
          <div className="panel ownerCommand">
            <div className="panelHead">
              <div>
                <h2>Owner command</h2>
                <p>Live company health, decisions, blockers, cost, repositories, and execution links.</p>
              </div>
              <div className="deepLinks">
                <a className="iconText" href={paperclipDashboardUrl} target="_blank" rel="noreferrer">Paperclip</a>
                <a className="iconText" href={`${hermesBaseUrl}/logs`} target="_blank" rel="noreferrer">Hermes</a>
                <a className="iconText" href={`${routerBaseUrl}/dashboard/usage`} target="_blank" rel="noreferrer">9Router</a>
              </div>
            </div>
            <div className="ownerCommandGrid">
              <article className="ownerMetric"><span>Running</span><strong>{activeRuns.length}</strong><small>{workroom.activeRuns} live Paperclip runs</small></article>
              <article className="ownerMetric"><span>Blocked</span><strong>{blockedTasks.length}</strong><small>{failedRuns.length} failed/cancelled recent runs</small></article>
              <article className="ownerMetric"><span>Owner decisions</span><strong>{ownerDecisionCount}</strong><small>{pendingHiring.length} hires - {pendingApprovals.length} approvals</small></article>
              <article className="ownerMetric"><span>Cost watch</span><strong>{money(state.routerMetrics.costUsd)}</strong><small>{highTokenRuns.length} high-token runs - {state.routerMetrics.requests} requests</small></article>
              <article className="ownerMetric"><span>Repositories</span><strong>{workRepositories.filter((repo) => repo.status === "ready").length}</strong><small>{repoErrors.length} repo errors</small></article>
              <article className="ownerMetric"><span>Memory</span><strong>{state.brainMemory.entries}</strong><small>{recentMemory.length} recent Hermes notes</small></article>
            </div>
            <div className="ownerAttentionList">
              {state.alerts.slice(0, 2).map((alert) => (
                <article className="ownerAttentionItem" key={alert.id}>
                  <div>
                    <strong>{alert.event}</strong>
                    <p>{alert.message}</p>
                  </div>
                  <Status value={alert.severity} />
                </article>
              ))}
              {guardrailDetails.slice(0, 4).map((item, index) => (
                <article className="ownerAttentionItem" key={`${item.trigger}-${item.issueId ?? item.meetingId ?? index}`}>
                  <div>
                    <strong>{item.issueKey ?? item.meetingTitle ?? item.trigger.replaceAll("_", " ")}</strong>
                    <p>{item.reason}</p>
                  </div>
                  <Status value={item.action} />
                </article>
              ))}
              {repoErrors.slice(0, 2).map((repo) => (
                <article className="ownerAttentionItem" key={repo.id}>
                  <div>
                    <strong>{repo.name}</strong>
                    <p>{repo.error ?? "Repository sync failed."}</p>
                  </div>
                  <Status value="error" />
                </article>
              ))}
              {state.alerts.length === 0 && guardrailDetails.length === 0 && repoErrors.length === 0 && (
                <div className="empty">No owner attention items right now. Watch active runs or dispatch the next task.</div>
              )}
            </div>
          </div>
          )}

          {activeView === "operations" && (
          <div className="panel guardrailCenter">
            <div className="panelHead">
              <div>
                <h2>Hermes guardrails</h2>
                <p>Bounded blocker, meeting, retry, and cost controls for Paperclip.</p>
              </div>
              {zeroHumanControlsVisible ? (
                <button onClick={scanPaperclipHermesInterventions} disabled={busy}>
                  <RefreshCw size={15} /> Scan guardrails
                </button>
              ) : (
                <span className="readOnlyChip">Auto observed</span>
              )}
            </div>
            <div className="syncSummary">
              <span>{state.paperclipHermesInterventions.scanned} issues scanned</span>
              <span>{state.paperclipHermesInterventions.intervened} interventions</span>
              <span>{state.paperclipHermesInterventions.skippedCooldown} cooldown skips</span>
              <span>{state.paperclipHermesInterventions.meetingsFlagged} meeting flags</span>
              <span>{state.paperclipHermesInterventions.highCostRuns} cost flags</span>
            </div>
            {paperclipHermesInterventionError && <p className="formWarning">{paperclipHermesInterventionError}</p>}
            <article className="comboPolicy">
              <strong>9Router combo policy</strong>
              <p>{state.paperclipHermesInterventions.comboPolicy?.note ?? "Provider/model routing stays inside 9Router."}</p>
              <div className="changeList">
                {(state.paperclipHermesInterventions.comboPolicy?.configuredCombos ?? Object.keys(state.combos)).map((combo) => (
                  <code key={combo}>{combo}</code>
                ))}
              </div>
            </article>
            <div className="guardrailList">
              {state.paperclipHermesInterventions.details.length === 0 && (
                <div className="empty">No guardrail findings yet. Scan to confirm blockers, meetings, and costs.</div>
              )}
              {state.paperclipHermesInterventions.details.slice(0, 8).map((item, index) => (
                <article className="guardrailRow" key={`${item.trigger}-${item.issueId ?? item.meetingId ?? index}`}>
                  <div>
                    <strong>{item.issueKey ?? item.meetingTitle ?? item.trigger.replaceAll("_", " ")}</strong>
                    <p>{item.reason}</p>
                  </div>
                  <div className="guardrailMeta">
                    <span>{item.trigger}</span>
                    <span>{item.action}</span>
                    {item.assignee && <span>{item.assignee}</span>}
                    {item.metric && <span>{item.metric}</span>}
                  </div>
                </article>
              ))}
            </div>
          </div>
          )}

          {activeView === "workroom" && (
          <div className="panel workroomRuns">
            <div className="panelHead">
              <div>
                <h2>Paperclip execution runs</h2>
                <p>{workroom.unavailable ? workroom.error ?? "Paperclip data unavailable." : `${workroom.activeRuns} active runs - ${workroom.changedFiles} changed files - ${filteredWorkroomRuns.length}/${workroom.runs.length} shown`}</p>
              </div>
              <button onClick={refreshWorkroom}>
                <RefreshCw size={15} /> Refresh
              </button>
            </div>
            <div className="workroomFilters">
              <label>
                Search
                <input
                  value={workroomFilters.query}
                  placeholder="agent, issue, repo, error"
                  onChange={(event) => setWorkroomFilters((current) => ({ ...current, query: event.target.value }))}
                />
              </label>
              <label>
                Agent
                <select value={workroomFilters.agent} onChange={(event) => setWorkroomFilters((current) => ({ ...current, agent: event.target.value }))}>
                  <option value="all">All agents</option>
                  {workroomAgents.map((agent) => <option value={agent} key={agent}>{agent}</option>)}
                </select>
              </label>
              <label>
                Status
                <select value={workroomFilters.status} onChange={(event) => setWorkroomFilters((current) => ({ ...current, status: event.target.value }))}>
                  <option value="all">All statuses</option>
                  {workroomStatuses.map((status) => <option value={status} key={status}>{status}</option>)}
                </select>
              </label>
              <label>
                Flag
                <select value={workroomFilters.flag} onChange={(event) => setWorkroomFilters((current) => ({ ...current, flag: event.target.value }))}>
                  <option value="all">All runs</option>
                  <option value="failed">Failed</option>
                  <option value="long">Long running</option>
                  <option value="high-token">High token</option>
                  <option value="changed">Has changes</option>
                </select>
              </label>
            </div>
            <div className="workroomList">
              {filteredWorkroomRuns.map((run) => (
                <button
                  className={`workroomRun ${run.status} ${selectedWorkroomRun?.id === run.id ? "active" : ""}`}
                  key={run.id}
                  onClick={() => setSelectedWorkroomRunId(run.id)}
                >
                  <span>
                    <strong>{run.agentName}</strong>
                    <small>{run.agentRole} - {run.shortId}</small>
                  </span>
                  <span>
                    <Status value={run.status} />
                    <small>{run.durationSec ?? 0}s</small>
                  </span>
                  <em>{run.issueKey ? `${run.issueKey} - ${run.issueTitle ?? "Untitled issue"}` : run.invocationSource ?? "heartbeat"}</em>
                  <small>{run.repo ?? "repo unknown"} - {run.model ?? "model unknown"}</small>
                </button>
              ))}
              {!workroom.runs.length && <div className="empty">No Paperclip/Codex runs observed yet.</div>}
              {workroom.runs.length > 0 && filteredWorkroomRuns.length === 0 && <div className="empty">No runs match the current filters.</div>}
            </div>
          </div>
          )}

          {activeView === "workroom" && (
          <div className="panel workroomTerminal">
            <div className="panelHead">
              <div>
                <h2>Terminal mirror</h2>
                <p>{selectedWorkroomRun?.workingDir ?? "Select a run to inspect its workspace."}</p>
              </div>
              <TerminalSquare size={20} />
            </div>
            {selectedWorkroomRun ? (
              <>
                <div className="runMeta">
                  <span><strong>Agent</strong>{selectedWorkroomRun.agentName}</span>
                  <span><strong>Model</strong>{selectedWorkroomRun.model ?? "unknown"}</span>
                  <span><strong>Adapter</strong>{selectedWorkroomRun.adapterType ?? "unknown"}</span>
                  <span><strong>Issue</strong>{selectedWorkroomRun.issueKey ?? "none"}</span>
                  <span><strong>Repo</strong>{selectedWorkroomRun.repo ?? "unknown"}</span>
                  <span><strong>Command</strong>{selectedWorkroomRun.commandStatus}</span>
                  <span><strong>Duration</strong>{selectedWorkroomRun.durationSec ?? 0}s</span>
                  <span><strong>Tokens</strong>{selectedWorkroomRun.tokenEstimate ? selectedWorkroomRun.tokenEstimate.toLocaleString() : "not reported"}</span>
                  <span><strong>Workspace</strong>{selectedWorkroomRun.workspaceReady ? "ready" : "unavailable"}</span>
                </div>
                {(selectedWorkroomRun.rootError || selectedWorkroomRun.recommendedAction) && (
                  <div className="triageBox">
                    {selectedWorkroomRun.rootError && (
                      <div>
                        <strong>Root error</strong>
                        <p>{selectedWorkroomRun.rootError}</p>
                      </div>
                    )}
                    {selectedWorkroomRun.recommendedAction && (
                      <div>
                        <strong>Recommended owner action</strong>
                        <p>{selectedWorkroomRun.recommendedAction}</p>
                      </div>
                    )}
                  </div>
                )}
                <pre className="terminalPane">{selectedWorkroomRun.terminal.length ? selectedWorkroomRun.terminal.join("\n") : "No terminal output captured yet."}</pre>
              </>
            ) : (
              <div className="empty">Pick a run from the left panel.</div>
            )}
          </div>
          )}

          {activeView === "workroom" && (
          <div className="panel workroomFiles">
            <div className="panelHead">
              <div>
                <h2>Changed files</h2>
                <p>Git status from the agent workspace, read directly from Paperclip when needed.</p>
              </div>
              <FolderGit2 size={20} />
            </div>
            {selectedWorkroomRun?.gitError && <div className="inlineError">{selectedWorkroomRun.gitError}</div>}
            <div className="fileChangeList">
              {(selectedWorkroomRun?.fileChanges ?? []).map((file) => (
                <div className="fileChange" key={`${file.status}-${file.path}`}>
                  <span>{file.status}</span>
                  <code>{file.path}</code>
                </div>
              ))}
              {selectedWorkroomRun && !selectedWorkroomRun.fileChanges.length && !selectedWorkroomRun.gitError && (
                <div className="empty">No uncommitted file changes detected.</div>
              )}
              {!selectedWorkroomRun && <div className="empty">Select a run to see file changes.</div>}
            </div>
          </div>
          )}

          {activeView === "workroom" && (
          <div className="panel workroomArtifacts">
            <div className="panelHead">
              <div>
                <h2>Generated artifacts</h2>
                <p>Documents, code, configs, and assets inferred from recorded file changes.</p>
              </div>
              <Save size={20} />
            </div>
            <div className="artifactList">
              {(selectedWorkroomRun?.artifacts ?? []).map((artifact) => (
                <article className="artifactItem" key={`${artifact.type}-${artifact.path}`}>
                  <Status value={artifact.type} />
                  <div>
                    <strong>{artifact.title}</strong>
                    <code>{artifact.path}</code>
                  </div>
                </article>
              ))}
              {selectedWorkroomRun && !selectedWorkroomRun.artifacts.length && (
                <div className="empty">No generated artifacts detected for this run yet.</div>
              )}
              {!selectedWorkroomRun && <div className="empty">Select a run to see artifacts.</div>}
            </div>
          </div>
          )}

          {activeView === "workroom" && (
          <div className="panel workroomDiff">
            <div className="panelHead">
              <div>
                <h2>Diff summary</h2>
                <p>Short stat of code added, updated, or removed in the selected workspace.</p>
              </div>
              <GitBranch size={20} />
            </div>
            <pre className="terminalPane compact">{selectedWorkroomRun?.diffStat.length ? selectedWorkroomRun.diffStat.join("\n") : "No diff stat available."}</pre>
          </div>
          )}

          {activeView === "agents" && (
          <div className="panel agents">
            <div className="panelHead">
              <div>
                <h2>Agent bench</h2>
                <p>Role templates from `zero-human.yaml`.</p>
              </div>
            </div>
            <div className="agentList">
              {state.agents.map((agent) => (
                <article className="agentCard" key={agent.id}>
                  <div className="agentTop">
                    <div>
                      <strong>{agent.id.replaceAll("_", " ")}</strong>
                      <span>{agent.role} · {agent.executor}</span>
                    </div>
                    <Status value={agent.status} />
                  </div>
                  <div className="skillRow">
                    {agent.skills.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}
                  </div>
                  <div className="agentFooter">
                    <small>{agent.modelCombo} · cap {money(agent.maxBudgetUsd)}</small>
                    {zeroHumanControlsVisible ? (
                      <>
                        <button onClick={() => hire(agent.id)} disabled={busy}>
                          <Plus size={15} /> Hire
                        </button>
                        {agent.status === "paused" && (
                          <button onClick={() => resume(agent.id)} disabled={busy}>
                            Resume
                          </button>
                        )}
                      </>
                    ) : (
                      <a className="buttonLink compact" href={paperclipOrgUrl} target="_blank" rel="noreferrer">Open in Paperclip</a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
          )}

          {activeView === "agents" && (
          <div className="panel hiring">
            <div className="panelHead">
              <div>
                <h2>Hiring monitor</h2>
                <p>Hiring authority lives in Paperclip. Zero-Human only mirrors signals and policy guidance.</p>
              </div>
              {zeroHumanControlsVisible ? (
                <button onClick={scanPaperclipChatSignals} disabled={busy}>
                  <RefreshCw size={15} /> Scan chat
                </button>
              ) : (
                <a className="buttonLink" href={paperclipOrgUrl} target="_blank" rel="noreferrer">Manage in Paperclip</a>
              )}
            </div>
            <div className="syncSummary">
              <span>{state.paperclipChatSignals.detected} chat signals</span>
              <span>{state.paperclipChatSignals.createdRequests} requests created</span>
              <span>{state.paperclipChatSignals.skippedDuplicates} duplicates skipped</span>
              <span>{state.paperclipChatSignals.processedComments} comments tracked</span>
            </div>
            {paperclipChatSignalError && <p className="formWarning">{paperclipChatSignalError}</p>}
            {state.paperclipChatSignals.details.length > 0 && (
              <div className="paperclipSkillDetails">
                {state.paperclipChatSignals.details.slice(0, 5).map((item) => (
                  <article className="paperclipSkillRow" key={item.commentId}>
                    <div>
                      <strong>{item.issueKey} · {item.role ?? "unknown role"}</strong>
                      <span>{item.agentName ?? "agent"} · {item.reason}</span>
                    </div>
                    <Status value={item.action} />
                  </article>
                ))}
              </div>
            )}
            {zeroHumanControlsVisible ? (
              <form className="hireForm" onSubmit={createHireRequest}>
                <label>
                  Title
                  <input
                    value={hireDraft.title}
                    placeholder="Brand Strategist"
                    onChange={(event) => setHireDraft((current) => ({ ...current, title: event.target.value }))}
                  />
                </label>
                <label>
                  Department
                  <input
                    value={hireDraft.department}
                    placeholder="Marketing"
                    onChange={(event) => setHireDraft((current) => ({ ...current, department: event.target.value }))}
                  />
                </label>
                <label>
                  Requested role
                  <input
                    value={hireDraft.requestedRole}
                    placeholder="Optional Paperclip role"
                    onChange={(event) => setHireDraft((current) => ({ ...current, requestedRole: event.target.value }))}
                  />
                </label>
                <label>
                  Hiring brief
                  <textarea
                    value={hireDraft.description}
                    onChange={(event) => setHireDraft((current) => ({ ...current, description: event.target.value }))}
                  />
                </label>
                <button disabled={busy || !hireDraft.title.trim()}>
                  <Plus size={15} /> Request hire
                </button>
              </form>
            ) : (
              <div className="readOnlyNotice">
                <strong>Read-only monitor</strong>
                <span>Create, approve, or reject hires inside Paperclip so the company board remains canonical.</span>
              </div>
            )}
            <div className="hiringQueue">
              {pendingHiring.length === 0 && <div className="empty">No pending hires. Paperclip requests will wait here for approval.</div>}
              {pendingHiring.map((request) => (
                <article className="hireCard" key={request.id}>
                  <div>
                    <strong>{request.title}</strong>
                    <span>{request.source} · {request.department ?? "unassigned"} · {Math.round(request.confidence * 100)}% match</span>
                    <p>{request.description}</p>
                  </div>
                  <div className="hireMap">
                    <code>{request.suggestedAgentId}</code>
                    <span>{request.suggestedRole} · {request.suggestedExecutor} · {money(request.suggestedBudgetUsd)}</span>
                    <div className="skillRow">
                      {request.suggestedSkills.slice(0, 5).map((skill) => <span key={skill}>{skill}</span>)}
                    </div>
                  </div>
                  {zeroHumanControlsVisible && (
                    <div className="hireActions">
                      <button onClick={() => rejectHireRequest(request.id)} disabled={busy}>Reject</button>
                      <button onClick={() => approveHireRequest(request.id)} disabled={busy}><Check size={15} /> Approve</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
          )}

          {activeView === "agents" && (
          <div className="panel issuePolicy">
            <div className="panelHead">
              <div>
                <h2>Agent issue policy</h2>
                <p>Mirrors how Paperclip routes agent-created issues into assignment, triage, approval, or blocked state.</p>
              </div>
              <ShieldCheck size={20} />
            </div>
            <div className="policyGrid">
              {state.issuePolicies.map((policy) => (
                <article className="policyCard" key={policy.role}>
                  <div className="agentTop">
                    <div>
                      <strong>{policy.role}</strong>
                      <span>{policy.allowedTaskTypes.join(", ")}</span>
                    </div>
                    <Status value={policy.canCreateIssue ? policy.defaultDecision : "blocked"} />
                  </div>
                  <div className="skillRow">
                    <span>{policy.canCreateIssue ? "can create issue" : "cannot create issue"}</span>
                    <span>{policy.autoAssign ? "auto assign allowed" : "triage first"}</span>
                    <span>P{policy.maxPriorityWithoutApproval} without approval</span>
                  </div>
                  <p>{policy.note}</p>
                </article>
              ))}
            </div>
            {zeroHumanControlsVisible ? (
              <form className="issuePolicyTester" onSubmit={evaluateIssuePolicy}>
                <label>
                  Agent
                  <select value={issuePolicyDraft.agentId} onChange={(event) => setIssuePolicyDraft((current) => ({ ...current, agentId: event.target.value }))}>
                    {state.agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.id} · {agent.role}</option>)}
                  </select>
                </label>
                <label>
                  Issue title
                  <input value={issuePolicyDraft.title} onChange={(event) => setIssuePolicyDraft((current) => ({ ...current, title: event.target.value }))} />
                </label>
                <label>
                  Type
                  <select value={issuePolicyDraft.type} onChange={(event) => setIssuePolicyDraft((current) => ({ ...current, type: event.target.value }))}>
                    <option value="architecture">Architecture</option>
                    <option value="coding">Coding</option>
                    <option value="review">Review</option>
                    <option value="test">Test</option>
                    <option value="deploy">Deploy</option>
                  </select>
                </label>
                <label>
                  Priority
                  <input type="range" min="1" max="3" value={issuePolicyDraft.priority} onChange={(event) => setIssuePolicyDraft((current) => ({ ...current, priority: Number(event.target.value) as 1 | 2 | 3 }))} />
                </label>
                <label>
                  Description
                  <textarea value={issuePolicyDraft.description} onChange={(event) => setIssuePolicyDraft((current) => ({ ...current, description: event.target.value }))} />
                </label>
                <button disabled={busy || !issuePolicyDraft.title.trim()}>
                  <ShieldCheck size={15} /> Evaluate policy
                </button>
              </form>
            ) : (
              <div className="readOnlyNotice">
                <strong>Policy mirror</strong>
                <span>Use Paperclip issue creation and assignment. Zero-Human observes the resulting policy state.</span>
              </div>
            )}
            {issuePolicyError && <p className="formWarning">{issuePolicyError}</p>}
            {issuePolicyEvaluation && (
              <article className="policyDecision">
                <div className="agentTop">
                  <div>
                    <strong>{issuePolicyEvaluation.decision.replace("_", " ")}</strong>
                    <span>{issuePolicyEvaluation.role} · {issuePolicyEvaluation.suggestedTaskType} · assignee {issuePolicyEvaluation.suggestedAssignee}</span>
                  </div>
                  <Status value={issuePolicyEvaluation.decision} />
                </div>
                <p>{issuePolicyEvaluation.reason}</p>
              </article>
            )}
          </div>
          )}

          {activeView === "agents" && (
          <div className="panel paperclipSync">
            <div className="panelHead">
              <div>
                <h2>Paperclip sync</h2>
                <p>Owner manifest that aligns Paperclip agents with Zero-Human roles, skills, and MCP tools.</p>
              </div>
              {zeroHumanControlsVisible ? (
                <div className="buttonGroup">
                  <button onClick={resetPaperclipManifest} disabled={busy || state.paperclipSync.records.length === 0}>
                    Reset
                  </button>
                  <button onClick={syncPaperclipManifest} disabled={busy}>
                    <RefreshCw size={15} /> Sync manifest
                  </button>
                </div>
              ) : (
                <span className="readOnlyChip">Read-only mirror</span>
              )}
            </div>
            <div className="syncSummary">
              <span>{state.paperclipSync.records.filter((record) => record.status === "synced").length} synced</span>
              <span>{state.paperclipSync.records.filter((record) => record.status === "missing").length} missing</span>
              <span>{state.paperclipSync.records.filter((record) => record.status === "drifted").length} drifted</span>
              <span>{state.paperclipSync.paperclipUrl}</span>
            </div>
            <div className="paperclipSyncGrid">
              {state.paperclipSync.records.length === 0 && (
                <div className="empty">Paperclip manifest is empty. Generate it only after the org structure is ready.</div>
              )}
              {state.paperclipSync.records.map((record) => (
                <article className="syncCard" key={record.agentId}>
                  <div className="agentTop">
                    <div>
                      <strong>{record.desiredName}</strong>
                      <span>{record.role} · {record.executor} · {record.modelCombo}</span>
                    </div>
                    <Status value={record.status} />
                  </div>
                  <div className="skillRow">
                    {record.desiredSkills.slice(0, 4).map((skill) => <span key={skill}>{skill}</span>)}
                  </div>
                  <div className="skillRow">
                    {record.desiredMcpServers.length === 0 && <span>no mcp tools</span>}
                    {record.desiredMcpServers.slice(0, 4).map((server) => <span key={server.id}>{server.name}</span>)}
                  </div>
                  <pre className="runbook">{record.runbook}</pre>
                  <div className="agentFooter">
                    <small>{record.desiredHash}{record.lastSyncedAt ? ` · ${new Date(record.lastSyncedAt).toLocaleString()}` : ""}</small>
                    {zeroHumanControlsVisible ? (
                      <button onClick={() => markPaperclipApplied(record.agentId)} disabled={busy || record.status === "synced"}>
                        <Check size={15} /> Mark applied
                      </button>
                    ) : (
                      <span className="readOnlyChip">Observed</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
          )}

          {activeView === "agents" && (
          zeroHumanControlsVisible ? (
          <form className="panel taskComposer" onSubmit={createTask}>
            <div className="panelHead">
              <div>
                <h2>Assign work</h2>
                <p>Publishes `zh:task:assigned` through Redis.</p>
              </div>
              <Play size={20} />
            </div>
            <label>
              Repository
              <select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
                {workRepositories.map((repo) => <option value={repo.id} key={repo.id}>{repo.name} · {repo.branch}</option>)}
              </select>
            </label>
            <label>
              Agent
              <select value={selectedAgent} onChange={(event) => setSelectedAgent(event.target.value)}>
                {state.agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.id}</option>)}
              </select>
            </label>
            <label>
              Task type
              <select value={type} onChange={(event) => setType(event.target.value)}>
                <option value="architecture">Architecture</option>
                <option value="coding">Coding</option>
                <option value="review">Review</option>
                <option value="test">Test</option>
                <option value="deploy">Deploy</option>
              </select>
            </label>
            <label>
              Priority
              <input type="range" min="1" max="3" value={priority} onChange={(event) => setPriority(Number(event.target.value) as 1 | 2 | 3)} />
            </label>
            <label>
              Description
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <button className="primary" disabled={busy || !description.trim() || selectedAgentProfile?.status === "paused"}>
              <Play size={17} /> Dispatch task
            </button>
            {selectedAgentProfile?.status === "paused" && (
              <p className="formWarning">Budget protection paused this agent.</p>
            )}
          </form>
          ) : (
          <div className="panel taskComposer">
            <div className="panelHead">
              <div>
                <h2>Assignment monitor</h2>
                <p>Paperclip owns issue creation, assignment, and execution. Zero-Human watches the board and Codex runs.</p>
              </div>
              <Play size={20} />
            </div>
            <div className="readOnlyNotice">
              <strong>Control moved to Paperclip</strong>
              <span>Create issues, assign agents, and run heartbeats inside Paperclip. Use Execution Monitor here to inspect terminal output and changed files.</span>
            </div>
            <a className="buttonLink" href={paperclipIssuesUrl} target="_blank" rel="noreferrer">Open Paperclip issues</a>
          </div>
          )
          )}

          {activeView === "gateway" && (
          <div className="panel repositories">
            <div className="panelHead">
              <div>
                <h2>Repository monitor</h2>
                <p>Observe registered workspaces and Paperclip repository links. Repository control belongs in Paperclip.</p>
              </div>
              {zeroHumanControlsVisible ? (
                <button onClick={syncPaperclipRepositories} disabled={busy}>
                  <RefreshCw size={15} /> Sync Paperclip
                </button>
              ) : (
                <a className="buttonLink" href={paperclipIssuesUrl} target="_blank" rel="noreferrer">Open Paperclip</a>
              )}
            </div>
            {zeroHumanControlsVisible ? (
              <form className="repoForm" onSubmit={addRepository}>
                <label>
                  Name
                  <input
                    value={repoDraft.name}
                    placeholder="client-webapp"
                    onChange={(event) => setRepoDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label>
                  Git URL
                  <input
                    value={repoDraft.url}
                    placeholder="https://github.com/org/repo.git"
                    onChange={(event) => setRepoDraft((current) => ({ ...current, url: event.target.value }))}
                  />
                </label>
                <label>
                  Branch
                  <input
                    value={repoDraft.branch}
                    onChange={(event) => setRepoDraft((current) => ({ ...current, branch: event.target.value }))}
                  />
                </label>
                <label>
                  Auth
                  <select
                    value={repoDraft.authType}
                    onChange={(event) => setRepoDraft((current) => ({ ...current, authType: event.target.value as typeof repoDraft.authType }))}
                  >
                    <option value="none">Public / no auth</option>
                    <option value="https-token">HTTPS token</option>
                    <option value="ssh-key">SSH private key</option>
                  </select>
                </label>
                {repoDraft.authType === "https-token" && (
                  <>
                    <label>
                      Username
                      <input
                        value={repoDraft.username}
                        placeholder="x-access-token"
                        onChange={(event) => setRepoDraft((current) => ({ ...current, username: event.target.value }))}
                      />
                    </label>
                    <label>
                      Token
                      <input
                        type="password"
                        value={repoDraft.token}
                        placeholder="GitHub PAT or GitLab token"
                        onChange={(event) => setRepoDraft((current) => ({ ...current, token: event.target.value }))}
                      />
                    </label>
                  </>
                )}
                {repoDraft.authType === "ssh-key" && (
                  <label>
                    SSH private key
                    <textarea
                      className="secretBox"
                      value={repoDraft.sshPrivateKey}
                      placeholder="Paste the complete SSH private key here"
                      onChange={(event) => setRepoDraft((current) => ({ ...current, sshPrivateKey: event.target.value }))}
                    />
                  </label>
                )}
                <button disabled={busy || !repoDraft.url.trim()}>
                  <Plus size={15} /> Add repo
                </button>
                {repoError && <p className="formWarning">{repoError}</p>}
              </form>
            ) : (
              <div className="readOnlyNotice">
                <strong>Read-only repository view</strong>
                <span>Zero-Human no longer clones or syncs repositories from this panel. Manage workspaces through Paperclip, then monitor execution here.</span>
              </div>
            )}
            <div className="repoList">
              {workRepositories.map((repo) => (
                <article className="repoRow" key={repo.id}>
                  <div>
                    <strong>{repo.name}</strong>
                    <span>{repo.branch} · {repo.authType ?? "none"} · {repo.url}</span>
                    <small className="monoPath">{repo.path}</small>
                    {repo.error && <small className="repoError">{repo.error}</small>}
                  </div>
                  <div className="repoActions">
                    <Status value={repo.status} />
                    {zeroHumanControlsVisible && (
                      <button onClick={() => syncRepository(repo.id)} disabled={busy}>
                        <RefreshCw size={15} /> Sync
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <div className="syncSummary">
              <span>{state.paperclipRepositorySync.repositoriesReady} ready repos</span>
              <span>{state.paperclipRepositorySync.workspacesSynced} workspaces synced</span>
              <span>{state.paperclipRepositorySync.issuesLinked} issues linked</span>
              <span>{state.paperclipRepositorySync.projectId ?? "project pending"}</span>
            </div>
            {paperclipRepositorySyncError && <p className="formWarning">{paperclipRepositorySyncError}</p>}
            {state.paperclipRepositorySync.details.length > 0 && (
              <div className="paperclipSkillDetails">
                {state.paperclipRepositorySync.details.map((item) => (
                  <article className="paperclipSkillRow" key={`${item.repositoryId}-${item.workspaceId ?? item.action}`}>
                    <div>
                      <strong>{item.repositoryName}</strong>
                      <span>{item.path}</span>
                    </div>
                    <Status value={`${item.action}${item.issuesLinked ? ` · ${item.issuesLinked} issues` : ""}`} />
                  </article>
                ))}
              </div>
            )}
            {skillSourceRepositories.length > 0 && (
              <p className="repoHint">{skillSourceRepositories.length} skill source repo hidden from task assignment. Manage them in Memory.</p>
            )}
          </div>
          )}

          {activeView === "operations" && (
          <div className="panel protection">
            <div className="panelHead">
              <div>
                <h2>Budget protection</h2>
                <p>Auto-pause uses cost events from Router.</p>
              </div>
              <Gauge size={20} />
            </div>
            <div className="budgetGauge">
              <div style={{ width: `${Math.min(100, (state.budget.spent / Math.max(1, state.budget.global)) * 100)}%` }} />
            </div>
            <div className="protectionStats">
              <span>Remaining <strong>{money(budgetRemaining)}</strong></span>
              <span>Approval gate <strong>{money(state.policies.approval_threshold_usd)}</strong></span>
              <span>Approval <strong>{state.policies.approval_required ? "required" : "optional"}</strong></span>
              <span>Auto merge <strong>{state.policies.auto_merge ? "on" : "off"}</strong></span>
              <span>Paused agents <strong>{pausedAgents}</strong></span>
            </div>
            {zeroHumanControlsVisible ? (
              <form className="budgetEditor" onSubmit={saveBudget}>
                <label>
                  Global cap
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={budgetDraft.globalBudgetUsd}
                    onChange={(event) => setBudgetDraft((current) => ({ ...current, globalBudgetUsd: event.target.value }))}
                  />
                </label>
                {state.agents.map((agent) => (
                  <label key={agent.id}>
                    {agent.id.replaceAll("_", " ")}
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={budgetDraft.agentCaps[agent.id] ?? ""}
                      onChange={(event) => setBudgetDraft((current) => ({
                        ...current,
                        agentCaps: { ...current.agentCaps, [agent.id]: event.target.value }
                      }))}
                    />
                  </label>
                ))}
                <button disabled={busy || !budgetDraft.globalBudgetUsd}>
                  <Check size={15} /> Save caps
                </button>
              </form>
            ) : (
              <div className="readOnlyNotice">
                <strong>Budget monitor</strong>
                <span>Budget policy is observed here. Operational budget decisions stay on the Paperclip company board.</span>
              </div>
            )}
          </div>
          )}

          {activeView === "memory" && (
          <div className="panel hermesAgentMemory">
            <div className="panelHead">
              <div>
                <h2>Hermes memory per agent</h2>
                <p>Read-only view of injected memory, automatic skill/MCP assignment, learned outcomes, and role relevance.</p>
              </div>
              <Brain size={20} />
            </div>
            <div className="brainSummary">
              <article><span>Memory injected</span><strong>{hermesMemoryInjected}/{state.hermesAgentMemory.length}</strong></article>
              <article><span>Ready agents</span><strong>{hermesReadyAgents}</strong></article>
              <article><span>Learned outcomes</span><strong>{state.hermesAgentMemory.reduce((sum, agent) => sum + agent.learnedOutcomes, 0)}</strong></article>
              <article><span>Failed learning</span><strong>{state.hermesAgentMemory.reduce((sum, agent) => sum + agent.failedLearning, 0)}</strong></article>
            </div>
            <div className="hermesAgentGrid">
              {state.hermesAgentMemory.length === 0 && <div className="empty">No Hermes per-agent memory state has been reported yet.</div>}
              {state.hermesAgentMemory.map((agent) => (
                <article className="hermesAgentCard" key={agent.agentId}>
                  <div className="hermesAgentHead">
                    <div>
                      <strong>{agent.agentId.replaceAll("_", " ")}</strong>
                      <span>{agent.role} - {agent.executor} - {agent.modelCombo}</span>
                    </div>
                    <Status value={agent.status} />
                  </div>
                  <div className="brainBars">
                    <label>
                      <span>Confidence</span>
                      <strong>{Math.round(agent.confidence * 100)}%</strong>
                      <i><b style={{ width: `${Math.round(agent.confidence * 100)}%` }} /></i>
                    </label>
                    <label>
                      <span>Role relevance</span>
                      <strong>{Math.round(agent.relevance * 100)}%</strong>
                      <i><b style={{ width: `${Math.round(agent.relevance * 100)}%` }} /></i>
                    </label>
                  </div>
                  <div className="brainFactGrid">
                    <span><strong>{agent.memoryInjected ? "yes" : "no"}</strong>memory injected</span>
                    <span><strong>{agent.memoryNoteCount}</strong>notes</span>
                    <span><strong>{agent.skillsAssigned.length}</strong>skills</span>
                    <span><strong>{agent.mcpAssigned.length}</strong>MCP</span>
                  </div>
                  <div className="skillRow compact">
                    {agent.skillsAssigned.slice(0, 7).map((skill) => <span key={skill}>{skill}</span>)}
                    {agent.skillsAssigned.length > 7 && <span>+{agent.skillsAssigned.length - 7}</span>}
                  </div>
                  <div className="mcpRow">
                    {agent.mcpAssigned.map((mcp) => (
                      <span className={mcp.mandatory ? "mandatory" : ""} key={mcp.id}>{mcp.name}</span>
                    ))}
                  </div>
                  <div className="memorySnippetList">
                    {agent.recentMemory.length === 0 && <small>No recent role-specific memory note.</small>}
                    {agent.recentMemory.slice(0, 2).map((note, index) => (
                      <small key={`${agent.agentId}-note-${index}`}>{note.note}</small>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
          )}

          {activeView === "memory" && (
          <div className="panel skills">
            <div className="panelHead">
              <div>
                <h2>Skill evolution</h2>
                <p>Brain publishes `zh:skill:learned` after handled tasks.</p>
              </div>
              <Brain size={20} />
            </div>
            <div className="skillMatrix">
              {state.skillProgress.length === 0 && <div className="empty">No skill events yet. Dispatch a task to start memory growth.</div>}
              {state.skillProgress.slice(0, 10).map((skill) => (
                <article className="skillCard" key={`${skill.agentId}-${skill.skill}`}>
                  <div>
                    <strong>{skill.skill}</strong>
                    <span>{skill.agentId} · {skill.runs} runs</span>
                  </div>
                  <div className="confidence">
                    <span>{Math.round(skill.confidence * 100)}%</span>
                    <div><i style={{ width: `${Math.round(skill.confidence * 100)}%` }} /></div>
                  </div>
                </article>
              ))}
            </div>
            <div className="roleSkillBoard">
              {roleSkillRows.map(({ agent, learned }) => (
                <article className="roleSkillCard" key={agent.id}>
                  <div>
                    <strong>{agent.id.replaceAll("_", " ")}</strong>
                    <span>{agent.role} · {agent.executor}</span>
                  </div>
                  <div className="skillRow">
                    {agent.skills.map((skill) => <span key={skill}>{skill}</span>)}
                  </div>
                  <small>
                    {learned.length
                      ? `${learned.length} learned skills tracked by Hermes Brain`
                      : "Waiting for first handled task"}
                  </small>
                </article>
              ))}
            </div>
            <div className="registryBoard">
              <div className="registrySummary">
                <strong>{registryEntries.length}</strong>
                <span>company skills across {registryCategories.length} divisions</span>
              </div>
              <div className="registryCategories">
                {registryCategories.map((category) => (
                  <article className="registryCategory" key={category}>
                    <strong>{category}</strong>
                    <span>{registryEntries.filter(([, skill]) => skill.category === category).length} skills</span>
                  </article>
                ))}
              </div>
            </div>
          </div>
          )}

          {activeView === "memory" && (
          <div className="panel skillImport">
            <div className="panelHead">
              <div>
                <h2>Skill sources</h2>
                <p>Register knowledge repos here. They feed memory and never become task workspaces.</p>
              </div>
              <FolderGit2 size={20} />
            </div>
            {zeroHumanControlsVisible ? (
              <form className="repoForm sourceIntake" onSubmit={addSkillSource}>
                <label>
                  Source name
                  <input
                    value={skillSourceDraft.name}
                    placeholder="company-skillbook"
                    onChange={(event) => setSkillSourceDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label>
                  Git URL
                  <input
                    value={skillSourceDraft.url}
                    placeholder="https://github.com/org/skills.git"
                    onChange={(event) => setSkillSourceDraft((current) => ({ ...current, url: event.target.value }))}
                  />
                </label>
                <label>
                  Branch
                  <input
                    value={skillSourceDraft.branch}
                    onChange={(event) => setSkillSourceDraft((current) => ({ ...current, branch: event.target.value }))}
                  />
                </label>
                <label>
                  Auth
                  <select
                    value={skillSourceDraft.authType}
                    onChange={(event) => setSkillSourceDraft((current) => ({ ...current, authType: event.target.value as typeof skillSourceDraft.authType }))}
                  >
                    <option value="none">Public / no auth</option>
                    <option value="https-token">HTTPS token</option>
                    <option value="ssh-key">SSH private key</option>
                  </select>
                </label>
                {skillSourceDraft.authType === "https-token" && (
                  <>
                    <label>
                      Username
                      <input
                        value={skillSourceDraft.username}
                        placeholder="x-access-token"
                        onChange={(event) => setSkillSourceDraft((current) => ({ ...current, username: event.target.value }))}
                      />
                    </label>
                    <label>
                      Token
                      <input
                        type="password"
                        value={skillSourceDraft.token}
                        placeholder="GitHub PAT or GitLab token"
                        onChange={(event) => setSkillSourceDraft((current) => ({ ...current, token: event.target.value }))}
                      />
                    </label>
                  </>
                )}
                {skillSourceDraft.authType === "ssh-key" && (
                  <label>
                    SSH private key
                    <textarea
                      className="secretBox"
                      value={skillSourceDraft.sshPrivateKey}
                      placeholder="Paste the complete SSH private key here"
                      onChange={(event) => setSkillSourceDraft((current) => ({ ...current, sshPrivateKey: event.target.value }))}
                    />
                  </label>
                )}
                <button disabled={busy || !skillSourceDraft.url.trim()}>
                  <Plus size={15} /> Add skill source
                </button>
                {skillSourceError && <p className="formWarning">{skillSourceError}</p>}
              </form>
            ) : (
              <div className="readOnlyNotice">
                <strong>Automatic memory source mapping</strong>
                <span>Skill and memory sources are monitored here. Paperclip/Hermes automation owns import, classification, and assignment.</span>
              </div>
            )}
            <div className="sourceDivider">
              <strong>Import into memory</strong>
              <span>Scan SKILL.md files, skip duplicates, and map new skills into company roles.</span>
            </div>
            {zeroHumanControlsVisible ? (
              <form className="repoForm" onSubmit={importRepoSkills}>
                <label>
                  Skill source
                  <select
                    value={skillImportDraft.repositoryId}
                    onChange={(event) => setSkillImportDraft((current) => ({ ...current, repositoryId: event.target.value }))}
                  >
                    {skillSourceRepositories.map((repo) => (
                      <option value={repo.id} key={repo.id}>{repo.name} · {repo.status}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Path
                  <input
                    value={skillImportDraft.path}
                    placeholder="skills or leave empty for whole repo"
                    onChange={(event) => setSkillImportDraft((current) => ({ ...current, path: event.target.value }))}
                  />
                </label>
                <button disabled={busy || !skillImportDraft.repositoryId}>
                  <Plus size={15} /> Import skills
                </button>
                {skillImportError && <p className="formWarning">{skillImportError}</p>}
              </form>
            ) : (
              <div className="readOnlyNotice">
                <strong>Import is automated</strong>
                <span>Zero-Human reports imported, skipped, and duplicate skills. Manual import controls are intentionally disabled.</span>
              </div>
            )}
            <div className="repoList">
              {skillSourceRepositories.length === 0 && <div className="empty">No skill source registered yet. Add a skill repo above first.</div>}
              {skillSourceRepositories.map((repo) => (
                <article className="repoRow sourceRow" key={repo.id}>
                  <div>
                    <strong>{repo.name}</strong>
                    <span>{repo.branch} · {repo.authType ?? "none"} · skill source</span>
                    <small className="monoPath">{repo.path}</small>
                    {repo.error && <small className="repoError">{repo.error}</small>}
                  </div>
                  <div className="repoActions">
                    <Status value={repo.status} />
                    {zeroHumanControlsVisible && (
                      <button onClick={() => syncRepository(repo.id)} disabled={busy}>
                        <RefreshCw size={15} /> Sync
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {(latestSkillImport ?? state.skillImports[0]) && (
              <article className="importReport">
                <strong>{(latestSkillImport ?? state.skillImports[0]).repositoryName}</strong>
                <span>
                  {(latestSkillImport ?? state.skillImports[0]).imported} imported · {(latestSkillImport ?? state.skillImports[0]).duplicates} duplicates · {(latestSkillImport ?? state.skillImports[0]).scanned} scanned
                </span>
                {(latestSkillImport ?? state.skillImports[0]).skipped.slice(0, 4).map((item) => (
                  <small key={`${item.sourcePath}-${item.duplicateOf}`}>
                    {item.name} skipped: {item.reason} ({item.duplicateOf})
                  </small>
                ))}
              </article>
            )}
          </div>
          )}

          {activeView === "memory" && (
          <div className="panel paperclipHermesBridge">
            <div className="panelHead">
              <div>
                <h2>Hermes bridge</h2>
                <p>Inject memory, delegation, and token guardrails into Paperclip agents before Codex runs.</p>
              </div>
              {zeroHumanControlsVisible ? (
                <button onClick={syncPaperclipHermesBridge} disabled={busy}>
                  <RefreshCw size={15} /> Sync Hermes
                </button>
              ) : (
                <span className="readOnlyChip">Auto bridge</span>
              )}
            </div>
            <div className="syncSummary">
              <span>{state.paperclipHermesBridge.protocolSkillSynced ? "protocol synced" : "protocol pending"}</span>
              <span>{state.paperclipHermesBridge.agentsPatched} agents patched</span>
              <span>{state.paperclipHermesBridge.agentsScanned} scanned</span>
              <span>{state.paperclipHermesBridge.memoryNotesWritten} memory notes</span>
              <span>{state.paperclipHermesBridge.protocolSkillKey}</span>
            </div>
            {paperclipHermesBridgeError && <p className="formWarning">{paperclipHermesBridgeError}</p>}
            <div className="paperclipSkillDetails">
              {state.paperclipHermesBridge.details.length === 0 && (
                <div className="empty">No Hermes bridge sync run yet.</div>
              )}
              {state.paperclipHermesBridge.details.slice(0, 10).map((item, index) => (
                <article className="paperclipSkillRow" key={`${item.action}-${item.agentId ?? index}`}>
                  <div>
                    <strong>{item.agentName ?? item.action.replaceAll("_", " ")}</strong>
                    <span>{[item.role, item.reason].filter(Boolean).join(" · ")}</span>
                  </div>
                  <Status value={item.action.replace("agent_", "").replace("_ready", "ready")} />
                </article>
              ))}
            </div>
          </div>
          )}

          {activeView === "memory" && (
          <div className="panel paperclipSkillSync">
            <div className="panelHead">
              <div>
                <h2>Paperclip skill sync</h2>
                <p>Publish Zero-Human registry skills into Paperclip native Skills without duplicating existing entries.</p>
              </div>
              {zeroHumanControlsVisible ? (
                <button onClick={syncPaperclipSkills} disabled={busy}>
                  <RefreshCw size={15} /> Sync skills
                </button>
              ) : (
                <span className="readOnlyChip">Auto assigned</span>
              )}
            </div>
            <div className="syncSummary">
              <span>{state.paperclipSkillSync.registrySkills} registry skills</span>
              <span>{state.paperclipSkillSync.imported} imported</span>
              <span>{state.paperclipSkillSync.updated} updated</span>
              <span>{state.paperclipSkillSync.skipped} skipped</span>
              <span>{state.paperclipSkillSync.companyId ?? "company pending"}</span>
            </div>
            {paperclipSkillSyncError && <p className="formWarning">{paperclipSkillSyncError}</p>}
            <div className="paperclipSkillDetails">
              {state.paperclipSkillSync.details.length === 0 && (
                <div className="empty">No Paperclip skill sync run yet.</div>
              )}
              {state.paperclipSkillSync.details.slice(0, 10).map((item) => (
                <article className="paperclipSkillRow" key={`${item.skill}-${item.paperclipKey ?? item.reason}`}>
                  <div>
                    <strong>{item.skill.replaceAll("_", " ")}</strong>
                    <span>{item.paperclipKey ?? item.reason ?? "zero-human registry"}</span>
                  </div>
                  <Status value={item.action} />
                </article>
              ))}
            </div>
          </div>
          )}

          {activeView === "memory" && (
          <div className="panel registry">
            <div className="panelHead">
              <div>
                <h2>Company skill registry</h2>
                <p>Shared skill catalog for tech and backoffice divisions.</p>
              </div>
              <Brain size={20} />
            </div>
            <div className="registryList">
              {registryEntries.map(([name, skill]) => (
                <article className="registrySkill" key={name}>
                  <div>
                    <strong>{name.replaceAll("_", " ")}</strong>
                    <span>
                      {[
                        skill.category,
                        skill.roles.join(", "),
                        skill.source,
                        skill.isOfficial ? "official" : "",
                        typeof skill.installs === "number" ? `${skill.installs.toLocaleString()} installs` : "",
                        skill.requiresApproval ? "approval" : ""
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <p>{skill.description}</p>
                  <div className="triggerRow">
                    {skill.triggers.slice(0, 5).map((trigger) => <code key={trigger}>{trigger}</code>)}
                  </div>
                </article>
              ))}
            </div>
          </div>
          )}

          {activeView === "memory" && (
          <div className="panel memory">
            <div className="panelHead">
              <div>
                <h2>Persistent memory</h2>
                <p>Recent Brain notes from the mounted memory volume.</p>
              </div>
              <Brain size={20} />
            </div>
            <div className="memoryList">
              {state.brainMemory.recentNotes.length === 0 && <div className="empty">No memory notes persisted yet.</div>}
              {state.brainMemory.recentNotes.map((item, index) => (
                <article className="memoryNote" key={`${item.agentId}-${index}`}>
                  <strong>{item.agentId}</strong>
                  <span>{item.note}</span>
                </article>
              ))}
            </div>
          </div>
          )}

          {activeView === "mcp" && (
          <div className="panel mcpMarketplace">
            <div className="panelHead">
              <div>
                <h2>MCP marketplace</h2>
                <p>Find installable Model Context Protocol servers for company divisions.</p>
              </div>
              <PackageSearch size={20} />
            </div>
            <label className="mcpSearch">
              Search marketplace
              <input
                value={mcpQuery}
                placeholder="github, figma, database, browser, sequential"
                onChange={(event) => setMcpQuery(event.target.value)}
              />
            </label>
            {zeroHumanControlsVisible ? (
              <div className="mcpImportGrid">
                <form className="mcpImportBox" onSubmit={importMcpRegistry}>
                  <strong>Import registry URL</strong>
                  <span>Load a JSON feed with `items`, `servers`, or an array of MCP configs.</span>
                  <input
                    value={mcpRegistryUrl}
                    placeholder="https://example.com/mcp-registry.json"
                    onChange={(event) => setMcpRegistryUrl(event.target.value)}
                  />
                  <button disabled={busy || !mcpRegistryUrl.trim()}>
                    <Download size={15} /> Import registry
                  </button>
                </form>
                <form className="mcpImportBox customMcpBox" onSubmit={installCustomMcp}>
                  <strong>Add custom MCP JSON</strong>
                  <span>Paste a single MCP config. Zero-Human will validate, install, and add it to the local marketplace.</span>
                  <textarea
                    className="customMcpEditor"
                    value={customMcpDraft}
                    spellCheck={false}
                    onChange={(event) => setCustomMcpDraft(event.target.value)}
                  />
                  <button disabled={busy || !customMcpDraft.trim()}>
                    <Plus size={15} /> Install custom MCP
                  </button>
                </form>
              </div>
            ) : (
              <div className="readOnlyNotice">
                <strong>MCP assignment is observed</strong>
                <span>Paperclip receives MCP guidance from Hermes/Zero-Human automation. Install and config actions are hidden from the monitor.</span>
              </div>
            )}
            {mcpError && <p className="formWarning">{mcpError}</p>}
            {mcpMessage && <p className="formSuccess">{mcpMessage}</p>}
            <div className="mcpCards">
              {filteredMarketplace.map((item) => (
                <article className="mcpCard" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.category} · {item.transport} · {item.packageName ?? item.url}</span>
                  </div>
                  <p>{item.description}</p>
                  <div className="triggerRow">
                    {(item.tags ?? []).slice(0, 5).map((tag) => <code key={tag}>{tag}</code>)}
                  </div>
                  <div className="mcpCardFooter">
                    <Status value={installedMcpIds.has(item.id) ? "installed" : "available"} />
                    {zeroHumanControlsVisible ? (
                      <button onClick={() => installMcp(item.id)} disabled={busy}>
                        <Download size={15} /> {installedMcpIds.has(item.id) ? "Reinstall" : "Install"}
                      </button>
                    ) : (
                      <span className="readOnlyChip">{installedMcpIds.has(item.id) ? "Installed" : "Available"}</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
          )}

          {activeView === "mcp" && (
          <div className="panel mcpManager">
            <div className="panelHead">
              <div>
                <h2>Manage MCP</h2>
                <p>Installed servers are stored as editable JSON and mapped to agent roles.</p>
              </div>
              <TerminalSquare size={20} />
            </div>
            {state.mcpServers.length === 0 && <div className="empty">Install an MCP from the marketplace to manage its JSON config.</div>}
            {state.mcpServers.length > 0 && (
              <>
                <label className="mcpSearch">
                  Installed server
                  <select value={selectedMcp?.id ?? ""} onChange={(event) => setSelectedMcpId(event.target.value)}>
                    {state.mcpServers.map((server) => (
                      <option value={server.id} key={server.id}>{server.name} · {server.status}</option>
                    ))}
                  </select>
                </label>
                {selectedMcp && (
                  <>
                    <div className="mcpSummary">
                      <div>
                        <strong>{selectedMcp.name}</strong>
                        <span>{selectedMcp.transport} · {selectedMcp.permissions.mode} · {selectedMcp.roles.join(", ")}</span>
                        {selectedMcp.error && <small className="repoError">{selectedMcp.error}</small>}
                      </div>
                      <Status value={selectedMcp.lastTestStatus ?? selectedMcp.status} />
                    </div>
                    <textarea
                      className="jsonEditor"
                      value={mcpJsonDraft}
                      spellCheck={false}
                      readOnly={!zeroHumanControlsVisible}
                      onChange={(event) => setMcpJsonDraft(event.target.value)}
                    />
                    {zeroHumanControlsVisible ? (
                      <div className="mcpActions">
                        <button onClick={saveMcpJson} disabled={busy}>
                          <Save size={15} /> Save JSON
                        </button>
                        <button onClick={() => testMcp(selectedMcp.id)} disabled={busy}>
                          <Check size={15} /> Test
                        </button>
                        <button onClick={() => updateMcpStatus(selectedMcp, selectedMcp.status === "enabled" ? "disabled" : "enabled")} disabled={busy}>
                          {selectedMcp.status === "enabled" ? "Disable" : "Enable"}
                        </button>
                      </div>
                    ) : (
                      <div className="readOnlyNotice">
                        <strong>Read-only JSON</strong>
                        <span>MCP JSON is displayed for audit only. Runtime assignment is automatic through Paperclip guidance.</span>
                      </div>
                    )}
                    {mcpError && <p className="formWarning">{mcpError}</p>}
                    {mcpMessage && <p className="formSuccess">{mcpMessage}</p>}
                  </>
                )}
              </>
            )}
          </div>
          )}

          {activeView === "mcp" && (
          <div className="panel mcpRoleMap">
            <div className="panelHead">
              <div>
                <h2>Role tool map</h2>
                <p>Enabled MCP servers are injected into task guidance only for assigned roles.</p>
              </div>
              <Users size={20} />
            </div>
            <div className="roleToolGrid">
              {state.agents.map((agent) => {
                const tools = Array.from(
                  new Map(
                    state.mcpServers
                      .filter((server) => (server.id === "sequential-thinking" && server.status !== "disabled") || (server.status === "enabled" && server.roles.includes(agent.role)))
                      .map((server) => [server.id, server])
                  ).values()
                );
                return (
                  <article className="roleToolCard" key={agent.id}>
                    <div>
                      <strong>{agent.id.replaceAll("_", " ")}</strong>
                      <span>{agent.role} · {tools.length} MCP tool{tools.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="skillRow">
                      {tools.length === 0 && <span>no mcp assigned</span>}
                      {tools.map((server) => <span key={server.id}>{server.name}</span>)}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
          )}

          {activeView === "operations" && (
          <div className="panel tasks">
            <div className="panelHead">
              <div>
                <h2>Task queue</h2>
                <p>Review gate stays human-controlled.</p>
              </div>
              <ShieldCheck size={20} />
            </div>
            <div className="taskList">
              {state.tasks.length === 0 && <div className="empty">No tasks yet. Dispatch one to test the flow.</div>}
              {state.tasks.map((task) => (
                <article className="taskRow" key={task.id}>
                  <div>
                    <strong>{task.description}</strong>
                    <span>{task.id} · {task.agentId} · P{task.priority}</span>
                    {task.repositoryName && <span>{task.repositoryName}</span>}
                    {task.branchName && <span>{task.branchName}</span>}
                    {task.requiredSkills && task.requiredSkills.length > 0 && (
                      <div className="changeList">
                        {task.requiredSkills.slice(0, 8).map((skill) => <code key={skill}>{skill}</code>)}
                      </div>
                    )}
                    {task.worktreePath && <small className="monoPath">{task.worktreePath}</small>}
                    {task.hostApplyStatus && (
                      <span>
                        Host export {task.hostApplyStatus}
                        {task.hostCommit ? ` · ${task.hostCommit}` : ""}
                      </span>
                    )}
                    {task.hostPatchPath && <small className="monoPath">{task.hostPatchPath}</small>}
                    {task.result && <p>{task.result}</p>}
                    {task.changedFiles && task.changedFiles.length > 0 && (
                      <div className="changeList">
                        {task.changedFiles.slice(0, 5).map((file) => <code key={file}>{file}</code>)}
                      </div>
                    )}
                    {task.validationOutput && (
                      <pre className="validationBox">{task.validationOutput}</pre>
                    )}
                  </div>
                  <div className="taskActions">
                    <Status value={task.status} />
                    {task.status === "pending_review" && (
                      <>
                        <button onClick={() => loadDiff(task.id)} disabled={busy}>Diff</button>
                        {zeroHumanControlsVisible ? (
                          <>
                            <button onClick={() => reject(task.id)} disabled={busy}>Reject</button>
                            <button onClick={() => approve(task.id)} disabled={busy}><Check size={15} /> Approve</button>
                          </>
                        ) : (
                          <span className="readOnlyChip">Review in Paperclip</span>
                        )}
                      </>
                    )}
                  </div>
                  {diffs[task.id] && (
                    <pre className="diffBox">{diffs[task.id].diff || diffs[task.id].status || "No diff output."}</pre>
                  )}
                </article>
              ))}
            </div>
          </div>
          )}

          {(activeView === "operations" || activeView === "memory") && (
          <div className="panel events">
            <div className="panelHead">
              <div>
                <h2>Company activity</h2>
                <p>{realtime.message} · {state.infrastructure.redisUrl}</p>
              </div>
            </div>
            <ol>
              {state.events.slice(0, 10).map((event, index) => (
                <li key={event.id ?? `${event.timestamp}-${index}`}>
                  <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                  <div>
                    <strong>{event.event}</strong>
                    <span>{event.summary}</span>
                    <small>
                      {[event.source, event.agentId, event.issueKey].filter(Boolean).join(" · ") || "company"}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          )}

          {activeView === "gateway" && (
          <div className="panel routerMonitor">
            <div className="panelHead">
              <div>
                <h2>9Router monitor</h2>
                <p>Observe active combo, provider fallback, failed providers, and token/cost spike guardrails. 9Router remains the gateway source of truth.</p>
              </div>
              <RadioTower size={20} />
            </div>
            <div className="routerMonitorGrid">
              <article>
                <span>Active combo</span>
                <strong>{state.routerMonitor.activeCombo || "unconfigured"}</strong>
                <small>{state.routerMonitor.configuredCombos.length} configured combos</small>
              </article>
              <article>
                <span>Requests</span>
                <strong>{state.routerMonitor.requests.toLocaleString()}</strong>
                <small>{state.routerMonitor.inputTokens.toLocaleString()} in - {state.routerMonitor.outputTokens.toLocaleString()} out</small>
              </article>
              <article>
                <span>Cost guardrail</span>
                <strong>{money(state.routerMonitor.costUsd)}</strong>
                <small>{routerSpike.status}: {routerSpike.highCostRuns} high-cost runs</small>
              </article>
            </div>
            <div className="routerMonitorColumns">
              <section>
                <h3>Model distribution</h3>
                <div className="distributionList">
                  {state.routerMonitor.modelDistribution.length === 0 && <div className="empty">No configured model routes reported.</div>}
                  {state.routerMonitor.modelDistribution.map((route, index) => (
                    <article className={route.active ? "activeRoute" : ""} key={`${route.combo}-${route.provider}-${route.model}-${index}`}>
                      <div>
                        <strong>{route.provider}/{route.model}</strong>
                        <span>{route.combo}{route.active ? " - active" : ""}</span>
                      </div>
                      <small>{route.requests.toLocaleString()} requests</small>
                    </article>
                  ))}
                </div>
              </section>
              <section>
                <h3>Provider fallback</h3>
                <div className="providerList">
                  {state.routerMonitor.providerFallbacks.length === 0 && <div className="empty">No provider routes available.</div>}
                  {state.routerMonitor.providerFallbacks.map((provider) => (
                    <article key={provider.provider}>
                      <div>
                        <strong>{provider.provider}</strong>
                        <span>{provider.lastModel ?? "waiting for traffic"}</span>
                      </div>
                      <Status value={provider.status} />
                      <small>{provider.fallbackCount} fallback - {provider.failureCount} failed</small>
                    </article>
                  ))}
                </div>
              </section>
              <section>
                <h3>Spike guardrail</h3>
                <div className={`guardrailBox ${routerSpike.status}`}>
                  <strong>{routerSpike.status}</strong>
                  <span>{routerSpike.reason}</span>
                  <small>Threshold: {routerSpike.thresholdTokens.toLocaleString()} tokens or {money(routerSpike.thresholdCostUsd)}</small>
                </div>
                <div className="failedProviderList">
                  {state.routerMonitor.failedProviders.length === 0 && <small>No failed provider detected by Hermes interventions.</small>}
                  {state.routerMonitor.failedProviders.map((provider) => (
                    <small key={provider.provider}>{provider.provider}: {provider.failures} failures - {provider.reason}</small>
                  ))}
                </div>
              </section>
            </div>
          </div>
          )}

          {activeView === "gateway" && (
          <div className="panel combos">
            <div className="panelHead">
              <div>
                <h2>Model combos</h2>
                <p>9Router routing groups available to Zero-Human agents.</p>
              </div>
              <RadioTower size={20} />
            </div>
            <div className="comboList">
              {Object.entries(state.combos).length === 0 && <div className="empty">No model combos configured yet.</div>}
              {Object.entries(state.combos).map(([comboName, models]) => (
                <article className="comboRow" key={comboName}>
                  <div>
                    <strong>{comboName}</strong>
                    <span>{models.length} model route{models.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="comboModels">
                    {models.map((model, index) => (
                      <code key={`${comboName}-${model.provider}-${model.model}-${index}`}>
                        {model.provider}/{model.model}
                      </code>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
          )}

          {activeView === "gateway" && (
          <div className="panel upstreams">
            <div className="panelHead">
              <div>
                <h2>Upstream code</h2>
                <p>Original repositories mounted as git subtrees.</p>
              </div>
              <GitBranch size={20} />
            </div>
            <div className="upstreamList">
              {state.upstreams.map((upstream) => (
                <article className="upstreamRow" key={upstream.name}>
                  <div>
                    <strong>{upstream.displayName}</strong>
                    <span>{upstream.packageName ?? upstream.name} {upstream.version ? `· v${upstream.version}` : ""}</span>
                    <small>{upstream.prefix}</small>
                    <small>{upstream.configuredUrl}</small>
                    <a href={upstream.defaultUrl} target="_blank" rel="noreferrer">{upstream.defaultUrl}</a>
                  </div>
                  <Status value={upstream.present ? "present" : "error"} />
                </article>
              ))}
            </div>
          </div>
          )}
        </section>
      </section>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <article className="metric"><div>{icon}</div><span>{label}</span><strong>{value}</strong></article>;
}

function Status({ value }: { value: string }) {
  return <span className={`status ${value}`}>{value.replace("_", " ")}</span>;
}

createRoot(document.getElementById("root")!).render(<App />);
