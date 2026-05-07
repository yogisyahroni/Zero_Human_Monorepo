import assert from "node:assert/strict";
import { loadConfig } from "@zh/sdk";

const config = loadConfig();
assert.ok(config.gateway.port > 0);
assert.ok(Object.keys(config.gateway.combos).length > 0);
console.log("@zh/router smoke test passed");
