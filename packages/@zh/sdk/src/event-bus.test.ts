import { afterEach, describe, expect, it, vi } from "vitest";
import { RedisEventBus } from "./event-bus.js";
import { ZHEvent } from "./types.js";

describe("RedisEventBus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an envelope when Redis is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bus = new RedisEventBus("redis://localhost:0", "sdk", { connectRetries: 0 });

    const envelope = await bus.publish(ZHEvent.AGENT_READY, { agentId: "cto" });

    expect(envelope.event).toBe(ZHEvent.AGENT_READY);
    expect(envelope.payload).toEqual({ agentId: "cto" });
    expect(warn.mock.calls.flat().join("\n")).toContain("not connected");
  });

  it("recognizes wildcard handlers without requiring Redis", async () => {
    const bus = new RedisEventBus("redis://localhost:0", "sdk", { connectRetries: 0 });
    const handler = vi.fn();

    bus.on("*", handler);

    expect(handler).not.toHaveBeenCalled();
  });
});
