import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Crm } from "./crm.js";

export const SESSION_COOKIE = "omni_session";
const SESSION_MS = 7 * 24 * 3600 * 1000;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;

/** Public paths that must stay reachable without a session (widget, Meta webhooks, health, login itself). */
export const isPublicPath = (path: string) =>
  path === "/api/health" || path.startsWith("/api/auth/") || path.startsWith("/api/public/") || path.startsWith("/api/webhooks/");

const digest = (s: string) => createHash("sha256").update(s).digest();

export function makeAuth(crm: Crm, password: string) {
  let secret = crm.getSetting("session_secret");
  if (!secret) {
    secret = randomBytes(32).toString("hex");
    crm.setSetting("session_secret", secret);
  }
  const key = secret;
  const revoked = new Set<string>();
  const failures = new Map<string, number[]>();

  const sign = (ts: number) => `${ts}.${createHmac("sha256", key).update(String(ts)).digest("hex")}`;

  const verify = (token: string | undefined): boolean => {
    if (!token || revoked.has(token)) return false;
    const [ts, sig] = token.split(".");
    if (!ts || !sig || !/^\d+$/.test(ts)) return false;
    const expected = createHmac("sha256", key).update(ts).digest();
    let given: Buffer;
    try {
      given = Buffer.from(sig, "hex");
    } catch {
      return false;
    }
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    return Date.now() - Number(ts) < SESSION_MS;
  };

  const cookieValue = (header: string | undefined): string | undefined => {
    for (const part of (header ?? "").split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === SESSION_COOKIE) return v.join("=");
    }
    return undefined;
  };

  return {
    required: !!password,
    isAuthed: (cookieHeader: string | undefined) => !password || verify(cookieValue(cookieHeader)),
    tokenFrom: cookieValue,
    revoke: (token: string | undefined) => token && revoked.add(token),
    /** Returns a session token, "throttled" after too many failures from the same client, or null for a wrong password. */
    login(given: string, client: string): string | "throttled" | null {
      const now = Date.now();
      const recent = (failures.get(client) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
      if (recent.length >= MAX_FAILURES) return "throttled";
      const ok = !!password && timingSafeEqual(digest(given), digest(password));
      if (!ok) {
        failures.set(client, [...recent, now]);
        return null;
      }
      failures.delete(client);
      return sign(now);
    },
    cookie: (token: string, secure: boolean) =>
      `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? "; Secure" : ""}`,
    clearCookie: () => `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  };
}
