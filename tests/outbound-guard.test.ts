import { describe, expect, it } from "vitest";
import { findPlaceholders, checkOutbound } from "../server/outbound-guard.js";

const OPEN = new Date("2026-10-28T10:00:00-05:00");
const SUNDAY = new Date("2026-10-25T10:00:00-05:00");

describe("findPlaceholders", () => {
  it("finds {{field}} and [LINK_x] markers", () => {
    expect(findPlaceholders("Hola {{nombre}}, mira [LINK_D1] y {{ tratamiento }}")).toEqual(["{{nombre}}", "[LINK_D1]", "{{ tratamiento }}"]);
  });
  it("returns nothing for clean text", () => {
    expect(findPlaceholders("Hola Ana, [1] es el primer paso")).toEqual([]);
  });
});

describe("checkOutbound", () => {
  it("allows a clean message inside business hours", () => {
    expect(checkOutbound({ text: "Hola Ana", now: OPEN })).toEqual({ ok: true });
  });
  it("blocks placeholders and hands the case to a human, at any hour", () => {
    expect(checkOutbound({ text: "Hola {{nombre}}", now: OPEN })).toMatchObject({ ok: false, reason: "placeholder", handoff: true });
  });
  it("blocks outside business hours", () => {
    expect(checkOutbound({ text: "Hola Ana", now: SUNDAY })).toMatchObject({ ok: false, reason: "sunday" });
  });
  it("lets a reply to someone who already wrote bypass the hours guard but never the placeholder guard", () => {
    expect(checkOutbound({ text: "Hola Dr.", now: SUNDAY, replyToInbound: true })).toEqual({ ok: true });
    expect(checkOutbound({ text: "Hola [LINK_X]", now: SUNDAY, replyToInbound: true })).toMatchObject({ ok: false, reason: "placeholder" });
  });
});
