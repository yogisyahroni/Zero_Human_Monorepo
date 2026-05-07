import { Redis } from "ioredis";
import { ZHEvent, type ZHEnvelope } from "./types.js";

type Handler<T = unknown> = (message: ZHEnvelope<T>) => void | Promise<void>;

export class RedisEventBus {
  private publisher?: Redis;
  private subscriber?: Redis;
  private handlers = new Map<string, Handler[]>();
  public readonly channel = "zh:events";
  public connected = false;

  constructor(private readonly redisUrl: string, private readonly source: ZHEnvelope["metadata"]["source"]) {}

  async connect(): Promise<void> {
    this.publisher = new Redis(this.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    this.subscriber = new Redis(this.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
    await this.subscriber.subscribe(this.channel);
    this.subscriber.on("message", (_channel: string, body: string) => {
      const envelope = JSON.parse(body) as ZHEnvelope;
      const handlers = [
        ...(this.handlers.get(envelope.event) ?? []),
        ...(this.handlers.get("*") ?? [])
      ];
      for (const handler of handlers) void handler(envelope);
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
    if (!this.publisher) throw new Error("Redis event bus is not connected");
    await this.publisher.publish(this.channel, JSON.stringify(envelope));
    return envelope;
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()]);
    this.connected = false;
  }
}

export function isZHEvent(value: string): value is ZHEvent {
  return Object.values(ZHEvent).includes(value as ZHEvent);
}
