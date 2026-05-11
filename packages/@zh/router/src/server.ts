import express from "express";
import cors from "cors";
import { loadConfig, RedisEventBus, requireEnv, upstreamSources, warnEnv, ZHEvent } from "@zh/sdk";

requireEnv(["PORT", "REDIS_URL", "ZH_ROUTER_URL"]);
warnEnv(["ZH_CONFIG_PATH"]);

const config = loadConfig();
const app = express();
const fallbackAuthorization = process.env.ZH_ROUTER_COMPAT_API_KEY
  ? `Bearer ${process.env.ZH_ROUTER_COMPAT_API_KEY}`
  : undefined;
const usage = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  fallbackCount: 0,
  upstreamFailures: 0
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

function upstreamBaseUrl(): string {
  return (config.infrastructure.services?.router_url ?? "").replace(/\/$/, "");
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  return Number(((inputTokens + outputTokens) * 0.0000006).toFixed(6));
}

async function publishCost(
  comboName: string,
  provider: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  context: { agentId?: string; taskId?: string } = {}
): Promise<void> {
  usage.requests += 1;
  usage.inputTokens += inputTokens;
  usage.outputTokens += outputTokens;
  usage.costUsd += costUsd;

  if (bus.connected) {
    await bus.publish(ZHEvent.COST_ACCUMULATED, {
      comboName,
      provider,
      inputTokens,
      outputTokens,
      costUsd,
      ...context
    });
  }
}

function usageFromResponse(responseBody: unknown, fallbackInputTokens: number): { inputTokens: number; outputTokens: number } {
  const usagePayload = (responseBody as { usage?: Record<string, unknown> } | null)?.usage;
  const inputTokens = Number(
    usagePayload?.prompt_tokens ??
    usagePayload?.input_tokens ??
    fallbackInputTokens
  );
  const outputTokens = Number(
    usagePayload?.completion_tokens ??
    usagePayload?.output_tokens ??
    usagePayload?.total_tokens ??
    0
  );
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : fallbackInputTokens,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0
  };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "@zh/router",
    redis: bus.connected,
    mode: upstreamBaseUrl() ? "proxy" : "local-fallback",
    upstreamUrl: upstreamBaseUrl() || null,
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
    `zh_router_fallbacks_total ${usage.fallbackCount}`,
    `zh_router_upstream_failures_total ${usage.upstreamFailures}`
  ].join("\n"));
});

app.get("/api/combos", (_req, res) => {
  res.json(config.gateway.combos);
});

app.post("/v1/chat/completions", async (req, res) => {
  const comboName = req.header("x-zh-combo") ?? "cheap_stack";
  const combo = config.gateway.combos[comboName] ?? config.gateway.combos.cheap_stack;
  const inputTokens = estimateTokens(req.body.messages ?? req.body);
  const provider = combo?.[0]?.provider ?? "mock";
  const upstreamUrl = upstreamBaseUrl();
  const eventContext = {
    agentId: req.header("x-zh-agent-id") ?? undefined,
    taskId: req.header("x-zh-task-id") ?? undefined
  };

  if (upstreamUrl) {
    try {
      const upstreamResponse = await fetch(`${upstreamUrl}/api/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(req.header("authorization") || fallbackAuthorization
            ? { "authorization": req.header("authorization") ?? fallbackAuthorization }
            : {}),
          "x-zh-combo": comboName
        },
        body: JSON.stringify({
          ...req.body,
          model: req.body.model ?? combo?.[0]?.model
        })
      });
      const contentType = upstreamResponse.headers.get("content-type") ?? "application/json";
      const raw = await upstreamResponse.text();
      let parsed: unknown = null;
      if (contentType.includes("application/json") && raw) {
        parsed = JSON.parse(raw);
        if (!upstreamResponse.ok) {
          throw new Error(`9Router returned HTTP ${upstreamResponse.status}`);
        }
        const tracked = usageFromResponse(parsed, inputTokens);
        await publishCost(comboName, provider, tracked.inputTokens, tracked.outputTokens, estimateCost(tracked.inputTokens, tracked.outputTokens), eventContext);
        return res.status(upstreamResponse.status).type(contentType).send(JSON.stringify(parsed));
      }
      if (!upstreamResponse.ok) {
        throw new Error(`9Router returned HTTP ${upstreamResponse.status}`);
      }
      const outputTokens = estimateTokens(raw);
      await publishCost(comboName, provider, inputTokens, outputTokens, estimateCost(inputTokens, outputTokens), eventContext);
      return res.status(upstreamResponse.status).type(contentType).send(raw);
    } catch (error) {
      usage.upstreamFailures += 1;
      console.warn(`[router] upstream proxy failed, using local fallback: ${(error as Error).message}`);
    }
  }

  const outputTokens = config.gateway.caveman_mode ? 96 : 180;
  const costUsd = estimateCost(inputTokens, outputTokens);
  usage.fallbackCount += 1;
  await publishCost(comboName, provider, inputTokens, outputTokens, costUsd, eventContext);

  res.json({
    id: `zhcmpl_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: combo?.[0]?.model ?? "mock-model",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "Zero-Human router fallback accepted the request because the 9Router upstream was unavailable or not configured."
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
