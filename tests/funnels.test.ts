import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../server/db.js";
import { Crm } from "../server/crm.js";
import { seedIfEmpty } from "../server/seed.js";
import { handleInbound, localProvider } from "../server/agent.js";
import { applyFunnelTrigger, CONTADORES_PROFILE, CONTADORES_TAG, detectTrigger, ensureContadoresFunnel, profileOf } from "../server/funnels.js";

let crm: Crm;
beforeEach(() => {
  crm = new Crm(openDb(":memory:"));
  seedIfEmpty(crm, Date.now(), { demoContacts: false });
  process.env.CONTADORES_LINK_D1 = "https://loovo.test/s1";
  process.env.CONTADORES_LINK_D2 = "https://loovo.test/s2";
  process.env.CONTADORES_LINK_D3 = "https://loovo.test/s3";
});

const stageName = (id: number) => crm.getStage(id)!.name;
const lead = (channel = "instagram") => crm.createContact({ name: "Cliente Instagram", channel });
const say = (id: number, text: string) => handleInbound(crm, localProvider, id, text);

describe("detectTrigger", () => {
  it.each([
    ["D1", "D1"], ["d1", "D1"], ["quiero el D1 porfa", "D1"], ["de uno", "D1"], ["De uno!", "D1"],
    ["D2", "D2"], ["d 2", "D2"], ["dedos", "D2"], ["D3", "D3"], ["Yo quiero D3 😍", "D3"],
    ["D1 D3", "D3"], // the highest one wins
  ])("%s -> %s", (text, expected) => expect(detectTrigger(text)).toBe(expected));

  it.each(["hola", "D10", "AD1", "me duelen los dedos de la mano", "una cuota de uno de mis clientes", "vitamina D12", ""])(
    "ignores %j",
    (text) => expect(detectTrigger(text)).toBeNull(),
  );
});

describe("Embudo Contadores", () => {
  it("D1 tags, scores, moves and answers with the Sistema 1 link", async () => {
    const c = lead();
    const r = await say(c.id, "D1");
    const after = crm.getContact(c.id)!;
    expect(r.provider).toBe("funnel");
    expect(after.tags).toEqual(expect.arrayContaining([CONTADORES_TAG, "lead-contador-d1", "interes-agente-tributario"]));
    expect(stageName(after.stage_id)).toBe("Contadores · Interesado DIAN");
    expect(after.score).toBe(35);
    expect(after.fields).toMatchObject({ disparador: "D1" });
    const ai = crm.messages(c.id).filter((m) => m.sender === "ai").map((m) => m.body);
    expect(ai).toHaveLength(2);
    expect(ai[0]).toContain("https://loovo.test/s1");
    expect(ai[0]).not.toContain("{{link}}");
    expect(ai[1]).toContain("personas naturales o jurídicas");
  });

  it("D2 answers with the two systems and the digitizing question", async () => {
    const c = lead();
    await say(c.id, "dedos");
    const after = crm.getContact(c.id)!;
    expect(after.tags).toEqual(expect.arrayContaining(["lead-contador-d2", "dolor-digitacion"]));
    expect(stageName(after.stage_id)).toBe("Contadores · Interesado Extractor");
    const ai = crm.messages(c.id).filter((m) => m.sender === "ai").map((m) => m.body);
    expect(ai[0]).toContain("https://loovo.test/s2");
    expect(ai[1]).toContain("digitas facturas a mano");
  });

  it("D3 is a hot lead that goes straight to Cierre / Demo", async () => {
    const c = lead();
    await say(c.id, "D3");
    const after = crm.getContact(c.id)!;
    expect(stageName(after.stage_id)).toBe("Contadores · Cierre / Demo");
    expect(after.score).toBeGreaterThanOrEqual(70);
    expect(after.tags).toEqual(expect.arrayContaining(["lead-contador-vip-d3", "alta-intencion-compra", "lead-caliente"]));
    expect(crm.messages(c.id).some((m) => m.sender === "ai" && m.body.includes("agendemos 15 min"))).toBe(true);
  });

  it("never moves a lead backwards and does not resend the same reply", async () => {
    const c = lead();
    await say(c.id, "D3");
    const sent = crm.messages(c.id).filter((m) => m.sender === "ai").length;
    await say(c.id, "D1");
    const after = crm.getContact(c.id)!;
    expect(stageName(after.stage_id)).toBe("Contadores · Cierre / Demo");
    expect(after.score).toBeGreaterThanOrEqual(70);
    await say(c.id, "D3");
    const replies = crm.messages(c.id).filter((m) => m.sender === "ai");
    expect(replies.filter((m) => m.meta.funnel === "D3")).toHaveLength(2); // only the first D3 got the canned reply
    expect(replies.length).toBeGreaterThanOrEqual(sent);
  });

  it("without a configured link it hands off instead of sending a placeholder", async () => {
    delete process.env.CONTADORES_LINK_D2;
    const c = lead();
    await say(c.id, "D2");
    const after = crm.getContact(c.id)!;
    expect(after.handler).toBe("human");
    expect(after.tags).toContain("lead-contador-d2");
    expect(crm.messages(c.id).some((m) => m.body.includes("{{link}}") || m.body.includes("[LINK"))).toBe(false);
    expect(crm.messages(c.id).some((m) => m.sender === "system" && m.body.includes("CONTADORES_LINK_D2"))).toBe(true);
  });

  it("tags and moves the lead but stays silent when a human owns the chat", async () => {
    const c = lead();
    crm.patchContact(c.id, { handler: "human" });
    const r = await say(c.id, "D2");
    expect(r.replied).toBe(false);
    expect(crm.messages(c.id).filter((m) => m.sender === "ai")).toHaveLength(0);
    expect(stageName(crm.getContact(c.id)!.stage_id)).toBe("Contadores · Interesado Extractor");
  });

  it("uses its own business profile and knowledge, and leaves the clinic funnel untouched", () => {
    const stagesBefore = crm.listStages().map((s) => s.name);
    const clinicBusiness = crm.getBusiness();
    const clinicKnowledge = crm.listKnowledge().map((k) => k.title);
    ensureContadoresFunnel(crm);
    ensureContadoresFunnel(crm); // idempotent
    expect(crm.listStages().map((s) => s.name).filter((n) => n.startsWith("Contadores"))).toHaveLength(3);
    expect(crm.listStages().map((s) => s.name).slice(0, stagesBefore.length)).toEqual(stagesBefore);
    expect(crm.getBusiness()).toEqual(clinicBusiness);
    expect(crm.listKnowledge().map((k) => k.title)).toEqual(clinicKnowledge);
    expect(crm.getBusiness(CONTADORES_PROFILE).name).toContain("Loovo");
    expect(crm.listKnowledge(CONTADORES_PROFILE).length).toBeGreaterThanOrEqual(4);
    expect(crm.listRules().filter((r) => r.name === "Contador VIP D3 es lead caliente")).toHaveLength(1);
  });

  it("selects the profile by tag: contadores contacts get their business, clinic contacts keep theirs", () => {
    const c = lead();
    expect(profileOf(crm.getContact(c.id)!)).toBe("");
    applyFunnelTrigger(crm, c.id, "D1");
    expect(profileOf(crm.getContact(c.id)!)).toBe(CONTADORES_PROFILE);
    expect(crm.relevantKnowledge("DIAN", 6000, CONTADORES_PROFILE).every((k) => k.profile === CONTADORES_PROFILE)).toBe(true);
    expect(crm.relevantKnowledge("blanqueamiento").every((k) => k.profile === "")).toBe(true);
  });

  it("a normal clinic message is not treated as a trigger", async () => {
    const c = lead("whatsapp");
    const r = await say(c.id, "Hola, ¿cuánto cuesta el blanqueamiento dental?");
    expect(r.provider).not.toBe("funnel");
    expect(crm.getContact(c.id)!.tags).not.toContain(CONTADORES_TAG);
    expect(crm.listStages().some((s) => s.name.startsWith("Contadores"))).toBe(false); // nothing is created until a trigger fires
  });
});
