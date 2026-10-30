import { describe, expect, it } from "vitest";
import { findUnsupportedClaims } from "../server/guard.js";

const KB = [
  "Blanqueamiento en consultorio: $350.000 COP, dura 60 minutos. Incluye valoración previa.",
  "Brackets metálicos desde $2.800.000 COP en total (cuotas mensuales de $180.000 COP). La valoración es gratuita y dura 30 minutos.",
];

describe("findUnsupportedClaims", () => {
  it("accepts amounts that appear in the knowledge base, however they are formatted", () => {
    expect(findUnsupportedClaims("el blanqueamiento sale en $350.000 COP", KB)).toEqual([]);
    expect(findUnsupportedClaims("son 180.000 al mes", KB)).toEqual([]);
    expect(findUnsupportedClaims("cuesta $2,800,000 en total", KB)).toEqual([]);
  });

  it("flags amounts that are not in the knowledge base or the customer's own words", () => {
    expect(findUnsupportedClaims("te lo dejo en $300.000", KB)).toEqual(["$300.000"]);
    expect(findUnsupportedClaims("serían 1.500.000 de inicial", KB)).toEqual(["1.500.000"]);
  });

  it("accepts an amount the customer mentioned themselves", () => {
    expect(findUnsupportedClaims("con tus $500.000 alcanza para empezar?", KB, ["tengo $500.000 de presupuesto"])).toEqual([]);
  });

  it("flags conditions that are not written anywhere (no interest, warranty, percentages)", () => {
    expect(findUnsupportedClaims("cuotas mensuales de $180.000 COP sin intereses", KB)).toContain("sin intereses");
    expect(findUnsupportedClaims("tiene garantía de por vida", KB)).toContain("garantía");
    expect(findUnsupportedClaims("te hago un 15% de descuento", KB)).toContain("15%");
  });

  it("flags filler promises such as sin compromiso or de por vida", () => {
    expect(findUnsupportedClaims("la valoración es gratuita y sin compromiso", KB)).toContain("sin compromiso");
    expect(findUnsupportedClaims("el resultado dura de por vida", KB)).toContain("de por vida");
  });

  it("flags payment-link promises (payments are not connected) unless the knowledge base offers them", () => {
    expect(findUnsupportedClaims("te confirmo el enlace de pago por WhatsApp", KB)).toContain("enlace de pago");
    expect(findUnsupportedClaims("te mando el link para pagar", [...KB, "Pagos: el cliente recibe un link de pago"])).toEqual([]);
  });

  it("flags appointment times the customer never proposed, in 12 or 24 hour form", () => {
    expect(findUnsupportedClaims("listo, jueves a las 3:00 pm", KB)).toContain("a las 3:00 pm".replace("a las ", "a las "));
    expect(findUnsupportedClaims("agendado para las 15:30", KB).length).toBe(1);
    expect(findUnsupportedClaims("listo, jueves a las 3", KB, ["me sirve el jueves a las 3"])).toEqual([]);
    expect(findUnsupportedClaims("te atendemos a las 15:00", KB, ["me sirve el jueves a las 3 de la tarde"])).toEqual([]); // 15 h is the same hour as 3 pm
    expect(findUnsupportedClaims("abrimos a las 8:00", KB, ["Horario: lunes a viernes 8:00-18:00"])).toEqual([]);
  });

  it("flags health and safety assurances that nobody wrote down", () => {
    expect(findUnsupportedClaims("no, no duele nada", KB)).toContain("sin dolor");
    expect(findUnsupportedClaims("es un procedimiento indoloro", KB)).toContain("sin dolor");
    expect(findUnsupportedClaims("no tiene efectos secundarios", KB)).toContain("sin riesgos");
    expect(findUnsupportedClaims("es un procedimiento indoloro", [...KB, "El procedimiento es indoloro"])).toEqual([]);
  });

  it("flags availability and booking commitments the agent cannot make", () => {
    expect(findUnsupportedClaims("el sábado a las 10 está disponible", KB, ["el sabado a las 10"])).toContain("disponibilidad");
    expect(findUnsupportedClaims("tu cita queda agendada", KB)).toContain("disponibilidad");
    expect(findUnsupportedClaims("ya te agendé para el jueves", KB)).toContain("disponibilidad");
    expect(findUnsupportedClaims("anoto que prefieres el jueves en la tarde", KB)).toEqual([]);
  });

  it("lets a condition through when the knowledge base states it", () => {
    expect(findUnsupportedClaims("las cuotas van sin intereses", [...KB, "Financiación: cuotas sin intereses hasta 12 meses"])).toEqual([]);
  });

  it("ignores ordinary chat, small numbers and years", () => {
    expect(findUnsupportedClaims("uy, te entiendo. la valoración dura 30 minutos y es gratis", KB)).toEqual([]);
    expect(findUnsupportedClaims("nos vemos el jueves 15", KB)).toEqual([]);
    expect(findUnsupportedClaims("abrimos desde 2019", KB)).toEqual([]);
  });
});
