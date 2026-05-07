import assert from "node:assert/strict";
import { agentsFromConfig, loadConfig } from "./index.js";

const config = loadConfig();
assert.equal(config.version, "1.0");
assert.ok(agentsFromConfig(config).length >= 1);
console.log("@zh/sdk smoke test passed");
