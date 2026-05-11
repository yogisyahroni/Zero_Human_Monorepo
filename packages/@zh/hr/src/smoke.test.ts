import { describe, expect, it } from "vitest";
import { agentsFromConfig, loadConfig } from "@zh/sdk";
import { evaluateBudgetPolicy } from "./budget-policy.js";

describe("@zh/hr smoke", () => {
  it("loads the CTO agent", () => {
    const agents = agentsFromConfig(loadConfig());
    expect(agents.find((agent) => agent.id === "cto")).toBeTruthy();
  });

  it("evaluates budget threshold and exhaustion", () => {
    expect(evaluateBudgetPolicy({
      globalSpent: 5,
      globalLimit: 100,
      approvalThreshold: 5,
      agentSpent: 1,
      agentLimit: 10
    })).toEqual({
      thresholdCrossed: true,
      globalExhausted: false,
      agentExhausted: false
    });

    expect(evaluateBudgetPolicy({
      globalSpent: 100,
      globalLimit: 100,
      approvalThreshold: 5,
      agentSpent: 10,
      agentLimit: 10
    })).toEqual({
      thresholdCrossed: true,
      globalExhausted: true,
      agentExhausted: true
    });
  });
});
