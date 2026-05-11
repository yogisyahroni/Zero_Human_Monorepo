import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import path from "node:path";

const [, , command, ...args] = process.argv;

if (!command) {
  console.error("Usage: node scripts/run.mjs <start|stop|status|logs> [...args]");
  process.exit(1);
}

const isWindows = platform() === "win32";
const extension = isWindows ? "ps1" : "sh";
const scriptPath = path.join("scripts", `${command}-zero-human.${extension}`);

if (!existsSync(scriptPath)) {
  console.error(`Unknown stack command or missing script: ${scriptPath}`);
  process.exit(1);
}

const executable = isWindows ? "powershell" : "bash";
const scriptArgs = isWindows
  ? ["-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args]
  : [scriptPath, ...args];

const result = spawnSync(executable, scriptArgs, { stdio: "inherit", shell: false });
process.exit(result.status ?? 1);
