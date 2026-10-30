import type { Crm } from "./crm.js";
import { OPENAI_DEFAULT_MODELS, NVIDIA_DEFAULT_MODELS } from "./agent.js";
import { splitBubbles } from "./humanize.js";

/**
 * Suggested reply for a human-handled chat: one plain completion that drafts the next message the user
 * would send. It never stores or sends anything; the user edits it and sends it themselves.
 */

export const SUGGEST_SETTING = "suggest_instructions";
export const MISSING_KEY = "No hay una clave de IA configurada: agrega ANTHROPIC_API_KEY, OPENAI_API_KEY o NVIDIA_API_KEY en las variables del servidor.";

export interface SuggestEngine {
  name: string;
  complete(system: string, user: string): Promise<string>;
}

const BASE_RULES = `Redactas el siguiente mensaje que enviará el usuario del CRM en una conversación de WhatsApp.
Reglas:
- Devuelve solo el texto, sin comillas, sin explicaciones y sin opciones.
- Escribe como una persona real en el celular, en español de Colombia: frases cortas, informales, sin formalidades de call center.
- Si lo que vas a decir es largo, pártelo en 2 o 3 mensajes cortos separados por una línea en blanco, como se envía en WhatsApp. Si es corto, un solo mensaje.
- Personaliza: responde a lo que dijo la otra persona con sus palabras y datos concretos (precio, tratamiento, nombre que usó). Nunca uses frases de plantilla que servirían igual para cualquier contacto.
- No inventes datos. Si falta un dato que no conoces, déjalo entre [corchetes].`;

export function suggestEngine(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): SuggestEngine | null {
  const mode = env.AI_PROVIDER?.toLowerCase();
  const pick = (m: string) => !mode || mode === m;
  if (env.ANTHROPIC_API_KEY && pick("anthropic")) {
    const model = env.AI_MODEL || "claude-haiku-5-5";
    return {
      name: `anthropic:${model}`,
      async complete(system, user) {
        const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
          signal: AbortSignal.timeout(30_000),
          // temperature 1: the same situation should not produce the same words for every contact
          body: JSON.stringify({ model, max_tokens: 400, temperature: 1, system, messages: [{ role: "user", content: user }] }),
        });
        if (!res.ok) throw new Error(`anthropic ${res.status}`);
        const data = (await res.json()) as { content?: { type: string; text?: string }[] };
        return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      },
    };
  }
  const chat = (vendor: string, base: string, apiKey: string, model: string, extra: Record<string, unknown>): SuggestEngine => ({
    name: `${vendor}:${model}`,
    async complete(system, user) {
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], ...extra }),
      });
      if (!res.ok) throw new Error(`${vendor} ${res.status}`);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    },
  });
  if (env.OPENAI_API_KEY && pick("openai")) {
    const model = env.OPENAI_MODEL?.split(",")[0]?.trim() || OPENAI_DEFAULT_MODELS[0]!;
    return chat("openai", "https://api.openai.com/v1", env.OPENAI_API_KEY, model, { max_completion_tokens: 1500, reasoning_effort: "low" });
  }
  const nvKey = env.NVIDIA_API_KEY || env.NVIDIA_NIM_API_KEY;
  if (nvKey && pick("nvidia")) {
    const model = env.NVIDIA_MODEL?.split(",")[0]?.trim() || NVIDIA_DEFAULT_MODELS[0]!;
    return chat("nvidia", "https://integrate.api.nvidia.com/v1", nvKey, model, {
      max_tokens: 400,
      temperature: 0.9,
      ...(/nemotron-3\.5/.test(model) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    });
  }
  return null;
}

const clock = (t: number) => new Date(t).toLocaleString("es-CO", { timeZone: "America/Bogota", weekday: "short", hour: "numeric", minute: "2-digit" });

/** Builds the prompt from the chat, the contact's fields, the active sequence step and the saved instructions. */
export function buildSuggestPrompt(crm: Crm, contactId: number, now = Date.now()): { system: string; user: string } {
  const contact = crm.getContact(contactId)!;
  const instructions = crm.getSetting(SUGGEST_SETTING)?.trim();
  const system = instructions ? `${BASE_RULES}\n\nInstrucciones del usuario:\n${instructions}` : BASE_RULES;

  const fields = Object.entries(contact.fields ?? {}).filter(([k, v]) => !k.startsWith("_") && v);
  const lines = crm
    .messages(contactId)
    .filter((m) => m.sender !== "system")
    .slice(-30)
    .map((m) => `${m.sender === "customer" ? "Ellos" : m.sender === "note" ? "Nota interna" : "Yo"} (${clock(m.created_at)}): ${m.body}`);
  const enrollment = crm.activeEnrollment(contactId);
  const sequence = enrollment ? crm.getSequence(enrollment.sequence_id) : undefined;
  const step = sequence?.steps[enrollment!.position];

  const user = [
    `Contacto: ${contact.name}`,
    fields.length ? `Datos del contacto:\n${fields.map(([k, v]) => `- ${k}: ${v}`).join("\n")}` : "",
    step ? `Paso actual de la secuencia "${sequence!.name}": ${step.title}` : "",
    `Ahora es ${clock(now)}.`,
    `Conversación:\n${lines.join("\n") || "(sin mensajes)"}`,
    "Escribe el siguiente mensaje que yo enviaría.",
  ].filter(Boolean).join("\n\n");
  return { system, user };
}

/**
 * Phone-chat punctuation: no periods, commas or opening ¿ ¡ (only the closing ? and !), the way people actually
 * type on WhatsApp. Numbers ($480.000, 1,5) and ellipses are left alone.
 */
export function casualText(input: string): string {
  return input
    .replace(/[¿¡]/g, "")
    .replace(/(?<!\.)\.(?![.\d])(\s*)(\p{Lu}?)/gu, (_m, sp: string, ch: string) => (sp ? " " : "") + ch.toLowerCase())
    .replace(/,(?!\d)/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Turns the model output into the 1-3 casual messages the user will send one after another. */
export function suggestionParts(raw: string): string[] {
  return splitBubbles(cleanSuggestion(raw)).map(casualText).filter(Boolean);
}

/** Strips wrapping quotes or a leading label the model sometimes adds. */
export function cleanSuggestion(text: string): string {
  let t = text.trim().replace(/^(mensaje|respuesta)\s*:\s*/i, "");
  if (/^["“«].*["”»]$/s.test(t)) t = t.slice(1, -1).trim();
  return t;
}
