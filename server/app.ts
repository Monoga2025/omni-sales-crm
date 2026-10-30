import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomBytes } from "node:crypto";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { BUSINESS_FIELDS, type Business, type Crm, type Rule, type SequenceStepInput, type Stage } from "./crm.js";
import { handleInbound, type AiProvider } from "./agent.js";
import { instantPace, type Pace } from "./humanize.js";
import { computeAnalytics } from "./analytics.js";
import { channelStatus, makeDeliver, parseEvolutionWebhook, parseMetaWebhook, verifyMetaSignature, type ChannelEnv, type Inbound } from "./channels.js";
import { isPublicPath, makeAuth } from "./auth.js";
import { WIDGET_DEMO_HTML, WIDGET_JS } from "./widget.js";
import { MISSING_KEY, SUGGEST_SETTING, buildSuggestPrompt, suggestEngine, suggestionParts } from "./suggest.js";

const RULE_TRIGGERS = ["stage_enter", "score_gte", "tag_added"];
const RULE_ACTIONS = ["send_message", "handoff", "add_tag", "set_ai_mode"];

const attachmentMeta = (b: Record<string, unknown>): Record<string, unknown> => {
  const a = b.attachment as { name?: unknown; size?: unknown } | undefined;
  if (!a || typeof a.name !== "string" || !a.name.trim()) return {};
  return { attachment: { name: a.name.trim().slice(0, 120), size: Number(a.size) || 0 } };
};

class HttpError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 429 | 503, message: string) {
    super(message);
  }
}

const num = (v: unknown, label: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `invalid ${label}`);
  return n;
};
const text = (v: unknown, label: string, max = 4000): string => {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${label} is required`);
  return v.trim().slice(0, max);
};

export interface AppOptions {
  env?: ChannelEnv;
  fetchImpl?: typeof fetch;
  /** Human-like timing for replies. Instant unless the server passes humanPace(). */
  pace?: Pace;
}

export function createApp(crm: Crm, provider: AiProvider, webDir = "web/dist", opts: AppOptions = {}): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    if (err instanceof SyntaxError) return c.json({ error: "invalid JSON body" }, 400);
    const msg = (err as Error).message;
    // Domain errors thrown by Crm (unknown ids, invalid values) are client errors, not crashes.
    if (/unknown|invalid|still has|empty/.test(msg)) return c.json({ error: msg }, 400);
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const pace = opts.pace ?? instantPace;
  crm.setOutbound(makeDeliver(crm, env, fetchImpl));

  // ---- admin login: protects the panel API, leaves the widget, webhooks and health open
  const auth = makeAuth(crm, env.ADMIN_PASSWORD ?? "");
  app.use("/api/public/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["content-type"] }));
  app.use("/api/*", async (c, next) => {
    if (!auth.required || isPublicPath(c.req.path) || auth.isAuthed(c.req.header("cookie"))) return next();
    return c.json({ error: "unauthorized" }, 401);
  });
  const clientKey = (c: { req: { header: (n: string) => string | undefined } }) => (c.req.header("x-forwarded-for") ?? "local").split(",")[0]!.trim();
  app.get("/api/auth/status", (c) => c.json({ required: auth.required, authenticated: auth.isAuthed(c.req.header("cookie")) }));
  app.post("/api/auth/login", async (c) => {
    const b = await body(c);
    const result = auth.login(typeof b.password === "string" ? b.password : "", clientKey(c));
    if (result === "throttled") throw new HttpError(429, "too many attempts, try again in a few minutes");
    if (!result) throw new HttpError(401, "wrong password");
    c.header("Set-Cookie", auth.cookie(result, c.req.header("x-forwarded-proto") === "https"));
    return c.json({ ok: true });
  });
  app.post("/api/auth/logout", (c) => {
    auth.revoke(auth.tokenFrom(c.req.header("cookie")));
    c.header("Set-Cookie", auth.clearCookie());
    return c.json({ ok: true });
  });

  // One AI turn at a time per conversation, so quick consecutive messages cannot race each other.
  const chains = new Map<number, Promise<unknown>>();
  const serial = <T,>(id: number, fn: () => Promise<T>): Promise<T> => {
    const next = (chains.get(id) ?? Promise.resolve()).catch(() => undefined).then(fn);
    chains.set(id, next);
    next.finally(() => chains.get(id) === next && chains.delete(id)).catch(() => undefined);
    return next;
  };
  const hits = new Map<string, number[]>();
  const allow = (key: string, max: number, windowMs: number) => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return false;
    hits.set(key, [...recent, now]);
    return true;
  };

  const body = async (c: { req: { json: () => Promise<unknown> } }) => {
    const b = (await c.req.json()) as Record<string, unknown> | null;
    if (!b || typeof b !== "object") throw new HttpError(400, "JSON object body required");
    return b;
  };
  const contactOr404 = (id: number) => {
    const c = crm.getContact(id);
    if (!c) throw new HttpError(404, "contact not found");
    return c;
  };

  app.get("/api/health", (c) => c.json({ ok: true, ai: provider.name }));

  // ---- realtime (SSE)
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const queue: string[] = [];
      let wake: (() => void) | null = null;
      const off = crm.subscribe((e) => {
        queue.push(JSON.stringify(e));
        wake?.();
      });
      stream.onAbort(() => {
        off();
        wake?.();
      });
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ ai: provider.name }) });
      while (!stream.aborted) {
        if (!queue.length) await new Promise<void>((r) => { wake = r; setTimeout(r, 15_000); });
        wake = null;
        const next = queue.shift();
        if (next) await stream.writeSSE({ event: "change", data: next });
        else if (!stream.aborted) await stream.writeSSE({ event: "ping", data: "{}" });
      }
    }),
  );

  // ---- stages
  app.get("/api/stages", (c) => c.json(crm.listStages()));
  app.post("/api/stages", async (c) => c.json(crm.createStage(text((await body(c)).name, "name", 40)), 201));
  app.put("/api/stages/:id", async (c) => {
    const b = await body(c);
    const patch: Partial<Stage> = {};
    for (const k of ["name", "color", "ai_mode", "ai_prompt", "stage_rule"] as const)
      if (typeof b[k] === "string") (patch as Record<string, unknown>)[k] = b[k];
    for (const k of ["is_default", "is_won", "is_lost"] as const) if (typeof b[k] === "boolean") patch[k] = b[k];
    if (typeof b.position === "number") patch.position = b.position;
    if (typeof b.ai_temperature === "number") patch.ai_temperature = b.ai_temperature;
    const s = crm.updateStage(num(c.req.param("id"), "id"), patch);
    if (!s) throw new HttpError(404, "stage not found");
    return c.json(s);
  });
  app.delete("/api/stages/:id", (c) => {
    if (!crm.deleteStage(num(c.req.param("id"), "id"))) throw new HttpError(404, "stage not found");
    return c.json({ ok: true });
  });

  // ---- rules
  app.get("/api/rules", (c) => c.json(crm.listRules()));
  app.post("/api/rules", async (c) => {
    const b = await body(c);
    const input = ruleInput(b);
    return c.json(crm.createRule(input), 201);
  });
  app.put("/api/rules/:id", async (c) => {
    const b = await body(c);
    const patch: Partial<Rule> = {};
    if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
    if (typeof b.name === "string") patch.name = b.name;
    if (typeof b.action_value === "string") patch.action_value = b.action_value;
    if (typeof b.trigger_value === "string") patch.trigger_value = b.trigger_value;
    if (b.action_type !== undefined) {
      if (!RULE_ACTIONS.includes(String(b.action_type))) throw new HttpError(400, "invalid action_type");
      patch.action_type = b.action_type as Rule["action_type"];
    }
    if (b.trigger_type !== undefined) {
      if (!RULE_TRIGGERS.includes(String(b.trigger_type))) throw new HttpError(400, "invalid trigger_type");
      patch.trigger_type = b.trigger_type as Rule["trigger_type"];
    }
    if (b.trigger_stage_id !== undefined) patch.trigger_stage_id = b.trigger_stage_id === null ? null : num(b.trigger_stage_id, "trigger_stage_id");
    const r = crm.updateRule(num(c.req.param("id"), "id"), patch);
    if (!r) throw new HttpError(404, "rule not found");
    return c.json(r);
  });
  app.delete("/api/rules/:id", (c) => {
    if (!crm.deleteRule(num(c.req.param("id"), "id"))) throw new HttpError(404, "rule not found");
    return c.json({ ok: true });
  });
  const ruleInput = (b: Record<string, unknown>): Omit<Rule, "id"> => {
    if (!RULE_TRIGGERS.includes(String(b.trigger_type))) throw new HttpError(400, "invalid trigger_type");
    if (!RULE_ACTIONS.includes(String(b.action_type))) throw new HttpError(400, "invalid action_type");
    const trigger_type = b.trigger_type as Rule["trigger_type"];
    const trigger_stage_id = trigger_type === "stage_enter" ? num(b.trigger_stage_id, "trigger_stage_id") : null;
    if (trigger_stage_id && !crm.getStage(trigger_stage_id)) throw new HttpError(400, "unknown stage");
    const trigger_value = typeof b.trigger_value === "string" ? b.trigger_value.trim() : "";
    if (trigger_type === "score_gte" && !Number.isFinite(Number(trigger_value))) throw new HttpError(400, "score threshold must be a number");
    if (trigger_type === "tag_added" && !trigger_value) throw new HttpError(400, "tag is required");
    return {
      name: text(b.name, "name", 80),
      trigger_type,
      trigger_stage_id,
      trigger_value,
      action_type: b.action_type as Rule["action_type"],
      action_value: typeof b.action_value === "string" ? b.action_value.trim() : "",
      enabled: b.enabled !== false,
    };
  };

  // ---- contacts & conversations
  app.get("/api/contacts", (c) => c.json(crm.listContacts()));
  app.get("/api/contacts/:id", (c) => {
    const contact = contactOr404(num(c.req.param("id"), "id"));
    const e = crm.latestEnrollment(contact.id);
    const seq = e && crm.getSequence(e.sequence_id);
    const enrollment = e && seq ? { ...e, sequence_name: seq.name, total_steps: seq.steps.length, next_step: seq.steps[e.position] ?? null } : null;
    return c.json({ contact, messages: crm.messages(contact.id), events: crm.events(contact.id), ai_mode: crm.aiModeFor(contact), enrollment });
  });
  app.post("/api/contacts/:id/read", (c) => {
    crm.markRead(contactOr404(num(c.req.param("id"), "id")).id);
    return c.json({ ok: true });
  });
  app.patch("/api/contacts/:id", async (c) => {
    const id = contactOr404(num(c.req.param("id"), "id")).id;
    const b = await body(c);
    const patch: Record<string, string> = {};
    for (const k of ["name", "phone", "email", "handler"]) if (typeof b[k] === "string") patch[k] = (b[k] as string).trim();
    return c.json(crm.patchContact(id, patch));
  });
  app.post("/api/contacts/:id/move", async (c) => {
    const id = contactOr404(num(c.req.param("id"), "id")).id;
    const b = await body(c);
    return c.json(crm.moveStage(id, num(b.stage_id, "stage_id"), "human"));
  });
  app.post("/api/contacts/:id/tags", async (c) => {
    const id = contactOr404(num(c.req.param("id"), "id")).id;
    crm.addTag(id, text((await body(c)).tag, "tag", 32), "human");
    return c.json(crm.getContact(id));
  });
  app.delete("/api/contacts/:id/tags/:tag", (c) => {
    const id = contactOr404(num(c.req.param("id"), "id")).id;
    crm.removeTag(id, decodeURIComponent(c.req.param("tag")));
    return c.json(crm.getContact(id));
  });

  /** A human agent replies from the inbox; replying takes the conversation over from the AI. */
  app.post("/api/contacts/:id/reply", async (c) => {
    const id = contactOr404(num(c.req.param("id"), "id")).id;
    const b = await body(c);
    const msg = text(b.body, "body");
    if (crm.getContact(id)!.handler !== "human") crm.patchContact(id, { handler: "human" });
    return c.json(crm.addMessage(id, "human", msg, attachmentMeta(b)), 201);
  });

  /** Internal note: visible only to the team, never sent to the customer, never wakes the AI. */
  app.post("/api/contacts/:id/note", async (c) => {
    const id = contactOr404(num(c.req.param("id"), "id")).id;
    const b = await body(c);
    return c.json(crm.addMessage(id, "note", text(b.body, "body"), attachmentMeta(b)), 201);
  });

  app.put("/api/contacts/:id/fields", async (c) => {
    const id = contactOr404(num(c.req.param("id"), "id")).id;
    const b = await body(c);
    const key = text(b.key, "key", 40);
    if (key.startsWith("_")) throw new HttpError(400, "invalid key");
    crm.setFields(id, { [key]: typeof b.value === "string" ? b.value.trim().slice(0, 200) : "" }, "human");
    return c.json(crm.getContact(id));
  });
  app.delete("/api/contacts/:id/fields/:key", (c) => {
    const id = contactOr404(num(c.req.param("id"), "id")).id;
    const key = decodeURIComponent(c.req.param("key"));
    if (key.startsWith("_")) throw new HttpError(400, "invalid key");
    crm.removeField(id, key);
    return c.json(crm.getContact(id));
  });

  // ---- kanban: stage change (fires rules) and persistent order inside the column
  app.post("/api/pipeline/place", async (c) => {
    const b = await body(c);
    const contactId = num(b.contact_id, "contact_id");
    contactOr404(contactId);
    const index = Number.isFinite(Number(b.index)) ? Number(b.index) : 0;
    return c.json(crm.placeContact(contactId, num(b.stage_id, "stage_id"), index, "human"));
  });

  // ---- flow builder node positions
  app.get("/api/flow/layout", (c) => c.json(crm.getLayout()));
  app.put("/api/flow/layout", async (c) => {
    const b = await body(c);
    if (!Array.isArray(b.nodes)) throw new HttpError(400, "nodes must be an array");
    const nodes = (b.nodes as Record<string, unknown>[]).map((n) => {
      if (typeof n.id !== "string" || typeof n.x !== "number" || typeof n.y !== "number" || !Number.isFinite(n.x) || !Number.isFinite(n.y))
        throw new HttpError(400, "invalid node");
      return { id: n.id.slice(0, 60), x: n.x, y: n.y };
    });
    crm.saveLayout(nodes);
    return c.json({ ok: true });
  });

  // ---- bulk contacts: WhatsApp phone digits are the external id, so webhook replies attach to them
  app.post("/api/contacts/bulk", async (c) => {
    const list = (await body(c)).contacts;
    if (!Array.isArray(list) || list.length === 0 || list.length > 500) throw new HttpError(400, "contacts must be a list of 1-500 items");
    const rows = list.map((x: Record<string, unknown>) => {
      const phone = String(x?.phone ?? "").replace(/\D/g, "");
      if (phone.length < 8) throw new HttpError(400, "every contact needs a phone");
      const fields = x.fields && typeof x.fields === "object" ? Object.fromEntries(Object.entries(x.fields as object).map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 500)])) : {};
      return { name: text(x.name, "name", 120), phone, fields };
    });
    let created = 0;
    const ids = rows.map((r) => {
      const found = crm.findByExternal("whatsapp", r.phone);
      if (found) return found.id;
      const contact = crm.createContact({ name: r.name, phone: r.phone, channel: "whatsapp" });
      crm.setExternalId(contact.id, r.phone);
      crm.patchContact(contact.id, { handler: "human" });
      if (Object.keys(r.fields).length) crm.setFields(contact.id, r.fields, "human");
      created++;
      return contact.id;
    });
    return c.json({ created, existing: ids.length - created, ids }, 201);
  });

  // ---- sequences (manual steps; completing a step records an event and never sends anything)
  const sequenceInput = (b: Record<string, unknown>) => ({
    ...(b.name !== undefined ? { name: text(b.name, "name", 80) } : {}),
    ...(typeof b.exit_on_reply === "boolean" ? { exit_on_reply: b.exit_on_reply } : {}),
    ...(b.steps !== undefined ? { steps: b.steps as SequenceStepInput[] } : {}),
  });
  app.get("/api/sequences", (c) => c.json(crm.listSequences()));
  app.post("/api/sequences", async (c) => {
    const b = await body(c);
    const input = sequenceInput(b);
    return c.json(crm.createSequence({ name: text(b.name, "name", 80), exit_on_reply: input.exit_on_reply ?? true, steps: input.steps ?? [] }), 201);
  });
  app.put("/api/sequences/:id", async (c) => {
    const s = crm.updateSequence(num(c.req.param("id"), "id"), sequenceInput(await body(c)));
    if (!s) throw new HttpError(404, "sequence not found");
    return c.json(s);
  });
  app.post("/api/contacts/:id/enroll", async (c) => {
    const id = contactOr404(num(c.req.param("id"), "id")).id;
    return c.json(crm.enroll(id, num((await body(c)).sequence_id, "sequence_id"), "human"), 201);
  });
  app.get("/api/tasks", (c) => {
    const q = c.req.query("until");
    const until = q === undefined ? Date.now() : Number(q);
    if (!Number.isFinite(until)) throw new HttpError(400, "invalid until");
    return c.json(
      crm.tasks(until).map((t) => ({
        ...t,
        wa_link: t.step.channel === "whatsapp" && t.contact.phone ? `https://wa.me/${t.contact.phone.replace(/\D/g, "")}?text=${encodeURIComponent(t.text)}` : null,
      })),
    );
  });
  // Note and reason are optional, so these accept an empty body.
  const optionalBody = async (c: { req: { text: () => Promise<string> } }): Promise<Record<string, unknown>> => {
    const raw = (await c.req.text()).trim();
    if (!raw) return {};
    const b = JSON.parse(raw) as unknown;
    if (!b || typeof b !== "object") throw new HttpError(400, "JSON object body required");
    return b as Record<string, unknown>;
  };
  app.post("/api/enrollments/:id/complete", async (c) => {
    const note = (await optionalBody(c)).note;
    return c.json(crm.completeStep(num(c.req.param("id"), "id"), "done", "human", typeof note === "string" ? note : ""));
  });
  app.post("/api/enrollments/:id/skip", (c) => c.json(crm.completeStep(num(c.req.param("id"), "id"), "skipped", "human")));
  app.post("/api/enrollments/:id/exit", async (c) => {
    const reason = (await optionalBody(c)).reason;
    return c.json(crm.exitEnrollment(num(c.req.param("id"), "id"), typeof reason === "string" ? reason : "", "human"));
  });

  /** Simulator: the customer writes in; the AI agent answers with tool-calling. */
  app.post("/api/contacts/:id/inbound", async (c) => {
    const id = contactOr404(num(c.req.param("id"), "id")).id;
    const msg = text((await body(c)).body, "body");
    const result = await serial(id, () => handleInbound(crm, provider, id, msg, {}, { pace }));
    return c.json(result);
  });
  app.post("/api/simulate/customer", async (c) => {
    const b = await body(c);
    const channels = ["whatsapp", "instagram", "messenger", "web-chat"];
    const channel = typeof b.channel === "string" && channels.includes(b.channel) ? b.channel : "whatsapp";
    const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 60) : `Visitante ${Math.floor(1000 + Math.random() * 9000)}`;
    const contact = crm.createContact({ name, channel, phone: typeof b.phone === "string" ? b.phone : "" });
    const first = typeof b.message === "string" && b.message.trim() ? b.message : null;
    const result = first ? await serial(contact.id, () => handleInbound(crm, provider, contact.id, first, {}, { pace })) : null;
    return c.json({ contact: crm.getContact(contact.id), result }, 201);
  });

  app.get("/api/analytics", (c) => c.json(computeAnalytics(crm)));

  // ---- business profile and knowledge base (what the agent knows about the company)
  app.get("/api/business", (c) => c.json(crm.getBusiness()));
  app.put("/api/business", async (c) => {
    const b = await body(c);
    const patch: Partial<Business> = {};
    for (const k of BUSINESS_FIELDS) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== "string") throw new HttpError(400, `invalid ${k}`);
      patch[k] = b[k] as string;
    }
    return c.json(crm.setBusiness(patch));
  });
  app.get("/api/knowledge", (c) => c.json(crm.listKnowledge()));
  app.post("/api/knowledge", async (c) => {
    const b = await body(c);
    return c.json(crm.addKnowledge(text(b.title, "title", 120), text(b.content, "content", 8000)), 201);
  });
  app.put("/api/knowledge/:id", async (c) => {
    const b = await body(c);
    const k = crm.updateKnowledge(num(c.req.param("id"), "id"), {
      title: typeof b.title === "string" ? b.title : undefined,
      content: typeof b.content === "string" ? b.content : undefined,
    });
    if (!k) throw new HttpError(404, "knowledge entry not found");
    return c.json(k);
  });
  app.delete("/api/knowledge/:id", (c) => {
    if (!crm.deleteKnowledge(num(c.req.param("id"), "id"))) throw new HttpError(404, "knowledge entry not found");
    return c.json({ ok: true });
  });

  // ---- AI and channel status (never returns secrets, only whether they exist)
  app.get("/api/ai/status", (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      provider: provider.name,
      models: provider.models ?? [],
      live: provider.name !== "local-engine",
      channels: channelStatus(env),
      auth: { required: auth.required },
      webhook: { url: `${origin}/api/webhooks/meta`, verify_token_set: !!env.META_VERIFY_TOKEN },
      widget_snippet: `<script src="${origin}/widget.js" async></script>`,
    });
  });
  app.post("/api/ai/test", async (c) => {
    try {
      return c.json({ ok: true, ...(provider.ping ? await provider.ping() : { model: provider.name, ms: 0 }) });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message });
    }
  });

  // ---- public web chat widget
  const visible = (contactId: number, after = 0) =>
    crm
      .messages(contactId)
      .filter((m) => m.id > after && (m.sender === "customer" || m.sender === "ai" || m.sender === "human"))
      .map((m) => ({ id: m.id, sender: m.sender, body: m.body, created_at: m.created_at, attachment: m.meta.attachment }));
  const byToken = (token: unknown) => (typeof token === "string" && /^[a-f0-9]{32}$/.test(token) ? crm.findByExternal("web-chat", token) : undefined);

  app.get("/api/public/chat/config", (c) => {
    const { name, agent_name: agent } = crm.getBusiness();
    const greeting = agent && name ? `Hola, soy ${agent} de ${name}. ¿En qué te puedo ayudar?` : name ? `Hola, bienvenido a ${name}. ¿En qué te puedo ayudar?` : "Hola, ¿en qué te puedo ayudar?";
    return c.json({ name: name || "Chat", agent: agent || "", greeting: crm.getSetting("widget_greeting") ?? greeting });
  });
  app.post("/api/public/chat/session", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { token?: unknown; name?: unknown } | null;
    const existing = byToken(b?.token);
    if (existing) return c.json({ token: b!.token, messages: visible(existing.id) });
    const token = randomBytes(16).toString("hex");
    const name = typeof b?.name === "string" && b.name.trim() ? b.name.trim().slice(0, 60) : `Visitante ${1000 + Math.floor(Math.random() * 9000)}`;
    const contact = crm.createContact({ name, channel: "web-chat" });
    crm.setExternalId(contact.id, token);
    return c.json({ token, messages: [] });
  });
  app.post("/api/public/chat/message", async (c) => {
    const b = await body(c);
    const contact = byToken(b.token);
    if (!contact) throw new HttpError(404, "session not found");
    const t = typeof b.text === "string" ? b.text.trim() : "";
    if (!t) throw new HttpError(400, "text is required");
    if (t.length > 2000) throw new HttpError(400, "text too long");
    if (!allow(`chat:${String(b.token)}`, 30, 60_000)) throw new HttpError(429, "too many messages, slow down");
    // Store the customer's message now and answer in the background: the reply is paced like a person's, so the widget polls for it.
    const stored = crm.addMessage(contact.id, "customer", t);
    crm.background(serial(contact.id, () => handleInbound(crm, provider, contact.id, t, {}, { pace, stored: true })));
    return c.json({ messages: visible(contact.id, stored.id - 1), typing: true });
  });
  app.get("/api/public/chat/messages", (c) => {
    const contact = byToken(c.req.query("token"));
    if (!contact) throw new HttpError(404, "session not found");
    return c.json({ messages: visible(contact.id, Number(c.req.query("after")) || 0), typing: crm.isTyping(contact.id) });
  });
  app.get("/widget.js", (c) =>
    c.body(WIDGET_JS, 200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" }),
  );
  app.get("/widget-demo", (c) => c.html(WIDGET_DEMO_HTML));

  // ---- AI suggested reply: drafts the next message for the user to edit and send; nothing is stored or sent.
  app.get("/api/suggest/settings", (c) => c.json({ instructions: crm.getSetting(SUGGEST_SETTING) ?? "" }));
  app.put("/api/suggest/settings", async (c) => {
    const b = await body(c);
    if (typeof b.instructions !== "string") throw new HttpError(400, "invalid instructions");
    crm.setSetting(SUGGEST_SETTING, b.instructions.trim().slice(0, 4000));
    return c.json({ instructions: crm.getSetting(SUGGEST_SETTING) });
  });
  app.post("/api/contacts/:id/suggest", async (c) => {
    const id = contactOr404(num(c.req.param("id"), "id")).id;
    const engine = suggestEngine(env, fetchImpl);
    if (!engine) return c.json({ error: MISSING_KEY }, 503);
    const { system, user } = buildSuggestPrompt(crm, id);
    let parts: string[];
    try {
      parts = suggestionParts(await engine.complete(system, user));
    } catch (e) {
      return c.json({ error: `La IA no respondió (${(e as Error).message}). Intenta de nuevo.` }, 502);
    }
    if (!parts.length) return c.json({ error: "La IA devolvió una sugerencia vacía. Intenta de nuevo." }, 502);
    return c.json({ text: parts.join("\n\n"), parts, engine: engine.name });
  });

  // ---- Meta webhooks: WhatsApp Cloud API, Messenger and Instagram share one endpoint
  const inflight = new Set<string>();
  const processInbound = async (m: Inbound) => {
    if (inflight.has(m.messageId) || crm.hasExternalMessageId(m.messageId)) return; // Meta retries deliveries
    inflight.add(m.messageId);
    try {
      let contact = crm.findByExternal(m.channel, m.externalId);
      if (!contact) {
        contact = crm.createContact({
          name: m.name || (m.channel === "whatsapp" ? `+${m.externalId}` : `Cliente ${m.channel === "messenger" ? "Messenger" : "Instagram"}`),
          phone: m.channel === "whatsapp" ? m.externalId : "",
          channel: m.channel,
        });
        crm.setExternalId(contact.id, m.externalId);
      }
      const id = contact.id;
      await serial(id, () => handleInbound(crm, provider, id, m.text, { external_id: m.messageId }, { pace }));
    } finally {
      inflight.delete(m.messageId);
    }
  };
  app.get("/api/webhooks/meta", (c) => {
    const ok = c.req.query("hub.mode") === "subscribe" && !!env.META_VERIFY_TOKEN && c.req.query("hub.verify_token") === env.META_VERIFY_TOKEN;
    return ok ? c.text(c.req.query("hub.challenge") ?? "") : c.text("forbidden", 403);
  });
  app.post("/api/webhooks/meta", async (c) => {
    const raw = await c.req.text();
    if (env.META_APP_SECRET && !verifyMetaSignature(raw, c.req.header("x-hub-signature-256"), env.META_APP_SECRET))
      throw new HttpError(401, "invalid signature");
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "invalid JSON body");
    }
    // Acknowledge immediately: Meta retries when the answer takes long, and the AI call can take seconds.
    for (const m of parseMetaWebhook(payload)) crm.background(processInbound(m));
    return c.text("EVENT_RECEIVED");
  });

  // ---- Evolution API webhook: read-only follow-up. Both sides of the chat are recorded; the AI never answers and nothing is sent.
  app.post("/api/webhooks/evolution", async (c) => {
    if (!env.EVOLUTION_WEBHOOK_TOKEN) throw new HttpError(503, "EVOLUTION_WEBHOOK_TOKEN is not configured");
    if (c.req.header("x-webhook-token") !== env.EVOLUTION_WEBHOOK_TOKEN) throw new HttpError(401, "invalid token");
    let payload: any;
    try {
      payload = await c.req.json();
    } catch {
      throw new HttpError(400, "invalid JSON body");
    }
    if (env.EVOLUTION_INSTANCE && payload?.instance !== env.EVOLUTION_INSTANCE) return c.json({ ok: true, ignored: "other instance" });
    // Privacy: the linked number also receives personal chats. When a list is configured, only those numbers are stored.
    const allowed = (env.EVOLUTION_ALLOWED_NUMBERS ?? "").split(",").map((n) => n.replace(/\D/g, "")).filter(Boolean);
    for (const m of parseEvolutionWebhook(payload)) {
      if (allowed.length && !allowed.includes(m.externalId)) continue;
      if (crm.hasExternalMessageId(m.messageId)) continue;
      let contact = crm.findByExternal(m.channel, m.externalId);
      if (!contact) {
        contact = crm.createContact({ name: m.name || `+${m.externalId}`, phone: m.externalId, channel: m.channel });
        crm.setExternalId(contact.id, m.externalId);
      }
      const meta = { external_id: m.messageId, source: "evolution" };
      // Own messages were already sent from the phone: record them, never deliver them again.
      if (m.fromMe) crm.addMessage(contact.id, "human", m.text, { ...meta, delivery: { status: "sent", at: m.at ?? Date.now() } }, { at: m.at, deliver: false });
      else crm.addMessage(contact.id, "customer", m.text, meta, { at: m.at });
    }
    return c.json({ ok: true });
  });

  // ---- static frontend
  if (existsSync(`${webDir}/index.html`)) {
    app.use("/*", serveStatic({ root: webDir }));
    app.get("*", (c) => (c.req.path.startsWith("/api/") ? c.json({ error: "not found" }, 404) : c.html(readFileSync(`${webDir}/index.html`, "utf8"))));
  }
  app.notFound((c) => c.json({ error: "not found" }, 404));
  return app;
}
