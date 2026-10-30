/**
 * Deterministic fact check for the agent's draft: amounts and conditions it states must come from the
 * knowledge base (or from the customer's own words). Models like to add reasonable-sounding extras
 * ("sin intereses", "con garantía") that the business never promised.
 */

const AMOUNT = /\$\s?\d[\d.,]*|\d{1,3}(?:[.,]\d{3})+|\d{4,}/g;
const digitsOf = (s: string) => s.replace(/\D/g, "");

function amountsIn(text: string): { raw: string; digits: string }[] {
  const out: { raw: string; digits: string }[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const raw = m[0].replace(/[.,\s]+$/, "").trim();
    const digits = digitsOf(raw);
    if (!digits) continue;
    const hasCurrency = raw.includes("$");
    const looksLikeYear = /^(19|20)\d{2}$/.test(digits) && !/[.,]/.test(raw);
    if (!hasCurrency && (digits.length < 4 || looksLikeYear)) continue;
    out.push({ raw, digits });
  }
  return out;
}

const CLAIMS: { label: string; re: RegExp }[] = [
  { label: "sin intereses", re: /sin\s+inter[eé]s(?:es)?/i },
  { label: "garantía", re: /garant[ií]a/i },
  { label: "sin compromiso", re: /sin\s+compromiso/i },
  { label: "disponibilidad", re: /est[aá]\s+disponible|hay\s+(?:cupo|disponibilidad)|queda\s+agendad[oa]|qued[oó]\s+agendad[oa]|(?:ya\s+)?te\s+agend[ée]|cita\s+(?:confirmada|agendada)/i },
  { label: "sin dolor", re: /no\s+(?:te\s+)?duele|indoloro|sin\s+dolor|no\s+es\s+doloros[oa]/i },
  { label: "sin riesgos", re: /sin\s+riesgos?|sin\s+efectos\s+secundarios|no\s+tiene\s+efectos\s+secundarios|totalmente\s+seguro/i },
  { label: "de por vida", re: /de\s+por\s+vida/i },
  { label: "enlace de pago", re: /(?:enlace|link|liga)\s+de\s+pago|te\s+(?:env[ií]o|mando|confirmo)\s+el\s+(?:enlace|link)/i },
];

const TIME = /\ba las \d{1,2}(?::\d{2})?(?:\s?(?:am|pm|a\.m\.|p\.m\.))?|\b\d{1,2}:\d{2}(?:\s?(?:am|pm|a\.m\.|p\.m\.))?/gi;
const hourOf = (t: string) => Number(/\d{1,2}/.exec(t)![0]) % 12; // 15 h and 3 pm are the same hour

/** Returns what the draft states that no source backs up (empty when it is safe to send). */
export function findUnsupportedClaims(draft: string, kb: string[], extra: string[] = []): string[] {
  const sources = [...kb, ...extra].join(" \n ");
  const known = new Set(amountsIn(sources).map((a) => a.digits));
  const flagged: string[] = [];

  for (const a of amountsIn(draft)) if (!known.has(a.digits) && !flagged.includes(a.raw)) flagged.push(a.raw);

  for (const c of CLAIMS) if (c.re.test(draft) && !c.re.test(sources)) flagged.push(c.label);

  // appointment times: the agent has no calendar, so a specific hour must be one the customer or the business already said
  const knownHours = new Set([...sources.matchAll(TIME)].map((m) => hourOf(m[0])));
  for (const m of draft.matchAll(TIME)) if (!knownHours.has(hourOf(m[0]))) flagged.push(m[0].trim());

  const sourcePercents = new Set([...sources.matchAll(/(\d{1,3})\s?%/g)].map((m) => m[1]));
  for (const m of draft.matchAll(/(\d{1,3})\s?%/g)) if (!sourcePercents.has(m[1])) flagged.push(`${m[1]}%`);

  return flagged;
}
