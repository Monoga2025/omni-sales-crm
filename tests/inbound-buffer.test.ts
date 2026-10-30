import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInboundBuffer, MemoryBufferStore, RedisBufferStore, type RedisLike } from "../server/inbound-buffer.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createInboundBuffer (debounce)", () => {
  it("joins messages that arrive within the window into one flush", async () => {
    const flushed: [string, string[]][] = [];
    const buf = createInboundBuffer({ store: new MemoryBufferStore(), windowMs: 3000, onFlush: async (k, m) => void flushed.push([k, m]) });
    await buf.add("c1", "hola");
    await vi.advanceTimersByTimeAsync(2000);
    await buf.add("c1", "quiero info");
    await vi.advanceTimersByTimeAsync(2999);
    expect(flushed).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(flushed).toEqual([["c1", ["hola", "quiero info"]]]);
  });
  it("keeps contacts independent", async () => {
    const flushed: [string, string[]][] = [];
    const buf = createInboundBuffer({ store: new MemoryBufferStore(), windowMs: 1000, onFlush: async (k, m) => void flushed.push([k, m]) });
    await buf.add("a", "1");
    await buf.add("b", "2");
    await vi.advanceTimersByTimeAsync(1000);
    expect(flushed.sort()).toEqual([["a", ["1"]], ["b", ["2"]]]);
  });
  it("starts a fresh batch after a flush and ignores blank messages", async () => {
    const flushed: string[][] = [];
    const buf = createInboundBuffer({ store: new MemoryBufferStore(), windowMs: 500, onFlush: async (_k, m) => void flushed.push(m) });
    await buf.add("a", "   ");
    await vi.advanceTimersByTimeAsync(500);
    expect(flushed).toEqual([]);
    await buf.add("a", "uno");
    await vi.advanceTimersByTimeAsync(500);
    await buf.add("a", "dos");
    await vi.advanceTimersByTimeAsync(500);
    expect(flushed).toEqual([["uno"], ["dos"]]);
  });
  it("flushNow drains immediately and cancels the timer", async () => {
    const flushed: string[][] = [];
    const buf = createInboundBuffer({ store: new MemoryBufferStore(), windowMs: 5000, onFlush: async (_k, m) => void flushed.push(m) });
    await buf.add("a", "x");
    await buf.flushNow("a");
    await vi.advanceTimersByTimeAsync(5000);
    expect(flushed).toEqual([["x"]]);
  });
});

function fakeRedis() {
  const data = new Map<string, string[]>();
  const ttl = new Map<string, number>();
  const client: RedisLike = {
    async rPush(k, v) { const l = data.get(k) ?? []; l.push(v); data.set(k, l); return l.length; },
    async expire(k, s) { ttl.set(k, s); return 1; },
    multi() {
      const ops: (() => unknown)[] = [];
      const m = {
        lRange(k: string) { ops.push(() => [...(data.get(k) ?? [])]); return m; },
        del(k: string) { ops.push(() => (data.delete(k) ? 1 : 0)); return m; },
        exec: async () => ops.map((o) => o()),
      };
      return m;
    },
  };
  return { client, data, ttl };
}

describe("RedisBufferStore (injected client)", () => {
  it("appends with a TTL and drains atomically", async () => {
    const r = fakeRedis();
    const s = new RedisBufferStore(r.client, { prefix: "inb:", ttlSeconds: 60 });
    await s.append("c1", "hola");
    await s.append("c1", "ok");
    expect(r.data.get("inb:c1")).toEqual(["hola", "ok"]);
    expect(r.ttl.get("inb:c1")).toBe(60);
    expect(await s.drain("c1")).toEqual(["hola", "ok"]);
    expect(await s.drain("c1")).toEqual([]);
  });
  it("works as the debounce store", async () => {
    const flushed: string[][] = [];
    const buf = createInboundBuffer({ store: new RedisBufferStore(fakeRedis().client), windowMs: 100, onFlush: async (_k, m) => void flushed.push(m) });
    await buf.add("c", "a");
    await buf.add("c", "b");
    await vi.advanceTimersByTimeAsync(100);
    expect(flushed).toEqual([["a", "b"]]);
  });
});
