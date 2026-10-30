import { checkBusinessHours, type HoursReason } from "./business-hours.js";

/** Unresolved template markers such as {{nombre}} or [LINK_D1]. They must never reach a customer. */
const PLACEHOLDER = /\{\{[^{}]*\}\}|\[LINK_[A-Z0-9_]+\]/gi;

export function findPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER) ?? [];
}

export type OutboundCheck =
  | { ok: true }
  | { ok: false; reason: "placeholder"; handoff: true; placeholders: string[] }
  | { ok: false; reason: HoursReason; nextWindow?: Date };

/**
 * Last gate before a message leaves. Placeholders always block (the case goes to a human).
 * The contact-hours guard applies to proactive messages; a reply to someone who already wrote
 * (`replyToInbound`) skips only the hours check.
 */
export function checkOutbound(input: { text: string; now: Date; replyToInbound?: boolean }): OutboundCheck {
  const placeholders = findPlaceholders(input.text);
  if (placeholders.length) return { ok: false, reason: "placeholder", handoff: true, placeholders };
  if (!input.replyToInbound) {
    const h = checkBusinessHours(input.now);
    if (!h.allowed) return { ok: false, reason: h.reason!, nextWindow: h.nextWindow };
  }
  return { ok: true };
}
