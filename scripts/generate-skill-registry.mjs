import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const upstreamRoot = path.join(repoRoot, "packages", "@zh", "brain", "upstream");
const outputPath = path.join(repoRoot, "config", "skills.generated.yaml");

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

const categoryRoleMap = {
  apple: ["operations", "support"],
  "autonomous-ai-agents": ["cto", "backend", "devops"],
  blockchain: ["backend", "finance", "legal"],
  communication: ["operations", "support", "marketing"],
  creative: ["design", "marketing", "product"],
  devops: ["devops", "backend", "cto"],
  dogfood: ["qa", "product", "design"],
  email: ["support", "sales", "marketing"],
  health: ["research", "support"],
  mcp: ["devops", "backend", "cto"],
  migration: ["devops", "backend", "cto"],
  mlops: ["research", "backend", "devops"],
  productivity: ["operations", "support", "product"],
  research: ["research", "product", "marketing"],
  security: ["legal", "devops", "cto"],
  "web-development": ["frontend", "backend", "qa"],
  google_meet: ["operations", "sales", "support"]
};

const keywordRoles = [
  [/react|frontend|web|browser|page|ux|ui|design/, ["frontend", "design"]],
  [/docker|kubernetes|deploy|cli|terminal|infrastructure|compose/, ["devops", "backend"]],
  [/test|qa|adversarial|validation/, ["qa", "product"]],
  [/email|telephony|meet|communication|message/, ["support", "sales", "operations"]],
  [/research|search|intel|scrap|bio|drug|domain/, ["research", "product"]],
  [/security|forensics|password|secret|sherlock/, ["legal", "devops", "cto"]],
  [/shop|sales|campaign|customer/, ["sales", "marketing", "support"]],
  [/finance|blockchain|solana|base|vendor|cost/, ["finance", "backend", "legal"]],
  [/mlops|pytorch|huggingface|tokenizer|faiss|qdrant|chroma|pinecone|modal|cuda|llava|whisper/, ["research", "backend", "devops"]]
];

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
    .slice(0, 80);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() && entry.name === "SKILL.md" ? [fullPath] : [];
  });
}

function frontmatter(raw) {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return {};
  const text = raw.slice(3, end);
  const result = {};
  const tagsMatch = text.match(/tags:\s*\[([^\]]*)\]/);
  const categoryMatch = text.match(/category:\s*["']?([^"'\n]+)["']?/);
  const toolsetsMatch = text.match(/requires_toolsets:\s*\[([^\]]*)\]/);
  result.name = text.match(/^name:\s*["']?([^"'\n]+)["']?/m)?.[1];
  result.description = text.match(/^description:\s*["']?([^"'\n]+)["']?/m)?.[1];
  result.metadata = {
    hermes: {
      tags: tagsMatch?.[1]?.split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")) ?? [],
      category: categoryMatch?.[1]?.trim(),
      requires_toolsets: toolsetsMatch?.[1]?.split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")) ?? []
    }
  };
  return result;
}

function categoryFromPath(relativePath, meta) {
  const explicit = meta?.metadata?.hermes?.category;
  if (explicit) return slug(explicit).replaceAll("_", "-");
  const parts = relativePath.split(path.sep);
  const root = parts[0] === "plugins" ? parts[1] : parts[1];
  return slug(root).replaceAll("_", "-") || "operations";
}

function tags(meta) {
  const rawTags = meta?.metadata?.hermes?.tags ?? [];
  return Array.isArray(rawTags) ? rawTags.map(ascii).filter(Boolean) : [];
}

function tools(meta, text) {
  const requiredToolsets = meta?.metadata?.hermes?.requires_toolsets ?? [];
  const inferred = [
    /docker/i.test(text) ? "docker" : "",
    /git|repo|codex|claude|opencode/i.test(text) ? "codex" : "",
    /browser|playwright/i.test(text) ? "browser" : "",
    /terminal|cli|shell/i.test(text) ? "terminal" : "",
    /mcp/i.test(text) ? "mcp" : ""
  ].filter(Boolean);
  return Array.from(new Set([...(Array.isArray(requiredToolsets) ? requiredToolsets : []), ...inferred].map(slug).filter(Boolean))).slice(0, 8);
}

function rolesFor(category, text) {
  const roles = new Set(categoryRoleMap[category] ?? ["operations"]);
  for (const [pattern, mappedRoles] of keywordRoles) {
    if (pattern.test(text)) mappedRoles.forEach((role) => roles.add(role));
  }
  return Array.from(roles).filter((role) => roleCatalog.includes(role)).slice(0, 5);
}

function triggersFor(name, category, meta, relativePath, description) {
  const words = [
    name,
    category,
    ...relativePath.split(path.sep),
    ...tags(meta),
    ...ascii(description).toLowerCase().split(/\W+/).filter((word) => word.length > 4)
  ];
  return Array.from(new Set(words.map(slug).filter(Boolean))).slice(0, 12);
}

function requiresApproval(category, text) {
  return /security|password|secret|credential|docker|deploy|terminal|shell|finance|legal|blockchain|email|calendar|meet|browser/i.test(`${category} ${text}`);
}

const skillFiles = walk(upstreamRoot).sort();
const registry = {};

for (const filePath of skillFiles) {
  const raw = fs.readFileSync(filePath, "utf8");
  const meta = frontmatter(raw);
  const relativePath = path.relative(upstreamRoot, filePath);
  const fallbackName = path.basename(path.dirname(filePath));
  const name = slug(meta.name ?? fallbackName);
  if (!name) continue;
  const category = categoryFromPath(relativePath, meta);
  const text = `${name} ${category} ${tags(meta).join(" ")} ${relativePath} ${raw}`;
  const keyBase = name;
  let key = keyBase;
  let counter = 2;
  while (registry[key]) key = `${keyBase}_${counter++}`;
  const description = ascii(meta.description ?? raw.match(/^#\s+(.+)$/m)?.[1] ?? `Hermes skill imported from ${relativePath}.`);
  registry[key] = {
    category,
    description,
    roles: rolesFor(category, text),
    triggers: triggersFor(name, category, meta, relativePath, description),
    tools: tools(meta, text),
    status: "available",
    requiresApproval: requiresApproval(category, text),
    source: "hermes-skill",
    sourcePath: relativePath.replaceAll(path.sep, "/")
  };
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, dumpRegistry(registry), "utf8");

console.log(`Generated ${Object.keys(registry).length} skills at ${path.relative(repoRoot, outputPath)}`);

function yamlScalar(value) {
  return JSON.stringify(ascii(value));
}

function yamlArray(values) {
  return `[${values.map((value) => yamlScalar(value)).join(", ")}]`;
}

function dumpRegistry(entries) {
  const lines = [
    "# Generated by scripts/generate-skill-registry.mjs. Do not edit by hand.",
    "skill_registry:"
  ];
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
  }
  return `${lines.join("\n")}\n`;
}
