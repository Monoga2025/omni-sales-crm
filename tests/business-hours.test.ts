import { describe, expect, it } from "vitest";
import { colombiaHolidays, isColombiaHoliday, checkBusinessHours } from "../server/business-hours.js";

// Bogota is UTC-5 all year (no DST): local 10:00 = 15:00Z.
const at = (iso: string) => new Date(`${iso}-05:00`);

describe("colombiaHolidays", () => {
  it("returns the 2026 national holidays, with Emiliani moves and Easter-based dates", () => {
    expect([...colombiaHolidays(2026)].sort()).toEqual([
      "2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03", "2026-05-01", "2026-05-18",
      "2026-06-08", "2026-06-15", "2026-06-29", "2026-07-20", "2026-08-07", "2026-08-17", "2026-10-12",
      "2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25",
    ]);
  });
  it("isColombiaHoliday matches a date in Bogota time", () => {
    expect(isColombiaHoliday(at("2026-12-25T10:00:00"))).toBe(true);
    expect(isColombiaHoliday(at("2026-12-24T10:00:00"))).toBe(false);
  });
});

describe("checkBusinessHours (Ley 2300)", () => {
  it("allows Mon-Fri 07:00 to 19:00", () => {
    expect(checkBusinessHours(at("2026-10-28T07:00:00")).allowed).toBe(true); // Wednesday
    expect(checkBusinessHours(at("2026-10-28T18:59:59")).allowed).toBe(true);
  });
  it("blocks Mon-Fri before 07:00 and from 19:00", () => {
    expect(checkBusinessHours(at("2026-10-28T06:59:59"))).toMatchObject({ allowed: false, reason: "outside_hours" });
    expect(checkBusinessHours(at("2026-10-28T19:00:00"))).toMatchObject({ allowed: false, reason: "outside_hours" });
  });
  it("allows Saturday 08:00 to 15:00 only", () => {
    expect(checkBusinessHours(at("2026-10-31T08:00:00")).allowed).toBe(true);
    expect(checkBusinessHours(at("2026-10-31T07:30:00")).allowed).toBe(false);
    expect(checkBusinessHours(at("2026-10-31T15:00:00")).allowed).toBe(false);
  });
  it("never allows Sundays", () => {
    expect(checkBusinessHours(at("2026-10-25T10:00:00"))).toMatchObject({ allowed: false, reason: "sunday" });
  });
  it("never allows holidays, even inside the weekday window", () => {
    expect(checkBusinessHours(at("2026-12-25T10:00:00"))).toMatchObject({ allowed: false, reason: "holiday" });
    expect(checkBusinessHours(at("2026-08-17T10:00:00"))).toMatchObject({ allowed: false, reason: "holiday" }); // moved to Monday
  });
  it("reports the next open window, skipping Sundays", () => {
    // Saturday 15:00 -> Sunday closed, Monday 2 Nov is a holiday -> Tuesday 07:00
    expect(checkBusinessHours(at("2026-10-31T15:00:00")).nextWindow?.toISOString()).toBe(at("2026-11-03T07:00:00").toISOString());
    // Friday evening -> Saturday 08:00
    expect(checkBusinessHours(at("2026-10-30T20:00:00")).nextWindow?.toISOString()).toBe(at("2026-10-31T08:00:00").toISOString());
  });
  it("skips Sunday and a Monday holiday when computing the next window", () => {
    // Sat 2026-08-15 16:00 -> Sun closed, Mon 17 holiday -> Tue 18 07:00
    expect(checkBusinessHours(at("2026-08-15T16:00:00")).nextWindow?.toISOString()).toBe(at("2026-08-18T07:00:00").toISOString());
  });
  it("uses Bogota time regardless of the host timezone (UTC input)", () => {
    expect(checkBusinessHours(new Date("2026-10-28T11:59:00Z")).allowed).toBe(false); // 06:59 local
    expect(checkBusinessHours(new Date("2026-10-28T12:00:00Z")).allowed).toBe(true); // 07:00 local
  });
});
