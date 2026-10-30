/**
 * Makes the agent's messages read like someone chatting on a phone: short bubbles, no markdown,
 * no call-center phrasing, human timing. It shapes style only; it never hides that the agent is an AI.
 */

const MAX_BUBBLES = 3;
const LONG_MESSAGE = 220;
const MAX_BUBBLE_CHARS = 140;

function chunkSentences(t: string): string[] {
  const sentences = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (sentences.length < 2) return [t];
  const n = Math.min(MAX_BUBBLES, Math.max(2, Math.ceil(t.length / LONG_MESSAGE)));
  const target = t.length / n;
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > target && out.length < n - 1) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

/** Splits a model answer into the chat bubbles that will be sent one after another (at most 3). */
export function splitBubbles(text: string): string[] {
  const t = text.replace(/\r/g, "").trim();
  if (!t) return [];
  let parts: string[];
  if (/-{3,}/.test(t)) parts = t.split(/\s*-{3,}\s*/);
  else if (/\n\s*\n/.test(t)) parts = t.split(/\n\s*\n/);
  else if (t.includes("\n")) parts = t.split("\n");
  else if (t.length > LONG_MESSAGE) parts = chunkSentences(t);
  else parts = [t];
  parts = parts.map((p) => p.trim()).filter(Boolean).flatMap((p) => (p.length > MAX_BUBBLE_CHARS ? chunkSentences(p) : [p]));
  if (parts.length > MAX_BUBBLES) parts = [...parts.slice(0, MAX_BUBBLES - 1), parts.slice(MAX_BUBBLES - 1).join(" ")];
  return parts;
}

const GREETING = /^\s*¡?\s*(?:hola|buenas(?: tardes| noches| días| dias)?|buen(?:os)? d[ií]as?|hey|qu[eé] tal)\b[^,.!?\n]{0,25}[,.!:]+\s*/i;
const CALL_CENTER_OPENER = /^\s*(?:gracias por (?:escribirnos|escribirte|contactarnos|contactarte|comunicarte(?: con nosotros)?|tu mensaje)|estimad[oa]s?(?: cliente)?)[,.!:]*\s*/i;

/** Removes the typographic tells of generated text from one bubble. */
export function humanizeText(input: string, o: { followUp?: boolean; allowEmoji?: boolean }): string {
  let t = input.replace(/\*\*|__|`/g, "");
  if (!o.allowEmoji) t = t.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").replace(/ +([,.!?])/g, "$1");
  t = t.replace(/^\s*(?:[-•*]|\d+[.)])\s+/gm, "");
  t = t.replace(/\s*[—–]\s*/g, ", ");
  t = t.replace(CALL_CENTER_OPENER, "");

  // one exclamation mark per bubble at most
  const total = (t.match(/!/g) ?? []).length;
  if (total > 1) {
    t = t.replace(/¡/g, "");
    let seen = 0;
    t = t.replace(/!(\s*)(\S?)/g, (m, sp: string, ch: string) => {
      seen++;
      return seen < total ? `,${sp || " "}${ch.toLowerCase()}` : m;
    });
  }

  if (o.followUp) {
    const m = t.match(GREETING);
    if (m && t.slice(m[0].length).trim().length >= 3) t = t.slice(m[0].length);
  }

  // voseo slips: the persona tutea
  const VOSEO: [RegExp, string][] = [
    [/\bten[ée]s\b/gi, "tienes"], [/\bquer[ée]s\b/gi, "quieres"], [/\bpod[ée]s\b/gi, "puedes"], [/\bsab[ée]s\b/gi, "sabes"],
    [/\bprefer[ií]s\b/gi, "prefieres"], [/\bnecesit[aá]s\b/gi, "necesitas"], [/\bdec[ií]s\b/gi, "dices"], [/\bvos\b/gi, "tú"],
    [/\bpasás\b/gi, "pasas"], [/\bmandás\b/gi, "mandas"], [/\bllamás\b/gi, "llamas"], [/\bavisás\b/gi, "avisas"], [/\bagendás\b/gi, "agendas"],
    [/\bconfirmás\b/gi, "confirmas"], [/\bhacés\b/gi, "haces"], [/\bvenís\b/gi, "vienes"], [/\bescribís\b/gi, "escribes"], [/\bvivís\b/gi, "vives"],
    [/\bpensás\b/gi, "piensas"], [/\bsentís\b/gi, "sientes"], [/\btomás\b/gi, "tomas"], [/\bllevás\b/gi, "llevas"],
  ];
  for (const [re, to] of VOSEO) t = t.replace(re, to);

  t = t.replace(/[ \t]+/g, " ").trim();
  // a short single-sentence bubble reads more natural without the final period
  if (t.length <= 80 && t.endsWith(".") && !t.endsWith("..") && !/[.!?]/.test(t.slice(0, -1))) t = t.slice(0, -1);
  return t;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const words = (s: string) => new Set(fold(s).split(/[^a-z0-9$]+/).filter((w) => w.length > 2));

/** Jaccard similarity of the word sets: used to catch the agent repeating itself. */
export function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

const tokens = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

/** True when `draft` contains a run of `n` consecutive words that also appears in `source` (instruction leakage). */
export function sharesPhrase(draft: string, source: string, n = 6): boolean {
  const d = tokens(draft);
  if (d.length < n) return false;
  const src = tokens(source);
  const shingles = new Set<string>();
  for (let i = 0; i + n <= src.length; i++) shingles.add(src.slice(i, i + n).join(" "));
  for (let i = 0; i + n <= d.length; i++) if (shingles.has(d.slice(i, i + n).join(" "))) return true;
  return false;
}

/** Share of the words of `phrase` that also appear in `text` (1 = the phrase is fully contained). */
export function coverage(phrase: string, text: string): number {
  const P = words(phrase);
  if (!P.size) return 0;
  const T = words(text);
  let hit = 0;
  for (const w of P) if (T.has(w)) hit++;
  return hit / P.size;
}

/** Human timing: a reading pause before typing, typing time proportional to the text, a short gap between bubbles. */
export interface Pace {
  sleep(ms: number): Promise<void>;
  readMs(incomingChars: number): number;
  typeMs(chars: number): number;
  betweenMs(): number;
}

export const instantPace: Pace = { sleep: async () => {}, readMs: () => 0, typeMs: () => 0, betweenMs: () => 0 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function humanPace(speed = 1): Pace {
  const jitter = (ms: number) => (ms * (0.8 + Math.random() * 0.4)) / speed;
  return {
    sleep: (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()),
    readMs: (n) => jitter(clamp(700 + 20 * n, 900, 3200)),
    typeMs: (n) => jitter(clamp(450 + 40 * n, 800, 4200)),
    betweenMs: () => jitter(450 + Math.random() * 500),
  };
}
