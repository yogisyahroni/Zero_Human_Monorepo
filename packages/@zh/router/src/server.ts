import express from "express";
import cors from "cors";
import { loadConfig, RedisEventBus, upstreamSources, ZHEvent } from "@zh/sdk";

const config = loadConfig();
const app = express();
const usage = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  fallbackCount: 0
};

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const bus = new RedisEventBus(config.infrastructure.redis_url, "router");
bus.connect().catch((error) => {
  console.warn(`[router] Redis unavailable, metrics events disabled: ${error.message}`);
});

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? "").length / 4);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "@zh/router",
    redis: bus.connected,
    upstream: upstreamSources.find((source) => source.name === "router"),
    rtkTokenSaver: config.gateway.rtk_token_saver,
    cavemanMode: config.gateway.caveman_mode
  });
});

app.get("/metrics", (_req, res) => {
  res.type("text/plain").send([
    `zh_router_requests_total ${usage.requests}`,
    `zh_router_input_tokens_total ${usage.inputTokens}`,
    `zh_router_output_tokens_total ${usage.outputTokens}`,
    `zh_router_cost_usd_total ${usage.costUsd.toFixed(6)}`,
    `zh_router_fallbacks_total ${usage.fallbackCount}`
  ].join("\n"));
});

app.get("/api/combos", (_req, res) => {
  res.json(config.gateway.combos);
});

app.post("/v1/chat/completions", async (req, res) => {
  const comboName = req.header("x-zh-combo") ?? "cheap_stack";
  const combo = config.gateway.combos[comboName] ?? config.gateway.combos.cheap_stack;
  const inputTokens = estimateTokens(req.body.messages ?? req.body);
  const outputTokens = config.gateway.caveman_mode ? 96 : 180;
  const costUsd = Number(((inputTokens + outputTokens) * 0.0000006).toFixed(6));

  usage.requests += 1;
  usage.inputTokens += inputTokens;
  usage.outputTokens += outputTokens;
  usage.costUsd += costUsd;

  if (bus.connected) {
    await bus.publish(ZHEvent.COST_ACCUMULATED, {
      comboName,
      provider: combo?.[0]?.provider ?? "mock",
      inputTokens,
      outputTokens,
      costUsd
    });
  }

  res.json({
    id: `zhcmpl_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: combo?.[0]?.model ?? "mock-model",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "Zero-Human router stub accepted the request. Wire a real upstream provider here."
      },
      finish_reason: "stop"
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      estimated_cost_usd: costUsd
    }
  });
});

const port = Number(process.env.PORT ?? config.gateway.port);
app.listen(port, config.gateway.host, () => {
  console.log(`[router] listening on http://${config.gateway.host}:${port}`);
});
