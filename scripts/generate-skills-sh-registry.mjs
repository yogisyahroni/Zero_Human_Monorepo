import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(repoRoot, "config", "skills.skills-sh.generated.yaml");
const sourceUrl = process.env.SKILLS_SH_URL ?? "https://skills.sh/";
const limit = Number.parseInt(process.env.SKILLS_SH_LIMIT ?? "", 10);

const roleCatalog = [
  "cto",
  "frontend",
  "backend",
  "qa",
  "devops",
  "product",
  "design",
  "marketing",
  "sales",
  "support",
  "finance",
  "operations",
  "research",
  "legal"
];

const keywordRoles = [
  [/react|frontend|web|browser|ui|ux|css|html|next|vite|component|animation|svelte|vue/, ["frontend", "design", "qa"]],
  [/design|brand|figma|image|video|presentation|slide|asset|creative|remotion/, ["design", "marketing", "product"]],
  [/github|git|code|repo|review|test|build|typescript|python|api|sdk/, ["backend", "frontend", "qa"]],
  [/docker|kubernetes|cloudflare|vercel|azure|aws|gcp|wrangler|deploy|infra|server|database|redis|postgres/, ["devops", "backend", "cto"]],
  [/security|auth|secret|credential|password|compliance|policy|legal|privacy/, ["legal", "devops", "cto"]],
  [/google|workspace|gmail|calendar|meet|docs|sheets|drive|slack|notion|linear|jira/, ["operations", "support", "sales"]],
  [/marketing|seo|content|campaign|growth|social|customer|sales|crm|email/, ["marketing", "sales", "support"]],
  [/finance|invoice|billing|payment|stripe|accounting|tax/, ["finance", "operations", "legal"]],
  [/research|search|crawl|scrape|tavily|firecrawl|analysis|data|spreadsheet|paper/, ["research", "product", "marketing"]],
  [/product|roadmap|prd|spec|planning|strategy/, ["product", "cto", "operations"]]
];

const categoryRules = [
  [/frontend|react|web|ui|ux|component|next|vite|svelte|vue/, "web-development"],
  [/design|figma|brand|creative|image|video|presentation|slide|asset/, "creative"],
  [/docker|kubernetes|cloudflare|vercel|azure|aws|gcp|wrangler|deploy|infra|server/, "devops"],
  [/security|auth|secret|credential|password|compliance|privacy/, "security"],
  [/google|workspace|gmail|calendar|meet|docs|sheets|drive|slack|notion|jira|linear/, "productivity"],
  [/marketing|seo|content|campaign|growth|social|sales|crm/, "marketing"],
  [/finance|invoice|billing|payment|stripe|accounting|tax/, "finance"],
  [/research|search|crawl|scrape|tavily|firecrawl|analysis|paper|data/, "research"],
  [/test|qa|validation|playwright|browser/, "qa"],
  [/database|postgres|redis|sql|mongo|supabase/, "backend"],
  [/product|roadmap|prd|spec|planning|strategy/, "product"]
];

const approvalPattern = /admin|auth|billing|browser|calendar|cloudflare|credential|database|deploy|docker|drive|email|finance|gcp|github|gmail|google|key|kubernetes|legal|password|payment|privacy|secret|security|shell|slack|ssh|terminal|token|wrangler/i;

function ascii(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return ascii(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

function categoryFor(text) {
  for (const [pattern, category] of categoryRules) {
    if (pattern.test(text)) return category;
  }
  return "operations";
}

function rolesFor(text) {
  const roles = new Set();
  for (const [pattern, mappedRoles] of keywordRoles) {
    if (pattern.test(text)) mappedRoles.forEach((role) => roles.add(role));
  }
  if (roles.size === 0) roles.add("operations");
  return Array.from(roles).filter((role) => roleCatalog.includes(role)).slice(0, 5);
}

function toolsFor(text) {
  const tools = [
    /github|git|repo/i.test(text) ? "git" : "",
    /browser|playwright|web/i.test(text) ? "browser" : "",
    /docker|kubernetes|deploy|cloudflare|wrangler|vercel/i.test(text) ? "deploy" : "",
    /google|gmail|calendar|drive|docs|sheets|meet/i.test(text) ? "google-workspace" : "",
    /slack|notion|linear|jira/i.test(text) ? "saas" : "",
    /terminal|shell|cli/i.test(text) ? "terminal" : "",
    /figma|image|video|design/i.test(text) ? "creative-tools" : "",
    "skills-sh"
  ];
  return Array.from(new Set(tools.filter(Boolean))).slice(0, 8);
}

function triggersFor(source, skillId, name, category) {
  const words = [
    category,
    ...source.split(/[/-]/),
    ...skillId.split(/[-_/.]/),
    ...name.split(/[-_/.]/)
  ];
  return Array.from(new Set(words.map(slug).filter((word) => word.length > 1))).slice(0, 12);
}

function parseSkillPayload(html) {
  const patterns = [
    /\{\\?"source\\?":\\?"([^"\\]+)\\?",\\?"skillId\\?":\\?"([^"\\]+)\\?",\\?"name\\?":\\?"([^"\\]+)\\?"(?:,\\?"installs\\?":(\d+))?(?:,\\?"isOfficial\\?":(true|false))?/g,
    /\{"source":"([^"]+)","skillId":"([^"]+)","name":"([^"]+)"(?:,"installs":(\d+))?(?:,"isOfficial":(true|false))?/g
  ];
  const skills = new Map();
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const skill = {
        source: ascii(match[1]),
        skillId: ascii(match[2]),
        name: ascii(match[3]),
        installs: match[4] ? Number(match[4]) : undefined,
        isOfficial: match[5] === "true"
      };
      if (!skill.source || !skill.skillId || !skill.name) continue;
      skills.set(`${skill.source}::${skill.skillId}`, skill);
    }
  }
  return Array.from(skills.values()).sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0));
}

const response = await fetch(sourceUrl);
if (!response.ok) {
  throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`);
}

const html = await response.text();
const upstreamTotal = html.match(/\\?"totalSkills\\?":(\d+)/)?.[1] ?? html.match(/"totalSkills":(\d+)/)?.[1] ?? null;
const allSkills = parseSkillPayload(html);
const selectedSkills = Number.isFinite(limit) && limit > 0 ? allSkills.slice(0, limit) : allSkills;
const registry = {};

for (const skill of selectedSkills) {
  const text = `${skill.source} ${skill.skillId} ${skill.name}`;
  const category = categoryFor(text);
  const key = `skillsh_${slug(skill.source)}_${slug(skill.skillId)}`;
  registry[key] = {
    category,
    description: `Skills.sh directory skill ${skill.name} from ${skill.source}${typeof skill.installs === "number" ? `, ${skill.installs} installs` : ""}.`,
    roles: rolesFor(text),
    triggers: triggersFor(skill.source, skill.skillId, skill.name, category),
    tools: toolsFor(text),
    status: "available",
    requiresApproval: approvalPattern.test(text),
    source: "skills.sh",
    sourcePath: `${skill.source}/${skill.skillId}`,
    installs: skill.installs,
    isOfficial: skill.isOfficial
  };
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, dumpRegistry(registry, allSkills.length, upstreamTotal), "utf8");

console.log(
  `Generated ${Object.keys(registry).length} skills at ${path.relative(repoRoot, outputPath)} from ${sourceUrl}` +
    (upstreamTotal ? ` (skills.sh reports ${upstreamTotal} total)` : "")
);

function yamlScalar(value) {
  return JSON.stringify(ascii(value));
}

function yamlArray(values) {
  return `[${values.map((value) => yamlScalar(value)).join(", ")}]`;
}

function dumpRegistry(entries, visibleCount, upstreamTotal) {
  const lines = [
    "# Generated by scripts/generate-skills-sh-registry.mjs. Do not edit by hand.",
    `# Source: ${sourceUrl}`,
    `# Imported public payload skills: ${visibleCount}`,
    upstreamTotal ? `# Upstream totalSkills reported by skills.sh: ${upstreamTotal}` : "",
    "skill_registry:"
  ].filter(Boolean);
  for (const [key, skill] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${key}:`);
    lines.push(`    category: ${yamlScalar(skill.category)}`);
    lines.push(`    description: ${yamlScalar(skill.description)}`);
    lines.push(`    roles: ${yamlArray(skill.roles)}`);
    lines.push(`    triggers: ${yamlArray(skill.triggers)}`);
    if (skill.tools.length) lines.push(`    tools: ${yamlArray(skill.tools)}`);
    lines.push(`    status: ${yamlScalar(skill.status)}`);
    lines.push(`    requiresApproval: ${skill.requiresApproval ? "true" : "false"}`);
    lines.push(`    source: ${yamlScalar(skill.source)}`);
    lines.push(`    sourcePath: ${yamlScalar(skill.sourcePath)}`);
    if (typeof skill.installs === "number") lines.push(`    installs: ${skill.installs}`);
    lines.push(`    isOfficial: ${skill.isOfficial ? "true" : "false"}`);
  }
  return `${lines.join("\n")}\n`;
}
