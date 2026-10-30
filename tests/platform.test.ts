import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { openDb } from "../server/db.js";
import { Crm } from "../server/crm.js";
import { chainProviders, handleInbound, localProvider, makeProvider, nvidiaProvider, openaiProvider } from "../server/agent.js";
import { type Pace } from "../server/humanize.js";
import { createApp } from "../server/app.js";
import { seedIfEmpty } from "../server/seed.js";
import { parseEvolutionWebhook, parseMetaWebhook } from "../server/channels.js";

let crm: Crm;
beforeEach(() => {
  crm = new Crm(openDb(":memory:"));
  seedIfEmpty(crm);
});

type Call = { url: string; init: any; body: any };
const fakeFetch = (handler: (c: Call) => { status?: number; json: unknown } | Promise<{ status?: number; json: unknown }>) => {
  const calls: Call[] = [];
  const f = (async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const c = { url: String(url), init, body };
    calls.push(c);
    const r = await handler(c);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
};
const completion = (message: object) => ({ json: { choices: [{ message }] } });
const toolCall = (name: string, args: object, id = "c1") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

describe("NVIDIA provider (reply call + CRM analysis call, in parallel)", () => {
  const analysisArgs = (o: object) => completion({ content: null, tool_calls: [toolCall("update_crm", o)] });
  const isAnalysis = (c: Call) => !!c.body.tools;
  const run = async (f: typeof fetch, text: string, name = "Visitante 9", models = ["m/primary"]) => {
    const id = crm.createContact({ name }).id;
    const r = await handleInbound(crm, nvidiaProvider({ apiKey: "nvapi-test", models, fetchImpl: f }), id, text);
    return { id, r };
  };

  it("writes the reply without tools and records the lead through one forced update_crm call", async () => {
    const { f, calls } = fakeFetch((c) =>
      isAnalysis(c)
        ? analysisArgs({ name: "Ana Soto", email: "ana@x.co", interest: "blanqueamiento", tags: ["pidio-descuento"], score: 72, stage_name: "Negociación" })
        : completion({ content: "Hola Ana, claro que sí." }),
    );
    const { id, r } = await run(f, "hola, soy Ana Soto, busco blanqueamiento, mi correo es ana@x.co");
    expect(r.reply).toBe("Hola Ana, claro que sí");
    const c = crm.getContact(id)!;
    expect(c).toMatchObject({ name: "Ana Soto", email: "ana@x.co", score: 72 });
    expect(c.tags).toContain("pidio-descuento");
    expect(crm.getStage(c.stage_id)!.name).toBe("Negociación");

    expect(calls).toHaveLength(2);
    const reply = calls.find((x) => !isAnalysis(x))!;
    const analysis = calls.find(isAnalysis)!;
    expect(reply.url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(reply.init.headers.Authorization).toBe("Bearer nvapi-test");
    expect(reply.body.tools).toBeUndefined();
    expect(analysis.body.tools).toHaveLength(1);
    expect(analysis.body.tool_choice).toEqual({ type: "function", function: { name: "update_crm" } });
    expect(analysis.body.tools[0].function.parameters.properties.stage_name.enum).toContain("Negociación");

    const ai = crm.messages(id).filter((m) => m.sender === "ai").at(-1)!;
    expect((ai.meta.tool_calls as any[]).map((t) => t.name)).toEqual(expect.arrayContaining(["update_lead", "add_tag", "set_lead_score", "move_stage"]));
  });

  it("only moves leads forward: ignores a model request to go back or to leave Ganado", async () => {
    const { f } = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({ stage_name: "Nuevo", score: 10 }) : completion({ content: "ok" })));
    const id = crm.createContact({ name: "Visitante 20", stage_id: crm.listStages().find((s) => s.name === "Interesado")!.id }).id;
    await handleInbound(crm, nvidiaProvider({ apiKey: "k", models: ["m/a"], fetchImpl: f }), id, "hola");
    expect(crm.getStage(crm.getContact(id)!.stage_id)!.name).toBe("Interesado");

    const won = crm.createContact({ name: "Visitante 21", stage_id: crm.listStages().find((s) => s.is_won)!.id }).id;
    await handleInbound(crm, nvidiaProvider({ apiKey: "k", models: ["m/a"], fetchImpl: f }), won, "hola");
    expect(crm.getStage(crm.getContact(won)!.stage_id)!.is_won).toBe(true);
  });

  it("falls back across models for both calls and records which model answered", async () => {
    const { f, calls } = fakeFetch((c) =>
      c.body.model === "m/dead" ? { status: 404, json: { detail: "Function not found for account" } }
      : c.body.model === "m/flaky" ? { status: 502, json: { error: "Upstream request failed." } }
      : isAnalysis(c) ? analysisArgs({ tags: ["desde-tercero"] })
      : completion({ content: "respuesta del tercero" }),
    );
    const { id, r } = await run(f, "hola", "Visitante 11", ["m/dead", "m/flaky", "m/ok"]);
    expect(r.reply).toBe("respuesta del tercero");
    expect(new Set(calls.map((c) => c.body.model))).toEqual(new Set(["m/dead", "m/flaky", "m/ok"]));
    expect(crm.messages(id).filter((m) => m.sender === "ai").at(-1)!.meta.provider).toBe("nvidia:m/ok");
    expect(crm.getContact(id)!.tags).toContain("desde-tercero");
  });

  it("hands the lead to a human when every model fails, instead of losing it or inventing an answer", async () => {
    const { f } = fakeFetch(() => ({ status: 500, json: { error: "down" } }));
    const id = crm.createContact({ name: "Visitante 12" }).id;
    const r = await handleInbound(crm, nvidiaProvider({ apiKey: "k", models: ["m/a", "m/b"], fetchImpl: f }), id, "hola");
    expect(r.replied).toBe(false);
    expect(crm.getContact(id)!.handler).toBe("human");
    expect(crm.messages(id).at(-1)!.body).toMatch(/falló el proveedor de IA/);
  });

  it("aborts on a rejected key without trying other models", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 401, json: { detail: "bad key" } }));
    const id = crm.createContact({ name: "Visitante 13" }).id;
    const r = await handleInbound(crm, nvidiaProvider({ apiKey: "k", models: ["m/a", "m/b", "m/c"], fetchImpl: f }), id, "hola");
    expect(r.replied).toBe(false);
    expect(new Set(calls.map((c) => c.body.model)).size).toBeLessThanOrEqual(1 + 1); // one attempt per call, never walking the whole chain
    expect(crm.messages(id).at(-1)!.body).toMatch(/rechazó la clave/);
  });

  it("treats a reasoning-only (empty) answer as a failure and uses the next model", async () => {
    const { f } = fakeFetch((c) =>
      c.body.model === "m/think" ? completion({ content: "", tool_calls: undefined })
      : isAnalysis(c) ? completion({ content: "sin herramienta" })
      : completion({ content: "respuesta real" }),
    );
    const { r } = await run(f, "hola", "Visitante 14", ["m/think", "m/ok"]);
    expect(r.reply).toBe("respuesta real");
  });

  it("strips <think> blocks and, when the analysis is garbage, still records the lead with the deterministic safety net", async () => {
    const { f } = fakeFetch((c) =>
      isAnalysis(c)
        ? completion({ content: null, tool_calls: [{ id: "x", type: "function", function: { name: "update_crm", arguments: "{not json" } }] })
        : completion({ content: "<think>razonando…</think>Perfecto Luis, sigo contigo." }),
    );
    const { id, r } = await run(f, "Hola, me llamo Luis Vega, necesito un CRM. Mi correo es luis@vega.co", "Visitante 15");
    expect(r.reply).toBe("Perfecto Luis, sigo contigo");
    const c = crm.getContact(id)!;
    expect(c.name).toBe("Luis Vega");
    expect(c.email).toBe("luis@vega.co");
    expect(c.score).toBeGreaterThan(0);
  });

  it("hands off when the customer asks for a person even if the model never flags it", async () => {
    const { f } = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({ tags: [] }) : completion({ content: "Claro, te ayudo." })));
    const { id } = await run(f, "quiero hablar con una persona real", "Visitante 16");
    expect(crm.getContact(id)!.handler).toBe("human");
  });

  it("ignores placeholder values copied from the lead card (generic name, \"-\" email) instead of saving them", async () => {
    const { f } = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({ name: "Visitor 9636", email: "-", interest: "-", budget: "-" }) : completion({ content: "ok" })));
    const { id } = await run(f, "hola", "Visitante 9636");
    const c = crm.getContact(id)!;
    expect(c.name).toBe("Visitante 9636");
    expect(c.email).toBe("");
    expect(c.fields.interest).toBeUndefined();
  });

  it("only hands off when the analyst sets needs_human; a stray handoff_reason note is ignored", async () => {
    const stray = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({ handoff_reason: "pregunta por precio, mover a Negociación" }) : completion({ content: "ok" })));
    const a = await run(stray.f, "¿cuánto cuesta?", "Visitante 23");
    expect(crm.getContact(a.id)!.handler).toBe("ai");

    const real = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({ needs_human: true, handoff_reason: "pide descuento especial" }) : completion({ content: "Te paso con una persona." })));
    const b = await run(real.f, "¿me haces un descuento especial?", "Visitante 24");
    expect(crm.getContact(b.id)!.handler).toBe("human");
    expect(crm.messages(b.id).some((m) => m.sender === "system" && /pide descuento especial/.test(m.body))).toBe(true);
  });

  it("never leaves the customer in silence: a handoff or a provider outage sends an acknowledgment first", async () => {
    // provider outage
    const down = fakeFetch(() => ({ status: 500, json: { error: "down" } }));
    const a = crm.createContact({ name: "Visitante 30" }).id;
    const ra = await handleInbound(crm, nvidiaProvider({ apiKey: "k", models: ["m/a"], fetchImpl: down.f }), a, "hola");
    expect(ra.replied).toBe(false);
    const ma = crm.messages(a);
    const ack = ma.find((m) => m.sender === "ai" && m.meta.courtesy);
    expect(ack).toBeTruthy();
    expect(ack!.body).toMatch(/persona del equipo/i);
    expect(ma.at(-1)!.sender).toBe("system"); // the handoff note still comes last

    // analyst-requested handoff whose reply does not mention a person
    const mk = (reply: string) => fakeFetch((c) => (isAnalysis(c) ? analysisArgs({ needs_human: true, handoff_reason: "regla del negocio" }) : completion({ content: reply })));
    const b = await run(mk("Con gusto, el blanqueamiento cuesta $350.000 COP.").f, "quiero un descuento especial", "Visitante 31");
    expect(crm.messages(b.id).filter((m) => m.sender === "ai" && m.meta.courtesy)).toHaveLength(1);

    // reply already tells the customer a person will follow up: no duplicate
    const c2 = await run(mk("Claro, te paso con una persona del equipo.").f, "quiero un descuento especial", "Visitante 32");
    expect(crm.messages(c2.id).filter((m) => m.meta.courtesy)).toHaveLength(0);
  });

  it("sends several short bubbles as separate messages with the tool calls only on the first", async () => {
    const { f } = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({ tags: ["x"] }) : completion({ content: "todo bien, gracias! y tú?\n---\ncuéntame, en qué te puedo colaborar" })));
    const { id, r } = await run(f, "Hola como estas?", "Visitante 40");
    const ai = crm.messages(id).filter((m) => m.sender === "ai");
    expect(ai.map((m) => m.body)).toEqual(["todo bien, gracias! y tú?", "cuéntame, en qué te puedo colaborar"]);
    expect(ai[0]!.meta.tool_calls).toBeTruthy();
    expect(ai[1]!.meta.tool_calls).toBeUndefined();
    expect(r.reply).toBe("todo bien, gracias! y tú?\ncuéntame, en qué te puedo colaborar");
  });

  it("gives the reply writer a human persona, chat-style rules, anti-repetition rules and an honesty rule about being an AI", async () => {
    crm.setBusiness({ name: "Clínica Sonrisa", agent_name: "Sofi", style_notes: "usa 'listo' y 'con gusto'" });
    const { f, calls } = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({}) : completion({ content: "ok" })));
    await run(f, "hola", "Visitante 41");
    const sys = calls.find((c) => !isAnalysis(c))!.body.messages[0].content as string;
    expect(sys).toContain("Sofi");
    expect(sys).toContain("usa 'listo' y 'con gusto'");
    expect(sys).toMatch(/WhatsApp/);
    expect(sys).toMatch(/---/);
    expect(sys).toMatch(/Repetir datos|no repit/i);
    expect(sys).toMatch(/uy, entiendo/i);
    expect(sys).toMatch(/Nunca niegues ser una IA/i);
  });

  it("does not hand the reply writer the same few-shot examples every turn, and never lets emoji through unasked", async () => {
    const mkPrompt = async (aiMessages: number) => {
      const id = crm.createContact({ name: "Visitante 60" }).id;
      for (let i = 0; i < aiMessages; i++) {
        crm.addMessage(id, "customer", "hola");
        crm.addMessage(id, "ai", `respuesta ${i}`);
      }
      const { f, calls } = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({}) : completion({ content: "listo, quedamos así 👍" })));
      const r = await handleInbound(crm, nvidiaProvider({ apiKey: "k", models: ["m/a"], fetchImpl: f }), id, "hola");
      return { sys: calls.find((c) => !isAnalysis(c))!.body.messages[0].content as string, reply: r.reply };
    };
    const a = await mkPrompt(0);
    const b = await mkPrompt(1);
    const examples = (s: string) => s.slice(s.indexOf("EJEMPLOS DEL TONO"), s.indexOf("EJEMPLOS DEL TONO") + 700);
    expect(examples(a.sys)).not.toBe(examples(b.sys));
    expect(a.sys).toMatch(/uy, entiendo, no es poca plata/i); // the price-objection example is always present
    expect(a.sys).toMatch(/no copies/i);
    expect(a.reply).toBe("listo, quedamos así");
  });

  it("rewrites a draft that copies one of the tone examples line by line", async () => {
    let n = 0;
    const { f, calls } = fakeFetch((c) => {
      if (isAnalysis(c)) return analysisArgs({});
      n++;
      return completion({ content: n === 1 ? "uy, entiendo, no es poca plata" : "ay sí, es un montón de plata. cuánto tenías pensado invertir?" });
    });
    const { r } = await run(f, "uff qué caro", "Visitante 61");
    expect(r.reply).toBe("ay sí, es un montón de plata. cuánto tenías pensado invertir?");
    expect(JSON.stringify(calls.filter((c) => !isAnalysis(c))[1]!.body.messages)).toMatch(/ejemplos/i);
  });

  it("also catches an example copied inside a longer bubble", async () => {
    let n = 0;
    const { f } = fakeFetch((c) => {
      if (isAnalysis(c)) return analysisArgs({});
      n++;
      return completion({ content: n === 1 ? "uy, entiendo, no es poca plata. qué presupuesto manejabas? miramos qué se ajusta." : "te entiendo, es una decisión grande. qué rango tenías en mente?" });
    });
    const { r } = await run(f, "uff qué caro", "Visitante 64");
    expect(r.reply).toBe("te entiendo, es una decisión grande. qué rango tenías en mente?");
  });

  it("never lets the instructions leak into the customer's chat: rewrites, and hands off if it keeps leaking", async () => {
    const leak = "No finjo ser una persona. Si el cliente te pregunta en serio si soy un bot, una IA o una persona, respóndele con la verdad y sigue ayudando.";
    let n = 0;
    const once = fakeFetch((c) => {
      if (isAnalysis(c)) return analysisArgs({});
      n++;
      return completion({ content: n === 1 ? leak : "claro, te cuento cómo funciona" });
    });
    const a = await run(once.f, "es doloroso?", "Visitante 66");
    expect(crm.messages(a.id).filter((m) => m.sender === "ai").map((m) => m.body)).toEqual(["claro, te cuento cómo funciona"]);

    const always = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({}) : completion({ content: leak })));
    const b = await run(always.f, "es doloroso?", "Visitante 67");
    const said = crm.messages(b.id).filter((m) => m.sender === "ai").map((m) => m.body).join(" ");
    expect(said).not.toMatch(/respóndele|el cliente te pregunta/);
    expect(crm.getContact(b.id)!.handler).toBe("human");
  });

  it("lets the honest answer about being virtual through (it is allowed to echo the suggested wording)", async () => {
    const { f } = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({}) : completion({ content: "soy la asistente virtual de Sonrisa Digital, y detrás hay un equipo humano" })));
    crm.setBusiness({ name: "Sonrisa Digital", agent_name: "Sofi" });
    const { r } = await run(f, "eres un bot?", "Visitante 68");
    expect(r.reply).toBe("soy la asistente virtual de Sonrisa Digital, y detrás hay un equipo humano");
  });

  it("catches repetition inside a multi-bubble draft, bubble by bubble", async () => {
    const id = crm.createContact({ name: "Visitante 69" }).id;
    crm.addMessage(id, "customer", "cuánto cuesta?");
    crm.addMessage(id, "ai", "el blanqueamiento en consultorio cuesta $350.000 COP y dura 60 minutos");
    let n = 0;
    const { f } = fakeFetch((c) => {
      if (isAnalysis(c)) return analysisArgs({});
      n++;
      return completion({ content: n === 1 ? "buena pregunta\n---\nel blanqueamiento en consultorio cuesta $350.000 COP y dura 60 minutos" : "buena pregunta\n---\nes rápido, la mayoría sale en una sola sesión" });
    });
    const r = await handleInbound(crm, nvidiaProvider({ apiKey: "k", models: ["m/a"], fetchImpl: f }), id, "y es rápido?");
    expect(r.reply).toBe("buena pregunta\nes rápido, la mayoría sale en una sola sesión");
  });

  it("retries a copied example WITHOUT showing the examples again, so the model cannot copy them twice", async () => {
    let n = 0;
    const { f, calls } = fakeFetch((c) => {
      if (isAnalysis(c)) return analysisArgs({});
      n++;
      return completion({ content: n === 1 ? "uy, entiendo, no es poca plata" : "te entiendo, es una decisión grande" });
    });
    await run(f, "uff qué caro", "Visitante 65");
    const replyCalls = calls.filter((c) => !isAnalysis(c));
    expect(replyCalls[0]!.body.messages[0].content).toContain("EJEMPLOS DEL TONO");
    expect(replyCalls[1]!.body.messages[0].content).not.toContain("EJEMPLOS DEL TONO");
  });

  it("tells the writer what it cannot do (no calendar, no payments) and to speak in the first person about being virtual", async () => {
    const { f, calls } = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({}) : completion({ content: "ok" })));
    await run(f, "hola", "Visitante 62");
    const sys = calls.find((c) => !isAnalysis(c))!.body.messages[0].content as string;
    expect(sys).toMatch(/no puedes agendar|no puedes confirmar citas/i);
    expect(sys).toMatch(/enlaces? de pago/i);
    expect(sys).toMatch(/soy la asistente virtual/i);
    const analysis = JSON.stringify(calls.find(isAnalysis)!.body.messages[0].content);
    expect(analysis).toMatch(/fecha|hora/i);
  });

  it("rewrites a draft that promises a time or a payment link it cannot deliver", async () => {
    let n = 0;
    const { f } = fakeFetch((c) => {
      if (isAnalysis(c)) return analysisArgs({});
      n++;
      return completion({ content: n === 1 ? "listo, jueves a las 3:00 pm. te confirmo el enlace de pago por WhatsApp" : "listo, jueves en la tarde queda anotado\n---\nuna persona del equipo te confirma la hora exacta" });
    });
    const { id } = await run(f, "ok dale, el jueves en la tarde", "Visitante 63");
    const said = crm.messages(id).filter((m) => m.sender === "ai").map((m) => m.body).join(" | ");
    expect(said).not.toMatch(/3:00|enlace de pago/);
    expect(said).toMatch(/confirma la hora/);
  });

  it("regenerates once when the draft repeats what the agent already said, and uses the new draft", async () => {
    const id = crm.createContact({ name: "Visitante 42" }).id;
    crm.addMessage(id, "customer", "cuánto cuesta?");
    crm.addMessage(id, "ai", "Los brackets metálicos tienen un costo total de $2.800.000 COP con cuotas de $180.000 COP mensuales");
    let n = 0;
    const { f, calls } = fakeFetch((c) => {
      if (isAnalysis(c)) return analysisArgs({});
      n++;
      return completion({ content: n === 1 ? "Los brackets metálicos cuestan en total $2.800.000 COP con cuotas mensuales de $180.000 COP" : "uy, te entiendo, es plata. qué tenías pensado más o menos?" });
    });
    const r = await handleInbound(crm, nvidiaProvider({ apiKey: "k", models: ["m/a"], fetchImpl: f }), id, "uff qué caro");
    expect(r.reply).toBe("uy, te entiendo, es plata. qué tenías pensado más o menos?");
    const replyCalls = calls.filter((c) => !isAnalysis(c));
    expect(replyCalls).toHaveLength(2);
    expect(JSON.stringify(replyCalls[1]!.body.messages)).toMatch(/repite/i);
  });

  it("rewrites a draft that invents conditions or amounts missing from the knowledge base, and hands off if it keeps inventing", async () => {
    crm.addKnowledge("Cuotas", "Brackets $2.800.000 COP en total, cuotas mensuales de $180.000 COP.");
    let n = 0;
    const retry = fakeFetch((c) => {
      if (isAnalysis(c)) return analysisArgs({});
      n++;
      return completion({ content: n === 1 ? "cuotas de $180.000 COP sin intereses" : "cuotas mensuales de $180.000 COP\n---\nlos intereses exactos los confirmo con el equipo" });
    });
    const a = await run(retry.f, "y si pago a cuotas?", "Visitante 50");
    expect(crm.messages(a.id).filter((m) => m.sender === "ai").map((m) => m.body)).toEqual(["cuotas mensuales de $180.000 COP", "los intereses exactos los confirmo con el equipo"]);
    expect(JSON.stringify(retry.calls.filter((c) => !isAnalysis(c))[1]!.body.messages)).toMatch(/sin intereses/);

    const stubborn = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({}) : completion({ content: "te lo dejo en $99.999 sin intereses" })));
    const b = await run(stubborn.f, "y si pago a cuotas?", "Visitante 51");
    const said = crm.messages(b.id).filter((m) => m.sender === "ai").map((m) => m.body).join(" ");
    expect(said).not.toContain("99.999");
    expect(said).toMatch(/confirm/i);
    expect(crm.getContact(b.id)!.handler).toBe("human");
  });

  it("paces the reply like a person: reading pause, typing indicator, then one typing pause per bubble", async () => {
    const log: string[] = [];
    crm.subscribe((e) => e.type === "typing" && log.push(`typing:${e.on}`));
    const pace: Pace = {
      sleep: async (ms) => { log.push(`sleep:${ms}`); },
      readMs: (n) => 1000 + n,
      typeMs: (n) => 200 + n,
      betweenMs: () => 50,
    };
    const { f } = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({}) : completion({ content: "uno\n---\ndos dos" })));
    const id = crm.createContact({ name: "Visitante 43" }).id;
    await handleInbound(crm, nvidiaProvider({ apiKey: "k", models: ["m/a"], fetchImpl: f }), id, "hola!", {}, { pace });
    expect(log[0]).toBe("sleep:1005"); // reading pause comes first, before any typing indicator
    expect(log.indexOf("typing:true")).toBeGreaterThan(0);
    expect(log.filter((x) => x.startsWith("sleep:")).length).toBeGreaterThanOrEqual(4);
    expect(log.at(-1)).toBe("typing:false");
    expect(crm.messages(id).filter((m) => m.sender === "ai")).toHaveLength(2);
  });

  it("puts the business profile and only the relevant knowledge in the reply prompt, and forbids inventing", async () => {
    crm.setBusiness({ name: "Clínica Sonrisa", description: "Odontología estética", tone: "cercano y profesional", goals: "agendar valoración" });
    crm.addKnowledge("Blanqueamiento", "El blanqueamiento dental cuesta $350.000 COP y dura 60 minutos.");
    const { f, calls } = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({}) : completion({ content: "ok" })));
    await run(f, "¿Cuánto cuesta el blanqueamiento?", "Visitante 17");
    const sys = calls.find((c) => !isAnalysis(c))!.body.messages[0].content as string;
    expect(sys).toContain("Clínica Sonrisa");
    expect(sys).toContain("agendar valoración");
    expect(sys).toContain("$350.000 COP");
    expect(sys).toMatch(/no inventes/i);
    expect(sys).not.toMatch(/herramienta|update_crm/i); // the reply writer never sees tool instructions
  });

  it("disables the thinking mode only for the nemotron-3.5 family (speed) and uses a natural-variation temperature", async () => {
    const { f, calls } = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({}) : completion({ content: "ok" })));
    await run(f, "hola", "Visitante 18", ["nvidia/nemotron-3.5-lightning-30b-a3b"]);
    const reply = calls.find((c) => !isAnalysis(c))!;
    expect(reply.body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(reply.body.temperature).toBe(0.7);
    const other = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({}) : completion({ content: "ok" })));
    await run(other.f, "hola", "Visitante 19", ["openai/gpt-oss-20b"]);
    expect(other.calls[0]!.body.chat_template_kwargs).toBeUndefined();
  });

  it("publishes typing on/off events around the model calls", async () => {
    const events: any[] = [];
    crm.subscribe((e) => e.type === "typing" && events.push(e));
    const { f } = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({}) : completion({ content: "ok" })));
    const { id } = await run(f, "hola", "Visitante 22");
    expect(events.map((e) => e.on)).toEqual([true, false]);
    expect(events[0].contactId).toBe(id);
  });

  it("makeProvider prefers NVIDIA under any supported env name, then Anthropic, then local; default model is the fast one", () => {
    expect(makeProvider({ Nvidia: "nvapi-x" }).name).toBe("nvidia:nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(makeProvider({ NVIDIA_API_KEY: "nvapi-x", NVIDIA_MODEL: "x/y" }).name).toBe("nvidia:x/y");
    expect(makeProvider({ NVIDIA_API_KEY: "nvapi-x", NVIDIA_MODEL: "x/y" }).models![0]).toBe("x/y");
    expect(makeProvider({ ANTHROPIC_API_KEY: "k" }).name).toMatch(/^anthropic:/);
    expect(makeProvider({}).name).toBe("local-engine");
    expect(makeProvider({ Nvidia: "nvapi-x", AI_PROVIDER: "local" }).name).toBe("local-engine");
  });
});

describe("OpenAI provider (gpt-6-luna) and provider chain", () => {
  const analysisArgs = (o: object) => completion({ content: null, tool_calls: [toolCall("update_crm", o)] });
  const isAnalysis = (c: Call) => !!c.body.tools;
  const run = async (provider: ReturnType<typeof openaiProvider>, text: string, name = "Visitante 80") => {
    const id = crm.createContact({ name }).id;
    const r = await handleInbound(crm, provider, id, text);
    return { id, r };
  };

  it("talks to api.openai.com with the shapes the reasoning models require", async () => {
    const { f, calls } = fakeFetch((c) => (isAnalysis(c) ? analysisArgs({ tags: ["x"], score: 40 }) : completion({ content: "claro, te cuento" })));
    const { id, r } = await run(openaiProvider({ apiKey: "sk-test", models: ["gpt-6-luna"], fetchImpl: f }), "hola");
    expect(r.reply).toBe("claro, te cuento");
    expect(crm.getContact(id)!.tags).toContain("x");

    const reply = calls.find((c) => !isAnalysis(c))!;
    const analysis = calls.find(isAnalysis)!;
    expect(reply.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(reply.init.headers.Authorization).toBe("Bearer sk-test");
    // reasoning models reject temperature and max_tokens; reasoning is "low" for writing and off for the forced function
    expect(reply.body.temperature).toBeUndefined();
    expect(reply.body.max_tokens).toBeUndefined();
    expect(reply.body.max_completion_tokens).toBeGreaterThanOrEqual(1000);
    expect(reply.body.reasoning_effort).toBe("low");
    expect(analysis.body.reasoning_effort).toBe("none");
    expect(analysis.body.tool_choice).toEqual({ type: "function", function: { name: "update_crm" } });
    expect(crm.messages(id).filter((m) => m.sender === "ai").at(-1)!.meta.provider).toBe("openai:gpt-6-luna");
  });

  it("lets the operator choose the reasoning effort and falls back across OpenAI models", async () => {
    const { f, calls } = fakeFetch((c) =>
      c.body.model === "gpt-6-luna" ? { status: 400, json: { error: { message: "Unsupported value" } } } : isAnalysis(c) ? analysisArgs({}) : completion({ content: "respuesta del segundo" }),
    );
    const { r } = await run(openaiProvider({ apiKey: "k", models: ["gpt-6-luna", "gpt-5.6-luna"], reasoning: "minimal", fetchImpl: f }), "hola", "Visitante 81");
    expect(r.reply).toBe("respuesta del segundo");
    expect(calls.find((c) => !isAnalysis(c) && c.body.model === "gpt-5.6-luna")!.body.reasoning_effort).toBe("minimal");
  });

  it("aborts on a rejected OpenAI key with a clear message", async () => {
    const { f } = fakeFetch(() => ({ status: 401, json: { error: { message: "Incorrect API key" } } }));
    const id = crm.createContact({ name: "Visitante 82" }).id;
    await handleInbound(crm, openaiProvider({ apiKey: "bad", models: ["gpt-6-luna", "gpt-5.6-luna"], fetchImpl: f }), id, "hola");
    expect(crm.messages(id).some((m) => /OpenAI rechazó la clave/.test(m.body))).toBe(true);
  });

  it("the chain answers with the next provider when the first one fails, and reports who answered", async () => {
    const { f, calls } = fakeFetch((c) =>
      c.url.includes("api.openai.com") ? { status: 500, json: { error: "down" } } : isAnalysis(c) ? analysisArgs({ tags: ["via-nvidia"] }) : completion({ content: "respondió el respaldo" }),
    );
    const chain = chainProviders([
      openaiProvider({ apiKey: "k", models: ["gpt-6-luna"], fetchImpl: f }),
      nvidiaProvider({ apiKey: "k", models: ["m/nv"], fetchImpl: f }),
    ]);
    const id = crm.createContact({ name: "Visitante 83" }).id;
    const r = await handleInbound(crm, chain, id, "hola");
    expect(r.reply).toBe("respondió el respaldo");
    expect(r.provider).toBe("nvidia:m/nv");
    expect(crm.getContact(id)!.tags).toContain("via-nvidia");
    expect(calls.some((c) => c.url.includes("api.openai.com"))).toBe(true);
  });

  it("makeProvider prefers OpenAI, chains NVIDIA behind it, and honours AI_PROVIDER and OPENAI_MODEL", () => {
    const both = makeProvider({ OPENAI_API_KEY: "sk-x", Nvidia: "nvapi-x" });
    expect(both.name).toBe("openai:gpt-6-luna");
    expect(both.models).toEqual(expect.arrayContaining(["gpt-6-luna", "nvidia/nemotron-3.5-lightning-30b-a3b"]));
    expect(makeProvider({ OPENAI_API_KEY: "sk-x" }).name).toBe("openai:gpt-6-luna");
    expect(makeProvider({ OPENAI_API_KEY: "sk-x", OPENAI_MODEL: "gpt-5.4-nano" }).name).toBe("openai:gpt-5.4-nano");
    expect(makeProvider({ OPENAI_API_KEY: "sk-x", Nvidia: "nvapi-x", AI_PROVIDER: "nvidia" }).name).toMatch(/^nvidia:/);
    expect(makeProvider({ OPENAI_API_KEY: "sk-x", AI_PROVIDER: "local" }).name).toBe("local-engine");
  });
});

describe("business profile and knowledge base API", () => {
  const mk = () => createApp(crm, localProvider, "nonexistent");
  const call = async (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as any };
  };

  it("stores and returns the business profile, validating field types", async () => {
    const app = mk();
    expect(typeof (await call(app, "GET", "/api/business")).json.name).toBe("string");
    const put = await call(app, "PUT", "/api/business", { name: "ACME", description: "Software", tone: "formal", hours: "L-V 9-6", goals: "cerrar ventas", handoff_rules: "Pasar a humano si piden descuento", agent_name: "Sofi", style_notes: "usa listo" });
    expect(put.status).toBe(200);
    expect((await call(app, "GET", "/api/business")).json).toMatchObject({ name: "ACME", tone: "formal", agent_name: "Sofi", style_notes: "usa listo" });
    expect((await call(app, "PUT", "/api/business", { name: 42 })).status).toBe(400);
  });

  it("CRUDs knowledge entries and rejects empty ones", async () => {
    const app = mk();
    const seeded = (await call(app, "GET", "/api/knowledge")).json.length;
    const a = await call(app, "POST", "/api/knowledge", { title: "Plan Pro", content: "Cuesta $49 por usuario al mes" });
    expect(a.status).toBe(201);
    expect((await call(app, "POST", "/api/knowledge", { title: "", content: "x" })).status).toBe(400);
    await call(app, "PUT", `/api/knowledge/${a.json.id}`, { content: "Cuesta $59 por usuario al mes" });
    expect((await call(app, "GET", "/api/knowledge")).json.find((k: any) => k.id === a.json.id).content).toContain("$59");
    expect((await call(app, "DELETE", `/api/knowledge/${a.json.id}`)).status).toBe(200);
    expect((await call(app, "GET", "/api/knowledge")).json).toHaveLength(seeded);
    expect((await call(app, "DELETE", `/api/knowledge/999`)).status).toBe(404);
  });

  it("reports provider, model and channel configuration without leaking secrets", async () => {
    const app = createApp(crm, localProvider, "nonexistent", { env: { WHATSAPP_TOKEN: "super-secret-token", WHATSAPP_PHONE_ID: "123", ADMIN_PASSWORD: undefined } });
    const r = await call(app, "GET", "/api/ai/status");
    expect(r.json.provider).toBe("local-engine");
    expect(r.json.channels.whatsapp).toMatchObject({ configured: true });
    expect(r.json.channels.messenger.configured).toBe(false);
    expect(JSON.stringify(r.json)).not.toContain("super-secret-token");
  });
});

describe("web chat widget (public API)", () => {
  const mk = () => createApp(crm, localProvider, "nonexistent");
  const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("serves the embeddable script and a demo page", async () => {
    const app = mk();
    const js = await app.request("/widget.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toMatch(/javascript/);
    expect(await js.text()).toContain("/api/public/chat");
    const demo = await app.request("/widget-demo");
    expect(demo.status).toBe(200);
    expect(await demo.text()).toContain("widget.js");
  });

  it("creates a session, answers with the AI and exposes only customer-visible messages", async () => {
    const app = mk();
    const s = (await (await post(app, "/api/public/chat/session", {})).json()) as any;
    expect(s.token).toMatch(/^[a-f0-9]{32}$/);
    const m = await post(app, "/api/public/chat/message", { token: s.token, text: "Hola, me llamo Lucía Paz, busco un CRM" });
    expect(m.status).toBe(200);
    const mj = (await m.json()) as any;
    // the request returns at once with the customer's own message; the reply arrives through polling
    expect(mj.messages.map((x: any) => x.sender)).toEqual(["customer"]);
    expect(m.headers.get("access-control-allow-origin")).toBe("*");
    await crm.drain();
    const polled = (await (await app.request(`/api/public/chat/messages?token=${s.token}&after=${mj.messages[0].id}`)).json()) as any;
    expect(polled.messages.some((x: any) => x.sender === "ai")).toBe(true);
    expect(polled.typing).toBe(false);

    const contact = crm.listContacts().find((c) => c.channel === "web-chat" && c.name === "Lucía Paz")!;
    expect(contact).toBeTruthy();
    crm.addMessage(contact.id, "note", "nota privada");
    crm.addMessage(contact.id, "system", "Transferido…");
    const list = (await (await app.request(`/api/public/chat/messages?token=${s.token}`)).json()) as any;
    expect(list.messages.every((x: any) => ["customer", "ai", "human"].includes(x.sender))).toBe(true);
    expect(JSON.stringify(list)).not.toContain("nota privada");
  });

  it("delivers a human reply to the widget through polling with `after`", async () => {
    const app = mk();
    const s = (await (await post(app, "/api/public/chat/session", {})).json()) as any;
    await post(app, "/api/public/chat/message", { token: s.token, text: "quiero hablar con una persona real" });
    await crm.drain();
    const contact = crm.findByExternal("web-chat", s.token)!;
    const first = (await (await app.request(`/api/public/chat/messages?token=${s.token}`)).json()) as any;
    const lastId = first.messages.at(-1).id;
    await app.request(`/api/contacts/${contact.id}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "Hola, soy Paula del equipo" }) });
    const next = (await (await app.request(`/api/public/chat/messages?token=${s.token}&after=${lastId}`)).json()) as any;
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]).toMatchObject({ sender: "human", body: "Hola, soy Paula del equipo" });
  });

  it("rejects unknown tokens, empty or oversized text, and throttles floods", async () => {
    const app = mk();
    expect((await post(app, "/api/public/chat/message", { token: "0".repeat(32), text: "hola" })).status).toBe(404);
    const s = (await (await post(app, "/api/public/chat/session", {})).json()) as any;
    expect((await post(app, "/api/public/chat/message", { token: s.token, text: "  " })).status).toBe(400);
    expect((await post(app, "/api/public/chat/message", { token: s.token, text: "x".repeat(2001) })).status).toBe(400);
    let last = 200;
    for (let i = 0; i < 40; i++) last = (await post(app, "/api/public/chat/message", { token: s.token, text: "hola " + i })).status;
    expect(last).toBe(429);
  });

  it("greets with the agent's name when one is configured", async () => {
    crm.setBusiness({ name: "Clínica Sonrisa", agent_name: "Sofi" });
    const cfg = (await (await mk().request("/api/public/chat/config")).json()) as any;
    expect(cfg.agent).toBe("Sofi");
    expect(cfg.greeting).toContain("Sofi");
    expect(cfg.greeting).toContain("Clínica Sonrisa");
  });

  it("answers CORS preflight for embedding on third-party sites", async () => {
    const res = await mk().request("/api/public/chat/message", { method: "OPTIONS", headers: { origin: "https://cliente.com", "access-control-request-method": "POST" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("Meta channels (WhatsApp, Messenger, Instagram)", () => {
  const waPayload = (text = "Hola, busco un CRM", id = "wamid.1") => ({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { contacts: [{ profile: { name: "Ana Soto" }, wa_id: "573001112233" }], messages: [{ from: "573001112233", id, type: "text", text: { body: text } }] } }] }],
  });
  const env = { WHATSAPP_TOKEN: "wa-token", WHATSAPP_PHONE_ID: "555", MESSENGER_PAGE_TOKEN: "pg-token", INSTAGRAM_PAGE_TOKEN: "ig-token", META_VERIFY_TOKEN: "verify-me" };
  const setup = (extraEnv: Record<string, string> = {}) => {
    const sent = fakeFetch(() => ({ json: { messages: [{ id: "out1" }] } }));
    const app = createApp(crm, localProvider, "nonexistent", { env: { ...env, ...extraEnv }, fetchImpl: sent.f });
    return { app, sent };
  };
  const post = (app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = {}) =>
    app.request("/api/webhooks/meta", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("parses WhatsApp, Messenger and Instagram payloads and ignores echoes and non-text", () => {
    expect(parseMetaWebhook(waPayload())).toEqual([{ channel: "whatsapp", externalId: "573001112233", name: "Ana Soto", text: "Hola, busco un CRM", messageId: "wamid.1" }]);
    expect(parseMetaWebhook({ object: "page", entry: [{ messaging: [{ sender: { id: "P1" }, message: { mid: "m1", text: "Hola" } }, { sender: { id: "P1" }, message: { mid: "m2", text: "eco", is_echo: true } }, { sender: { id: "P1" }, message: { mid: "m3", attachments: [{}] } }] }] })).toEqual([
      { channel: "messenger", externalId: "P1", name: undefined, text: "Hola", messageId: "m1" },
    ]);
    expect(parseMetaWebhook({ object: "instagram", entry: [{ messaging: [{ sender: { id: "I1" }, message: { mid: "i1", text: "Buenas" } }] }] })[0]).toMatchObject({ channel: "instagram", externalId: "I1" });
    expect(parseMetaWebhook({ object: "other" })).toEqual([]);
    expect(parseMetaWebhook(null)).toEqual([]);
  });

  it("answers the Meta verification handshake only with the right token", async () => {
    const { app } = setup();
    const ok = await app.request("/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1234");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1234");
    expect((await app.request("/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1234")).status).toBe(403);
  });

  it("creates the contact, runs the AI and sends the reply back through the WhatsApp Cloud API", async () => {
    const { app, sent } = setup();
    const res = await post(app, waPayload());
    expect(res.status).toBe(200);
    await crm.drain();
    const c = crm.listContacts().find((x) => x.phone === "573001112233")!;
    expect(c.name).toBe("Ana Soto");
    expect(c.phone).toBe("573001112233");
    const out = sent.calls.find((x) => x.url.includes("/555/messages"))!;
    expect(out.init.headers.Authorization).toBe("Bearer wa-token");
    expect(out.body).toMatchObject({ messaging_product: "whatsapp", to: "573001112233", type: "text" });
    expect(out.body.text.body.length).toBeGreaterThan(0);
    const ai = crm.messages(c.id).filter((m) => m.sender === "ai").at(-1)!;
    expect(ai.meta.delivery).toMatchObject({ status: "sent" });
  });

  it("is idempotent when Meta retries the same message id", async () => {
    const { app } = setup();
    await post(app, waPayload("Hola", "wamid.dup"));
    await crm.drain();
    await post(app, waPayload("Hola", "wamid.dup"));
    await crm.drain();
    const c = crm.listContacts().find((x) => x.phone === "573001112233")!;
    expect(crm.messages(c.id).filter((m) => m.sender === "customer")).toHaveLength(1);
    expect(crm.listContacts().filter((x) => x.phone === "573001112233")).toHaveLength(1);
  });

  it("rejects bad signatures when META_APP_SECRET is configured and accepts a valid one", async () => {
    const { app } = setup({ META_APP_SECRET: "appsecret" });
    const raw = JSON.stringify(waPayload("Hola firmada", "wamid.sig"));
    const sig = "sha256=" + createHmac("sha256", "appsecret").update(raw).digest("hex");
    const bad = await app.request("/api/webhooks/meta", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" }, body: raw });
    expect(bad.status).toBe(401);
    const good = await app.request("/api/webhooks/meta", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: raw });
    expect(good.status).toBe(200);
    await crm.drain();
    expect(crm.listContacts().some((x) => x.phone === "573001112233")).toBe(true);
  });

  it("routes Messenger and Instagram replies through /me/messages with the right page token", async () => {
    const { app, sent } = setup();
    await post(app, { object: "page", entry: [{ messaging: [{ sender: { id: "PSID1" }, message: { mid: "m1", text: "Hola" } }] }] });
    await post(app, { object: "instagram", entry: [{ messaging: [{ sender: { id: "IGSID1" }, message: { mid: "i1", text: "Hola" } }] }] });
    await crm.drain();
    const m = sent.calls.find((c) => c.url.includes("me/messages") && c.url.includes("pg-token"))!;
    expect(m.body).toMatchObject({ recipient: { id: "PSID1" }, messaging_type: "RESPONSE" });
    expect(sent.calls.some((c) => c.url.includes("me/messages") && c.url.includes("ig-token") && c.body.recipient.id === "IGSID1")).toBe(true);
  });

  it("a human reply from the inbox is delivered to the customer's channel; notes never are", async () => {
    const { app, sent } = setup();
    await post(app, waPayload("quiero hablar con una persona real", "wamid.h"));
    await crm.drain();
    const c = crm.listContacts().find((x) => x.phone === "573001112233")!;
    const before = sent.calls.length;
    await app.request(`/api/contacts/${c.id}/note`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "no enviar esto" }) });
    await app.request(`/api/contacts/${c.id}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "Hola Ana, soy Paula" }) });
    await crm.drain();
    const newCalls = sent.calls.slice(before);
    expect(newCalls).toHaveLength(1);
    expect(newCalls[0]!.body.text.body).toBe("Hola Ana, soy Paula");
  });

  it("marks delivery as failed (and keeps the message) when the channel API errors, and as not_configured without credentials", async () => {
    const failing = fakeFetch(() => ({ status: 400, json: { error: { message: "token expired" } } }));
    const app = createApp(crm, localProvider, "nonexistent", { env, fetchImpl: failing.f });
    await post(app, waPayload("Hola", "wamid.f"));
    await crm.drain();
    const c = crm.listContacts().find((x) => x.phone === "573001112233")!;
    const ai = crm.messages(c.id).filter((m) => m.sender === "ai").at(-1)!;
    expect(ai.meta.delivery).toMatchObject({ status: "failed" });
    expect(String((ai.meta.delivery as any).error)).toContain("token expired");

    const bare = createApp(crm, localProvider, "nonexistent", { env: {}, fetchImpl: failing.f });
    const c2 = crm.createContact({ name: "Sin credenciales", channel: "whatsapp" });
    crm.setExternalId(c2.id, "999");
    crm.addMessage(c2.id, "human", "hola");
    await crm.drain();
    expect((crm.messages(c2.id).at(-1)!.meta.delivery as any).status).toBe("not_configured");
    void bare;
  });
});

describe("admin login", () => {
  const mk = () => createApp(crm, localProvider, "nonexistent", { env: { ADMIN_PASSWORD: "s3cret-pass" } });
  const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;

  it("is open when no ADMIN_PASSWORD is configured and says so", async () => {
    const app = createApp(crm, localProvider, "nonexistent", { env: {} });
    expect((await app.request("/api/contacts")).status).toBe(200);
    expect(await (await app.request("/api/auth/status")).json()).toMatchObject({ required: false, authenticated: true });
  });

  it("protects the panel API, keeps public endpoints open, and issues an HttpOnly session on login", async () => {
    const app = mk();
    expect((await app.request("/api/contacts")).status).toBe(401);
    expect((await app.request("/api/events")).status).toBe(401);
    expect((await app.request("/api/health")).status).toBe(200);
    expect((await app.request("/api/public/chat/session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(200);
    expect(await (await app.request("/api/auth/status")).json()).toMatchObject({ required: true, authenticated: false });

    const bad = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "mala" }) });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();

    const ok = await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "s3cret-pass" }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    const cookie = cookieOf(ok);
    expect((await app.request("/api/contacts", { headers: { cookie } })).status).toBe(200);
    expect(await (await app.request("/api/auth/status", { headers: { cookie } })).json()).toMatchObject({ authenticated: true });
    expect((await app.request("/api/contacts", { headers: { cookie: cookie.slice(0, -2) + "xx" } })).status).toBe(401);

    await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect((await app.request("/api/contacts", { headers: { cookie } })).status).toBe(401);
  });

  it("throttles repeated wrong passwords", async () => {
    const app = mk();
    let status = 0;
    for (let i = 0; i < 12; i++) status = (await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "x" + i }) })).status;
    expect(status).toBe(429);
  });

  it("keeps the Meta webhook reachable without a session (Meta cannot log in)", async () => {
    const app = createApp(crm, localProvider, "nonexistent", { env: { ADMIN_PASSWORD: "p", META_VERIFY_TOKEN: "v" } });
    expect((await app.request("/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=v&hub.challenge=7")).status).toBe(200);
  });
});


describe("Evolution API channel (read-only follow-up)", () => {
  const evo = (over: Record<string, unknown> = {}, key: Record<string, unknown> = {}) => ({
    event: "messages.upsert",
    instance: "loovo-ventas",
    data: { key: { remoteJid: "573001112233@s.whatsapp.net", fromMe: false, id: "EVO1", ...key }, pushName: "Recepción Clínica Demo", message: { conversation: "Hola, buenos días, claro que sí" }, ...over },
  });
  const post = (app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = { "x-webhook-token": "tok" }) =>
    app.request("/api/webhooks/evolution", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const mk = (env: Record<string, string> = { EVOLUTION_WEBHOOK_TOKEN: "tok" }) => createApp(crm, localProvider, "nonexistent", { env });

  it("parses individual text messages, marks own ones and ignores group and non-text messages", () => {
    expect(parseEvolutionWebhook(evo())).toEqual([{ channel: "whatsapp", externalId: "573001112233", name: "Recepción Clínica Demo", text: "Hola, buenos días, claro que sí", messageId: "EVO1" }]);
    expect(parseEvolutionWebhook(evo({}, { fromMe: true }))).toEqual([{ channel: "whatsapp", externalId: "573001112233", name: undefined, text: "Hola, buenos días, claro que sí", messageId: "EVO1", fromMe: true }]);
    expect(parseEvolutionWebhook(evo({}, { remoteJid: "1203@g.us" }))).toEqual([]);
    expect(parseEvolutionWebhook(evo({ message: { imageMessage: {} } }))).toEqual([]);
    expect(parseEvolutionWebhook({ ...evo(), event: "connection.update" })).toEqual([]);
    expect(parseEvolutionWebhook(evo({ message: { extendedTextMessage: { text: "con link" } } }))[0]?.text).toBe("con link");
    expect(parseEvolutionWebhook(evo({}, { remoteJid: "999@lid", remoteJidAlt: "573009998877@s.whatsapp.net" }))[0]?.externalId).toBe("573009998877");
    expect(parseEvolutionWebhook(evo({}, { remoteJid: "999@lid" }))).toEqual([]);
    expect(parseEvolutionWebhook(null)).toEqual([]);
  });

  it("rejects calls without the right token and stays closed when no token is configured", async () => {
    expect((await post(mk(), evo(), {})).status).toBe(401);
    expect((await post(mk(), evo(), { "x-webhook-token": "bad" })).status).toBe(401);
    expect((await post(mk({}), evo())).status).toBe(503);
  });

  it("records the reply as a customer message without running the AI or sending anything", async () => {
    const app = mk();
    expect((await post(app, evo())).status).toBe(200);
    await crm.drain();
    const c = crm.findByExternal("whatsapp", "573001112233")!;
    expect(c.name).toBe("Recepción Clínica Demo");
    const msgs = crm.messages(c.id);
    expect(msgs.map((m) => [m.sender, m.body])).toEqual([["customer", "Hola, buenos días, claro que sí"]]);
  });

  it("is idempotent on retries and keeps one contact per number", async () => {
    const app = mk();
    await post(app, evo());
    await post(app, evo());
    await post(app, evo({ message: { conversation: "segundo" } }, { id: "EVO2" }));
    await crm.drain();
    const c = crm.findByExternal("whatsapp", "573001112233")!;
    expect(crm.messages(c.id)).toHaveLength(2);
  });

  it("records only the allowed numbers when EVOLUTION_ALLOWED_NUMBERS is set (personal chats never enter the CRM)", async () => {
    const app = mk({ EVOLUTION_WEBHOOK_TOKEN: "tok", EVOLUTION_ALLOWED_NUMBERS: "573001112233, 573001110000" });
    await post(app, evo());
    await post(app, evo({ pushName: "Familia" }, { remoteJid: "573229998877@s.whatsapp.net", id: "EVO9" }));
    await crm.drain();
    expect(crm.findByExternal("whatsapp", "573001112233")).toBeDefined();
    expect(crm.findByExternal("whatsapp", "573229998877")).toBeUndefined();
  });
  it("ignores other instances when EVOLUTION_INSTANCE is set", async () => {
    const app = mk({ EVOLUTION_WEBHOOK_TOKEN: "tok", EVOLUTION_INSTANCE: "otra" });
    await post(app, evo());
    await crm.drain();
    expect(crm.findByExternal("whatsapp", "573001112233")).toBeUndefined();
  });
});

describe("seed without demo contacts", () => {
  it("creates stages and rules but no fake contacts when demoContacts is false", () => {
    const fresh = new Crm(openDb(":memory:"));
    expect(seedIfEmpty(fresh, Date.now(), { demoContacts: false })).toBe(true);
    expect(Number((fresh.db.prepare("SELECT COUNT(*) AS c FROM contacts").get() as { c: number }).c)).toBe(0);
    expect(Number((fresh.db.prepare("SELECT COUNT(*) AS c FROM stages").get() as { c: number }).c)).toBeGreaterThan(0);
  });
});
