import { describe, expect, it } from "vitest";
import { agentsFromConfig, loadConfig } from "@zh/sdk";

describe("@zh/brain config", () => {
  it("has at least one Hermes-backed agent", () => {
    expect(agentsFromConfig(loadConfig()).some((agent) => agent.brain === "hermes")).toBe(true);
  });
});
