import assert from "node:assert/strict";
import { agentsFromConfig, loadConfig } from "@zh/sdk";

assert.ok(agentsFromConfig(loadConfig()).some((agent) => agent.brain === "hermes"));
console.log("@zh/brain smoke test passed");
