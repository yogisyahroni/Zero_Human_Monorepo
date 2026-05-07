import assert from "node:assert/strict";
import { agentsFromConfig, loadConfig } from "@zh/sdk";
import { evaluateBudgetPolicy } from "./budget-policy.js";

const agents = agentsFromConfig(loadConfig());
assert.ok(agents.find((agent) => agent.id === "cto"));

assert.deepEqual(evaluateBudgetPolicy({
  globalSpent: 5,
  globalLimit: 100,
  approvalThreshold: 5,
  agentSpent: 1,
  agentLimit: 10
}), {
  thresholdCrossed: true,
  globalExhausted: false,
  agentExhausted: false
});

assert.deepEqual(evaluateBudgetPolicy({
  globalSpent: 100,
  globalLimit: 100,
  approvalThreshold: 5,
  agentSpent: 10,
  agentLimit: 10
}), {
  thresholdCrossed: true,
  globalExhausted: true,
  agentExhausted: true
});

console.log("@zh/hr smoke test passed");
