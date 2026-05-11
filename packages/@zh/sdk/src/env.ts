export function requireEnv(keys: string[]): void {
  const missing = keys.filter((key) => !process.env[key]?.trim());
  if (missing.length === 0) return;

  console.error("[FATAL] Missing required environment variables:");
  for (const key of missing) {
    console.error(`  - ${key}`);
  }
  console.error("\nCheck your .env file against .env.example.");
  process.exit(1);
}

export function warnEnv(keys: string[]): void {
  const missing = keys.filter((key) => !process.env[key]?.trim());
  if (missing.length === 0) return;

  console.warn("[WARN] Optional environment variables are not set:");
  for (const key of missing) {
    console.warn(`  - ${key}`);
  }
}
