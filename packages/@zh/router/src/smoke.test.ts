import { describe, expect, it } from "vitest";
import { loadConfig } from "@zh/sdk";

describe("@zh/router config", () => {
  it("has a listening port and model combos", () => {
    const config = loadConfig();
    expect(config.gateway.port).toBeGreaterThan(0);
    expect(Object.keys(config.gateway.combos).length).toBeGreaterThan(0);
  });
});
