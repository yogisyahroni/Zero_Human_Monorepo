import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BadgeDollarSign,
  Brain,
  Check,
  CircuitBoard,
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
  priority: 1 | 2 | 3;
  status: string;
  worktreePath?: string;
  costAccumulated?: number;
  result?: string;
  createdAt: string;
};

type State = {
  company: { name: string; description: string; budget_usd: number; currency: string };
  infrastructure: { redisUrl: string; worktreeBase: string };
  policies: { approval_required: boolean; approval_threshold_usd: number; auto_merge: boolean };
  agents: Agent[];
  tasks: Task[];
  events: Array<{ event: string; timestamp: string; summary: string }>;
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
  brainMemory: { ok: boolean; agentCount: number; entries: number; error?: string };
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
  routerMetrics: { requests: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 },
  skillProgress: [],
  serviceHealth: [],
  brainMemory: { ok: false, agentCount: 0, entries: 0 },
  upstreams: [],
  budget: { global: 0, allocated: 0, spent: 0, currency: "USD" },
  combos: {}
};

function money(value: number): string {
  return `$${value.toFixed(value >= 10 ? 0 : 3)}`;
}

function App() {
  const [state, setState] = useState<State>(fallbackState);
  const [selectedAgent, setSelectedAgent] = useState("cto");
  const [description, setDescription] = useState("Create an architecture plan for the authentication module.");
  const [type, setType] = useState("architecture");
  const [priority, setPriority] = useState<1 | 2 | 3>(2);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/state");
    setState(await response.json());
  }

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 1800);
    return () => window.clearInterval(interval);
  }, []);

  const activeTasks = useMemo(
    () => state.tasks.filter((task) => task.status !== "done").length,
    [state.tasks]
  );
  const selectedAgentProfile = state.agents.find((agent) => agent.id === selectedAgent);
  const budgetRemaining = Math.max(0, state.budget.global - state.budget.spent);
  const pausedAgents = state.agents.filter((agent) => agent.status === "paused").length;

  async function hire(agentId: string) {
    setBusy(true);
    await fetch(`/api/agents/${agentId}/hire`, { method: "POST" });
    await refresh();
    setBusy(false);
  }

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: selectedAgent, type, description, priority })
    });
    setDescription("");
    await refresh();
    setBusy(false);
  }

  async function approve(taskId: string) {
    setBusy(true);
    await fetch(`/api/tasks/${taskId}/approve`, { method: "POST" });
    await refresh();
    setBusy(false);
  }

  return (
    <main className="shell">
      <aside className="rail">
        <div className="mark"><CircuitBoard size={22} /></div>
        <button title="Operations"><Activity size={19} /></button>
        <button title="Agents"><Users size={19} /></button>
        <button title="Memory"><Brain size={19} /></button>
        <button title="Gateway"><RadioTower size={19} /></button>
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

        <section className="metrics">
          <Metric icon={<BadgeDollarSign />} label="Budget spent" value={`${money(state.budget.spent)} / ${money(state.budget.global)}`} />
          <Metric icon={<Users />} label="Agents online" value={`${state.agents.length}`} />
          <Metric icon={<GitBranch />} label="Active tasks" value={`${activeTasks}`} />
          <Metric icon={<RadioTower />} label="Router cost" value={money(state.routerMetrics.costUsd)} />
        </section>

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
              <span>{state.brainMemory.entries} notes · {state.brainMemory.agentCount} agents</span>
            </div>
            <Status value={state.brainMemory.ok ? "online" : "error"} />
          </article>
        </section>

        <section className="grid">
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
                  </div>
                </article>
              ))}
            </div>
          </div>

          <form className="panel taskComposer" onSubmit={createTask}>
            <div className="panelHead">
              <div>
                <h2>Assign work</h2>
                <p>Publishes `zh:task:assigned` through Redis.</p>
              </div>
              <Play size={20} />
            </div>
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
              <span>Paused agents <strong>{pausedAgents}</strong></span>
            </div>
          </div>

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
              {state.skillProgress.slice(0, 6).map((skill) => (
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
          </div>

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
                    {task.result && <p>{task.result}</p>}
                  </div>
                  <div className="taskActions">
                    <Status value={task.status} />
                    {task.status === "pending_review" && (
                      <button onClick={() => approve(task.id)} disabled={busy}><Check size={15} /> Approve</button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>

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
