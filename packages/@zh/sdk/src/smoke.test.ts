import { describe, expect, it } from "vitest";
import { agentsFromConfig, loadConfig } from "./index.js";

describe("@zh/sdk config", () => {
  it("loads the company config and agents", () => {
    const config = loadConfig();
    expect(config.version).toBe("1.0");
    expect(agentsFromConfig(config).length).toBeGreaterThanOrEqual(1);
  });
});
