import { Redis } from "ioredis";
import { ZHEvent, type ZHEnvelope } from "./types.js";

type Handler<T = unknown> = (message: ZHEnvelope<T>) => void | Promise<void>;

export interface RedisEventBusOptions {
  connectRetries?: number;
  retryDelayMs?: number;
}

export class RedisEventBus {
  private publisher?: Redis;
  private subscriber?: Redis;
  private handlers = new Map<string, Handler[]>();
  public readonly channel = "zh:events";
  public connected = false;

  constructor(
    private readonly redisUrl: string,
    private readonly source: ZHEnvelope["metadata"]["source"],
    private readonly options: RedisEventBusOptions = {}
  ) {}

  async connect(): Promise<void> {
    const retryStrategy = (times: number): number | null => Math.min(times * 250, 5000);
    this.publisher = new Redis(this.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy });
    this.subscriber = new Redis(this.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy });
    this.publisher.on("error", (error) => this.markDisconnected("publisher", error));
    this.subscriber.on("error", (error) => this.markDisconnected("subscriber", error));
    this.publisher.on("ready", () => { this.connected = true; });
    this.subscriber.on("ready", () => { this.connected = true; });
    await this.connectWithRetry();
    await this.subscriber.subscribe(this.channel);
    this.subscriber.on("message", (_channel: string, body: string) => {
      let envelope: ZHEnvelope;
      try {
        envelope = JSON.parse(body) as ZHEnvelope;
      } catch (error) {
        console.warn(`[event-bus] ignored malformed Redis event: ${(error as Error).message}`);
        return;
      }
      const handlers = [
        ...(this.handlers.get(envelope.event) ?? []),
        ...(this.handlers.get("*") ?? [])
      ];
      for (const handler of handlers) {
        void Promise.resolve(handler(envelope)).catch((error) => {
          console.warn(`[event-bus] handler failed for ${envelope.event}: ${(error as Error).message}`);
        });
      }
    });
    this.connected = true;
  }

  on<T>(event: ZHEvent | "*", handler: Handler<T>): void {
    const key = event.toString();
    const handlers = this.handlers.get(key) ?? [];
    handlers.push(handler as Handler);
    this.handlers.set(key, handlers);
  }

  async publish<T>(event: ZHEvent, payload: T): Promise<ZHEnvelope<T>> {
    const envelope: ZHEnvelope<T> = {
      event,
      timestamp: new Date().toISOString(),
      payload,
      metadata: { source: this.source, version: "1.0" }
    };
    if (!this.publisher || !this.connected) {
      console.warn(`[event-bus] skipped ${event}; Redis event bus is not connected`);
      return envelope;
    }
    try {
      await this.publisher.publish(this.channel, JSON.stringify(envelope));
    } catch (error) {
      this.connected = false;
      console.warn(`[event-bus] failed to publish ${event}: ${(error as Error).message}`);
    }
    return envelope;
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()]);
    this.connected = false;
  }

  private async connectWithRetry(): Promise<void> {
    const retries = this.options.connectRetries ?? Number(process.env.ZH_REDIS_CONNECT_RETRIES ?? 20);
    const delayMs = this.options.retryDelayMs ?? Number(process.env.ZH_REDIS_RETRY_DELAY_MS ?? 500);
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        await Promise.all([this.connectClient(this.publisher), this.connectClient(this.subscriber)]);
        return;
      } catch (error) {
        lastError = error;
        if (attempt === retries) break;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Redis connection failed");
  }

  private async connectClient(client?: Redis): Promise<void> {
    if (!client || client.status === "ready") return;
    if (client.status === "connecting" || client.status === "connect") {
      await new Promise<void>((resolve, reject) => {
        client.once("ready", () => resolve());
        client.once("error", reject);
      });
      return;
    }
    await client.connect();
  }

  private markDisconnected(role: "publisher" | "subscriber", error: Error): void {
    this.connected = false;
    console.warn(`[event-bus] Redis ${role} error: ${error.message}`);
  }
}

export function isZHEvent(value: string): value is ZHEvent {
  return Object.values(ZHEvent).includes(value as ZHEvent);
}
