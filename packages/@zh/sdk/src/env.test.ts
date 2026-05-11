import { afterEach, describe, expect, it, vi } from "vitest";
import { requireEnv, warnEnv } from "./env.js";

const KEY = "ZH_ENV_TEST_REQUIRED";

describe("env guards", () => {
  afterEach(() => {
    delete process.env[KEY];
    vi.restoreAllMocks();
  });

  it("passes when required variables are present", () => {
    process.env[KEY] = "ok";
    expect(() => requireEnv([KEY])).not.toThrow();
  });

  it("exits with a clear error when required variables are missing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit:${code}`);
    }) as never);

    expect(() => requireEnv([KEY])).toThrow("exit:1");
    expect(error.mock.calls.flat().join("\n")).toContain(KEY);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("warns without exiting for optional variables", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnEnv([KEY]);
    expect(warn.mock.calls.flat().join("\n")).toContain(KEY);
  });
});
