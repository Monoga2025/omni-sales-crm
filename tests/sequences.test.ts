import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { openDb } from "../server/db.js";
import { Crm, renderTemplate, type SequenceStepInput } from "../server/crm.js";
import { seedIfEmpty } from "../server/seed.js";
import { createApp } from "../server/app.js";
import { localProvider } from "../server/agent.js";

const MIN = 60_000;
const DAY = 1440 * MIN;
const STEPS: SequenceStepInput[] = [
  { channel: "whatsapp", title: "Auditoría", template: "Hola, quiero info", delay_minutes: 0 },
  { channel: "instagram_dm", title: "DM al doctor", template: "Dr. {{apellido}}, buenas", delay_minutes: 1440 },
  { channel: "instagram_comment", title: "Comentario en Reel", template: "Buen contenido", delay_minutes: 2 },
];

let crm: Crm;
let now: number;
beforeEach(() => {
  crm = new Crm(openDb(":memory:"));
  seedIfEmpty(crm, Date.now(), { demoContacts: false });
  now = Date.UTC(2026, 9, 17, 13, 0);
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

const setup = (exit_on_reply = true) => {
  const seq = crm.createSequence({ name: "8 toques", exit_on_reply, steps: STEPS });
  const contact = crm.createContact({ name: "Demo", phone: "573001112233" });
  return { seq, contact };
};

describe("sequences: model", () => {
  it("creates a sequence with ordered steps and lists it", () => {
    const { seq } = setup();
    expect(seq.steps.map((s) => s.title)).toEqual(["Auditoría", "DM al doctor", "Comentario en Reel"]);
    expect(seq.exit_on_reply).toBe(true);
    expect(crm.listSequences().map((s) => s.id)).toEqual([seq.id]);
  });

  it("rejects an empty sequence and an unknown channel", () => {
    expect(() => crm.createSequence({ name: "x", exit_on_reply: true, steps: [] })).toThrow(/empty/);
    expect(() => crm.createSequence({ name: "x", exit_on_reply: true, steps: [{ ...STEPS[0]!, channel: "fax" as never }] })).toThrow(/invalid channel/);
  });
});

describe("sequences: enrollment and steps", () => {
  it("enrolls with step 1 due now and logs an event", () => {
    const { seq, contact } = setup();
    const e = crm.enroll(contact.id, seq.id, "human");
    expect(e).toMatchObject({ status: "active", position: 0, next_due_at: now, contact_id: contact.id });
    expect(crm.events(contact.id).map((x) => x.type)).toContain("sequence_enrolled");
  });

  it("allows only one active enrollment per contact", () => {
    const { seq, contact } = setup();
    crm.enroll(contact.id, seq.id, "human");
    expect(() => crm.enroll(contact.id, seq.id, "human")).toThrow(/invalid: contact already enrolled/);
  });

  it("completing a step schedules the next one from the completion time (task waits until done)", () => {
    const { seq, contact } = setup();
    const e = crm.enroll(contact.id, seq.id, "human");
    vi.setSystemTime(now + 3 * DAY); // done late: the next delay counts from completion
    const next = crm.completeStep(e.id, "done", "human", "enviado");
    expect(next).toMatchObject({ status: "active", position: 1, next_due_at: now + 3 * DAY + DAY });
    const ev = crm.events(contact.id).find((x) => x.type === "sequence_step")!;
    expect(ev.data).toMatchObject({ position: 0, title: "Auditoría", outcome: "done", note: "enviado" });
  });

  it("skipping also advances, and the last step finishes the enrollment", () => {
    const { seq, contact } = setup();
    const e = crm.enroll(contact.id, seq.id, "human");
    crm.completeStep(e.id, "done", "human");
    crm.completeStep(e.id, "skipped", "human");
    const last = crm.completeStep(e.id, "done", "human");
    expect(last).toMatchObject({ status: "finished", next_due_at: null });
    expect(crm.activeEnrollment(contact.id)).toBeUndefined();
    expect(crm.events(contact.id).map((x) => x.type)).toContain("sequence_finished");
    expect(() => crm.completeStep(e.id, "done", "human")).toThrow(/invalid: enrollment is not active/);
  });

  it("never creates or sends a message when steps are completed", () => {
    const sent = vi.fn();
    crm.setOutbound(sent);
    const { seq, contact } = setup();
    const e = crm.enroll(contact.id, seq.id, "human");
    crm.completeStep(e.id, "done", "human");
    crm.exitEnrollment(e.id, "Respondió por Instagram", "human");
    expect(crm.messages(contact.id)).toEqual([]);
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("sequences: replies", () => {
  it("exits on a customer reply when exit_on_reply is on", () => {
    const { seq, contact } = setup(true);
    const e = crm.enroll(contact.id, seq.id, "human");
    vi.setSystemTime(now + 42 * MIN);
    crm.addMessage(contact.id, "customer", "Hola, sí claro");
    const after = crm.getEnrollment(e.id)!;
    expect(after).toMatchObject({ status: "exited", exit_reason: "reply", first_reply_at: now + 42 * MIN });
    expect(crm.events(contact.id).map((x) => x.type)).toContain("sequence_exited");
  });

  it("only records the first reply time when exit_on_reply is off", () => {
    const { seq, contact } = setup(false);
    const e = crm.enroll(contact.id, seq.id, "human");
    vi.setSystemTime(now + 10 * MIN);
    crm.addMessage(contact.id, "customer", "Buenos días, ¿qué tratamiento?");
    vi.setSystemTime(now + 20 * MIN);
    crm.addMessage(contact.id, "customer", "Le paso precios");
    expect(crm.getEnrollment(e.id)).toMatchObject({ status: "active", first_reply_at: now + 10 * MIN });
    expect(crm.events(contact.id).find((x) => x.type === "sequence_reply")!.data).toMatchObject({ minutes: 10 });
  });

  it("times the first reply from the last completed step (when the message was sent), not from enrollment", () => {
    const { seq, contact } = setup(false);
    const e = crm.enroll(contact.id, seq.id, "human");
    vi.setSystemTime(now + 5 * 60 * MIN); // sent five hours after enrolling
    crm.completeStep(e.id, "done", "human");
    vi.setSystemTime(now + 5 * 60 * MIN + 15 * MIN);
    crm.addMessage(contact.id, "customer", "Hola, sí tenemos cupo");
    expect(crm.events(contact.id).find((x) => x.type === "sequence_reply")!.data).toMatchObject({ minutes: 15 });
    expect(crm.getEnrollment(e.id)).toMatchObject({ last_step_at: now + 5 * 60 * MIN });
  });

  it("ignores non-customer messages", () => {
    const { seq, contact } = setup(true);
    const e = crm.enroll(contact.id, seq.id, "human");
    crm.addMessage(contact.id, "note", "nota interna");
    expect(crm.getEnrollment(e.id)).toMatchObject({ status: "active", first_reply_at: null });
  });

  it("manual exit keeps the given reason", () => {
    const { seq, contact } = setup();
    const e = crm.enroll(contact.id, seq.id, "human");
    expect(crm.exitEnrollment(e.id, "Respondió por Instagram", "human")).toMatchObject({ status: "exited", exit_reason: "Respondió por Instagram" });
  });
});

describe("sequences: task queue", () => {
  it("lists only active steps due until the given time, oldest first, with rendered text", () => {
    const { seq, contact } = setup();
    crm.setFields(contact.id, { apellido: "Cadena" }, "human");
    const other = crm.createContact({ name: "Perla", phone: "573000000099" });
    const e1 = crm.enroll(contact.id, seq.id, "human");
    crm.completeStep(e1.id, "done", "human"); // next due tomorrow
    vi.setSystemTime(now + MIN);
    crm.enroll(other.id, seq.id, "human"); // due now + 1 min

    const today = crm.tasks(now + 2 * MIN);
    expect(today.map((t) => t.contact.name)).toEqual(["Perla"]);
    expect(today[0]).toMatchObject({ step: { title: "Auditoría" }, step_number: 1, total_steps: 3, text: "Hola, quiero info" });

    const tomorrow = crm.tasks(now + 2 * DAY);
    expect(tomorrow.map((t) => t.contact.name)).toEqual(["Perla", "Demo"]);
    expect(tomorrow[1]!.text).toBe("Dr. Cadena, buenas");
  });
});

describe("renderTemplate", () => {
  it("fills nombre and contact fields, and leaves unknown placeholders visible", () => {
    const c = { name: "Clínica X", fields: { apellido: "Reyes" } };
    expect(renderTemplate("Hola {{nombre}}, Dra. {{apellido}} {{ tratamiento }}", c)).toBe("Hola Clínica X, Dra. Reyes {{tratamiento}}");
  });
});

describe("sequences: HTTP API", () => {
  const mkApp = () => createApp(crm, localProvider, "nonexistent", { env: {} });
  const call = async (app: ReturnType<typeof mkApp>, method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as any };
  };

  it("creates, lists and edits sequences; refuses step edits while contacts are enrolled", async () => {
    const app = mkApp();
    const created = await call(app, "POST", "/api/sequences", { name: "8 toques", exit_on_reply: false, steps: STEPS });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ name: "8 toques", exit_on_reply: false });
    expect((await call(app, "GET", "/api/sequences")).json).toHaveLength(1);
    expect((await call(app, "POST", "/api/sequences", { name: "x", steps: [] })).status).toBe(400);

    const c = crm.createContact({ name: "Demo" });
    expect((await call(app, "POST", `/api/contacts/${c.id}/enroll`, { sequence_id: created.json.id })).status).toBe(201);
    const blocked = await call(app, "PUT", `/api/sequences/${created.json.id}`, { steps: STEPS.slice(0, 1) });
    expect(blocked).toMatchObject({ status: 400, json: { error: "invalid: sequence has active enrollments" } });
    expect((await call(app, "PUT", `/api/sequences/${created.json.id}`, { name: "Lote 1" })).json.name).toBe("Lote 1");
  });

  it("bulk-creates WhatsApp contacts keyed by phone, human-handled, without duplicates", async () => {
    const app = mkApp();
    const r = await call(app, "POST", "/api/contacts/bulk", {
      contacts: [
        { name: "Demo", phone: "+57 300 000 0001", fields: { apellido: "Cadena" } },
        { name: "Perla", phone: "+57 300 000 0002" },
      ],
    });
    expect(r).toMatchObject({ status: 201, json: { created: 2, existing: 0 } });
    const again = await call(app, "POST", "/api/contacts/bulk", { contacts: [{ name: "Demo otra vez", phone: "573001110000" }] });
    expect(again.json).toMatchObject({ created: 0, existing: 1, ids: [r.json.ids[0]] });
    const demo = crm.findByExternal("whatsapp", "573001110000")!;
    expect(demo).toMatchObject({ name: "Demo", handler: "human", fields: { apellido: "Cadena" } });
    expect((await call(app, "POST", "/api/contacts/bulk", { contacts: [{ name: "Sin número", phone: "" }] })).status).toBe(400);
  });

  it("a webhook reply attaches to the bulk-created contact and is timed by its enrollment", async () => {
    const app = createApp(crm, localProvider, "nonexistent", { env: { EVOLUTION_WEBHOOK_TOKEN: "tok" } });
    const { json } = await call(app, "POST", "/api/contacts/bulk", { contacts: [{ name: "Demo", phone: "573001110000" }] });
    const seq = crm.createSequence({ name: "8 toques", exit_on_reply: false, steps: STEPS });
    crm.enroll(json.ids[0], seq.id, "human");
    vi.setSystemTime(now + 5 * MIN);
    await app.request("/api/webhooks/evolution", {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-token": "tok" },
      body: JSON.stringify({ event: "messages.upsert", instance: "x", data: { key: { remoteJid: "573001110000@s.whatsapp.net", fromMe: false, id: "M1" }, pushName: "Recepción", message: { conversation: "Hola, buenos días" } } }),
    });
    expect(crm.activeEnrollment(json.ids[0])).toMatchObject({ first_reply_at: now + 5 * MIN });
  });

  it("serves the task queue with a wa.me link and completes, skips and exits steps", async () => {
    const app = mkApp();
    const seq = crm.createSequence({ name: "8 toques", exit_on_reply: false, steps: STEPS });
    const c = crm.createContact({ name: "Demo", phone: "573001110000" });
    const enrolled = await call(app, "POST", `/api/contacts/${c.id}/enroll`, { sequence_id: seq.id });

    const q = await call(app, "GET", `/api/tasks?until=${now + MIN}`);
    expect(q.json).toHaveLength(1);
    expect(q.json[0]).toMatchObject({ text: "Hola, quiero info", wa_link: "https://wa.me/573001110000?text=Hola%2C%20quiero%20info", step_number: 1 });

    const done = await call(app, "POST", `/api/enrollments/${enrolled.json.id}/complete`, { note: "enviado 8:05" });
    expect(done.json).toMatchObject({ position: 1, status: "active" });
    expect((await call(app, "GET", `/api/tasks?until=${now + MIN}`)).json).toHaveLength(0);
    expect((await call(app, "POST", `/api/enrollments/${enrolled.json.id}/complete`)).json.position).toBe(2); // empty body is fine
    const exited = await call(app, "POST", `/api/enrollments/${enrolled.json.id}/exit`, { reason: "Respondió por Instagram" });
    expect(exited.json).toMatchObject({ status: "exited", exit_reason: "Respondió por Instagram" });
    expect(await call(app, "POST", `/api/enrollments/${enrolled.json.id}/complete`)).toMatchObject({ status: 400, json: { error: "invalid: enrollment is not active" } });

    const other = crm.createContact({ name: "Perla", phone: "573000000099" });
    const e2 = await call(app, "POST", `/api/contacts/${other.id}/enroll`, { sequence_id: seq.id });
    expect((await call(app, "POST", `/api/enrollments/${e2.json.id}/skip`)).json.position).toBe(1);
    expect(crm.events(other.id).find((x) => x.type === "sequence_step")!.data).toMatchObject({ outcome: "skipped" });

    const detail = await call(app, "GET", `/api/contacts/${c.id}`);
    expect(detail.json.enrollment).toMatchObject({ status: "exited", sequence_name: "8 toques", total_steps: 3 });
    expect((await call(app, "GET", "/api/tasks?until=abc")).status).toBe(400);
  });
});
