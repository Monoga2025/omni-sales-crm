import type { DB } from "./db.js";

export type Sender = "customer" | "ai" | "human" | "system" | "note";
export type Actor = "ai" | "human" | "system" | "rule";
export type AiMode = "qualify" | "nurture" | "close_aggressive" | "support";

export interface Stage {
  id: number;
  name: string;
  position: number;
  color: string;
  is_default: boolean;
  is_won: boolean;
  is_lost: boolean;
  ai_mode: AiMode;
  ai_prompt: string;
  stage_rule: string;
  ai_temperature: number;
}

export interface Contact {
  id: number;
  name: string;
  phone: string;
  email: string;
  channel: string;
  stage_id: number;
  score: number;
  tags: string[];
  fields: Record<string, string>;
  handler: "ai" | "human";
  created_at: number;
  last_message_at: number;
  unread: number;
  sort_order: number;
  budget_value: number;
}

export interface Message {
  id: number;
  contact_id: number;
  sender: Sender;
  body: string;
  created_at: number;
  meta: Record<string, unknown>;
}

export interface CrmEvent {
  id: number;
  contact_id: number;
  type: string;
  data: Record<string, unknown>;
  actor: Actor;
  created_at: number;
}

export interface Rule {
  id: number;
  name: string;
  trigger_type: "stage_enter" | "score_gte" | "tag_added";
  trigger_stage_id: number | null;
  trigger_value: string;
  action_type: "send_message" | "handoff" | "add_tag" | "set_ai_mode";
  action_value: string;
  enabled: boolean;
}

export type BusEvent = { type: string; contactId?: number; on?: boolean };
type Listener = (e: BusEvent) => void;

const AI_MODES: AiMode[] = ["qualify", "nurture", "close_aggressive", "support"];
export const isAiMode = (v: unknown): v is AiMode => AI_MODES.includes(v as AiMode);

type Row = Record<string, unknown>;
const stageOf = (r: Row): Stage => ({
  id: r.id as number,
  name: r.name as string,
  position: r.position as number,
  color: r.color as string,
  is_default: !!r.is_default,
  is_won: !!r.is_won,
  is_lost: !!r.is_lost,
  ai_mode: r.ai_mode as AiMode,
  ai_prompt: r.ai_prompt as string,
  stage_rule: r.stage_rule as string,
  ai_temperature: r.ai_temperature as number,
});
/** Parses free-text budgets such as "3000", "$3,000", "1.500", "2k", "2 mil" or "3.5k" into a number. */
export function parseBudget(text: string | undefined): number {
  const m = (text ?? "").replace(/[$\s]/g, "").toLowerCase().match(/^([\d.,]+)(k|mil)?/);
  if (!m || !/\d/.test(m[1]!)) return 0;
  let num = m[1]!;
  const mult = m[2] ? 1000 : 1;
  if (num.includes(",") && num.includes(".")) num = num.replace(/,/g, "");
  else if (/^\d{1,3}([.,]\d{3})+$/.test(num)) num = num.replace(/[.,]/g, "");
  else num = num.replace(",", ".");
  const n = parseFloat(num);
  return Number.isFinite(n) ? Math.round(n * mult) : 0;
}

const contactOf = (r: Row): Contact => ({
  id: r.id as number,
  name: r.name as string,
  phone: r.phone as string,
  email: r.email as string,
  channel: r.channel as string,
  stage_id: r.stage_id as number,
  score: r.score as number,
  tags: JSON.parse(r.tags as string),
  fields: JSON.parse(r.fields as string),
  handler: r.handler as "ai" | "human",
  created_at: r.created_at as number,
  last_message_at: r.last_message_at as number,
  unread: r.unread as number,
  sort_order: r.sort_order as number,
  budget_value: parseBudget((JSON.parse(r.fields as string) as Record<string, string>).budget),
});
const ruleOf = (r: Row): Rule => ({
  id: r.id as number,
  name: r.name as string,
  trigger_type: r.trigger_type as Rule["trigger_type"],
  trigger_stage_id: (r.trigger_stage_id as number | null) ?? null,
  trigger_value: r.trigger_value as string,
  action_type: r.action_type as Rule["action_type"],
  action_value: r.action_value as string,
  enabled: !!r.enabled,
});

export interface Business {
  name: string;
  description: string;
  tone: string;
  language: string;
  hours: string;
  goals: string;
  handoff_rules: string;
  /** Name of the persona that chats with customers (e.g. "Sofi"). */
  agent_name: string;
  /** Extra style instructions for the persona (regional words, how formal, etc.). */
  style_notes: string;
}
export const BUSINESS_FIELDS: (keyof Business)[] = ["name", "description", "tone", "language", "hours", "goals", "handoff_rules", "agent_name", "style_notes"];

export interface Knowledge {
  id: number;
  title: string;
  content: string;
  created_at: number;
  /** Business profile this entry belongs to; "" is the default business. */
  profile: string;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const tokens = (s: string) => new Set(fold(s).split(/[^a-z0-9$]+/).filter((w) => w.length > 2));

export type OutboundHook = (contact: Contact, message: Message) => Promise<void> | void;

// ---- sequences: ordered manual steps with delays (modeled on HubSpot Sequences task steps)
export const STEP_CHANNELS = ["whatsapp", "instagram_dm", "instagram_comment", "voice_note", "other"] as const;
export type StepChannel = (typeof STEP_CHANNELS)[number];
export interface SequenceStepInput {
  channel: StepChannel;
  title: string;
  template: string;
  /** Minutes after the previous step is completed. Step 1 is due on enrollment. */
  delay_minutes: number;
}
export interface Sequence {
  id: number;
  name: string;
  exit_on_reply: boolean;
  steps: SequenceStepInput[];
  created_at: number;
}
export type EnrollmentStatus = "active" | "finished" | "exited";
export interface Enrollment {
  id: number;
  contact_id: number;
  sequence_id: number;
  status: EnrollmentStatus;
  /** Index of the current (pending) step. */
  position: number;
  next_due_at: number | null;
  exit_reason: string;
  first_reply_at: number | null;
  /** When the last step was marked done or skipped: the reply clock starts here. */
  last_step_at: number | null;
  enrolled_at: number;
  updated_at: number;
}
export interface SequenceTask {
  enrollment: Enrollment;
  sequence: { id: number; name: string };
  contact: Contact;
  step: SequenceStepInput;
  step_number: number;
  total_steps: number;
  due_at: number;
  text: string;
}

/** Fills {{nombre}} and {{field}} placeholders; unknown placeholders stay visible so nothing is invented. */
export function renderTemplate(template: string, contact: Pick<Contact, "name" | "fields">): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
    if (key === "nombre") return contact.name;
    const v = contact.fields[key];
    return typeof v === "string" && v.trim() ? v : `{{${key}}}`;
  });
}

const sequenceOf = (r: Row): Sequence => ({
  id: r.id as number,
  name: r.name as string,
  exit_on_reply: !!r.exit_on_reply,
  steps: JSON.parse(r.steps as string) as SequenceStepInput[],
  created_at: r.created_at as number,
});
const enrollmentOf = (r: Row): Enrollment => ({
  id: r.id as number,
  contact_id: r.contact_id as number,
  sequence_id: r.sequence_id as number,
  status: r.status as EnrollmentStatus,
  position: r.position as number,
  next_due_at: (r.next_due_at as number | null) ?? null,
  exit_reason: r.exit_reason as string,
  first_reply_at: (r.first_reply_at as number | null) ?? null,
  last_step_at: (r.last_step_at as number | null) ?? null,
  enrolled_at: r.enrolled_at as number,
  updated_at: r.updated_at as number,
});
const validSteps = (steps: unknown): SequenceStepInput[] => {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error("empty sequence: add at least one step");
  return steps.map((s: Partial<SequenceStepInput>) => {
    if (!STEP_CHANNELS.includes(s.channel as StepChannel)) throw new Error(`invalid channel: ${String(s.channel)}`);
    const delay = Number(s.delay_minutes ?? 0);
    if (!Number.isInteger(delay) || delay < 0) throw new Error("invalid delay_minutes");
    const title = String(s.title ?? "").trim().slice(0, 80);
    if (!title) throw new Error("invalid step: title is required");
    return { channel: s.channel as StepChannel, title, template: String(s.template ?? "").slice(0, 4000), delay_minutes: delay };
  });
};

export class Crm {
  private listeners = new Set<Listener>();
  private outbound: OutboundHook | null = null;
  private pending = new Set<Promise<unknown>>();
  constructor(readonly db: DB) {}

  // ---- settings, business profile and knowledge base
  getSetting(key: string): string | undefined {
    const r = this.db.prepare("SELECT value FROM settings WHERE key=?").get(key);
    return r ? (r.value as string) : undefined;
  }
  setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }
  /** `profile` selects another business (e.g. a second funnel); "" is the default one the panel edits. */
  getBusiness(profile = ""): Business {
    const base: Business = { name: "", description: "", tone: "", language: "", hours: "", goals: "", handoff_rules: "", agent_name: "", style_notes: "" };
    try {
      return { ...base, ...(JSON.parse(this.getSetting(profile ? `business:${profile}` : "business") ?? "{}") as Partial<Business>) };
    } catch {
      return base;
    }
  }
  hasBusiness(profile: string): boolean {
    return this.getSetting(profile ? `business:${profile}` : "business") !== undefined;
  }
  setBusiness(patch: Partial<Business>, profile = ""): Business {
    const next = this.getBusiness(profile);
    for (const k of BUSINESS_FIELDS) {
      const v = patch[k];
      if (v === undefined) continue;
      if (typeof v !== "string") throw new Error(`invalid ${k}`);
      next[k] = v.trim().slice(0, 2000);
    }
    this.setSetting(profile ? `business:${profile}` : "business", JSON.stringify(next));
    this.publish({ type: "business" });
    return next;
  }
  /** Only the entries of one profile: the default business never sees another funnel's knowledge. */
  listKnowledge(profile = ""): Knowledge[] {
    return this.db.prepare("SELECT * FROM knowledge WHERE profile=? ORDER BY id").all(profile) as unknown as Knowledge[];
  }
  addKnowledge(title: string, content: string, profile = ""): Knowledge {
    const t = title.trim().slice(0, 120);
    const c = content.trim().slice(0, 8000);
    if (!t || !c) throw new Error("invalid knowledge entry: title and content are required");
    const res = this.db.prepare("INSERT INTO knowledge (title, content, created_at, profile) VALUES (?,?,?,?)").run(t, c, Date.now(), profile);
    this.publish({ type: "knowledge" });
    return this.db.prepare("SELECT * FROM knowledge WHERE id=?").get(Number(res.lastInsertRowid)) as unknown as Knowledge;
  }
  updateKnowledge(id: number, patch: { title?: string; content?: string }): Knowledge | undefined {
    const cur = this.db.prepare("SELECT * FROM knowledge WHERE id=?").get(id) as unknown as Knowledge | undefined;
    if (!cur) return undefined;
    const title = (patch.title ?? cur.title).trim().slice(0, 120);
    const content = (patch.content ?? cur.content).trim().slice(0, 8000);
    if (!title || !content) throw new Error("invalid knowledge entry: title and content are required");
    this.db.prepare("UPDATE knowledge SET title=?, content=? WHERE id=?").run(title, content, id);
    this.publish({ type: "knowledge" });
    return { ...cur, title, content };
  }
  deleteKnowledge(id: number): boolean {
    const n = Number(this.db.prepare("DELETE FROM knowledge WHERE id=?").run(id).changes);
    this.publish({ type: "knowledge" });
    return n > 0;
  }
  /** Entries that share words with the customer's message come first; the rest fill the remaining budget. */
  relevantKnowledge(query: string, maxChars = 6000, profile = ""): Knowledge[] {
    const q = tokens(query);
    const scored = this.listKnowledge(profile).map((k) => {
      const t = tokens(`${k.title} ${k.content}`);
      let score = 0;
      for (const w of q) if (t.has(w)) score++;
      return { k, score };
    });
    scored.sort((a, b) => b.score - a.score || b.k.id - a.k.id);
    const out: Knowledge[] = [];
    let used = 0;
    for (const { k } of scored) {
      const len = k.title.length + k.content.length;
      if (used + len > maxChars) continue;
      out.push(k);
      used += len;
    }
    return out;
  }

  // ---- external channel identity (never exposed through the panel API)
  setExternalId(contactId: number, externalId: string): void {
    this.db.prepare("UPDATE contacts SET external_id=? WHERE id=?").run(externalId, contactId);
  }
  getExternalId(contactId: number): string {
    const r = this.db.prepare("SELECT external_id FROM contacts WHERE id=?").get(contactId);
    return r ? (r.external_id as string) : "";
  }
  findByExternal(channel: string, externalId: string): Contact | undefined {
    if (!externalId) return undefined;
    const r = this.db.prepare("SELECT * FROM contacts WHERE channel=? AND external_id=?").get(channel, externalId);
    return r ? contactOf(r) : undefined;
  }
  hasExternalMessageId(messageId: string): boolean {
    return !!this.db.prepare("SELECT 1 AS x FROM messages WHERE json_extract(meta,'$.external_id')=? LIMIT 1").get(messageId);
  }
  updateMessageMeta(id: number, patch: Record<string, unknown>): void {
    const r = this.db.prepare("SELECT contact_id, meta FROM messages WHERE id=?").get(id);
    if (!r) return;
    const meta = { ...(JSON.parse((r.meta as string) || "{}") as Record<string, unknown>), ...patch };
    this.db.prepare("UPDATE messages SET meta=? WHERE id=?").run(JSON.stringify(meta), id);
    this.publish({ type: "message", contactId: r.contact_id as number });
  }

  // ---- outbound delivery and background work
  setOutbound(fn: OutboundHook | null): void {
    this.outbound = fn;
  }
  background(p: Promise<unknown>): void {
    const tracked: Promise<unknown> = p
      .catch((e) => console.error("background task failed:", (e as Error).message))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }
  /** Resolves when every background task (webhook processing, deliveries) has settled. */
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }
  private typingNow = new Set<number>();
  typing(contactId: number, on: boolean): void {
    if (on) this.typingNow.add(contactId);
    else this.typingNow.delete(contactId);
    this.publish({ type: "typing", contactId, on });
  }
  isTyping(contactId: number): boolean {
    return this.typingNow.has(contactId);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  publish(e: BusEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  // ---- stages
  listStages(): Stage[] {
    return this.db.prepare("SELECT * FROM stages ORDER BY position, id").all().map(stageOf);
  }
  getStage(id: number): Stage | undefined {
    const r = this.db.prepare("SELECT * FROM stages WHERE id = ?").get(id);
    return r ? stageOf(r) : undefined;
  }
  defaultStage(): Stage {
    const r = this.db.prepare("SELECT * FROM stages ORDER BY is_default DESC, position LIMIT 1").get();
    if (!r) throw new Error("no stages configured");
    return stageOf(r);
  }
  createStage(name: string): Stage {
    const pos = (this.db.prepare("SELECT COALESCE(MAX(position),0)+1 AS p FROM stages").get() as { p: number }).p;
    const res = this.db.prepare("INSERT INTO stages (name, position) VALUES (?, ?)").run(name, pos);
    this.publish({ type: "stages" });
    return this.getStage(Number(res.lastInsertRowid))!;
  }
  updateStage(id: number, patch: Partial<Omit<Stage, "id">>): Stage | undefined {
    const cur = this.getStage(id);
    if (!cur) return undefined;
    if (patch.ai_mode !== undefined && !isAiMode(patch.ai_mode)) throw new Error("invalid ai_mode");
    if (patch.ai_temperature !== undefined && !(Number.isInteger(patch.ai_temperature) && patch.ai_temperature >= 0 && patch.ai_temperature <= 100))
      throw new Error("invalid ai_temperature");
    const next = { ...cur, ...patch };
    // Exactly one default stage and at most one won stage: those flags are exclusive across stages.
    if (patch.is_default) this.db.prepare("UPDATE stages SET is_default = 0 WHERE id != ?").run(id);
    if (patch.is_won) this.db.prepare("UPDATE stages SET is_won = 0 WHERE id != ?").run(id);
    this.db
      .prepare(
        "UPDATE stages SET name=?, position=?, color=?, is_default=?, is_won=?, is_lost=?, ai_mode=?, ai_prompt=?, stage_rule=?, ai_temperature=? WHERE id=?",
      )
      .run(
        next.name, next.position, next.color, +next.is_default, +next.is_won, +next.is_lost,
        next.ai_mode, next.ai_prompt, next.stage_rule, next.ai_temperature, id,
      );
    this.publish({ type: "stages" });
    return this.getStage(id);
  }
  deleteStage(id: number): boolean {
    const used = this.db.prepare("SELECT COUNT(*) AS c FROM contacts WHERE stage_id = ?").get(id) as { c: number };
    if (used.c > 0) throw new Error("stage still has contacts; move them first");
    const n = Number(this.db.prepare("DELETE FROM stages WHERE id = ?").run(id).changes);
    this.publish({ type: "stages" });
    return n > 0;
  }

  // ---- contacts
  listContacts(): (Contact & { last_message: string | null; last_sender: Sender | null })[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, (SELECT body FROM messages m WHERE m.contact_id=c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message,
                (SELECT sender FROM messages m WHERE m.contact_id=c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_sender
         FROM contacts c ORDER BY c.last_message_at DESC`,
      )
      .all();
    return rows.map((r) => ({
      ...contactOf(r),
      last_message: (r.last_message as string | null) ?? null,
      last_sender: (r.last_sender as Sender | null) ?? null,
    }));
  }
  getContact(id: number): Contact | undefined {
    const r = this.db.prepare("SELECT * FROM contacts WHERE id = ?").get(id);
    return r ? contactOf(r) : undefined;
  }
  createContact(input: { name: string; phone?: string; channel?: string; stage_id?: number }): Contact {
    const stage = input.stage_id ? this.getStage(input.stage_id) : this.defaultStage();
    if (!stage) throw new Error("unknown stage");
    const now = Date.now();
    const res = this.db
      .prepare("INSERT INTO contacts (name, phone, channel, stage_id, created_at, last_message_at, sort_order) VALUES (?,?,?,?,?,?,?)")
      .run(input.name, input.phone ?? "", input.channel ?? "whatsapp", stage.id, now, now, -now);
    const id = Number(res.lastInsertRowid);
    this.logEvent(id, "created", { stage: stage.name, stage_id: stage.id }, "system");
    this.publish({ type: "contact", contactId: id });
    return this.getContact(id)!;
  }
  patchContact(id: number, patch: Partial<Pick<Contact, "name" | "phone" | "email" | "handler">>): Contact | undefined {
    const cur = this.getContact(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    if (next.handler !== "ai" && next.handler !== "human") throw new Error("invalid handler");
    this.db
      .prepare("UPDATE contacts SET name=?, phone=?, email=?, handler=? WHERE id=?")
      .run(next.name, next.phone, next.email, next.handler, id);
    if (patch.handler && patch.handler !== cur.handler) this.logEvent(id, "handler_changed", { to: patch.handler }, "human");
    this.publish({ type: "contact", contactId: id });
    return this.getContact(id);
  }
  removeField(id: number, key: string): void {
    const cur = this.getContact(id);
    if (!cur) throw new Error("unknown contact");
    const next = { ...cur.fields };
    delete next[key];
    this.db.prepare("UPDATE contacts SET fields=? WHERE id=?").run(JSON.stringify(next), id);
    this.publish({ type: "contact", contactId: id });
  }
  setFields(id: number, fields: Record<string, string>, actor: Actor): void {
    const cur = this.getContact(id);
    if (!cur) throw new Error("unknown contact");
    const merged = { ...cur.fields, ...fields };
    this.db.prepare("UPDATE contacts SET fields=? WHERE id=?").run(JSON.stringify(merged), id);
    this.logEvent(id, "fields_updated", fields, actor);
    this.publish({ type: "contact", contactId: id });
  }
  setScore(id: number, score: number, actor: Actor): void {
    const clamped = Math.max(0, Math.min(100, Math.round(score)));
    const cur = this.getContact(id);
    if (!cur || cur.score === clamped) return;
    this.db.prepare("UPDATE contacts SET score=? WHERE id=?").run(clamped, id);
    this.logEvent(id, "score_changed", { from: cur.score, to: clamped }, actor);
    this.runRules(id, { kind: "score" });
    this.publish({ type: "contact", contactId: id });
  }
  addTag(id: number, tag: string, actor: Actor): boolean {
    const t = tag.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32);
    const cur = this.getContact(id);
    if (!cur || !t || cur.tags.includes(t)) return false;
    this.db.prepare("UPDATE contacts SET tags=? WHERE id=?").run(JSON.stringify([...cur.tags, t]), id);
    this.logEvent(id, "tag_added", { tag: t }, actor);
    this.runRules(id, { kind: "tag", tag: t });
    this.publish({ type: "contact", contactId: id });
    return true;
  }
  removeTag(id: number, tag: string): void {
    const cur = this.getContact(id);
    if (!cur) return;
    this.db.prepare("UPDATE contacts SET tags=? WHERE id=?").run(JSON.stringify(cur.tags.filter((x) => x !== tag)), id);
    this.publish({ type: "contact", contactId: id });
  }
  markRead(id: number): void {
    this.db.prepare("UPDATE contacts SET unread=0 WHERE id=?").run(id);
    this.publish({ type: "contact", contactId: id });
  }

  /** Effective AI mode: a rule override wins until the next stage change. */
  aiModeFor(contact: Contact): AiMode {
    const override = contact.fields._ai_mode;
    if (isAiMode(override)) return override;
    return this.getStage(contact.stage_id)?.ai_mode ?? "qualify";
  }

  // ---- messages
  messages(contactId: number): Message[] {
    return this.db
      .prepare("SELECT * FROM messages WHERE contact_id=? ORDER BY created_at, id")
      .all(contactId)
      .map((r) => ({ ...(r as unknown as Message), meta: JSON.parse((r.meta as string) || "{}") }));
  }
  /**
   * Stores a message. `at` records it at its real time (e.g. from WhatsApp); `deliver: false` records a message
   * that was already sent outside the CRM, so the outbound hook must not send it again.
   */
  addMessage(contactId: number, sender: Sender, body: string, meta: Record<string, unknown> = {}, opts: { at?: number; deliver?: boolean } = {}): Message {
    const now = opts.at ?? Date.now();
    const res = this.db
      .prepare("INSERT INTO messages (contact_id, sender, body, created_at, meta) VALUES (?,?,?,?,?)")
      .run(contactId, sender, body, now, JSON.stringify(meta));
    // Only real conversation turns bump recency; system messages and internal notes do not.
    if (sender !== "system" && sender !== "note") {
      this.db
        .prepare("UPDATE contacts SET last_message_at=MAX(last_message_at, ?), unread = CASE WHEN ?='customer' THEN unread+1 ELSE unread END WHERE id=?")
        .run(now, sender, contactId);
    }
    if (sender === "customer") this.onCustomerReply(contactId, now);
    this.publish({ type: "message", contactId });
    const message: Message = { id: Number(res.lastInsertRowid), contact_id: contactId, sender, body, created_at: now, meta };
    if (this.outbound && opts.deliver !== false && (sender === "ai" || sender === "human")) {
      const contact = this.getContact(contactId);
      if (contact) this.background(Promise.resolve(this.outbound(contact, message)));
    }
    return message;
  }

  // ---- events
  logEvent(contactId: number, type: string, data: Record<string, unknown>, actor: Actor): void {
    this.db
      .prepare("INSERT INTO events (contact_id, type, data, actor, created_at) VALUES (?,?,?,?,?)")
      .run(contactId, type, JSON.stringify(data), actor, Date.now());
  }
  events(contactId: number): CrmEvent[] {
    return this.db
      .prepare("SELECT * FROM events WHERE contact_id=? ORDER BY id")
      .all(contactId)
      .map((r) => ({ ...(r as unknown as CrmEvent), data: JSON.parse(r.data as string) }));
  }

  /** The single stage-change operation used by UI drag&drop, the AI tool and rules. */
  moveStage(contactId: number, stageId: number, actor: Actor): Contact {
    const contact = this.getContact(contactId);
    const target = this.getStage(stageId);
    if (!contact) throw new Error("unknown contact");
    if (!target) throw new Error("unknown stage");
    if (contact.stage_id === stageId) return contact;
    const from = this.getStage(contact.stage_id);
    const fields = { ...contact.fields };
    delete fields._ai_mode; // entering a stage resets any per-contact mode override
    this.db.prepare("UPDATE contacts SET stage_id=?, fields=? WHERE id=?").run(stageId, JSON.stringify(fields), contactId);
    this.logEvent(
      contactId,
      "stage_changed",
      { from: from?.name ?? null, from_id: contact.stage_id, to: target.name, to_id: stageId },
      actor,
    );
    this.runRules(contactId, { kind: "stage", stageId });
    this.publish({ type: "contact", contactId });
    return this.getContact(contactId)!;
  }

  /** Drag&drop entry point: changes stage when needed (firing rules) and persists the position inside the column. */
  placeContact(contactId: number, stageId: number, index: number, actor: Actor): Contact {
    if (!this.getContact(contactId)) throw new Error("unknown contact");
    if (!this.getStage(stageId)) throw new Error("unknown stage");
    this.moveStage(contactId, stageId, actor);
    const rows = this.db
      .prepare("SELECT id FROM contacts WHERE stage_id=? AND id!=? ORDER BY sort_order, last_message_at DESC, id")
      .all(stageId, contactId)
      .map((r) => r.id as number);
    const at = Math.max(0, Math.min(Math.trunc(index) || 0, rows.length));
    rows.splice(at, 0, contactId);
    const upd = this.db.prepare("UPDATE contacts SET sort_order=? WHERE id=?");
    rows.forEach((id, i) => upd.run(i + 1, id));
    this.publish({ type: "contact", contactId });
    return this.getContact(contactId)!;
  }

  // ---- flow builder layout
  getLayout(): Record<string, { x: number; y: number }> {
    const out: Record<string, { x: number; y: number }> = {};
    for (const r of this.db.prepare("SELECT id, x, y FROM flow_layout").all()) out[r.id as string] = { x: r.x as number, y: r.y as number };
    return out;
  }
  saveLayout(nodes: { id: string; x: number; y: number }[]): void {
    const up = this.db.prepare("INSERT INTO flow_layout (id, x, y) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET x=excluded.x, y=excluded.y");
    for (const n of nodes) up.run(n.id, n.x, n.y);
  }

  // ---- automations
  listRules(): Rule[] {
    return this.db.prepare("SELECT * FROM rules ORDER BY id").all().map(ruleOf);
  }
  createRule(input: Omit<Rule, "id">): Rule {
    const res = this.db
      .prepare(
        "INSERT INTO rules (name, trigger_type, trigger_stage_id, trigger_value, action_type, action_value, enabled) VALUES (?,?,?,?,?,?,?)",
      )
      .run(input.name, input.trigger_type, input.trigger_stage_id, input.trigger_value, input.action_type, input.action_value, +input.enabled);
    this.publish({ type: "rules" });
    return ruleOf(this.db.prepare("SELECT * FROM rules WHERE id=?").get(Number(res.lastInsertRowid))!);
  }
  updateRule(id: number, patch: Partial<Omit<Rule, "id">>): Rule | undefined {
    const row = this.db.prepare("SELECT * FROM rules WHERE id=?").get(id);
    if (!row) return undefined;
    const n = { ...ruleOf(row), ...patch };
    this.db
      .prepare("UPDATE rules SET name=?, trigger_type=?, trigger_stage_id=?, trigger_value=?, action_type=?, action_value=?, enabled=? WHERE id=?")
      .run(n.name, n.trigger_type, n.trigger_stage_id, n.trigger_value, n.action_type, n.action_value, +n.enabled, id);
    this.publish({ type: "rules" });
    return ruleOf(this.db.prepare("SELECT * FROM rules WHERE id=?").get(id)!);
  }
  deleteRule(id: number): boolean {
    const n = Number(this.db.prepare("DELETE FROM rules WHERE id=?").run(id).changes);
    this.publish({ type: "rules" });
    return n > 0;
  }

  private runRules(
    contactId: number,
    ctx: { kind: "stage"; stageId: number } | { kind: "score" } | { kind: "tag"; tag: string },
  ): void {
    const contact = this.getContact(contactId);
    if (!contact) return;
    for (const rule of this.listRules().filter((r) => r.enabled)) {
      let hit = false;
      if (ctx.kind === "stage") hit = rule.trigger_type === "stage_enter" && rule.trigger_stage_id === ctx.stageId;
      else if (ctx.kind === "score") hit = rule.trigger_type === "score_gte" && contact.score >= Number(rule.trigger_value);
      else hit = rule.trigger_type === "tag_added" && rule.trigger_value.toLowerCase() === ctx.tag;
      if (!hit) continue;
      // score and tag rules fire once per contact so they cannot repeat on every change
      if (rule.trigger_type !== "stage_enter" && this.hasFired(contactId, rule.id)) continue;
      this.applyAction(contactId, rule);
    }
  }
  private hasFired(contactId: number, ruleId: number): boolean {
    const rows = this.db.prepare("SELECT data FROM events WHERE contact_id=? AND type='automation_fired'").all(contactId);
    return rows.some((r) => (JSON.parse(r.data as string) as { rule_id: number }).rule_id === ruleId);
  }
  private applyAction(contactId: number, rule: Rule): void {
    const c = this.getContact(contactId)!;
    const fill = (s: string) => s.replaceAll("{{name}}", c.name.split(" ")[0] || "hola");
    // Log first: a rule whose action re-triggers rules (e.g. add_tag) must not recurse into itself.
    this.logEvent(contactId, "automation_fired", { rule_id: rule.id, rule: rule.name, action: rule.action_type }, "rule");
    switch (rule.action_type) {
      case "send_message":
        this.addMessage(contactId, "ai", fill(rule.action_value));
        break;
      case "handoff":
        this.handoff(contactId, fill(rule.action_value) || "regla de automatización", "rule");
        break;
      case "add_tag":
        this.addTag(contactId, rule.action_value, "rule");
        break;
      case "set_ai_mode":
        if (isAiMode(rule.action_value)) this.setFields(contactId, { _ai_mode: rule.action_value }, "rule");
        break;
    }
  }

  handoff(contactId: number, reason: string, actor: Actor): void {
    const c = this.getContact(contactId);
    if (!c || c.handler === "human") return;
    this.db.prepare("UPDATE contacts SET handler='human' WHERE id=?").run(contactId);
    this.addMessage(contactId, "system", `Transferido a un agente humano: ${reason}`);
    this.logEvent(contactId, "handoff", { reason, via: actor }, actor);
    this.publish({ type: "contact", contactId });
  }

  // ---- sequences
  listSequences(): Sequence[] {
    return this.db.prepare("SELECT * FROM sequences ORDER BY id").all().map(sequenceOf);
  }
  getSequence(id: number): Sequence | undefined {
    const r = this.db.prepare("SELECT * FROM sequences WHERE id=?").get(id);
    return r ? sequenceOf(r) : undefined;
  }
  createSequence(input: { name: string; exit_on_reply: boolean; steps: SequenceStepInput[] }): Sequence {
    const steps = validSteps(input.steps);
    const res = this.db
      .prepare("INSERT INTO sequences (name, exit_on_reply, steps, created_at) VALUES (?,?,?,?)")
      .run(input.name, input.exit_on_reply ? 1 : 0, JSON.stringify(steps), Date.now());
    return this.getSequence(Number(res.lastInsertRowid))!;
  }
  /** Steps cannot change while contacts are enrolled, so a pending position always points at the step the user saw. */
  updateSequence(id: number, patch: { name?: string; exit_on_reply?: boolean; steps?: SequenceStepInput[] }): Sequence | undefined {
    const cur = this.getSequence(id);
    if (!cur) return undefined;
    const steps = patch.steps ? validSteps(patch.steps) : cur.steps;
    if (patch.steps) {
      const active = Number((this.db.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE sequence_id=? AND status='active'").get(id) as { n: number }).n);
      if (active) throw new Error("invalid: sequence has active enrollments");
    }
    this.db
      .prepare("UPDATE sequences SET name=?, exit_on_reply=?, steps=? WHERE id=?")
      .run(patch.name ?? cur.name, (patch.exit_on_reply ?? cur.exit_on_reply) ? 1 : 0, JSON.stringify(steps), id);
    return this.getSequence(id);
  }

  getEnrollment(id: number): Enrollment | undefined {
    const r = this.db.prepare("SELECT * FROM enrollments WHERE id=?").get(id);
    return r ? enrollmentOf(r) : undefined;
  }
  activeEnrollment(contactId: number): Enrollment | undefined {
    const r = this.db.prepare("SELECT * FROM enrollments WHERE contact_id=? AND status='active' ORDER BY id DESC LIMIT 1").get(contactId);
    return r ? enrollmentOf(r) : undefined;
  }
  latestEnrollment(contactId: number): Enrollment | undefined {
    const r = this.db.prepare("SELECT * FROM enrollments WHERE contact_id=? ORDER BY id DESC LIMIT 1").get(contactId);
    return r ? enrollmentOf(r) : undefined;
  }
  enroll(contactId: number, sequenceId: number, actor: Actor): Enrollment {
    if (!this.getContact(contactId)) throw new Error("unknown contact");
    const seq = this.getSequence(sequenceId);
    if (!seq) throw new Error("unknown sequence");
    if (this.activeEnrollment(contactId)) throw new Error("invalid: contact already enrolled");
    const now = Date.now();
    const res = this.db
      .prepare("INSERT INTO enrollments (contact_id, sequence_id, status, position, next_due_at, enrolled_at, updated_at) VALUES (?,?, 'active', 0, ?, ?, ?)")
      .run(contactId, sequenceId, now + seq.steps[0]!.delay_minutes * 60_000, now, now);
    this.logEvent(contactId, "sequence_enrolled", { sequence: seq.name, sequence_id: seq.id }, actor);
    this.publish({ type: "contact", contactId });
    return this.getEnrollment(Number(res.lastInsertRowid))!;
  }
  private activeOrThrow(enrollmentId: number): { e: Enrollment; seq: Sequence } {
    const e = this.getEnrollment(enrollmentId);
    if (!e) throw new Error("unknown enrollment");
    if (e.status !== "active") throw new Error("invalid: enrollment is not active");
    return { e, seq: this.getSequence(e.sequence_id)! };
  }
  /** Marks the pending step as done or skipped and schedules the next one from now. Records an event only: nothing is sent. */
  completeStep(enrollmentId: number, outcome: "done" | "skipped", actor: Actor, note = ""): Enrollment {
    const { e, seq } = this.activeOrThrow(enrollmentId);
    const step = seq.steps[e.position]!;
    const now = Date.now();
    this.logEvent(e.contact_id, "sequence_step", { sequence: seq.name, position: e.position, title: step.title, channel: step.channel, outcome, note: note.slice(0, 500) }, actor);
    const next = seq.steps[e.position + 1];
    if (next) {
      this.db.prepare("UPDATE enrollments SET position=?, next_due_at=?, last_step_at=?, updated_at=? WHERE id=?").run(e.position + 1, now + next.delay_minutes * 60_000, now, now, e.id);
    } else {
      this.db.prepare("UPDATE enrollments SET status='finished', position=?, next_due_at=NULL, last_step_at=?, updated_at=? WHERE id=?").run(e.position + 1, now, now, e.id);
      this.logEvent(e.contact_id, "sequence_finished", { sequence: seq.name }, actor);
    }
    this.publish({ type: "contact", contactId: e.contact_id });
    return this.getEnrollment(e.id)!;
  }
  exitEnrollment(enrollmentId: number, reason: string, actor: Actor): Enrollment {
    const { e, seq } = this.activeOrThrow(enrollmentId);
    const why = reason.trim().slice(0, 200) || "manual";
    this.db.prepare("UPDATE enrollments SET status='exited', exit_reason=?, next_due_at=NULL, updated_at=? WHERE id=?").run(why, Date.now(), e.id);
    this.logEvent(e.contact_id, "sequence_exited", { sequence: seq.name, reason: why, position: e.position }, actor);
    this.publish({ type: "contact", contactId: e.contact_id });
    return this.getEnrollment(e.id)!;
  }
  /** First customer reply: always timed (audit metric); ends the enrollment only when the sequence exits on reply. */
  private onCustomerReply(contactId: number, at: number): void {
    const e = this.activeEnrollment(contactId);
    if (!e) return;
    const seq = this.getSequence(e.sequence_id)!;
    if (e.first_reply_at === null) {
      this.db.prepare("UPDATE enrollments SET first_reply_at=?, updated_at=? WHERE id=?").run(at, at, e.id);
      this.logEvent(contactId, "sequence_reply", { sequence: seq.name, minutes: Math.round((at - (e.last_step_at ?? e.enrolled_at)) / 60_000) }, "system");
    }
    if (seq.exit_on_reply) this.exitEnrollment(e.id, "reply", "system");
  }
  /** Pending steps due up to `until`, oldest first. */
  tasks(until: number): SequenceTask[] {
    const rows = this.db.prepare("SELECT * FROM enrollments WHERE status='active' AND next_due_at <= ? ORDER BY next_due_at, id").all(until).map(enrollmentOf);
    return rows.flatMap((e) => {
      const seq = this.getSequence(e.sequence_id);
      const contact = this.getContact(e.contact_id);
      const step = seq?.steps[e.position];
      if (!seq || !contact || !step) return [];
      return [{
        enrollment: e,
        sequence: { id: seq.id, name: seq.name },
        contact,
        step,
        step_number: e.position + 1,
        total_steps: seq.steps.length,
        due_at: e.next_due_at!,
        text: renderTemplate(step.template, contact),
      }];
    });
  }
}
