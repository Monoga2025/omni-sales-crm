import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../server/db.js";
import { Crm } from "../server/crm.js";
import { seedIfEmpty } from "../server/seed.js";
import { createApp } from "../server/app.js";
import { localProvider } from "../server/agent.js";
import { casualText } from "../server/suggest.js";

let crm: Crm;
beforeEach(() => {
  crm = new Crm(openDb(":memory:"));
  seedIfEmpty(crm, Date.now(), { demoContacts: false });
});

const anthropicOk = (text: string) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 }));

const chat = () => {
  const c = crm.createContact({ name: "Demo", phone: "573001112233" });
  crm.patchContact(c.id, { handler: "human" });
  crm.addMessage(c.id, "human", "Hola, quiero botox en la frente", {}, { deliver: false });
  crm.addMessage(c.id, "customer", "¿Con quién tengo el gusto?");
  return c;
};

describe("AI suggested reply", () => {
  it("drafts the next message from the conversation and the saved instructions, without sending anything", async () => {
    const fetchImpl = anthropicOk('"Con Daniel, ¿cuánto vale?"');
    const app = createApp(crm, localProvider, "nonexistent", { env: { ANTHROPIC_API_KEY: "k" }, fetchImpl: fetchImpl as unknown as typeof fetch });
    const c = chat();
    const put = await app.request("/api/suggest/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ instructions: "Soy un paciente llamado Daniel." }) });
    expect(put.status).toBe(200);
    expect(await (await app.request("/api/suggest/settings")).json()).toEqual({ instructions: "Soy un paciente llamado Daniel." });

    const res = await app.request(`/api/contacts/${c.id}/suggest`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: "Con Daniel cuánto vale?", parts: ["Con Daniel cuánto vale?"] });
    const req = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(req.system).toContain("Soy un paciente llamado Daniel.");
    const prompt = JSON.stringify(req.messages);
    expect(prompt).toContain("Hola, quiero botox en la frente");
    expect(prompt).toContain("¿Con quién tengo el gusto?");
    expect(crm.messages(c.id)).toHaveLength(2); // nothing stored, nothing sent
    expect(req.system).toMatch(/personaliza/i);
    expect(req.temperature).toBe(1); // varied wording, not the same message for every clinic
  });

  it("splits a long suggestion into two or three WhatsApp messages written casually", async () => {
    const fetchImpl = anthropicOk("Listo, muchas gracias.\n\n¿La valoración tiene costo? Es que vi que el botox está en $480.000.\n\n¡Lo pienso y les confirmo!");
    const app = createApp(crm, localProvider, "nonexistent", { env: { ANTHROPIC_API_KEY: "k" }, fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await (await app.request(`/api/contacts/${chat().id}/suggest`, { method: "POST" })).json();
    expect(res.parts).toEqual(["Listo muchas gracias", "La valoración tiene costo? Es que vi que el botox está en $480.000", "Lo pienso y les confirmo!"]);
    expect(res.text).toBe(res.parts.join("\n\n"));
  });

  it("writes like a phone chat: no periods, commas or opening marks, numbers untouched", () => {
    expect(casualText("Hola, buenos días. ¿Tienen cita esta semana?")).toBe("Hola buenos días tienen cita esta semana?");
    expect(casualText("¡Qué bien! Gracias.")).toBe("Qué bien! Gracias");
    expect(casualText("Cuesta $1.500.000, o 1,5 millones...")).toBe("Cuesta $1.500.000 o 1,5 millones...");
  });

  it("explains that an AI key is missing", async () => {
    const app = createApp(crm, localProvider, "nonexistent", { env: {} });
    const res = await app.request(`/api/contacts/${chat().id}/suggest`, { method: "POST" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("ANTHROPIC_API_KEY");
  });

  it("reports a provider failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("overloaded", { status: 529 }));
    const app = createApp(crm, localProvider, "nonexistent", { env: { ANTHROPIC_API_KEY: "k" }, fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await app.request(`/api/contacts/${chat().id}/suggest`, { method: "POST" });
    expect(res.status).toBe(502);
  });

  it("returns 404 for an unknown contact", async () => {
    const app = createApp(crm, localProvider, "nonexistent", { env: { ANTHROPIC_API_KEY: "k" }, fetchImpl: anthropicOk("x") as unknown as typeof fetch });
    expect((await app.request("/api/contacts/9999/suggest", { method: "POST" })).status).toBe(404);
  });
});
