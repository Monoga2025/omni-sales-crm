import type { Contact, Crm } from "./crm.js";

/**
 * "Embudo Contadores D1-D2-D3": a second funnel that lives next to the default one.
 * Contacts are told apart by the `embudo-contadores` tag; that tag also selects the business profile
 * and knowledge base the agent uses, so the default (clinic) funnel is never touched.
 */
export const CONTADORES_PROFILE = "contadores";
export const CONTADORES_TAG = "embudo-contadores";

export type Trigger = "D1" | "D2" | "D3";

const RANK: Record<Trigger, number> = { D1: 1, D2: 2, D3: 3 };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * D1/D2/D3 anywhere in the message (the highest one wins). "de uno" and "dedos" are the spoken forms of
 * D1 and D2, so they only count when they are (almost) the whole message: "me duelen los dedos" is not a lead.
 */
export function detectTrigger(text: string): Trigger | null {
  let best: Trigger | null = null;
  const bump = (t: Trigger) => {
    if (!best || RANK[t] > RANK[best]) best = t;
  };
  for (const m of text.matchAll(/(?<![\p{L}\p{N}])d\s?([123])(?![\p{L}\p{N}])/giu)) bump(`D${m[1]}` as Trigger);
  const words = fold(text).split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length > 0 && words.length <= 3) {
    const flat = words.join(" ");
    if (/\bde uno\b/.test(flat)) bump("D1");
    if (/\bdedos\b/.test(flat)) bump("D2");
  }
  return best;
}

interface TriggerSpec {
  stage: string;
  score: number;
  tags: string[];
  interest: string;
  linkEnv: string;
  /** Chat bubbles; `{{link}}` is replaced with the configured link. */
  bubbles: string[];
}

const SPECS: Record<Trigger, TriggerSpec> = {
  D1: {
    stage: "Contadores · Interesado DIAN",
    score: 35,
    tags: ["lead-contador-d1", "interes-agente-tributario"],
    interest: "Sistema 1 (Agente IA DIAN)",
    linkEnv: "CONTADORES_LINK_D1",
    bubbles: [
      "¡Hola colega! 📊 Aquí tienes el acceso al Sistema 1 (Agente Estatuto Tributario & DIAN) entrenado con conceptos vigentes 2026. Te responde artículos y cálculos de exógena en 3 segundos: {{link}}",
      "¿Manejas clientes personas naturales o jurídicas principalmente?",
    ],
  },
  D2: {
    stage: "Contadores · Interesado Extractor",
    score: 50,
    tags: ["lead-contador-d2", "dolor-digitacion"],
    interest: "Sistema 1 + Sistema 2 (Agente DIAN + Extractor PDF/Fotos a Excel)",
    linkEnv: "CONTADORES_LINK_D2",
    bubbles: [
      "¡Buenísimo! 🚀 Te preparé el acceso a los 2 Sistemas: 1️⃣ el Agente Tributario DIAN y 2️⃣ el Extractor Inteligente de Tirillas y WhatsApp a Excel para Siigo/Alegra. Descárgalos aquí: {{link}}",
      "¿Actualmente digitas facturas a mano en tu despacho?",
    ],
  },
  D3: {
    stage: "Contadores · Cierre / Demo",
    score: 75,
    tags: ["lead-contador-vip-d3", "alta-intencion-compra"],
    interest: "Sistemas 1 + 2 + 3 (Agente DIAN + Extractor + Conciliador Bancario)",
    linkEnv: "CONTADORES_LINK_D3",
    bubbles: [
      "¡Excelente jugada! ⚡ Quieres el despacho en piloto automático completo: 1️⃣ Agente DIAN, 2️⃣ Extractor de Facturas/Tirillas a Excel y 3️⃣ Conciliador Bancario Automático (Bancolombia/Davivienda). Aquí tienes el paquete completo: {{link}}",
      "Además, como pediste los 3, ¿quieres que agendemos 15 min y te muestro cómo conectarlo a tu Siigo/Alegra en vivo?",
    ],
  },
};

/** The business profile the agent must use for this contact. "" is the default business. */
export function profileOf(contact: Pick<Contact, "tags">): string {
  return contact.tags.includes(CONTADORES_TAG) ? CONTADORES_PROFILE : "";
}

/** Creates the funnel's stages, business profile, knowledge and rules. Safe to call repeatedly; never edits what already exists. */
export function ensureContadoresFunnel(crm: Crm): void {
  const stages = crm.listStages();
  const mk = (name: string, color: string, patch: Parameters<Crm["updateStage"]>[1]) => {
    if (stages.some((s) => s.name === name)) return;
    const s = crm.createStage(name);
    crm.updateStage(s.id, { color, ...patch });
  };
  mk(SPECS.D1.stage, "#14b8a6", {
    ai_mode: "nurture", ai_temperature: 50,
    ai_prompt: "El contador pidió el Sistema 1 (Agente IA DIAN). Confirma que le llegó el acceso y averigua si maneja personas naturales o jurídicas. Una pregunta por mensaje.",
    stage_rule: "Entra aquí solo cuando el contador escribe D1 (o 'de uno').",
  });
  mk(SPECS.D2.stage, "#06b6d4", {
    ai_mode: "nurture", ai_temperature: 55,
    ai_prompt: "El contador pidió los Sistemas 1 y 2. Averigua cuántas facturas o tirillas digita al mes y con qué software contable trabaja (Siigo, Alegra u otro).",
    stage_rule: "Entra aquí solo cuando el contador escribe D2 (o 'dedos').",
  });
  mk(SPECS.D3.stage, "#f97316", {
    ai_mode: "nurture", ai_temperature: 70,
    ai_prompt: "El contador pidió los 3 sistemas: es un lead caliente. Propón una demo en vivo de 15 minutos conectada a su Siigo/Alegra y coordina el día y la hora. No des precios: se confirman en la demo.",
    stage_rule: "Entra aquí solo cuando el contador escribe D3. Lead caliente: pasa directo a demo.",
  });

  if (!crm.hasBusiness(CONTADORES_PROFILE)) {
    crm.setBusiness(
      {
        name: "Loovo — Sistemas para despachos contables",
        agent_name: "Asistente Loovo",
        description:
          "Loovo construye sistemas de IA para contadores y despachos contables en Colombia: Sistema 1 (Agente Estatuto Tributario & DIAN), Sistema 2 (Extractor de tirillas y facturas de WhatsApp a Excel para Siigo/Alegra) y Sistema 3 (Conciliador Bancario Automático para Bancolombia y Davivienda).",
        tone: "colega a colega, directo y breve; tutea; vocabulario contable colombiano (DIAN, exógena, Siigo, Alegra)",
        style_notes: "colombiano, profesional y cercano; llama 'colega' al contador; nada de lenguaje de call center",
        goals: "Calificar al contador (personas naturales o jurídicas, si digita facturas a mano) y agendar una demo de 15 minutos",
        handoff_rules: "el contador pide precio final, contrato o factura, quiere hablar con una persona o reporta un problema con un sistema",
      },
      CONTADORES_PROFILE,
    );
  }
  if (crm.listKnowledge(CONTADORES_PROFILE).length === 0) {
    const k = (title: string, content: string) => crm.addKnowledge(title, content, CONTADORES_PROFILE);
    k("Sistema 1: Agente Tributario & DIAN", "Agente de IA entrenado con el Estatuto Tributario y conceptos DIAN vigentes 2026. Responde artículos y cálculos de exógena en unos 3 segundos.");
    k("Sistema 2: Extractor de tirillas y facturas", "Convierte PDF, fotos, tirillas y facturas recibidas por WhatsApp en filas de Excel listas para Siigo o Alegra, sin digitar a mano.");
    k("Sistema 3: Conciliador Bancario Automático", "Concilia los movimientos bancarios (Bancolombia y Davivienda) con la contabilidad de forma automática.");
    k("Oferta VIP D3", "Pack completo con los 3 sistemas (Agente DIAN, Extractor y Conciliador Bancario) más una auditoría del despacho. Se presenta en una demo en vivo de 15 minutos conectada a Siigo o Alegra.");
    k("Precios y condiciones", "No hay precios publicados. Si preguntan por precio, di que se define en la demo de 15 minutos según el tamaño del despacho. No inventes cifras ni descuentos.");
  }

  const ruleName = "Contador VIP D3 es lead caliente";
  if (!crm.listRules().some((r) => r.name === ruleName)) {
    crm.createRule({
      name: ruleName, trigger_type: "tag_added", trigger_stage_id: null, trigger_value: "lead-contador-vip-d3",
      action_type: "add_tag", action_value: "lead-caliente", enabled: true,
    });
  }
}

export interface FunnelOutcome {
  trigger: Trigger;
  /** Bubbles to send. Empty when nothing should be auto-sent (human owns the chat, already sent, or link missing). */
  parts: string[];
}

/** Tags, scores and moves the contact for a D1/D2/D3 trigger and returns the canned reply to send, if any. */
export function applyFunnelTrigger(
  crm: Crm,
  contactId: number,
  trigger: Trigger,
  env: Record<string, string | undefined> = process.env,
): FunnelOutcome | null {
  const contact = crm.getContact(contactId);
  if (!contact) return null;
  ensureContadoresFunnel(crm);
  const spec = SPECS[trigger];

  const already = crm.events(contactId).some((e) => e.type === "funnel_trigger" && e.data.trigger === trigger);
  crm.logEvent(contactId, "funnel_trigger", { funnel: CONTADORES_PROFILE, trigger, repeated: already }, "rule");

  crm.addTag(contactId, CONTADORES_TAG, "rule");
  for (const t of spec.tags) crm.addTag(contactId, t, "rule");
  crm.setFields(contactId, { disparador: trigger, interes: spec.interest }, "rule");
  crm.setScore(contactId, Math.max(contact.score, spec.score), "rule");

  // A later trigger never drags a lead backwards (D1 after D3) or out of a won deal.
  const stages = crm.listStages();
  const current = stages.find((s) => s.id === crm.getContact(contactId)!.stage_id);
  const target = stages.find((s) => s.name === spec.stage)!;
  const currentRank = (Object.keys(SPECS) as Trigger[]).find((t) => SPECS[t].stage === current?.name);
  const keep = current?.is_won || (currentRank !== undefined && RANK[currentRank] >= RANK[trigger]);
  if (!keep) crm.moveStage(contactId, target.id, "rule");

  if (already || crm.getContact(contactId)!.handler === "human") return { trigger, parts: [] };

  const link = env[spec.linkEnv]?.trim();
  if (!link) {
    // Never send a placeholder to a customer and never leave the lead in silence.
    crm.handoff(contactId, `falta configurar ${spec.linkEnv}: el contador pidió ${trigger} y no hay enlace que enviar`, "rule");
    return { trigger, parts: [] };
  }
  return { trigger, parts: spec.bubbles.map((b) => b.replaceAll("{{link}}", link)) };
}
