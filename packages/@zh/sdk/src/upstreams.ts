export interface UpstreamSource {
  name: "router" | "brain" | "hr";
  displayName: string;
  repository: string;
  branch: string;
  prefix: string;
  role: string;
}

export const upstreamSources: UpstreamSource[] = [
  {
    name: "router",
    displayName: "9Router",
    repository: "https://github.com/decolua/9router.git",
    branch: "master",
    prefix: "packages/@zh/router/upstream",
    role: "Local AI gateway with provider fallback and dashboard"
  },
  {
    name: "brain",
    displayName: "Hermes Agent",
    repository: "https://github.com/NousResearch/hermes-agent.git",
    branch: "main",
    prefix: "packages/@zh/brain/upstream",
    role: "Persistent memory, skills, cron, and agent execution"
  },
  {
    name: "hr",
    displayName: "Paperclip",
    repository: "https://github.com/paperclipai/paperclip.git",
    branch: "master",
    prefix: "packages/@zh/hr/upstream",
    role: "Company orchestration, dashboard, budgets, and governance"
  }
];
