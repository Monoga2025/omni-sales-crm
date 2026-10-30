import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../server/db.js";
import { Crm, parseBudget } from "../server/crm.js";
import { localProvider, anthropicProvider, handleInbound } from "../server/agent.js";
import { createApp } from "../server/app.js";
import { seedIfEmpty } from "../server/seed.js";

let crm: Crm;
let app: ReturnType<typeof createApp>;

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
};
const stageId = (name: string) => crm.listStages().find((s) => s.name === name)!.id;
const stageName = (contactId: number) => crm.getStage(crm.getContact(contactId)!.stage_id)!.name;

beforeEach(() => {
  crm = new Crm(openDb(":memory:"));
  seedIfEmpty(crm);
  app = createApp(crm, localProvider, "nonexistent");
});

describe("stage moves and automations", () => {
  it("moving into Negociación sends the offer message and switches the AI to aggressive close", async () => {
    const { json: created } = await call("POST", "/api/simulate/customer", { name: "Ana Pérez" });
    const id = created.contact.id;
    crm.listRules().filter((r) => r.name === "Recordatorio de oferta").forEach((r) => crm.updateRule(r.id, { enabled: true }));
    const moved = await call("POST", `/api/contacts/${id}/move`, { stage_id: stageId("Negociación") });
    expect(moved.status).toBe(200);
    expect(moved.json.stage_id).toBe(stageId("Negociación"));

    const detail = (await call("GET", `/api/contacts/${id}`)).json;
    expect(detail.ai_mode).toBe("close_aggressive");
    expect(detail.messages.at(-1)).toMatchObject({ sender: "ai" });
    expect(detail.messages.at(-1).body).toContain("Ana");
    expect(detail.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(["stage_changed", "automation_fired"]));
    expect(detail.events.find((e: any) => e.type === "stage_changed").actor).toBe("human");
  });

  it("a handoff rule flips the handler to human and writes a system note", () => {
    const id = crm.createContact({ name: "Rule Test" }).id;
    crm.createRule({
      name: "handoff on lost", trigger_type: "stage_enter", trigger_stage_id: stageId("Perdido"),
      trigger_value: "", action_type: "handoff", action_value: "needs review", enabled: true,
    });
    crm.moveStage(id, stageId("Perdido"), "human");
    expect(crm.getContact(id)!.handler).toBe("human");
    expect(crm.messages(id).at(-1)).toMatchObject({ sender: "system" });
  });

  it("disabled rules do not fire and entering a stage resets the per-contact mode override", () => {
    const id = crm.createContact({ name: "Mode Test" }).id;
    crm.createRule({
      name: "override", trigger_type: "stage_enter", trigger_stage_id: stageId("Calificando"),
      trigger_value: "", action_type: "set_ai_mode", action_value: "support", enabled: true,
    });
    crm.moveStage(id, stageId("Calificando"), "human");
    expect(crm.aiModeFor(crm.getContact(id)!)).toBe("support");
    crm.moveStage(id, stageId("Interesado"), "human");
    expect(crm.aiModeFor(crm.getContact(id)!)).toBe("nurture");
    crm.listRules().forEach((r) => crm.updateRule(r.id, { enabled: false }));
    const before = crm.messages(id).length;
    crm.moveStage(id, stageId("Negociación"), "human");
    expect(crm.messages(id).length).toBe(before);
  });

  it("rejects unknown stages and contacts with 4xx, not 500", async () => {
    const id = crm.createContact({ name: "X" }).id;
    expect((await call("POST", `/api/contacts/${id}/move`, { stage_id: 9999 })).status).toBe(400);
    expect((await call("POST", `/api/contacts/9999/move`, { stage_id: 1 })).status).toBe(404);
    expect((await call("POST", `/api/contacts/${id}/move`, {})).status).toBe(400);
  });
});

describe("AI agent (tool-calling)", () => {
  it("extracts lead data, tags, scores and advances the stage from a conversation", async () => {
    const { json } = await call("POST", "/api/simulate/customer", { message: "Hi, my name is Carlos Ruiz. I'm looking for a CRM for my agency" });
    const id = json.contact.id;
    expect(json.result.tools.map((t: any) => t.name)).toEqual(expect.arrayContaining(["update_lead", "set_lead_score", "move_stage"]));
    let d = (await call("GET", `/api/contacts/${id}`)).json;
    expect(d.contact.name).toBe("Carlos Ruiz");
    expect(d.contact.fields.interest).toContain("CRM");
    expect(d.contact.score).toBeGreaterThan(0);

    await call("POST", `/api/contacts/${id}/inbound`, { body: "How much does it cost? My budget is $3000, email carlos@agency.io, I need it today" });
    d = (await call("GET", `/api/contacts/${id}`)).json;
    expect(d.contact.email).toBe("carlos@agency.io");
    expect(d.contact.tags).toEqual(expect.arrayContaining(["precio-consultado", "con-presupuesto", "urgente"]));
    expect(d.contact.budget_value).toBe(3000);
    expect(d.contact.score).toBeGreaterThanOrEqual(55);
    expect(stageName(id)).toBe("Negociación");
    expect(d.ai_mode).toBe("close_aggressive");
    expect(d.events.filter((e: any) => e.type === "stage_changed").every((e: any) => e.actor !== "human")).toBe(true);
  });

  it("stores the tool calls of each AI turn on the AI message so the UI can show them", async () => {
    const { json } = await call("POST", "/api/simulate/customer", { message: "Hola, me llamo Marta Díaz, busco un CRM" });
    const d = (await call("GET", `/api/contacts/${json.contact.id}`)).json;
    const aiMsg = d.messages.filter((m: any) => m.sender === "ai").at(-1);
    const names = aiMsg.meta.tool_calls.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(["update_lead", "set_lead_score"]));
    expect(aiMsg.meta.tool_calls[0]).toHaveProperty("result");
    expect(aiMsg.meta.tool_calls[0]).toHaveProperty("input");
  });

  it("closes the sale when the customer confirms purchase with enough signal, and never moves a Ganado lead back", async () => {
    const { json } = await call("POST", "/api/simulate/customer", { message: "Hola, me llamo Marta Díaz, busco un CRM" });
    const id = json.contact.id;
    await call("POST", `/api/contacts/${id}/inbound`, { body: "Mi presupuesto es $2000, escribe a marta@mail.co, lo necesito hoy. Cuánto cuesta una demo?" });
    await call("POST", `/api/contacts/${id}/inbound`, { body: "Quiero comprar ahora" });
    expect(stageName(id)).toBe("Ganado");
    await call("POST", `/api/contacts/${id}/inbound`, { body: "hola de nuevo" });
    expect(stageName(id)).toBe("Ganado");
  });

  it("hands off to a human on request and stops answering afterwards", async () => {
    const { json } = await call("POST", "/api/simulate/customer", { message: "I want to speak to a real person" });
    const id = json.contact.id;
    expect(crm.getContact(id)!.handler).toBe("human");
    expect(crm.events(id).some((e) => e.type === "handoff")).toBe(true);
    const next = await call("POST", `/api/contacts/${id}/inbound`, { body: "hello?" });
    expect(next.json.replied).toBe(false);
    expect(crm.messages(id).at(-1)).toMatchObject({ sender: "customer", body: "hello?" });
  });

  it("moves to Perdido on a clear refusal", async () => {
    const { json } = await call("POST", "/api/simulate/customer", { message: "Not interested, thanks" });
    expect(stageName(json.contact.id)).toBe("Perdido");
  });

  it("rejects empty inbound messages", async () => {
    const id = crm.createContact({ name: "E" }).id;
    expect((await call("POST", `/api/contacts/${id}/inbound`, { body: "   " })).status).toBe(400);
  });

  it("the Anthropic provider runs a tool_use loop through the shared executor and sends the stage temperature", async () => {
    const calls: any[] = [];
    const responses = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "add_tag", input: { tag: "vip" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Listo!" }] },
    ];
    const fake = (async (_u: string, init: any) => {
      calls.push(JSON.parse(init.body));
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    }) as unknown as typeof fetch;
    const id = crm.createContact({ name: "Visitante 1" }).id;
    const r = await handleInbound(crm, anthropicProvider("k", "claude-haiku-5-5", fake), id, "hola");
    expect(r.reply).toBe("Listo!");
    expect(crm.getContact(id)!.tags).toContain("vip");
    expect(calls[1].messages.at(-1).content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
    expect(calls[0].tools.map((t: any) => t.name)).toContain("move_stage");
    expect(calls[0].temperature).toBeCloseTo(crm.getStage(crm.defaultStage().id)!.ai_temperature / 100, 2);
  });

  it("a provider failure hands the lead to a human instead of losing it", async () => {
    const failing = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const id = crm.createContact({ name: "Visitante 2" }).id;
    const r = await handleInbound(crm, anthropicProvider("k", "m", failing), id, "hola");
    expect(r.replied).toBe(false);
    expect(crm.getContact(id)!.handler).toBe("human");
  });
});

describe("inbox v2: notes, fields, attachments", () => {
  it("internal notes are stored as notes, never bump recency or unread, and never trigger the AI", async () => {
    const id = crm.createContact({ name: "Nota" }).id;
    const before = crm.getContact(id)!;
    const res = await call("POST", `/api/contacts/${id}/note`, { body: "Pidió factura a nombre de empresa" });
    expect(res.status).toBe(201);
    const after = crm.getContact(id)!;
    expect(after.last_message_at).toBe(before.last_message_at);
    expect(after.unread).toBe(before.unread);
    expect(crm.messages(id).at(-1)).toMatchObject({ sender: "note", body: "Pidió factura a nombre de empresa" });
    expect((await call("POST", `/api/contacts/${id}/note`, { body: " " })).status).toBe(400);
  });

  it("custom fields can be edited inline and removed; internal keys are protected", async () => {
    const id = crm.createContact({ name: "Campos" }).id;
    expect((await call("PUT", `/api/contacts/${id}/fields`, { key: "empresa", value: "ACME" })).status).toBe(200);
    expect(crm.getContact(id)!.fields.empresa).toBe("ACME");
    expect((await call("PUT", `/api/contacts/${id}/fields`, { key: "_ai_mode", value: "x" })).status).toBe(400);
    expect((await call("DELETE", `/api/contacts/${id}/fields/empresa`)).status).toBe(200);
    expect(crm.getContact(id)!.fields.empresa).toBeUndefined();
  });

  it("a human reply can carry an attachment descriptor and takes over the conversation", async () => {
    const id = crm.createContact({ name: "Adj" }).id;
    await call("POST", `/api/contacts/${id}/reply`, { body: "Te envío la propuesta", attachment: { name: "propuesta.pdf", size: 2048 } });
    const m = crm.messages(id).at(-1)!;
    expect(m.sender).toBe("human");
    expect(m.meta.attachment).toEqual({ name: "propuesta.pdf", size: 2048 });
    expect(crm.getContact(id)!.handler).toBe("human");
  });
});

describe("pipeline v2: reorder and budgets", () => {
  it("parseBudget understands $, thousands separators, k and mil", () => {
    expect(parseBudget("3000")).toBe(3000);
    expect(parseBudget("$3,000")).toBe(3000);
    expect(parseBudget("1.500")).toBe(1500);
    expect(parseBudget("2k")).toBe(2000);
    expect(parseBudget("2 mil")).toBe(2000);
    expect(parseBudget("3.5k")).toBe(3500);
    expect(parseBudget("")).toBe(0);
    expect(parseBudget("sin idea")).toBe(0);
  });

  it("place persists the order inside a column and moves across columns firing rules once", async () => {
    const stage = stageId("Calificando");
    const seeded = crm.listContacts().filter((x) => x.stage_id === stage).length;
    const a = crm.createContact({ name: "A", stage_id: stage }).id;
    const b = crm.createContact({ name: "B", stage_id: stage }).id;
    const c = crm.createContact({ name: "C", stage_id: stage }).id;
    const order = () => crm.listContacts().filter((x) => x.stage_id === stage).sort((x, y) => x.sort_order - y.sort_order).map((x) => x.name);
    expect(order()).toHaveLength(3 + seeded);
    const r = await call("POST", "/api/pipeline/place", { contact_id: c, stage_id: stage, index: 0 });
    expect(r.status).toBe(200);
    expect(order()[0]).toBe("C");
    await call("POST", "/api/pipeline/place", { contact_id: a, stage_id: stage, index: 2 });
    expect(order().indexOf("A")).toBe(2);
    expect(crm.events(c).filter((e) => e.type === "stage_changed")).toHaveLength(0); // same-column reorder is not a stage change

    const neg = stageId("Negociación");
    crm.listRules().filter((r) => r.name === "Recordatorio de oferta").forEach((r) => crm.updateRule(r.id, { enabled: true }));
    await call("POST", "/api/pipeline/place", { contact_id: b, stage_id: neg, index: 0 });
    expect(stageName(b)).toBe("Negociación");
    expect(crm.messages(b).filter((m) => m.sender === "ai")).toHaveLength(1); // offer rule fired once
    expect(crm.listContacts().filter((x) => x.stage_id === neg).sort((x, y) => x.sort_order - y.sort_order)[0]!.id).toBe(b);
    expect((await call("POST", "/api/pipeline/place", { contact_id: b, stage_id: 9999, index: 0 })).status).toBe(400);
    expect((await call("POST", "/api/pipeline/place", { contact_id: 9999, stage_id: neg, index: 0 })).status).toBe(404);
  });

  it("contacts expose a numeric budget_value parsed from the budget field", () => {
    const id = crm.createContact({ name: "Presu" }).id;
    crm.setFields(id, { budget: "2 mil" }, "human");
    expect(crm.listContacts().find((x) => x.id === id)!.budget_value).toBe(2000);
  });
});

describe("analytics v2", () => {
  it("funnel step rates never exceed 100% and are computed from reach-or-beyond", async () => {
    const a = (await call("GET", "/api/analytics")).json;
    expect(a.totals.contacts).toBeGreaterThanOrEqual(10);
    const names = a.funnel.map((f: any) => f.name);
    expect(names).toEqual(["Nuevo", "Calificando", "Interesado", "Negociación", "Ganado"]);
    expect(a.funnel[0].reached).toBe(a.totals.contacts);
    expect(a.funnel[0].step_rate).toBeNull();
    for (const f of a.funnel.slice(1)) {
      expect(f.step_rate).toBeLessThanOrEqual(100);
      expect(f.pct_of_leads).toBeLessThanOrEqual(100);
    }
    const reached = a.funnel.map((f: any) => f.reached);
    expect([...reached].sort((x, y) => y - x)).toEqual(reached); // monotonic non-increasing
  });

  it("reports comparison trends, per-channel breakdown and AI vs human performance from stored data", async () => {
    const a = (await call("GET", "/api/analytics")).json;
    expect(a.trend.contacts.current).toBeGreaterThan(0);
    expect(a.trend.contacts.previous).toBeGreaterThan(0);
    expect(a.by_channel.map((c: any) => c.channel)).toEqual(expect.arrayContaining(["whatsapp", "instagram"]));
    const sum = a.by_channel.reduce((n: number, c: any) => n + c.contacts, 0);
    expect(sum).toBe(a.totals.contacts);
    expect(a.handler_perf.ai.contacts + a.handler_perf.human.contacts).toBe(a.totals.contacts);
    expect(a.totals.open_value).toBeGreaterThan(0);
    expect(a.totals.won_value).toBeGreaterThan(0);

    await call("POST", "/api/simulate/customer", { channel: "messenger", message: "Quiero comprar, me llamo Pablo" });
    const b = (await call("GET", "/api/analytics")).json;
    expect(b.totals.contacts).toBe(a.totals.contacts + 1);
    const msgr = (x: any) => x.by_channel.find((c: any) => c.channel === "messenger").contacts;
    expect(msgr(b)).toBe(msgr(a) + 1);
    expect(b.messages.customer).toBe(a.messages.customer + 1);
  });
});

describe("flow builder persistence", () => {
  it("stores node positions, validates input, and exposes the stage temperature", async () => {
    expect((await call("GET", "/api/flow/layout")).json).toEqual({});
    const put = await call("PUT", "/api/flow/layout", { nodes: [{ id: "stage:1", x: 120.5, y: 40 }, { id: "ai", x: 0, y: 0 }] });
    expect(put.status).toBe(200);
    expect((await call("GET", "/api/flow/layout")).json["stage:1"]).toEqual({ x: 120.5, y: 40 });
    expect((await call("PUT", "/api/flow/layout", { nodes: [{ id: "x", x: "a", y: 1 }] })).status).toBe(400);

    const neg = stageId("Negociación");
    const up = await call("PUT", `/api/stages/${neg}`, { ai_temperature: 85 });
    expect(up.json.ai_temperature).toBe(85);
    expect((await call("PUT", `/api/stages/${neg}`, { ai_temperature: 140 })).status).toBe(400);
  });
});

describe("configuration persistence", () => {
  it("stage prompt/mode edits and rule CRUD persist and keep won/default flags exclusive", async () => {
    const neg = stageId("Negociación");
    const up = await call("PUT", `/api/stages/${neg}`, { ai_prompt: "Sé directo", ai_mode: "nurture" });
    expect(up.json).toMatchObject({ ai_prompt: "Sé directo", ai_mode: "nurture" });
    expect((await call("PUT", `/api/stages/${neg}`, { ai_mode: "bogus" })).status).toBe(400);

    await call("PUT", `/api/stages/${neg}`, { is_won: true });
    expect(crm.listStages().filter((s) => s.is_won)).toHaveLength(1);

    const created = await call("POST", "/api/rules", {
      name: "Etiquetar VIP", trigger_type: "score_gte", trigger_value: "90", action_type: "add_tag", action_value: "vip",
    });
    expect(created.status).toBe(201);
    expect((await call("POST", "/api/rules", { name: "bad", trigger_type: "nope", action_type: "add_tag" })).status).toBe(400);
    expect((await call("POST", "/api/rules", { name: "bad", trigger_type: "score_gte", trigger_value: "abc", action_type: "add_tag" })).status).toBe(400);
    await call("PUT", `/api/rules/${created.json.id}`, { enabled: false });
    expect(crm.listRules().find((r) => r.id === created.json.id)!.enabled).toBe(false);
    expect((await call("DELETE", `/api/rules/${created.json.id}`)).status).toBe(200);
    expect((await call("DELETE", `/api/stages/${stageId("Ganado")}`)).status).toBe(400); // still has contacts
  });
});
