export interface UpstreamSource {
  name: "router" | "brain" | "hr";
  displayName: string;
  repository: string;
  branch: string;
  prefix: string;
  defaultUrl: string;
  containerPort: number;
  role: string;
}

export const upstreamSources: UpstreamSource[] = [
  {
    name: "router",
    displayName: "9Router",
    repository: "https://github.com/decolua/9router.git",
    branch: "master",
    prefix: "packages/@zh/router/upstream",
    defaultUrl: "http://localhost:20128",
    containerPort: 20128,
    role: "Local AI gateway with provider fallback and dashboard"
  },
  {
    name: "brain",
    displayName: "Hermes Agent",
    repository: "https://github.com/NousResearch/hermes-agent.git",
    branch: "main",
    prefix: "packages/@zh/brain/upstream",
    defaultUrl: "http://localhost:9119",
    containerPort: 9119,
    role: "Persistent memory, skills, cron, and agent execution"
  },
  {
    name: "hr",
    displayName: "Paperclip",
    repository: "https://github.com/paperclipai/paperclip.git",
    branch: "master",
    prefix: "packages/@zh/hr/upstream",
    defaultUrl: "http://localhost:3100",
    containerPort: 3100,
    role: "Company orchestration, dashboard, budgets, and governance"
  }
];
