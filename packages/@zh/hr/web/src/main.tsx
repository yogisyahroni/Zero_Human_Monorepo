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

type ViewId = "operations" | "agents" | "memory" | "gateway" | "mcp";

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

type State = {
  company: { name: string; description: string; budget_usd: number; currency: string };
  infrastructure: { redisUrl: string; worktreeBase: string };
  policies: { approval_required: boolean; approval_threshold_usd: number; auto_merge: boolean };
  agents: Agent[];
  tasks: Task[];
  events: Array<{ event: string; timestamp: string; summary: string }>;
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
  infrastructure: { redisUrl: "", worktreeBase: "" },
  policies: { approval_required: true, approval_threshold_usd: 0, auto_merge: false },
  agents: [],
  tasks: [],
  events: [],
  alerts: [],
  routerMetrics: { requests: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 },
  skillProgress: [],
  serviceHealth: [],
  brainMemory: { ok: false, agentCount: 0, entries: 0, outcomes: 0, skills: [], recentNotes: [] },
  upstreams: [],
  repositories: [],
  mcpMarketplace: [],
  mcpServers: [],
  hiringRequests: [],
  skillImports: [],
  skillRegistry: {},
  budget: { global: 0, allocated: 0, spent: 0, currency: "USD" },
  combos: {}
};

function money(value: number): string {
  return `$${value.toFixed(value >= 10 ? 0 : 3)}`;
}

const views: Array<{ id: ViewId; label: string; eyebrow: string; title: string; description: string; icon: React.ReactNode }> = [
  {
    id: "operations",
    label: "Operations",
    eyebrow: "Command center",
    title: "Operations board",
    description: "Track budget gates, active task worktrees, review state, and live execution events.",
    icon: <Activity size={19} />
  },
  {
    id: "agents",
    label: "Agents",
    eyebrow: "Workforce",
    title: "Agent bench",
    description: "Hire operators, choose a repository, and dispatch coding work into isolated worktrees.",
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
    title: "9Router gateway",
    description: "Manage repository intake, inspect service health, upstream code, and model combo routing.",
    icon: <RadioTower size={19} />
  },
  {
    id: "mcp",
    label: "MCP",
    eyebrow: "Tool marketplace",
    title: "MCP control plane",
    description: "Install Model Context Protocol servers, manage JSON config, and assign tools to company roles.",
    icon: <PackageSearch size={19} />
  }
];

function App() {
  const [state, setState] = useState<State>(fallbackState);
  const [activeView, setActiveView] = useState<ViewId>("operations");
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

  async function refresh() {
    const response = await fetch("/api/state");
    setState(await response.json());
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 1800);
    return () => window.clearInterval(interval);
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

  useEffect(() => {
    if (!workRepositories.some((repo) => repo.id === repositoryId)) {
      setRepositoryId(workRepositories[0]?.id ?? "default");
    }
  }, [repositoryId, workRepositories]);

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
          <button className="iconText" onClick={refresh} disabled={busy}>
            <RefreshCw size={17} /> Sync
          </button>
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
                    <button onClick={() => hire(agent.id)} disabled={busy}>
                      <Plus size={15} /> Hire
                    </button>
                    {agent.status === "paused" && (
                      <button onClick={() => resume(agent.id)} disabled={busy}>
                        Resume
                      </button>
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
                <h2>Hiring approvals</h2>
                <p>Paperclip hire intake is mapped first, then activated after approval.</p>
              </div>
              <Users size={20} />
            </div>
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
                  <div className="hireActions">
                    <button onClick={() => rejectHireRequest(request.id)} disabled={busy}>Reject</button>
                    <button onClick={() => approveHireRequest(request.id)} disabled={busy}><Check size={15} /> Approve</button>
                  </div>
                </article>
              ))}
            </div>
          </div>
          )}

          {activeView === "agents" && (
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
          )}

          {activeView === "gateway" && (
          <div className="panel repositories">
            <div className="panelHead">
              <div>
                <h2>Repository intake</h2>
                <p>Clone a Git repository into the Docker workspace.</p>
              </div>
              <FolderGit2 size={20} />
            </div>
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
                    <button onClick={() => syncRepository(repo.id)} disabled={busy}>
                      <RefreshCw size={15} /> Sync
                    </button>
                  </div>
                </article>
              ))}
            </div>
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
            <div className="sourceDivider">
              <strong>Import into memory</strong>
              <span>Scan SKILL.md files, skip duplicates, and map new skills into company roles.</span>
            </div>
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
                    <button onClick={() => syncRepository(repo.id)} disabled={busy}>
                      <RefreshCw size={15} /> Sync
                    </button>
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
                    <button onClick={() => installMcp(item.id)} disabled={busy}>
                      <Download size={15} /> {installedMcpIds.has(item.id) ? "Reinstall" : "Install"}
                    </button>
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
                      onChange={(event) => setMcpJsonDraft(event.target.value)}
                    />
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
                const tools = state.mcpServers.filter((server) => server.status === "enabled" && server.roles.includes(agent.role));
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
                        <button onClick={() => reject(task.id)} disabled={busy}>Reject</button>
                        <button onClick={() => approve(task.id)} disabled={busy}><Check size={15} /> Approve</button>
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
                <h2>Event stream</h2>
                <p>{state.infrastructure.redisUrl}</p>
              </div>
            </div>
            <ol>
              {state.events.slice(0, 10).map((event, index) => (
                <li key={`${event.timestamp}-${index}`}>
                  <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                  <span>{event.event}</span>
                </li>
              ))}
            </ol>
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
