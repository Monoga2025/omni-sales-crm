import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../server/db.js";
import { Crm } from "../server/crm.js";
import { seedIfEmpty } from "../server/seed.js";
import { createApp } from "../server/app.js";
import { localProvider } from "../server/agent.js";
import { parseEvolutionWebhook } from "../server/channels.js";

const NUM = "573005555008";
const T0 = Date.UTC(2026, 9, 17, 14, 24); // 09:24 Colombia

let crm: Crm;
beforeEach(() => {
  crm = new Crm(openDb(":memory:"));
  seedIfEmpty(crm, Date.now(), { demoContacts: false });
});

const evo = (id: string, text: string, fromMe: boolean, at: number, pushName = "Daniel") => ({
  event: "messages.upsert",
  instance: "loovo-ventas",
  data: { key: { remoteJid: "573005555009@lid", remoteJidAlt: `${NUM}@s.whatsapp.net`, fromMe, id }, pushName, message: { conversation: text }, messageTimestamp: Math.floor(at / 1000) },
});

describe("own WhatsApp messages (Evolution fromMe)", () => {
  const fetchSpy = vi.fn(async () => new Response("{}"));
  const mk = () =>
    createApp(crm, localProvider, "nonexistent", {
      env: { EVOLUTION_WEBHOOK_TOKEN: "tok", EVOLUTION_ALLOWED_NUMBERS: NUM, WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_ID: "p" },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
  const post = (app: ReturnType<typeof mk>, body: unknown) =>
    app.request("/api/webhooks/evolution", { method: "POST", headers: { "content-type": "application/json", "x-webhook-token": "tok" }, body: JSON.stringify(body) });

  it("parses own messages with their timestamp", () => {
    expect(parseEvolutionWebhook(evo("A1", "Hola", true, T0))).toEqual([
      { channel: "whatsapp", externalId: NUM, name: undefined, text: "Hola", messageId: "A1", fromMe: true, at: T0 },
    ]);
  });

  it("stores own messages as human, at the WhatsApp time, without sending them", async () => {
    const app = mk();
    expect((await post(app, evo("A1", "Hola, quiero botox", true, T0))).status).toBe(200);
    await post(app, evo("B1", "Con quién tengo el gusto?", false, T0 + 10 * 60_000, "Recepción AURORA"));
    await crm.drain();
    const contact = crm.findByExternal("whatsapp", NUM)!;
    expect(contact.name).toBe(`+${NUM}`); // own pushName is not the clinic's name
    const msgs = crm.messages(contact.id);
    expect(msgs.map((m) => [m.sender, m.body, m.created_at])).toEqual([
      ["human", "Hola, quiero botox", T0],
      ["customer", "Con quién tengo el gusto?", T0 + 10 * 60_000],
    ]);
    expect(msgs[0]!.meta).toMatchObject({ external_id: "A1", source: "evolution" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(crm.getContact(contact.id)!.unread).toBe(1);
  });

  it("ignores duplicates and numbers outside the allowed list", async () => {
    const app = mk();
    await post(app, evo("A1", "Hola", true, T0));
    await post(app, evo("A1", "Hola", true, T0));
    await post(app, { ...evo("Z1", "personal", true, T0), data: { ...evo("Z1", "personal", true, T0).data, key: { remoteJid: "contacto008@example.com", fromMe: true, id: "Z1" } } });
    const contact = crm.findByExternal("whatsapp", NUM)!;
    expect(crm.messages(contact.id)).toHaveLength(1);
    expect(crm.findByExternal("whatsapp", "573005555010")).toBeUndefined();
  });

  it("orders late-recorded messages by their time and keeps recency", async () => {
    const app = mk();
    await post(app, evo("B1", "Respuesta", false, T0 + 60_000));
    const contact = crm.findByExternal("whatsapp", NUM)!;
    const recency = crm.getContact(contact.id)!.last_message_at;
    await post(app, evo("A1", "Pregunta", true, T0)); // backfilled after the reply
    expect(crm.messages(contact.id).map((m) => m.body)).toEqual(["Pregunta", "Respuesta"]);
    const row = crm.listContacts().find((c) => c.id === contact.id)!;
    expect([row.last_message, row.last_sender, row.last_message_at]).toEqual(["Respuesta", "customer", recency]);
  });
});
