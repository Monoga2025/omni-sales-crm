import type { AiMode, Business, Contact, Crm, Knowledge, Message, Stage } from "./crm.js";
import { applyFunnelTrigger, detectTrigger, profileOf } from "./funnels.js";
import { findUnsupportedClaims } from "./guard.js";
import { coverage, humanizeText, instantPace, sharesPhrase, similarity, splitBubbles, type Pace } from "./humanize.js";

/** A tool call the agent can make. Every provider (local engine or Claude) goes through the same executor. */
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export const TOOL_SPECS = [
  {
    name: "update_lead",
    description: "Save facts learned about the lead (name, email, phone, interest, budget, notes).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        interest: { type: "string" },
        budget: { type: "string" },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "add_tag",
    description: "Attach a short dynamic tag describing the lead (e.g. asked-price, urgent, wants-demo).",
    input_schema: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"] },
  },
  {
    name: "set_lead_score",
    description: "Set the lead score from 0 (cold) to 100 (ready to buy).",
    input_schema: {
      type: "object",
      properties: { score: { type: "number" }, reason: { type: "string" } },
      required: ["score"],
    },
  },
  {
    name: "move_stage",
    description: "Move the lead to another funnel stage by its exact name.",
    input_schema: {
      type: "object",
      properties: { stage_name: { type: "string" }, reason: { type: "string" } },
      required: ["stage_name"],
    },
  },
  {
    name: "handoff_to_human",
    description: "Stop answering and transfer the conversation to a human agent.",
    input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
  },
] as const;

export interface AgentContext {
  crm: Crm;
  contact: Contact;
  stage: Stage;
  stages: Stage[];
  mode: AiMode;
  history: Message[];
  business: Business;
  knowledge: Pick<Knowledge, "title" | "content">[];
}

/** Messages of context sent to the model. */
const HISTORY_LIMIT = 24;

export interface AiProvider {
  readonly name: string;
  /** Models in fallback order, when the provider has several. */
  readonly models?: string[];
  /** Cheap connectivity check used by the settings screen. */
  ping?(): Promise<{ model: string; ms: number }>;
  /** Runs the agent: calls `exec` for each tool it wants and returns the customer-facing reply. */
  run(ctx: AgentContext, exec: (call: ToolCall) => string): Promise<string>;
}

// ---------------------------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------------------------

export interface ExecState {
  handoffReason: string | null;
  calls: (ToolCall & { result: string })[];
}

export function makeExecutor(crm: Crm, contactId: number, state: ExecState) {
  const run = (call: ToolCall): string => {
    const i = call.input;
    const str = (k: string) => (typeof i[k] === "string" ? (i[k] as string).trim() : "");
    switch (call.name) {
      case "update_lead": {
        const fields: Record<string, string> = {};
        for (const k of ["interest", "budget", "notes"]) if (str(k)) fields[k] = str(k).slice(0, 200);
        const patch: { name?: string; email?: string; phone?: string } = {};
        if (str("name")) patch.name = str("name").slice(0, 80);
        if (str("email")) patch.email = str("email").slice(0, 120);
        if (str("phone")) patch.phone = str("phone").slice(0, 40);
        if (Object.keys(patch).length) crm.patchContact(contactId, patch);
        if (Object.keys(fields).length) crm.setFields(contactId, fields, "ai");
        return "lead actualizado";
      }
      case "add_tag":
        return crm.addTag(contactId, str("tag"), "ai") ? "etiqueta añadida" : "etiqueta ya existente o vacía";
      case "set_lead_score": {
        const n = Number(i.score);
        if (!Number.isFinite(n)) return "error: el puntaje debe ser un número";
        crm.setScore(contactId, n, "ai");
        return `puntaje fijado en ${Math.max(0, Math.min(100, Math.round(n)))}`;
      }
      case "move_stage": {
        const wanted = str("stage_name").toLowerCase();
        const target = crm.listStages().find((s) => s.name.toLowerCase() === wanted);
        if (!target) return `error: etapa desconocida. Válidas: ${crm.listStages().map((s) => s.name).join(", ")}`;
        crm.moveStage(contactId, target.id, "ai");
        return `movido a ${target.name}`;
      }
      case "handoff_to_human":
        state.handoffReason = str("reason") || "la IA solicitó un humano";
        return "traspaso programado";
      default:
        return `error: herramienta desconocida ${call.name}`;
    }
  };
  return (call: ToolCall): string => {
    const result = run(call);
    state.calls.push({ ...call, result });
    return result;
  };
}

// ---------------------------------------------------------------------------------------------
// Inbound pipeline
// ---------------------------------------------------------------------------------------------

export interface InboundResult {
  replied: boolean;
  reply: string | null;
  tools: ToolCall[];
  provider: string;
}

const COURTESY_ES = "Dame un momento, esto lo confirmo con una persona del equipo y te escribe por este mismo chat en breve.";
const COURTESY_EN = "Give me a moment, I'm checking this with someone on the team and they'll write to you here shortly.";

export interface HandleOptions {
  /** Human-like timing (reading pause, typing time, gaps between bubbles). Instant by default. */
  pace?: Pace;
  /** The caller already stored the customer's message (it is the last one in the history). */
  stored?: boolean;
}

export async function handleInbound(
  crm: Crm,
  provider: AiProvider,
  contactId: number,
  text: string,
  customerMeta: Record<string, unknown> = {},
  opts: HandleOptions = {},
): Promise<InboundResult> {
  const pace = opts.pace ?? instantPace;
  const body = text.trim();
  if (!body) throw new Error("empty message");
  const before = crm.getContact(contactId);
  if (!before) throw new Error("unknown contact");
  if (!opts.stored) crm.addMessage(contactId, "customer", body, customerMeta);

  // D1/D2/D3 comment triggers: tag, score and move the lead even when a human owns the chat.
  const trigger = detectTrigger(body);
  const funnel = trigger ? applyFunnelTrigger(crm, contactId, trigger) : null;
  if (funnel?.parts.length) {
    await pace.sleep(pace.readMs(body.length));
    try {
      for (let i = 0; i < funnel.parts.length; i++) {
        const part = funnel.parts[i]!;
        if (i > 0) await pace.sleep(pace.betweenMs());
        crm.typing(contactId, true);
        await pace.sleep(pace.typeMs(part.length));
        crm.addMessage(contactId, "ai", part, { funnel: funnel.trigger, part: i + 1 });
      }
    } finally {
      crm.typing(contactId, false);
    }
    crm.logEvent(contactId, "ai_turn", { provider: "funnel", tools: [] }, "ai");
    return { replied: true, reply: funnel.parts.join("\n"), tools: [], provider: "funnel" };
  }

  // Human-owned conversations are never answered by the AI.
  const owner = crm.getContact(contactId)!;
  if (before.handler === "human" || owner.handler === "human") return { replied: false, reply: null, tools: [], provider: provider.name };

  const contact = owner;
  const stage = crm.getStage(contact.stage_id)!;
  const state: ExecState = { handoffReason: null, calls: [] };
  const exec = makeExecutor(crm, contactId, state);
  const ctx: AgentContext = {
    crm,
    contact,
    stage,
    stages: crm.listStages(),
    mode: crm.aiModeFor(contact),
    history: crm.messages(contactId),
    business: crm.getBusiness(profileOf(contact)),
    knowledge: crm.relevantKnowledge(body, 6000, profileOf(contact)),
  };
  const followUp = ctx.history.some((m) => m.sender === "ai" && !m.meta.courtesy);

  // The model works while the "person" is still reading; the typing indicator only appears afterwards.
  const outcome = provider.run(ctx, exec).then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  const started = Date.now();
  const readMs = pace.readMs(body.length);
  await pace.sleep(readMs);

  crm.typing(contactId, true);
  let parts: string[] = [];
  try {
    let reply = "";
    try {
      const r = await outcome;
      if (!r.ok) throw r.e;
      reply = r.v;
    } catch (err) {
      // Provider outage must not lose the lead: hand it to a human with the reason recorded.
      state.handoffReason = `falló el proveedor de IA (${(err as Error).message.slice(0, 120)})`;
    }
    const allowEmoji = /\p{Extended_Pictographic}/u.test(ctx.history.filter((m) => m.sender === "customer").slice(-3).map((m) => m.body).join(" "));
    parts = splitBubbles(reply).map((p) => humanizeText(p, { followUp, allowEmoji })).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (i > 0) await pace.sleep(pace.betweenMs());
      // time the model already took counts as typing time for the first bubble
      const already = i === 0 ? Date.now() - started - readMs : 0;
      await pace.sleep(Math.max(0, pace.typeMs(part.length) - already));
      crm.addMessage(contactId, "ai", part, i === 0 ? { tool_calls: state.calls, provider: provider.name } : { part: i + 1 });
    }
  } finally {
    crm.typing(contactId, false);
  }

  const spoken = parts.join(" ");
  if (state.handoffReason) {
    // The customer must never be left in silence: acknowledge unless the reply already says a person will follow up.
    if (!spoken || !/persona|humano|equipo|asesor|colega|\bteam\b|human|agent|teammate/i.test(spoken)) {
      const english = !RE.spanish.test(body) && /\b(the|you|your|please|hello|hi|how|price|want)\b/i.test(body);
      crm.addMessage(contactId, "ai", english ? COURTESY_EN : COURTESY_ES, { courtesy: true });
    }
    crm.handoff(contactId, state.handoffReason, "ai");
  }
  crm.logEvent(contactId, "ai_turn", { provider: provider.name, tools: state.calls.map((c) => c.name) }, "ai");
  return { replied: parts.length > 0, reply: parts.join("\n") || null, tools: state.calls, provider: provider.name };
}

// ---------------------------------------------------------------------------------------------
// Local deterministic engine (used when no API key is configured)
// ---------------------------------------------------------------------------------------------

const RE = {
  email: /[\w.+-]+@[\w-]+\.[\w.-]+/,
  name: /(?:me llamo|mi nombre es|my name is|soy|i am|i'm|this is)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,})?)/i,
  budget: /(?:presupuesto|budget|spend|gastar|pagar|hasta|up to)[^\d$]{0,24}\$?\s?(\d[\d.,]*)\s?(k|mil)?|\$\s?(\d[\d.,]*)\s?(k|mil)?/i,
  interest: /(?:interesad[oa] en|interested in|busco|looking for|necesito|need|quiero|want)\s+(?:a |an |un |una |the |el |la )?([^.,;!?\n]{3,60})/i,
  price: /precio|cu[aá]nto cuesta|cu[aá]nto vale|cost|price|cotiz|quote|how much|tarifa/i,
  buy: /quiero comprar|lo compro|lo quiero|c[oó]mo pago|d[oó]nde pago|want to buy|i'?ll take it|let'?s do it|where (do|can) i pay|cerremos|acepto|send (me )?the invoice|env[ií]ame la factura/i,
  human: /humano|asesor|persona real|hablar con (alguien|un agente)|human|real person|speak to (a |an )?(person|agent|someone)|representative/i,
  hardNo: /no (me )?interesa|no gracias|not interested|unsubscribe|dejen de escribir|stop messaging/i,
  urgency: /urgente|hoy|today|asap|ya mismo|esta semana|this week|right now|cuanto antes/i,
  demo: /demo|prueba|trial|reuni[oó]n|meeting|llamada|\bcall\b|agendar|schedule/i,
  spanish: /\b(hola|quiero|necesito|precio|cu[aá]nto|gracias|buenas|presupuesto|busco|tengo|puedo|c[oó]mo|por favor)\b/i,
};

const NAME_STOP = new Set(["de", "un", "una", "the", "interested", "looking", "interesado", "interesada", "from", "here"]);

export function scoreFromHistory(history: Message[], known: { name: boolean; email: boolean }): number {
  const text = history.filter((m) => m.sender === "customer").map((m) => m.body).join(" \n ");
  const turns = history.filter((m) => m.sender === "customer").length;
  let s = Math.min(turns * 4, 12);
  if (known.name) s += 5;
  if (known.email) s += 12;
  if (RE.interest.test(text)) s += 10;
  if (RE.price.test(text)) s += 15;
  if (RE.budget.test(text)) s += 15;
  if (RE.urgency.test(text)) s += 12;
  if (RE.demo.test(text)) s += 10;
  if (RE.buy.test(text)) s += 25;
  if (RE.hardNo.test(text)) s = Math.min(s, 10);
  return Math.max(0, Math.min(100, s));
}

type Level = "qualifying" | "interested" | "negotiating" | "won" | "lost";

/** Resolve a funnel level to a stage using the won/lost flags, then name hints, then position. */
export function stageForLevel(stages: Stage[], level: Level): Stage | undefined {
  const open = stages.filter((s) => !s.is_won && !s.is_lost);
  if (level === "won") return stages.find((s) => s.is_won);
  if (level === "lost") return stages.find((s) => s.is_lost);
  const hints: Record<Exclude<Level, "won" | "lost">, RegExp> = {
    qualifying: /qualif|calific/i,
    interested: /interest|interes|hot|warm/i,
    negotiating: /negot|proposal|propuesta|negoci|quote|cotiz/i,
  };
  const byName = open.find((s) => hints[level].test(s.name));
  if (byName) return byName;
  const idx = { qualifying: 1, interested: 2, negotiating: 3 }[level];
  return open[Math.min(idx, open.length - 1)];
}

const T = {
  en: {
    askName: "Hi! I'm the virtual assistant. What's your name?",
    askInterest: (n: string) => `Nice to meet you, ${n}! What are you looking for?`,
    askBudget: "Got it. Roughly what budget are you working with?",
    askEmail: "Great. What email can I send the details to?",
    nurture: (n: string) => `Thanks ${n}. Here's the short version: we tailor the plan to your needs and onboarding takes a few days. Want a quick demo?`,
    close: (n: string) => `${n}, we can lock this in today with the current offer. Shall I send the payment link now so you can start right away?`,
    support: (n: string) => `Thanks ${n}, I'm on it. Can you share a bit more detail so I can help you faster?`,
    price: "Pricing depends on the plan, but I can give you a precise quote once I know your needs.",
    handoff: "Of course, I'm bringing in a teammate now. They'll continue with you here.",
    bye: "Understood, no problem. I won't message you again. Have a great day!",
    won: (n: string) => `Excellent, ${n}! I'm sending the invoice and next steps now. Welcome aboard!`,
  },
  es: {
    askName: "¡Hola! Soy el asistente virtual. ¿Cómo te llamas?",
    askInterest: (n: string) => `¡Mucho gusto, ${n}! ¿Qué estás buscando?`,
    askBudget: "Perfecto. ¿Con qué presupuesto aproximado cuentas?",
    askEmail: "Genial. ¿A qué correo te envío los detalles?",
    nurture: (n: string) => `Gracias ${n}. En breve: adaptamos el plan a tus necesidades y la puesta en marcha toma pocos días. ¿Te agendo una demo rápida?`,
    close: (n: string) => `${n}, podemos cerrar hoy con la oferta vigente. ¿Te envío el enlace de pago ahora para empezar de inmediato?`,
    support: (n: string) => `Gracias ${n}, ya lo reviso. ¿Puedes darme un poco más de detalle para ayudarte más rápido?`,
    price: "El precio depende del plan, pero te doy una cotización exacta apenas conozca tus necesidades.",
    handoff: "Claro, ya te paso con una persona del equipo. Seguirá contigo por aquí.",
    bye: "Entendido, sin problema. No volveré a escribirte. ¡Que tengas un gran día!",
    won: (n: string) => `¡Excelente, ${n}! Te envío la factura y los siguientes pasos ahora mismo. ¡Bienvenido!`,
  },
} as const;

const GENERIC_NAME = /^(visitor|visitante|customer|guest|cliente|invitado|unknown|desconocido)\b|^\+?\d/i;

type Exec = (call: ToolCall) => string;

interface Signals {
  lang: "es" | "en";
  name: string;
  known: { name: boolean; email: boolean };
  hardNo: boolean;
  wantsBuy: boolean;
  interest: string | undefined;
  last: string;
}

/**
 * Deterministic CRM extraction from the conversation: facts, tags, score and funnel stage.
 * The local engine uses it for everything; LLM providers run it afterwards (see applyGuardrails)
 * for whatever the model skipped, so the CRM stays reliable whatever the model's tool-calling quality.
 */
export function applySignals(ctx: AgentContext, exec: Exec, skip: Set<string> = new Set()): Signals {
  const { contact, stages, history } = ctx;
  const incoming = history.filter((m) => m.sender === "customer");
  const last = incoming[incoming.length - 1]?.body ?? "";
  const all = incoming.map((m) => m.body).join(" \n ");
  const lang = RE.spanish.test(all) ? "es" : "en";

  // 1. Extract facts
  let name = contact.name;
  const nm = last.match(RE.name)?.[1]?.trim();
  const nameCandidate = nm && !NAME_STOP.has(nm.split(/\s+/)[0]!.toLowerCase()) ? nm : undefined;
  const hadGenericName = GENERIC_NAME.test(contact.name);
  const update: Record<string, unknown> = {};
  if (nameCandidate && hadGenericName) {
    name = nameCandidate.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    update.name = name;
  }
  const email = last.match(RE.email)?.[0];
  if (email && !contact.email) update.email = email;
  const interest = last.match(RE.interest)?.[1]?.trim();
  if (interest && !contact.fields.interest) update.interest = interest;
  const bm = last.match(RE.budget);
  const budgetNum = bm ? (bm[1] ?? bm[3]) : undefined;
  if (budgetNum && !contact.fields.budget) {
    const unit = (bm![2] ?? bm![4]) ? ` ${(bm![2] ?? bm![4])}` : "";
    update.budget = `${budgetNum}${unit}`;
  }
  if (Object.keys(update).length && !skip.has("update_lead")) exec({ name: "update_lead", input: update });

  // 2. Dynamic tags
  const tag = (cond: boolean, t2: string) => cond && exec({ name: "add_tag", input: { tag: t2 } });
  tag(RE.price.test(last), "precio-consultado");
  tag(!!budgetNum, "con-presupuesto");
  tag(RE.urgency.test(last), "urgente");
  tag(RE.demo.test(last), "quiere-demo");
  tag(RE.buy.test(last), "listo-para-comprar");
  tag(RE.human.test(last), "pidio-humano");
  tag(lang === "es", "idioma-es");
  const firstWord = (update.interest as string | undefined)?.split(/\s+/)[0]?.toLowerCase().replace(/[^a-záéíóúñ0-9]/g, "");
  if (firstWord && firstWord.length > 2) tag(true, `interes-${firstWord}`);

  // 3. Lead score (idempotent: recomputed from the whole customer history)
  const known = { name: !GENERIC_NAME.test(name), email: !!(contact.email || email) };
  const computed = scoreFromHistory(history, known);
  const scoreSkipped = skip.has("set_lead_score");
  if (!scoreSkipped) exec({ name: "set_lead_score", input: { score: computed, reason: "recalculado a partir de la conversación" } });
  const score = scoreSkipped ? (ctx.crm.getContact(contact.id)?.score ?? computed) : computed;

  // 4. Stage decision: leads only move forward, never out of won/lost
  const current = stages.find((s) => s.id === contact.stage_id)!;
  const hardNo = RE.hardNo.test(last);
  const wantsBuy = RE.buy.test(last);
  let level: Level | null = null;
  if (hardNo) level = "lost";
  else if (wantsBuy && score >= 70) level = "won";
  else if (wantsBuy || score >= 55) level = "negotiating";
  else if (score >= 30) level = "interested";
  else if (incoming.length >= 1) level = "qualifying";
  if (level && !skip.has("move_stage") && !current.is_won && !current.is_lost) {
    const target = stageForLevel(stages, level);
    if (target && target.id !== current.id && (level === "lost" || target.position > current.position)) {
      exec({ name: "move_stage", input: { stage_name: target.name, reason: `nivel ${level}, puntaje ${score}` } });
    }
  }
  return { lang, name, known, hardNo, wantsBuy, interest, last };
}

/** Fills whatever the LLM did not record (identified by the tool names it already called). */
export function applyGuardrails(ctx: AgentContext, exec: Exec, called: Set<string>): void {
  const fresh = ctx.crm.getContact(ctx.contact.id);
  if (!fresh) return;
  const s = applySignals({ ...ctx, contact: fresh, stage: ctx.crm.getStage(fresh.stage_id) ?? ctx.stage }, exec, called);
  if (RE.human.test(s.last) && !called.has("handoff_to_human")) exec({ name: "handoff_to_human", input: { reason: "el cliente pidió un humano" } });
}

export const localProvider: AiProvider = {
  name: "local-engine",
  async run(ctx, exec) {
    const sig = applySignals(ctx, exec);
    const { contact } = ctx;
    const { name, known, hardNo, wantsBuy, interest, last } = sig;
    const t = T[sig.lang];

    // Reply, shaped by the (possibly new) effective mode
    if (RE.human.test(last)) {
      exec({ name: "handoff_to_human", input: { reason: "el cliente pidió un humano" } });
      return t.handoff;
    }
    if (hardNo) return t.bye;
    const fresh = ctx.crm.getContact(contact.id)!;
    const effective = ctx.crm.aiModeFor(fresh);
    const nameForReply = name.split(" ")[0] || "";
    if (wantsBuy && ctx.crm.getStage(fresh.stage_id)?.is_won) return t.won(nameForReply);
    if (effective === "close_aggressive") return t.close(nameForReply);
    if (effective === "support") return t.support(nameForReply);
    if (effective === "nurture") return t.nurture(nameForReply);
    // qualify: ask for the next missing fact
    if (!known.name) return RE.price.test(last) ? `${t.price} ${t.askName}` : t.askName;
    if (!fresh.fields.interest && !interest) return t.askInterest(nameForReply);
    if (!fresh.fields.budget) return RE.price.test(last) ? `${t.price} ${t.askBudget}` : t.askBudget;
    if (!fresh.email) return t.askEmail;
    return t.nurture(nameForReply);
  },
};

// ---------------------------------------------------------------------------------------------
// Anthropic provider (real tool-calling over the Messages API)
// ---------------------------------------------------------------------------------------------

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function promptBlocks(ctx: AgentContext) {
  const { contact, stage, stages, mode, business: b } = ctx;
  const modeText: Record<AiMode, string> = {
    qualify: "Qualify the lead: learn name, need, budget and email, one question at a time.",
    nurture: "Nurture the lead: build trust, answer questions, propose a demo or next step.",
    close_aggressive: "Close aggressively but honestly: create urgency with real deadlines, ask for the sale, send the payment step.",
    support: "Support the customer: solve the problem, keep it short, escalate if you cannot.",
  };
  const profile = [
    b.name && `Business: ${b.name}`,
    b.description && `About the business: ${b.description}`,
    b.tone && `Tone of voice: ${b.tone}`,
    b.language && `Preferred language: ${b.language} (still answer in the language the customer writes in)`,
    b.hours && `Business hours: ${b.hours}`,
    b.goals && `Main goal of every conversation: ${b.goals}`,
    b.handoff_rules && `Hand the conversation to a human when: ${b.handoff_rules}`,
  ]
    .filter(Boolean)
    .join("\n");
  const kb = ctx.knowledge.length
    ? `Knowledge base (the only source for products, prices, policies and availability):\n${ctx.knowledge.map((k) => `### ${k.title}\n${k.content}`).join("\n\n")}`
    : "Knowledge base: empty. You have no price or product data, so do not quote any.";
  return {
    profile,
    kb,
    modeLine: `Current mode: ${mode}. ${modeText[mode]}`,
    intensity: `Commercial intensity for this stage: ${stage.ai_temperature}/100 (0 = soft and consultative, 100 = maximum sales pressure).`,
    playbook: stage.ai_prompt ? `Playbook for stage "${stage.name}": ${stage.ai_prompt}` : "",
    funnel: `Funnel stages and when to move into them:\n${stages.map((s) => `- ${s.name}${s.is_won ? " (won)" : ""}${s.is_lost ? " (lost)" : ""}: ${s.stage_rule || "no rule"}`).join("\n")}`,
    lead: `Lead now: name=${contact.name}; email=${contact.email || "-"}; stage=${stage.name}; score=${contact.score}; tags=${contact.tags.join(",") || "-"}; fields=${JSON.stringify(contact.fields)}.`,
  };
}

/** Prompt for providers that run a single tool-calling loop (Anthropic). */
export function buildSystemPrompt(ctx: AgentContext): string {
  const p = promptBlocks(ctx);
  return [
    "You are the AI sales agent in a multi-channel inbox. Reply in the customer's language, in at most 3 short sentences, one question at a time.",
    "Use the tools to record what you learn, tag the lead, score it 0-100, and move it through the funnel. When you need tools, call them AND write your reply to the customer in that same response.",
    "Answer product, price and policy questions only from the knowledge base. Do not invent prices, discounts, stock, dates or policies. If the answer is not in the knowledge base, say you will check with the team and call handoff_to_human.",
    p.profile, p.kb, p.modeLine, p.intensity, p.playbook, p.funnel, p.lead,
    "If the customer asks for a human, call handoff_to_human.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const OBJECTION_EXAMPLES = [
  `Cliente: uff qué caro
Tú: uy, entiendo, no es poca plata
---
qué presupuesto manejabas? miramos qué se ajusta`,
  `Cliente: eso está muy costoso
Tú: te entiendo, es una decisión importante
---
qué tenías pensado invertir? a veces se puede organizar distinto`,
  `Cliente: en otro lado me lo hacen más barato
Tú: normal que compares, hazlo con calma
---
lo que sí te cuento es qué incluye lo nuestro, quieres que te lo explique?`,
];

const EXAMPLE_POOL = [
  `Cliente: hola buenas, cómo estás?
Tú: bien y tú? cuéntame qué necesitas`,
  `Cliente: cuánto cuesta el plan básico?
Tú: el básico está en $49 al mes
---
si quieres te cuento qué trae y vemos cuál te sirve más`,
  `Cliente: y tiene permanencia?
Tú: mmm eso no lo tengo a la mano
---
déjame confirmarlo con el equipo y te cuento`,
  `Cliente: puedo ir mañana?
Tú: claro, mañana sí hay cupo
---
en la mañana o en la tarde te queda mejor?`,
  `Cliente: lo voy a pensar
Tú: dale, sin afán
---
si te queda alguna duda me escribes y la resolvemos`,
  `Cliente: gracias
Tú: con gusto! cualquier cosa por aquí estoy`,
  `Cliente: no entendí
Tú: ay perdón, me expliqué mal
---
te lo digo más sencillo`,
];

/** One price-objection example plus two others, all rotating with the conversation so the tone does not become a template. */
function pickExamples(ctx: AgentContext): string[] {
  const turn = ctx.history.filter((m) => m.sender === "ai").length;
  return [OBJECTION_EXAMPLES[turn % OBJECTION_EXAMPLES.length]!, ...[0, 1].map((i) => EXAMPLE_POOL[(turn * 2 + i * 3) % EXAMPLE_POOL.length]!)];
}

function toneExamples(ctx: AgentContext): string {
  return `EJEMPLOS DEL TONO (de otro negocio, solo para captar el ritmo; no copies las frases, di lo tuyo con tus palabras). Las frases de empatía como "uy, entiendo" solo van cuando el cliente muestra molestia o sorpresa, no al responder una pregunta normal.\n${pickExamples(ctx).join("\n\n")}`;
}

/** Examples shorter than three meaningful words are too generic to count as copying. */
const words3 = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2).length >= 3;

/** The agent-side lines of the examples shown to the writer, to detect verbatim copying. */
function exampleReplies(blocks: string[]): string[] {
  const out: string[] = [];
  for (const b of blocks)
    for (const line of b.split("\n")) {
      const m = /^Tú:\s*(.*)$/.exec(line);
      const t = m ? m[1]! : line.startsWith("Cliente:") || line.trim() === "---" ? "" : line.trim();
      if (t) out.push(t);
    }
  return out;
}

function replyPromptParts(ctx: AgentContext, opts: { examples?: boolean }) {
  const { contact, stage, mode, business: b } = ctx;
  const agent = b.agent_name || "una asesora";
  const company = b.name || "la empresa";
  const modeText: Record<AiMode, string> = {
    qualify: "Estás conociendo al cliente: su nombre, qué necesita, presupuesto y correo, de a una pregunta, sin interrogarlo.",
    nurture: "Estás acompañando: genera confianza, resuelve dudas y propone un siguiente paso suave (por ejemplo la valoración).",
    close_aggressive: "Estás en cierre: ve directa a concretar (fecha, pago), con urgencia real pero sin presionar de más.",
    support: "Estás dando soporte: resuelve y sé breve; si no puedes, pasa con una persona del equipo.",
  };
  const profile = [
    b.description && `Qué es el negocio: ${b.description}`,
    b.tone && `Tono de la marca: ${b.tone}`,
    b.style_notes && `Notas de estilo del negocio: ${b.style_notes}`,
    b.hours && `Horario de atención: ${b.hours}`,
    b.goals && `Objetivo de cada conversación: ${b.goals}`,
    b.handoff_rules && `Pasas la conversación a una persona del equipo cuando: ${b.handoff_rules}`,
  ]
    .filter(Boolean)
    .join("\n");
  const kb = ctx.knowledge.length
    ? `Base de conocimiento (única fuente de productos, precios, políticas y disponibilidad):\n${ctx.knowledge.map((k) => `### ${k.title}\n${k.content}`).join("\n\n")}`
    : "Base de conocimiento: vacía. No tienes precios ni datos de productos, así que no menciones ninguno.";
  const said = ctx.history
    .filter((m) => m.sender === "ai" || m.sender === "human")
    .slice(-3)
    .map((m) => `- ${m.body.slice(0, 220)}`)
    .join("\n");

  const instructions = [
    `Eres ${agent}, quien atiende por chat a los clientes de ${company}. Escribe como una persona real chateando por WhatsApp, no como un asistente corporativo.`,
    `CÓMO SUENAS
- Cercana y natural, de tú a tú (tienes, puedes, quieres; nunca voseo como "tenés" o "podés"); cálida sin exagerar.
- Mensajes cortos, como se escribe en el celular: de 1 a 3 mensajes, cada uno de 3 a 15 palabras (casi nunca más). Si son varios, sepáralos con una línea que contenga solo ---
- Responde primero a lo que el cliente acaba de decir, tal cual (un saludo, una queja, un chiste, una duda) y solo después avanza.
- Usa expresiones de chat con naturalidad, sin abusar ni repetirlas seguido: "claro", "listo", "mira", "uy", "ay", "mmm", "te cuento", "con gusto", "dale", "tranqui", "entiendo", "la verdad". Son muletillas ocasionales, no van en todos los mensajes.
- Varía cómo empiezas y cómo terminas. No cierres siempre con una pregunta ni con la misma invitación a agendar.
- Sin listas, sin negritas, sin guiones largos, sin varias exclamaciones seguidas. A lo sumo una exclamación o un emoji cuando encaje, y solo si el cliente también los usa. A veces sin punto final.
- Usa el nombre del cliente de vez en cuando, no en cada mensaje. Si ya se saludaron, no vuelvas a saludar.`,
    `LO QUE NUNCA HACES
- Repetir datos, cifras o frases que ya dijiste. Si el cliente vuelve sobre un tema, responde a su duda concreta con algo nuevo (un matiz, un ejemplo, una pregunta) en vez de recitar otra vez el precio.
- Frases de call center: "gracias por escribirnos" (ni agradecer por escribir), "estimado cliente", "en qué puedo ayudarte hoy", "quedo atenta a tus comentarios", "como te mencioné".
- Añadir condiciones que no estén escritas, aunque suenen razonables: "sin intereses", "incluye…", "con garantía", "gratis". Si algo no está en la base de conocimiento, no lo afirmes.
- Inventar nada: no inventes precios, descuentos, intereses, plazos, experiencias personales ni datos que no estén en la base de conocimiento. Si falta un dato (por ejemplo los intereses de las cuotas), dilo con naturalidad y di que lo confirmas con el equipo para no darle algo errado.
- Presionar o suplicar. Cuando algo le parece caro, primero reconoce lo que siente ("uy, entiendo"), no lo contradigas ni repitas el precio; pregúntale qué esperaba o qué presupuesto maneja y muéstrale opciones reales de la base de conocimiento (cuotas, valoración gratis).
- Responder con sermón a una grosería: toma la molestia con calma y buen humor, y sigue ayudando.`,
    `LO QUE NO PUEDES HACER (todavía)
No puedes agendar ni confirmar citas, fechas u horas, ni enviar o prometer enlaces de pago, facturas o contratos: no hay calendario ni pagos conectados. Cuando el cliente elige un día u hora, agradécele, anota lo que prefiere, pídele su teléfono si falta y dile que una persona del equipo le confirma la hora exacta. Nunca inventes una hora ni un enlace.`,
    `SOBRE SER UNA IA
No finjas ser una persona. Si el cliente te pregunta en serio si eres un bot, una IA o una persona, respóndele con la verdad, en primera persona y de forma natural y breve (por ejemplo: "soy la asistente virtual de ${company}, y detrás hay un equipo humano") y sigue ayudando. Nunca niegues ser una IA, ni cuentes vivencias personales, ni digas que "estuviste" o "hiciste" cosas fuera del chat.`,
  ];
  const examples = opts.examples === false ? "" : toneExamples(ctx);
  const data = [
    profile,
    kb,
    `Estado de la conversación: ${modeText[mode]} Intensidad comercial en esta etapa: ${stage.ai_temperature}/100 (0 muy consultiva y suave, 100 muy enfocada en cerrar).${stage.ai_prompt ? ` Guía de la etapa "${stage.name}": ${stage.ai_prompt}` : ""}`,
    `Lo que sabes del cliente: nombre ${contact.name}; correo ${contact.email || "aún no lo tienes"}; datos ${JSON.stringify(contact.fields)}.`,
    said ? `Lo último que ya dijiste (no lo repitas):\n${said}` : "",
    "Escribe SOLO el mensaje para el cliente, sin comillas, sin explicar lo que haces y sin mostrar tu razonamiento.",
  ];
  return { instructions, examples, data, company };
}

/** Prompt of the call that only writes what the customer reads: a person chatting, not a corporate assistant. */
export function buildReplyPrompt(ctx: AgentContext, opts: { examples?: boolean } = {}): string {
  const p = replyPromptParts(ctx, opts);
  return [...p.instructions, p.examples, ...p.data].filter(Boolean).join("\n\n");
}

/** Only the instructions of the reply prompt (no business data): what must never show up in a customer message. */
export function replyInstructionText(ctx: AgentContext): string {
  const p = replyPromptParts(ctx, {});
  const allowed = `soy la asistente virtual de ${p.company}, y detrás hay un equipo humano`; // the suggested honest answer may be echoed
  return p.instructions.join("\n").replace(allowed, ""); // the examples are policed separately (copy guard)
}

/** Prompt of the call that records the lead in the CRM through one forced function. */
export function buildAnalysisPrompt(ctx: AgentContext): string {
  const p = promptBlocks(ctx);
  return [
    "Eres el analista de CRM de un agente de ventas. Lee la conversación y llama a update_crm con lo que el CLIENTE haya dicho: nombre, correo, interés, presupuesto; etiquetas cortas en español en kebab-case (máximo 4, por ejemplo pidio-descuento); score 0-100 según su intención de compra; stage_name con la etapa del embudo que corresponde ahora (solo avanza, nunca retrocedas; usa la etapa de descarte solo si el cliente rechaza claramente); needs_human=true (con handoff_reason) SOLO si el cliente pide hablar con una persona o se cumple claramente una regla de traspaso del negocio; una pregunta normal que la base de conocimiento responde (por ejemplo, si hay descuentos) NO es motivo de traspaso; también cuando el cliente propone, elige o confirma una fecha u hora para una cita o visita (todavía no hay calendario conectado: una persona debe confirmarla); en cualquier otro caso omite needs_human. La ficha del lead que ves abajo es solo contexto: no copies sus valores vacíos (un guion) ni el nombre genérico; omite los campos que el cliente no haya dicho. No inventes datos.",
    p.profile, p.funnel, p.lead,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function anthropicProvider(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): AiProvider {
  return {
    name: `anthropic:${model}`,
    async run(ctx, exec) {
      const messages: { role: "user" | "assistant"; content: unknown }[] = [];
      for (const m of ctx.history.slice(-HISTORY_LIMIT)) {
        if (m.sender === "system" || m.sender === "note") continue;
        const role = m.sender === "customer" ? "user" : "assistant";
        const prev = messages[messages.length - 1];
        if (prev && prev.role === role && typeof prev.content === "string") prev.content += `\n${m.body}`;
        else messages.push({ role, content: m.body });
      }
      if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: "(conversation started)" });
      let reply = "";
      const called = new Set<string>();
      const track: Exec = (c) => {
        called.add(c.name);
        return exec(c);
      };
      for (let step = 0; step < 5; step++) {
        const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model, max_tokens: 700, temperature: ctx.stage.ai_temperature / 100,
            system: buildSystemPrompt(ctx), tools: TOOL_SPECS, messages,
          }),
        });
        if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 160)}`);
        const data = (await res.json()) as { content: AnthropicBlock[]; stop_reason: string };
        const text = data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
        if (text) reply = text;
        const uses = data.content.filter((b) => b.type === "tool_use");
        if (data.stop_reason !== "tool_use" || uses.length === 0) break;
        messages.push({ role: "assistant", content: data.content });
        messages.push({
          role: "user",
          content: uses.map((u) => ({
            type: "tool_result",
            tool_use_id: u.id,
            content: track({ name: u.name ?? "", input: u.input ?? {} }),
          })),
        });
      }
      applyGuardrails(ctx, track, called);
      return reply;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// NVIDIA NIM provider (OpenAI-compatible chat completions)
//
// Measured with the real API: the hosted models are good writers but unreliable when given many
// tools at once (they mix arguments and leave the message empty). So one turn is two parallel calls:
//   1. reply   - plain completion, no tools: the message the customer reads.
//   2. analyst - one FORCED function (update_crm) that records the lead; mapped onto the CRM tools.
// Whatever the analyst misses is filled by the deterministic guardrails.
// ---------------------------------------------------------------------------------------------

export const NVIDIA_DEFAULT_MODELS = [
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "openai/gpt-oss-20b",
  "nvidia/nemotron-3-ultra-550b-a55b",
];

export interface NvidiaOptions {
  apiKey: string;
  models: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

export interface OpenAiOptions extends NvidiaOptions {
  /** reasoning_effort for the call that writes the reply (the CRM analyst always runs with reasoning off). */
  reasoning?: string;
}

type Role = "reply" | "analysis" | "ping";

/** Everything that differs between OpenAI-compatible vendors: endpoint, label and request shaping. */
interface ChatProviderOptions {
  label: "nvidia" | "openai";
  vendor: string;
  apiKey: string;
  models: string[];
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  tune: (model: string, role: Role, body: Record<string, unknown>) => Record<string, unknown>;
}

interface NvMessage {
  content?: string | null;
  tool_calls?: { id: string; type?: string; function: { name: string; arguments?: string } }[];
}

class FatalProviderError extends Error {}

const cleanModelText = (s: string | null | undefined): string =>
  (s ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "").trim();

const foldName = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Maps the analyst's update_crm arguments onto the CRM tools, with the same safety rules as the local engine. */
function runAnalysis(ctx: AgentContext, msg: NvMessage, exec: Exec): void {
  const call = msg.tool_calls?.find((c) => c.function.name === "update_crm");
  if (!call) return;
  let a: Record<string, unknown>;
  try {
    const parsed = JSON.parse(call.function.arguments || "{}");
    if (!parsed || typeof parsed !== "object") return;
    a = parsed as Record<string, unknown>;
  } catch {
    return; // malformed arguments: the guardrails take over
  }
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  // The analyst sees the lead card, so models sometimes echo its placeholders ("-", the generic name): drop those.
  const real = (v: unknown) => {
    const t = str(v);
    return t && !/^[-–—?]+$/.test(t) && !/^(n\/a|none|null|ninguno|desconocido|no indica)$/i.test(t) ? t : "";
  };
  const lead: Record<string, unknown> = {};
  const name = real(a.name);
  if (name && GENERIC_NAME.test(ctx.contact.name) && !GENERIC_NAME.test(name)) lead.name = name; // never replace a known name with a guess
  const email = real(a.email);
  if (email && /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(email) && email !== ctx.contact.email) lead.email = email;
  for (const k of ["interest", "budget"]) {
    const v = real(a[k]);
    if (v && v !== ctx.contact.fields[k]) lead[k] = v;
  }
  if (Object.keys(lead).length) exec({ name: "update_lead", input: lead });

  if (Array.isArray(a.tags)) for (const t of a.tags.slice(0, 5)) if (str(t, 32)) exec({ name: "add_tag", input: { tag: str(t, 32) } });

  if (typeof a.score === "number" && Number.isFinite(a.score)) exec({ name: "set_lead_score", input: { score: a.score, reason: "análisis del agente IA" } });

  const wanted = str(a.stage_name);
  if (wanted) {
    const current = ctx.stages.find((s) => s.id === ctx.contact.stage_id);
    const target = ctx.stages.find((s) => foldName(s.name) === foldName(wanted));
    const open = current && !current.is_won && !current.is_lost;
    if (target && current && open && target.id !== current.id && (target.is_lost || target.position > current.position))
      exec({ name: "move_stage", input: { stage_name: target.name, reason: "análisis del agente IA" } });
  }

  if (a.needs_human === true && real(a.handoff_reason)) exec({ name: "handoff_to_human", input: { reason: str(a.handoff_reason) } });
}

function chatProvider(o: ChatProviderOptions): AiProvider {
  const fetchImpl = o.fetchImpl ?? fetch;
  const base = o.baseUrl;
  const timeout = o.timeoutMs ?? 15_000;
  let last = o.models[0]!;
  const cooldown = new Map<string, number>(); // model -> unavailable until (ms epoch)

  /**
   * Tries the models in order. Unavailable ones (404/410/429/5xx/timeout) and answers that fail `valid`
   * (e.g. a reasoning model that spent every token thinking) are skipped; a rejected key aborts at once.
   */
  async function chat(
    body: Record<string, unknown>,
    valid: (m: NvMessage) => boolean,
    deadline: number,
    remember: boolean,
    role: Role,
  ): Promise<NvMessage> {
    const now = Date.now();
    const live = o.models.filter((m) => (cooldown.get(m) ?? 0) <= now);
    const order = live.length ? live : o.models; // if everything is cooling down, try anyway
    const errors: string[] = [];
    for (const model of order) {
      const left = deadline - Date.now();
      if (left < 1500) {
        errors.push(`${model}: sin tiempo`);
        break;
      }
      try {
        const res = await fetchImpl(`${base}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
          signal: AbortSignal.timeout(Math.min(timeout, left)),
          body: JSON.stringify({ ...o.tune(model, role, body), model }),
        });
        if (res.status === 401 || res.status === 403) throw new FatalProviderError(`${o.vendor} rechazó la clave (${res.status})`);
        if (!res.ok) {
          cooldown.set(model, Date.now() + (res.status === 404 || res.status === 410 ? 10 * 60_000 : 60_000));
          errors.push(`${model}: ${res.status}`);
          continue;
        }
        const msg = ((await res.json()) as { choices?: { message?: NvMessage }[] }).choices?.[0]?.message;
        if (!msg || !valid(msg)) {
          errors.push(`${model}: respuesta sin contenido útil`);
          continue;
        }
        if (remember) last = model;
        return msg;
      } catch (e) {
        if (e instanceof FatalProviderError) throw e;
        cooldown.set(model, Date.now() + 30_000);
        errors.push(`${model}: ${(e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message}`);
      }
    }
    throw new Error(`todos los modelos fallaron (${errors.join("; ")})`);
  }

  const crmTool = (stages: Stage[]) => ({
    type: "function",
    function: {
      name: "update_crm",
      description: "Registra en el CRM lo aprendido del cliente. Omite los campos que no apliquen.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nombre real del cliente, solo si lo dijo" },
          email: { type: "string" },
          interest: { type: "string", description: "Qué producto o servicio busca" },
          budget: { type: "string" },
          tags: { type: "array", items: { type: "string" }, description: "Hasta 4 etiquetas en español, kebab-case" },
          score: { type: "number", description: "Intención de compra, 0-100" },
          stage_name: { type: "string", enum: stages.map((s) => s.name) },
          needs_human: { type: "boolean", description: "true SOLO si el cliente pide una persona o se cumple una regla de traspaso del negocio; si no, false" },
          handoff_reason: { type: "string", description: "Motivo del traspaso; solo cuando needs_human es true. No escribas notas aquí." },
        },
      },
    },
  });

  return {
    get name() {
      return `${o.label}:${last}`;
    },
    models: o.models,
    async ping() {
      const t0 = Date.now();
      await chat({ messages: [{ role: "user", content: "Responde solo: ok" }], max_tokens: 24, temperature: 0 }, (m) => !!cleanModelText(m.content), Date.now() + 30_000, true, "ping");
      return { model: last, ms: Date.now() - t0 };
    },
    async run(ctx, exec) {
      const convo: { role: "user" | "assistant"; content: string }[] = [];
      for (const m of ctx.history.slice(-HISTORY_LIMIT)) {
        if (m.sender === "system" || m.sender === "note") continue;
        const role = m.sender === "customer" ? "user" : "assistant";
        const prev = convo[convo.length - 1];
        if (prev && prev.role === role) prev.content += `\n${m.body}`;
        else convo.push({ role, content: m.body });
      }
      if (convo[0]?.role !== "user") convo.unshift({ role: "user", content: "(inicio de la conversación)" });

      const deadline = Date.now() + 40_000;
      const temperature = 0.7; // natural variation; the commercial intensity is expressed in the prompt, not here
      const hasText = (m: NvMessage) => !!cleanModelText(m.content);
      const replyBody = (system: string) => ({ messages: [{ role: "system", content: system }, ...convo], temperature, max_tokens: 900 });
      const [reply, analysis] = await Promise.allSettled([
        chat(replyBody(buildReplyPrompt(ctx)), hasText, deadline, true, "reply"),
        chat(
          {
            messages: [{ role: "system", content: buildAnalysisPrompt(ctx) }, ...convo],
            tools: [crmTool(ctx.stages)],
            tool_choice: { type: "function", function: { name: "update_crm" } },
            temperature: 0.1,
            max_tokens: 700,
          },
          (m) => !!m.tool_calls?.some((c) => c.function.name === "update_crm"),
          deadline,
          false,
          "analysis",
        ),
      ]);

      // Record the lead first: it is valuable even if the reply failed.
      const called = new Set<string>();
      const track: Exec = (c) => {
        called.add(c.name);
        return exec(c);
      };
      if (analysis.status === "fulfilled") runAnalysis(ctx, analysis.value, track);
      applyGuardrails(ctx, track, called);

      if (reply.status === "rejected") throw reply.reason;
      let text = cleanModelText(reply.value.content);

      // Second chances: one rewrite per problem, each with a note that says exactly what was wrong.
      const rewrite = async (note: string, opts: { examples?: boolean } = {}): Promise<string | null> => {
        try {
          const t = cleanModelText((await chat(replyBody(buildReplyPrompt(ctx, opts) + note), hasText, deadline, true, "reply")).content);
          return t || null;
        } catch {
          return null;
        }
      };

      const SAFE = "eso prefiero confirmártelo con el equipo para no darte un dato errado";

      // Instructions must never reach the customer. One rewrite without the examples; if it leaks again, say nothing risky and call a person.
      const instructionText = replyInstructionText(ctx);
      if (text && sharesPhrase(text, instructionText)) {
        const t = await rewrite("\n\nATENCIÓN: tu borrador contiene instrucciones internas. Escribe SOLO lo que le dirías al cliente en el chat, con tus propias palabras.", { examples: false });
        if (t && !sharesPhrase(t, instructionText)) text = t;
        else {
          text = SAFE;
          track({ name: "handoff_to_human", input: { reason: "la IA filtró instrucciones internas" } });
        }
      }

      // A person does not recite the same figures twice (checked on the whole draft and on each bubble).
      const prior = ctx.history.filter((m) => m.sender === "ai" || m.sender === "human").slice(-3).map((m) => m.body);
      const repeated = (t: string) =>
        prior.some((p) => similarity(t, p) > 0.55) || splitBubbles(t).some((bubble) => bubble.split(/\s+/).length >= 4 && prior.some((p) => similarity(bubble, p) > 0.6));
      if (text && text !== SAFE && repeated(text)) {
        const t = await rewrite(`\n\nATENCIÓN: tu borrador ("${text.slice(0, 160)}") repite lo que ya dijiste. Reescríbelo: reacciona a lo último que dijo el cliente y avanza la conversación sin repetir cifras ni frases.`);
        if (t) text = t;
      }

      // The tone examples are from another business: copying them line by line is the clearest tell.
      const examples = exampleReplies(pickExamples(ctx));
      const copied = (t: string) => examples.some((e) => words3(e) && coverage(e, t) >= 0.8);
      if (text && text !== SAFE && copied(text)) {
        const t = await rewrite("\n\nATENCIÓN: tu borrador copia una frase de los ejemplos del tono. Los ejemplos son de otro negocio: responde con tus propias palabras a lo que acaba de decir el cliente.", { examples: false });
        if (t) text = t;
      }

      // Facts check: amounts, times, payment links and conditions must come from the knowledge base or the customer's own words.
      if (text && text !== SAFE) {
        const kb = ctx.knowledge.map((k) => `${k.title} ${k.content}`);
        const heard = [
          ...ctx.history.filter((m) => m.sender === "customer").map((m) => m.body),
          JSON.stringify(ctx.contact.fields),
          ctx.business.description, ctx.business.goals, ctx.business.hours, ctx.business.style_notes,
        ];
        const bad = findUnsupportedClaims(text, kb, heard);
        if (bad.length) {
          const t = await rewrite(`\n\nATENCIÓN: tu borrador ("${text.slice(0, 160)}") afirma cosas que no están en la base de conocimiento o que no puedes cumplir: ${bad.join(", ")}. Quítalas: si el cliente pregunta por eso, di que lo confirma una persona del equipo para no darle un dato errado.`);
          if (t && !findUnsupportedClaims(t, kb, heard).length) text = t;
          else {
            text = SAFE;
            track({ name: "handoff_to_human", input: { reason: "la IA no pudo responder sin inventar datos" } });
          }
        }
      }
      return text;
    },
  };
}

export function nvidiaProvider(o: NvidiaOptions): AiProvider {
  return chatProvider({
    label: "nvidia",
    vendor: "NVIDIA",
    apiKey: o.apiKey,
    models: o.models,
    baseUrl: o.baseUrl ?? "https://integrate.api.nvidia.com/v1",
    fetchImpl: o.fetchImpl,
    timeoutMs: o.timeoutMs,
    // the nemotron-3.5 reasoning models answer in ~1 s with thinking switched off
    tune: (model, _role, body) => (/nemotron-3\.5/.test(model) ? { ...body, chat_template_kwargs: { enable_thinking: false } } : body),
  });
}

export const OPENAI_DEFAULT_MODELS = ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-nano"];

/**
 * OpenAI chat completions. The luna/5.x reasoning models reject `temperature` and `max_tokens`, count reasoning
 * towards `max_completion_tokens`, and cannot combine function tools with reasoning: the reply is written with
 * low reasoning and the CRM analyst (forced function) runs with reasoning off.
 */
export function openaiProvider(o: OpenAiOptions): AiProvider {
  const effort = o.reasoning || "low";
  return chatProvider({
    label: "openai",
    vendor: "OpenAI",
    apiKey: o.apiKey,
    models: o.models,
    baseUrl: o.baseUrl ?? "https://api.openai.com/v1",
    fetchImpl: o.fetchImpl,
    timeoutMs: o.timeoutMs ?? 20_000,
    tune: (_model, role, body) => {
      const { temperature: _t, max_tokens, ...rest } = body as { temperature?: number; max_tokens?: number } & Record<string, unknown>;
      return { ...rest, max_completion_tokens: role === "reply" ? Math.max(Number(max_tokens) || 0, 1500) : Number(max_tokens) || 700, reasoning_effort: role === "reply" ? effort : "none" };
    },
  });
}

/** Tries the providers in order; the first one that answers wins and `name` reports who it was. */
export function chainProviders(list: AiProvider[]): AiProvider {
  if (list.length === 1) return list[0]!;
  let active = list[0]!;
  return {
    get name() {
      return active.name;
    },
    models: list.flatMap((p) => p.models ?? [p.name]),
    async ping() {
      let last: unknown;
      for (const p of list) {
        try {
          const r = p.ping ? await p.ping() : { model: p.name, ms: 0 };
          active = p;
          return r;
        } catch (e) {
          last = e;
        }
      }
      throw last;
    },
    async run(ctx, exec) {
      let last: unknown;
      for (const p of list) {
        try {
          const reply = await p.run(ctx, exec);
          active = p;
          return reply;
        } catch (e) {
          last = e;
        }
      }
      throw last;
    },
  };
}

const firstEnv = (env: Record<string, string | undefined>, names: string[]) => names.map((n) => env[n]).find((v) => !!v);
const list = (v: string | undefined) => (v ?? "").split(",").map((m) => m.trim()).filter(Boolean);
const withDefaults = (chosen: string[], defaults: string[]) => [...chosen, ...defaults.filter((m) => !chosen.includes(m))];

/**
 * Picks the AI engine from the environment. Without AI_PROVIDER: OpenAI first, NVIDIA and Anthropic as fallbacks,
 * and the local rule engine only when no key exists. AI_PROVIDER (openai | nvidia | anthropic | local) forces one.
 */
export function makeProvider(env: Record<string, string | undefined> = process.env): AiProvider {
  const mode = env.AI_PROVIDER?.toLowerCase();
  if (mode === "local") return localProvider;
  const openaiKey = env.OPENAI_API_KEY;
  const nvKey = firstEnv(env, ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY", "NVIDIA", "Nvidia"]);
  const anKey = env.ANTHROPIC_API_KEY;
  const providers: AiProvider[] = [];
  if (openaiKey && (!mode || mode === "openai"))
    providers.push(openaiProvider({ apiKey: openaiKey, models: withDefaults(list(env.OPENAI_MODEL), OPENAI_DEFAULT_MODELS), reasoning: env.OPENAI_REASONING }));
  if (nvKey && (!mode || mode === "nvidia"))
    providers.push(nvidiaProvider({ apiKey: nvKey, models: withDefaults(list(env.NVIDIA_MODEL), NVIDIA_DEFAULT_MODELS) }));
  if (anKey && (!mode || mode === "anthropic")) providers.push(anthropicProvider(anKey, env.AI_MODEL || "claude-haiku-5-5"));
  return providers.length ? chainProviders(providers) : localProvider;
}
