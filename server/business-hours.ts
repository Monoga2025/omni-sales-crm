/**
 * Colombia contact-hours guard (Ley 2300): Mon-Fri 07:00-19:00, Sat 08:00-15:00, never Sundays or national holidays.
 * Pure: the clock is injected as a Date. Bogota is UTC-5 all year (no DST), so no tz database is needed.
 */

const OFFSET_MS = -5 * 3600_000;
const DAY_MS = 86_400_000;

/** Opening window per weekday in local hours (0 = Sunday). `null` = closed. */
const WINDOWS: ([number, number] | null)[] = [null, [7, 19], [7, 19], [7, 19], [7, 19], [7, 19], [8, 15]];

/** A Date whose UTC fields read as Bogota local time. */
const local = (d: Date) => new Date(d.getTime() + OFFSET_MS);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const utcDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

/** Emiliani law: a holiday that is not a Monday moves to the next Monday. */
const toNextMonday = (d: Date) => addDays(d, (8 - d.getUTCDay()) % 7);

function easterSunday(y: number): Date {
  // Anonymous Gregorian algorithm.
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(y, month, day);
}

const cache = new Map<number, Set<string>>();

/** National holidays of a year as `YYYY-MM-DD` strings. */
export function colombiaHolidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const out = new Set<string>();
  for (const [m, d] of [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]]) out.add(ymd(utcDate(year, m!, d!)));
  for (const [m, d] of [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]]) out.add(ymd(toNextMonday(utcDate(year, m!, d!))));
  const easter = easterSunday(year);
  out.add(ymd(addDays(easter, -3))); // Holy Thursday
  out.add(ymd(addDays(easter, -2))); // Good Friday
  for (const offset of [39, 60, 68]) out.add(ymd(toNextMonday(addDays(easter, offset)))); // Ascension, Corpus Christi, Sacred Heart
  cache.set(year, out);
  return out;
}

export function isColombiaHoliday(at: Date): boolean {
  const l = local(at);
  return colombiaHolidays(l.getUTCFullYear()).has(ymd(l));
}

export type HoursReason = "sunday" | "holiday" | "outside_hours";
export interface HoursCheck {
  allowed: boolean;
  reason?: HoursReason;
  /** Start of the next open window (absolute instant), when closed. */
  nextWindow?: Date;
}

const dayIsOpen = (l: Date) => WINDOWS[l.getUTCDay()] !== null && !colombiaHolidays(l.getUTCFullYear()).has(ymd(l));

function nextWindowAfter(at: Date): Date {
  const l = local(at);
  for (let i = 0; i < 14; i++) {
    const day = addDays(new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate())), i);
    if (!dayIsOpen(day)) continue;
    const start = new Date(day.getTime() + WINDOWS[day.getUTCDay()]![0] * 3600_000 - OFFSET_MS);
    if (start.getTime() > at.getTime()) return start;
  }
  throw new Error("no open window within 14 days"); // unreachable with real calendars
}

export function checkBusinessHours(now: Date): HoursCheck {
  const l = local(now);
  const dow = l.getUTCDay();
  let reason: HoursReason | undefined;
  if (dow === 0) reason = "sunday";
  else if (colombiaHolidays(l.getUTCFullYear()).has(ymd(l))) reason = "holiday";
  else {
    const [from, to] = WINDOWS[dow]!;
    const hour = l.getUTCHours() + l.getUTCMinutes() / 60 + l.getUTCSeconds() / 3600;
    if (hour < from || hour >= to) reason = "outside_hours";
  }
  return reason ? { allowed: false, reason, nextWindow: nextWindowAfter(now) } : { allowed: true };
}
