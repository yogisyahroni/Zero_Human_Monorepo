import assert from "node:assert/strict";
import { agentsFromConfig, loadConfig } from "@zh/sdk";

const agents = agentsFromConfig(loadConfig());
assert.ok(agents.find((agent) => agent.id === "cto"));
console.log("@zh/hr smoke test passed");
