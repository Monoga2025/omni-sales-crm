import { describe, expect, it } from "vitest";
import { coverage, humanizeText, humanPace, instantPace, similarity, splitBubbles } from "../server/humanize.js";

describe("splitBubbles", () => {
  it("splits on --- lines, trims, drops empties and keeps short messages intact", () => {
    expect(splitBubbles("todo bien, gracias! y tú?\n---\ncuéntame, en qué te colaboro")).toEqual(["todo bien, gracias! y tú?", "cuéntame, en qué te colaboro"]);
    expect(splitBubbles("  hola  ")).toEqual(["hola"]);
    expect(splitBubbles("uno\n---\n\n---\ndos")).toEqual(["uno", "dos"]);
    expect(splitBubbles("")).toEqual([]);
  });

  it("also treats an inline --- as a bubble break and never leaves it in the text", () => {
    expect(splitBubbles("bien, gracias --- y tú?")).toEqual(["bien, gracias", "y tú?"]);
    expect(splitBubbles("nos alcanza perfecto. ---")).toEqual(["nos alcanza perfecto."]);
    expect(splitBubbles("--- hola")).toEqual(["hola"]);
  });

  it("splits paragraphs when the model forgot the separator", () => {
    expect(splitBubbles("primero esto\n\nluego esto otro")).toEqual(["primero esto", "luego esto otro"]);
  });

  it("treats single line breaks as bubble breaks", () => {
    expect(splitBubbles("cuotas mensuales de $180.000 \nlo demás lo confirmo con el equipo ")).toEqual(["cuotas mensuales de $180.000", "lo demás lo confirmo con el equipo"]);
  });

  it("chunks one long message by sentences into at most 3 bubbles", () => {
    const long = "Mira, la ortodoncia con brackets metálicos sale en total $2.800.000 y se puede en cuotas. Incluye los controles mensuales y el retenedor al final del tratamiento. La valoración no tiene costo y dura 30 minutos aproximadamente. Si quieres te cuento cómo es el proceso paso a paso desde la primera cita.";
    const parts = splitBubbles(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.length).toBeLessThanOrEqual(3);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(260);
  });

  it("splits an over-long bubble at sentence boundaries so each message stays chat-sized", () => {
    const long = "Sobre los brackets metálicos: $2.800.000 COP en total, con cuotas de $180.000 COP mensuales. La valoración para planear el tratamiento es gratuita. ¿Te gustaría agendarla o tienes alguna otra duda?";
    const parts = splitBubbles(long);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(140);
  });

  it("never returns more than 3 bubbles", () => {
    expect(splitBubbles("a\n---\nb\n---\nc\n---\nd\n---\ne")).toHaveLength(3);
    expect(splitBubbles("a\n---\nb\n---\nc\n---\nd")[2]).toContain("d");
  });
});

describe("humanizeText", () => {
  it("removes markdown and the typographic tells of generated text", () => {
    expect(humanizeText("**Claro** — te cuento", {})).toBe("Claro, te cuento");
    expect(humanizeText("- primero esto", {})).toBe("primero esto");
    expect(humanizeText("1. primero esto", {})).toBe("primero esto");
    expect(humanizeText("usa `esto` ahora", {})).toBe("usa esto ahora");
  });

  it("keeps at most one exclamation mark per bubble", () => {
    const out = humanizeText("¡Hola! ¡Claro que sí! ¡Con gusto!", {});
    expect((out.match(/!/g) ?? []).length).toBe(1);
    expect(out).not.toContain("¡¡");
  });

  it("drops a leading greeting only on follow-up messages, and never empties the bubble", () => {
    expect(humanizeText("Hola Daniela, te cuento que sí se puede", { followUp: true })).toBe("te cuento que sí se puede");
    expect(humanizeText("Hola Daniela, te cuento que sí se puede", { followUp: false })).toBe("Hola Daniela, te cuento que sí se puede");
    expect(humanizeText("Hola", { followUp: true })).toBe("Hola");
  });

  it("removes emoji unless the customer uses them", () => {
    expect(humanizeText("listo, quedamos así 👍", {})).toBe("listo, quedamos así");
    expect(humanizeText("Hola Daniela! 😊 bienvenida", {})).toBe("Hola Daniela! bienvenida");
    expect(humanizeText("listo, quedamos así 👍", { allowEmoji: true })).toBe("listo, quedamos así 👍");
  });

  it("converts voseo verb forms to the informal tú the persona uses", () => {
    expect(humanizeText("¿tenés algún presupuesto en mente?", {})).toBe("¿tienes algún presupuesto en mente?");
    expect(humanizeText("si querés, podés agendar hoy", {})).toBe("si quieres, puedes agendar hoy");
  });

  it("converts more voseo forms (pasás, avisás, hacés)", () => {
    expect(humanizeText("¿me lo pasás?", {})).toBe("¿me lo pasas?");
    expect(humanizeText("me avisás cuando puedas y lo hacés", {})).toBe("me avisas cuando puedas y lo haces");
    expect(humanizeText("eso es más o menos lo demás", {})).toBe("eso es más o menos lo demás"); // never touch normal words ending in -ás
  });

  it("drops call-center openers", () => {
    expect(humanizeText("Gracias por escribirnos. Te cuento lo de las cuotas", {})).toBe("Te cuento lo de las cuotas");
    expect(humanizeText("Estimado cliente, claro que sí", {})).toBe("claro que sí");
    expect(humanizeText("gracias por escribirte! te cuento", {})).toBe("te cuento");
  });

  it("drops the final period of a short single-sentence bubble but keeps ellipses and question marks", () => {
    expect(humanizeText("listo, quedamos así.", {})).toBe("listo, quedamos así");
    expect(humanizeText("no sé...", {})).toBe("no sé...");
    expect(humanizeText("te sirve el jueves?", {})).toBe("te sirve el jueves?");
  });
});

describe("similarity", () => {
  it("is high for near-duplicates and low for different content", () => {
    const a = "Los brackets metálicos tienen un costo total de $2.800.000 COP con cuotas de $180.000 COP mensuales";
    const b = "Los brackets metálicos cuestan en total $2.800.000 COP con cuotas mensuales de $180.000 COP";
    expect(similarity(a, b)).toBeGreaterThan(0.6);
    expect(similarity(a, "uy, te entiendo, es una inversión importante. qué tenías en mente?")).toBeLessThan(0.2);
    expect(similarity("", "algo")).toBe(0);
  });
});

describe("coverage", () => {
  it("measures how much of a phrase appears inside a longer text", () => {
    expect(coverage("uy, entiendo, no es poca plata", "uy, entiendo, no es poca plata. qué presupuesto manejabas? miramos qué se ajusta.")).toBe(1);
    expect(coverage("uy, entiendo, no es poca plata", "ay sí, es un montón de plata")).toBeLessThan(0.5);
    expect(coverage("", "algo")).toBe(0);
  });
});

describe("pace", () => {
  it("instant pace never waits", () => {
    expect(instantPace.readMs(100)).toBe(0);
    expect(instantPace.typeMs(100)).toBe(0);
    expect(instantPace.betweenMs()).toBe(0);
  });

  it("human pace grows with text length, stays within sane bounds and can be sped up", () => {
    const p = humanPace(1);
    const avg = (f: () => number) => Array.from({ length: 200 }, f).reduce((a, b) => a + b, 0) / 200;
    expect(avg(() => p.typeMs(80))).toBeGreaterThan(avg(() => p.typeMs(10)));
    for (let i = 0; i < 200; i++) {
      expect(p.readMs(500)).toBeLessThanOrEqual(3200 * 1.25);
      expect(p.typeMs(500)).toBeLessThanOrEqual(4200 * 1.25);
      expect(p.betweenMs()).toBeGreaterThan(300);
    }
    expect(avg(() => humanPace(2).typeMs(60))).toBeLessThan(avg(() => p.typeMs(60)));
  });
});
