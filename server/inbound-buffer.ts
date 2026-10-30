/**
 * Inbound debounce: customers often send several short messages in a row. The buffer collects them per
 * contact and flushes once after `windowMs` of silence, so the agent answers one combined message.
 * Storage is pluggable: in-memory by default, Redis through an injected client (no hard dependency).
 */

export interface BufferStore {
  append(key: string, text: string): Promise<void>;
  /** Returns the buffered messages in order and empties the buffer. */
  drain(key: string): Promise<string[]>;
}

export class MemoryBufferStore implements BufferStore {
  private data = new Map<string, string[]>();
  async append(key: string, text: string) {
    const l = this.data.get(key) ?? [];
    l.push(text);
    this.data.set(key, l);
  }
  async drain(key: string) {
    const l = this.data.get(key) ?? [];
    this.data.delete(key);
    return l;
  }
}

/** The subset of a node-redis v4 client that the adapter needs. */
export interface RedisLike {
  rPush(key: string, value: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  multi(): {
    lRange(key: string, start: number, stop: number): unknown;
    del(key: string): unknown;
    exec(): Promise<unknown[]>;
  };
}

export class RedisBufferStore implements BufferStore {
  private prefix: string;
  private ttl: number;
  constructor(private redis: RedisLike, opts: { prefix?: string; ttlSeconds?: number } = {}) {
    this.prefix = opts.prefix ?? "loovo:inbound:";
    this.ttl = opts.ttlSeconds ?? 300;
  }
  async append(key: string, text: string) {
    await this.redis.rPush(this.prefix + key, text);
    await this.redis.expire(this.prefix + key, this.ttl); // orphaned buffers expire on their own
  }
  async drain(key: string) {
    const k = this.prefix + key;
    const tx = this.redis.multi();
    tx.lRange(k, 0, -1);
    tx.del(k);
    const [list] = await tx.exec(); // LRANGE + DEL in one transaction: no message is lost or read twice
    return Array.isArray(list) ? (list as string[]) : [];
  }
}

export interface InboundBuffer {
  add(key: string, text: string): Promise<void>;
  flushNow(key: string): Promise<void>;
}

export function createInboundBuffer(opts: {
  store: BufferStore;
  windowMs: number;
  onFlush: (key: string, messages: string[]) => Promise<void> | void;
  onError?: (err: unknown) => void;
}): InboundBuffer {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  async function flush(key: string) {
    const t = timers.get(key);
    if (t) clearTimeout(t);
    timers.delete(key);
    const messages = await opts.store.drain(key);
    if (messages.length) await opts.onFlush(key, messages);
  }

  return {
    async add(key, text) {
      if (!text.trim()) return;
      await opts.store.append(key, text);
      const prev = timers.get(key);
      if (prev) clearTimeout(prev);
      timers.set(key, setTimeout(() => void flush(key).catch(opts.onError ?? (() => {})), opts.windowMs));
    },
    flushNow: flush,
  };
}
