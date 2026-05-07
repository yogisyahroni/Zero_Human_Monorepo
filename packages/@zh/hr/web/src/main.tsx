import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BadgeDollarSign,
  Brain,
  Check,
  CircuitBoard,
  FolderGit2,
  Gauge,
  GitBranch,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Users
} from "lucide-react";
import "./styles.css";

type ViewId = "operations" | "agents" | "memory" | "gateway";

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
  authType?: "none" | "https-token" | "ssh-key";
  username?: string;
  status: "ready" | "syncing" | "error";
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
  error?: string;
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
  skillRegistry: Record<string, {
    category: string;
    description: string;
    roles: string[];
    triggers: string[];
    tools?: string[];
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
    authType: "none" as "none" | "https-token" | "ssh-key",
    username: "",
    token: "",
    sshPrivateKey: ""
  });
  const [repoError, setRepoError] = useState("");
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

  async function addRepository(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setRepoError("");
    const response = await fetch("/api/repositories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(repoDraft)
    });
    const body = await response.json();
    if (!response.ok) {
      setRepoError(body.error ?? body.error ?? "Failed to register repository");
    } else {
      setRepositoryId(body.id);
      setRepoDraft({ name: "", url: "", branch: "main", authType: "none", username: "", token: "", sshPrivateKey: "" });
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
          <Metric icon={<FolderGit2 />} label="Repos ready" value={`${state.repositories.filter((repo) => repo.status === "ready").length}`} />
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
                {state.repositories.map((repo) => <option value={repo.id} key={repo.id}>{repo.name} · {repo.branch}</option>)}
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
              {state.repositories.map((repo) => (
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
                    <span>{skill.category} · {skill.roles.join(", ")}</span>
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
