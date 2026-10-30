import { createHmac, timingSafeEqual } from "node:crypto";
import type { Contact, Crm, Message } from "./crm.js";

export type ChannelEnv = Record<string, string | undefined>;
export type MetaChannel = "whatsapp" | "messenger" | "instagram";

export interface Inbound {
  channel: MetaChannel;
  externalId: string;
  name: string | undefined;
  text: string;
  messageId: string;
  /** Sent by the account owner from the linked phone (Evolution only). */
  fromMe?: boolean;
  /** Message time from the channel, in ms (Evolution only). */
  at?: number;
}

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Extracts individual text messages from an Evolution API `messages.upsert` event, including the ones the
 * owner sends from the linked phone (`fromMe`). Groups, broadcasts and non-text payloads are ignored. A `@lid` chat id carries no
 * phone number, so it is used only when Evolution also supplies the real number (`remoteJidAlt`).
 */
export function parseEvolutionWebhook(body: unknown): Inbound[] {
  const b = body as { event?: string; data?: any } | null;
  if (!b || typeof b !== "object" || String(b.event ?? "").toLowerCase().replace("_", ".") !== "messages.upsert") return [];
  const out: Inbound[] = [];
  for (const d of Array.isArray(b.data) ? b.data : [b.data]) {
    const key = d?.key;
    if (!key) continue;
    const jid = [key.remoteJid, key.remoteJidAlt].find((j) => typeof j === "string" && j.endsWith("@s.whatsapp.net")) as string | undefined;
    const text = d?.message?.conversation ?? d?.message?.extendedTextMessage?.text;
    if (!jid || typeof text !== "string" || !text || !key.id) continue;
    const fromMe = key.fromMe === true;
    // On own messages pushName is the owner's name, not the contact's.
    const name = !fromMe && typeof d.pushName === "string" && d.pushName ? d.pushName : undefined;
    const ts = Number(d.messageTimestamp);
    out.push({
      channel: "whatsapp", externalId: jid.split("@")[0]!, name, text, messageId: String(key.id),
      ...(fromMe ? { fromMe } : {}), ...(Number.isFinite(ts) && ts > 0 ? { at: ts * 1000 } : {}),
    });
  }
  return out;
}

/** Extracts customer text messages from a Meta webhook body. Echoes and non-text payloads are ignored. */
export function parseMetaWebhook(body: unknown): Inbound[] {
  const out: Inbound[] = [];
  const b = body as { object?: string; entry?: any[] } | null;
  if (!b || typeof b !== "object" || !Array.isArray(b.entry)) return out;

  if (b.object === "whatsapp_business_account") {
    for (const entry of b.entry) {
      for (const change of entry?.changes ?? []) {
        const v = change?.value;
        const names = new Map<string, string>();
        for (const c of v?.contacts ?? []) if (c?.wa_id) names.set(String(c.wa_id), c?.profile?.name);
        for (const m of v?.messages ?? []) {
          if (m?.type !== "text" || typeof m?.text?.body !== "string" || !m.from) continue;
          out.push({ channel: "whatsapp", externalId: String(m.from), name: names.get(String(m.from)), text: m.text.body, messageId: String(m.id) });
        }
      }
    }
    return out;
  }

  const channel: MetaChannel | null = b.object === "page" ? "messenger" : b.object === "instagram" ? "instagram" : null;
  if (!channel) return out;
  for (const entry of b.entry) {
    for (const ev of entry?.messaging ?? []) {
      const m = ev?.message;
      if (!m || m.is_echo || typeof m.text !== "string" || !ev?.sender?.id) continue;
      out.push({ channel, externalId: String(ev.sender.id), name: undefined, text: m.text, messageId: String(m.mid) });
    }
  }
  return out;
}

export function verifyMetaSignature(raw: string, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header.slice(7), "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface ChannelStatus {
  configured: boolean;
  missing: string[];
}

/** Which channels have credentials. Values are never returned, only whether they exist. */
export function channelStatus(env: ChannelEnv): Record<MetaChannel | "web-chat", ChannelStatus> & { signature: boolean } {
  const need = (names: string[]): ChannelStatus => {
    const missing = names.filter((n) => !env[n]);
    return { configured: missing.length === 0, missing };
  };
  return {
    whatsapp: need(["WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID"]),
    messenger: need(["MESSENGER_PAGE_TOKEN"]),
    instagram: need(["INSTAGRAM_PAGE_TOKEN"]),
    "web-chat": { configured: true, missing: [] },
    signature: !!env.META_APP_SECRET,
  };
}

const apiError = async (res: Response): Promise<string> => {
  try {
    const j = (await res.json()) as { error?: { message?: string } | string };
    const e = j.error;
    return (typeof e === "string" ? e : e?.message) ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
};

/**
 * Builds the outbound hook: every AI or human message is pushed to the customer's channel.
 * The result is stored on the message so the inbox can show "sent" or "failed".
 */
export function makeDeliver(crm: Crm, env: ChannelEnv, fetchImpl: typeof fetch = fetch) {
  return async (contact: Contact, msg: Message): Promise<void> => {
    if (contact.channel === "web-chat") return; // the widget polls for new messages
    const set = (status: string, extra: Record<string, unknown> = {}) => crm.updateMessageMeta(msg.id, { delivery: { status, at: Date.now(), ...extra } });
    const to = crm.getExternalId(contact.id);
    if (!to) return set("simulated"); // demo contact without a real channel identity
    const text = msg.body.slice(0, 4000);

    let url: string;
    let headers: Record<string, string> = { "content-type": "application/json" };
    let payload: unknown;
    if (contact.channel === "whatsapp") {
      if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) return set("not_configured", { error: "faltan WHATSAPP_TOKEN y WHATSAPP_PHONE_ID" });
      url = `${GRAPH}/${env.WHATSAPP_PHONE_ID}/messages`;
      headers = { ...headers, Authorization: `Bearer ${env.WHATSAPP_TOKEN}` };
      payload = { messaging_product: "whatsapp", to, type: "text", text: { body: text } };
    } else if (contact.channel === "messenger" || contact.channel === "instagram") {
      const token = contact.channel === "messenger" ? env.MESSENGER_PAGE_TOKEN : env.INSTAGRAM_PAGE_TOKEN;
      if (!token) return set("not_configured", { error: contact.channel === "messenger" ? "falta MESSENGER_PAGE_TOKEN" : "falta INSTAGRAM_PAGE_TOKEN" });
      url = `${GRAPH}/me/messages?access_token=${encodeURIComponent(token)}`;
      payload = { recipient: { id: to }, messaging_type: "RESPONSE", message: { text } };
    } else {
      return set("simulated");
    }

    try {
      const res = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return set("failed", { error: await apiError(res) });
      set("sent");
    } catch (e) {
      set("failed", { error: (e as Error).message });
    }
  };
}
