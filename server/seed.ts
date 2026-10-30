import type { Crm, Sender } from "./crm.js";

const DAY = 86_400_000;

type Msg = [Sender, string, Record<string, unknown>?];
const tc = (name: string, input: Record<string, unknown>, result: string) => ({ name, input, result });

interface Demo {
  name: string; phone: string; channel: string; ago: number; stage: string; score: number;
  tags: string[]; budget?: string; human?: boolean; msgs: Msg[];
}

/** Seeds stages, rules and demo conversations. Runs only on an empty database. */
export function seedIfEmpty(crm: Crm, now = Date.now(), opts: { demoContacts?: boolean } = {}): boolean {
  const n = Number((crm.db.prepare("SELECT COUNT(*) AS c FROM stages").get() as { c: number }).c);
  if (n > 0) return false;

  const ids: Record<string, number> = {};
  const mk = (name: string, color: string, patch: Parameters<Crm["updateStage"]>[1]) => {
    const s = crm.createStage(name);
    crm.updateStage(s.id, { color, ...patch });
    ids[name] = s.id;
    return s.id;
  };
  mk("Nuevo", "#71717a", {
    is_default: true, ai_mode: "qualify", ai_temperature: 30,
    ai_prompt: "Saluda con calidez, averigua el nombre y qué necesita. Una pregunta por mensaje.",
    stage_rule: "Toda conversación nueva empieza aquí.",
  });
  mk("Calificando", "#0ea5e9", {
    ai_mode: "qualify", ai_temperature: 40,
    ai_prompt: "Recoge necesidad, presupuesto y correo. No des precios todavía.",
    stage_rule: "Mover aquí cuando el cliente respondió al menos una vez.",
  });
  mk("Interesado", "#8b5cf6", {
    ai_mode: "nurture", ai_temperature: 55,
    ai_prompt: "Explica el valor en dos frases y propone una demo corta.",
    stage_rule: "Mover aquí cuando exprese una necesidad clara o el puntaje llegue a 30.",
  });
  mk("Negociación", "#f59e0b", {
    ai_mode: "close_aggressive", ai_temperature: 90,
    ai_prompt: "Crea urgencia con la oferta de 24 h, resuelve objeciones, pide la venta y envía el enlace de pago.",
    stage_rule: "Mover aquí cuando pida precio con presupuesto, diga que quiere comprar o el puntaje llegue a 55.",
  });
  mk("Ganado", "#10b981", {
    is_won: true, ai_mode: "support", ai_temperature: 20,
    ai_prompt: "Confirma la compra, explica el onboarding y queda disponible para soporte.",
    stage_rule: "Mover aquí cuando confirme la compra y el puntaje sea 70 o más.",
  });
  mk("Perdido", "#ef4444", {
    is_lost: true, ai_mode: "nurture", ai_temperature: 10,
    ai_prompt: "No insistas. Agradece y deja la puerta abierta.",
    stage_rule: "Mover aquí cuando diga claramente que no le interesa.",
  });

  // Demo business so the agent has something real to sell. Customers replace this from the settings screen.
  crm.setBusiness({
    name: "Sonrisa Digital",
    agent_name: "Sofi",
    style_notes: "colombiana de Bogotá, cálida y directa; usa de vez en cuando listo, claro que sí, con gusto, mira, uy; tutea; nada de lenguaje de call center",
    description: "Clínica odontológica en Bogotá especializada en estética dental y ortodoncia.",
    tone: "cercano, profesional y breve; tutea al cliente",
    hours: "Lunes a viernes 8:00-18:00, sábados 9:00-13:00",
    goals: "Agendar una valoración gratuita de 30 minutos",
    handoff_rules: "el cliente negocia un descuento fuera de los precios publicados o reporta una urgencia médica",
  });
  crm.addKnowledge("Blanqueamiento dental", "Blanqueamiento en consultorio: $350.000 COP, dura 60 minutos, resultados desde la primera sesión. Incluye valoración previa.");
  crm.addKnowledge("Ortodoncia", "Brackets metálicos desde $2.800.000 COP en total (cuotas mensuales de $180.000 COP). Alineadores invisibles desde $5.500.000 COP. La valoración es gratuita.");
  crm.addKnowledge("Limpieza y revisión", "Limpieza dental con revisión: $90.000 COP, dura 40 minutos. Se recomienda cada 6 meses.");
  crm.addKnowledge("Ubicación y pagos", "Estamos en Chapinero, Bogotá (Cra 13 # 63-20). Aceptamos efectivo, tarjetas y transferencia. No hay descuentos fuera de los precios publicados.");

  crm.createRule({
    name: "Recordatorio de oferta", trigger_type: "stage_enter", trigger_stage_id: ids["Negociación"]!, trigger_value: "",
    action_type: "send_message", enabled: false, // a templated message in the middle of a chat reads robotic; enable it deliberately
    action_value: "Hola {{name}}, te reservé la oferta vigente por 24 horas. ¿Te envío el enlace de pago?",
  });
  crm.createRule({
    name: "Bienvenida al nuevo cliente", trigger_type: "stage_enter", trigger_stage_id: ids["Ganado"]!, trigger_value: "",
    action_type: "send_message", enabled: true,
    action_value: "¡Bienvenido, {{name}}! Ya te enviamos los pasos de tu onboarding.",
  });
  crm.createRule({
    name: "Etiquetar clientes", trigger_type: "stage_enter", trigger_stage_id: ids["Ganado"]!, trigger_value: "",
    action_type: "add_tag", action_value: "cliente", enabled: true,
  });
  crm.createRule({
    name: "Marcar leads calientes", trigger_type: "score_gte", trigger_stage_id: null, trigger_value: "70",
    action_type: "add_tag", action_value: "lead-caliente", enabled: true,
  });
  crm.createRule({
    name: "VIP pasa a un humano", trigger_type: "tag_added", trigger_stage_id: null, trigger_value: "vip",
    action_type: "handoff", action_value: "Cliente VIP", enabled: true,
  });

  const demo: Demo[] = [
    { name: "Laura Gómez", phone: "+57 300 555 5000", channel: "whatsapp", ago: 6, stage: "Ganado", score: 92, budget: "4500", tags: ["cliente", "precio-consultado", "lead-caliente"],
      msgs: [["customer", "Hola, necesito un CRM para mi tienda"], ["ai", "¡Hola Laura! ¿Qué presupuesto aproximado tienes?", { tool_calls: [tc("update_lead", { name: "Laura Gómez", interest: "CRM para tienda" }, "lead actualizado"), tc("set_lead_score", { score: 34 }, "puntaje fijado en 34")] }], ["customer", "Quiero comprar hoy, mi correo es contacto005@example.com"]] },
    { name: "Mark Fischer", phone: "+1 415 555 0132", channel: "instagram", ago: 5, stage: "Negociación", score: 68, budget: "$2,000", tags: ["precio-consultado", "con-presupuesto"],
      msgs: [["customer", "¿Cuánto cuesta el plan Pro?"], ["ai", "Depende del plan. ¿Con qué presupuesto cuentas?", { tool_calls: [tc("add_tag", { tag: "precio-consultado" }, "etiqueta añadida"), tc("set_lead_score", { score: 41 }, "puntaje fijado en 41")] }], ["customer", "Hasta $2k"], ["note", "Cliente pide factura en USD. Confirmar con finanzas."]] },
    { name: "Sofía Ramírez", phone: "+52 55 5550 0144", channel: "whatsapp", ago: 4, stage: "Interesado", score: 41, budget: "1.200", tags: ["quiere-demo"],
      msgs: [["customer", "Busco automatizar mis respuestas"], ["ai", "¡Genial! ¿Te agendo una demo rápida?", { tool_calls: [tc("move_stage", { stage_name: "Interesado" }, "movido a Interesado")] }]] },
    { name: "Daniel Ortiz", phone: "+57 300 555 5001", channel: "messenger", ago: 3, stage: "Calificando", score: 22, tags: [],
      msgs: [["customer", "Buenas"], ["ai", "¡Hola! ¿Cómo te llamas?"]] },
    { name: "Priya Shah", phone: "+91 98 5550 0166", channel: "web-chat", ago: 2, stage: "Perdido", score: 8, tags: ["perdido"],
      msgs: [["customer", "No me interesa, gracias"], ["ai", "Entendido, sin problema. ¡Que tengas un gran día!"]] },
    { name: "Visitante 4821", phone: "", channel: "web-chat", ago: 0, stage: "Nuevo", score: 0, tags: [], msgs: [["customer", "Hola"]] },
    { name: "Andrés Molina", phone: "+57 300 555 5002", channel: "whatsapp", ago: 8, stage: "Ganado", score: 88, budget: "3k", tags: ["cliente", "urgente"],
      msgs: [["customer", "Necesito el CRM esta semana"], ["ai", "Perfecto, ¿te envío el enlace de pago?"], ["customer", "Sí, lo compro"]] },
    { name: "Camila Torres", phone: "+57 300 555 5003", channel: "instagram", ago: 9, stage: "Perdido", score: 12, tags: ["perdido"],
      msgs: [["customer", "Muy caro, no me interesa"], ["ai", "Entendido, gracias por tu tiempo."]] },
    { name: "Jorge Pineda", phone: "+57 300 555 5004", channel: "messenger", ago: 10, stage: "Negociación", score: 71, budget: "6 mil", human: true, tags: ["lead-caliente", "con-presupuesto"],
      msgs: [["customer", "Quiero hablar con una persona real, es una cuenta grande"], ["human", "Hola Jorge, soy Paula. Te preparo una propuesta hoy."]] },
    { name: "Valentina Cruz", phone: "+57 300 555 5005", channel: "whatsapp", ago: 11, stage: "Interesado", score: 47, budget: "800", tags: ["precio-consultado"],
      msgs: [["customer", "¿Cuánto cuesta el plan básico?"], ["ai", "Depende del plan; ¿qué necesitas automatizar?"]] },
    { name: "Tomás Herrera", phone: "+57 300 555 5006", channel: "web-chat", ago: 12, stage: "Calificando", score: 25, tags: [],
      msgs: [["customer", "Hola, vi su web"], ["ai", "¡Hola! ¿Cómo te llamas?"]] },
    { name: "Isabela Rojas", phone: "+57 300 555 5007", channel: "whatsapp", ago: 13, stage: "Ganado", score: 95, budget: "5000", tags: ["cliente", "lead-caliente"],
      msgs: [["customer", "Quiero comprar, ¿cómo pago?"], ["ai", "¡Excelente! Te envío el enlace ahora mismo."]] },
  ];

  if (opts.demoContacts === false) return true;
  const stageIdByName = (name: string) => ids[name]!;
  for (const d of demo) {
    const c = crm.createContact({ name: d.name, phone: d.phone, channel: d.channel });
    for (const [sender, body, meta] of d.msgs) {
      crm.addMessage(c.id, sender, body, meta ?? {});
      const calls = (meta?.tool_calls ?? []) as { name: string }[];
      if (calls.length) crm.logEvent(c.id, "ai_turn", { provider: "local-engine", tools: calls.map((t) => t.name) }, "ai");
    }
    if (d.stage !== "Nuevo") crm.moveStage(c.id, stageIdByName(d.stage), d.stage === "Interesado" || d.stage === "Calificando" ? "ai" : "human");
    for (const t of d.tags) crm.addTag(c.id, t, "ai");
    if (d.budget) crm.setFields(c.id, { budget: d.budget }, "ai");
    if (d.human) crm.patchContact(c.id, { handler: "human" });
    crm.db.prepare("UPDATE contacts SET score=?, unread=0 WHERE id=?").run(d.score, c.id);
    const t0 = now - d.ago * DAY - 3_600_000;
    crm.db.prepare("UPDATE contacts SET created_at=?, last_message_at=? WHERE id=?").run(t0, t0 + 2_700_000, c.id);
    crm.db.prepare("UPDATE events SET created_at=? WHERE contact_id=?").run(t0 + 1_800_000, c.id);
    crm.db.prepare("UPDATE events SET created_at=? WHERE contact_id=? AND type='created'").run(t0, c.id);
    crm.db.prepare("UPDATE messages SET created_at=? WHERE contact_id=?").run(t0 + 600_000, c.id);
  }
  // Keep the freshest demo lead on top of the inbox.
  crm.db.prepare("UPDATE contacts SET last_message_at=?, unread=1 WHERE name='Visitante 4821'").run(now - 60_000);
  crm.db.prepare("UPDATE contacts SET unread=2 WHERE name='Daniel Ortiz'").run();
  return true;
}
