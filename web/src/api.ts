import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type AiMode = "qualify" | "nurture" | "close_aggressive" | "support";
export type Sender = "customer" | "ai" | "human" | "system" | "note";

export interface Stage {
  id: number;
  name: string;
  position: number;
  color: string;
  is_default: boolean;
  is_won: boolean;
  is_lost: boolean;
  ai_mode: AiMode;
  ai_prompt: string;
  stage_rule: string;
  ai_temperature: number;
}

export interface Contact {
  id: number;
  name: string;
  phone: string;
  email: string;
  channel: string;
  stage_id: number;
  score: number;
  tags: string[];
  fields: Record<string, string>;
  handler: "ai" | "human";
  created_at: number;
  last_message_at: number;
  unread: number;
  sort_order: number;
  budget_value: number;
}

export interface ContactRow extends Contact {
  last_message: string | null;
  last_sender: Sender | null;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: string;
}

export interface Message {
  id: number;
  contact_id: number;
  sender: Sender;
  body: string;
  created_at: number;
  meta: {
    tool_calls?: ToolCall[];
    provider?: string;
    attachment?: { name: string; size: number };
    courtesy?: boolean;
    delivery?: { status: "sent" | "failed" | "not_configured" | "simulated"; error?: string };
  };
}

export interface CrmEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  actor: string;
  created_at: number;
}

export type StepChannel = "whatsapp" | "instagram_dm" | "instagram_comment" | "voice_note" | "other";
export interface SequenceStep {
  channel: StepChannel;
  title: string;
  template: string;
  delay_minutes: number;
}
export interface Sequence {
  id: number;
  name: string;
  exit_on_reply: boolean;
  steps: SequenceStep[];
}
export interface Enrollment {
  id: number;
  contact_id: number;
  sequence_id: number;
  status: "active" | "finished" | "exited";
  position: number;
  next_due_at: number | null;
  exit_reason: string;
  first_reply_at: number | null;
  last_step_at: number | null;
  enrolled_at: number;
}
export interface SequenceTask {
  enrollment: Enrollment;
  sequence: { id: number; name: string };
  contact: Contact;
  step: SequenceStep;
  step_number: number;
  total_steps: number;
  due_at: number;
  text: string;
  wa_link: string | null;
}
export const STEP_CHANNEL_LABEL: Record<StepChannel, string> = {
  whatsapp: "WhatsApp",
  instagram_dm: "DM de Instagram",
  instagram_comment: "Comentario en Instagram",
  voice_note: "Nota de voz",
  other: "Otro",
};

export interface ContactDetail {
  contact: Contact;
  messages: Message[];
  events: CrmEvent[];
  ai_mode: AiMode;
  enrollment: (Enrollment & { sequence_name: string; total_steps: number; next_step: SequenceStep | null }) | null;
}

export interface Rule {
  id: number;
  name: string;
  trigger_type: "stage_enter" | "score_gte" | "tag_added";
  trigger_stage_id: number | null;
  trigger_value: string;
  action_type: "send_message" | "handoff" | "add_tag" | "set_ai_mode";
  action_value: string;
  enabled: boolean;
}

export interface Delta {
  current: number;
  previous: number;
}

export interface Analytics {
  totals: {
    contacts: number; open: number; won: number; lost: number; conversion_rate: number;
    avg_score: number; hot_leads: number; open_value: number; won_value: number;
  };
  funnel: { stage_id: number; name: string; color: string; current: number; reached: number; pct_of_leads: number; step_rate: number | null }[];
  by_stage_value: { stage_id: number; name: string; count: number; value: number }[];
  by_channel: { channel: string; contacts: number; won: number; conversion_rate: number; avg_score: number }[];
  handler_perf: {
    ai: { contacts: number; won: number; conversion_rate: number; avg_score: number };
    human: { contacts: number; won: number; conversion_rate: number; avg_score: number };
    autonomous_wins: number; ai_turns: number; tool_calls: number;
  };
  trend: { contacts: Delta; won: Delta; messages: Delta };
  messages: Record<string, number>;
  handlers: { ai: number; human: number };
  stage_moves_by_actor: Record<string, number>;
  leads_per_day: { day: string; count: number }[];
  avg_hours_to_win: number | null;
  top_tags: { tag: string; count: number }[];
  automations: { rule: string; count: number }[];
  handoffs: number;
}

export interface Business {
  name: string;
  description: string;
  tone: string;
  language: string;
  hours: string;
  goals: string;
  handoff_rules: string;
  agent_name: string;
  style_notes: string;
}
export interface Knowledge {
  id: number;
  title: string;
  content: string;
}
export interface ChannelInfo {
  configured: boolean;
  missing: string[];
}
export interface AiStatus {
  provider: string;
  models: string[];
  live: boolean;
  channels: Record<"whatsapp" | "messenger" | "instagram" | "web-chat", ChannelInfo> & { signature: boolean };
  auth: { required: boolean };
  webhook: { url: string; verify_token_set: boolean };
  widget_snippet: string;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("auth-required"));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export interface Live {
  version: number;
  connected: boolean;
  ai: string;
  /** contact id -> the AI is writing a reply right now */
  typing: Record<number, boolean>;
}
export const LiveContext = createContext<Live>({ version: 0, connected: false, ai: "", typing: {} });
export const useLive = () => useContext(LiveContext);

/** Subscribes to server-sent events; every change bumps `version` so views refetch. */
export function useLiveSource(): Live {
  const [live, setLive] = useState<Live>({ version: 0, connected: false, ai: "", typing: {} });
  useEffect(() => {
    const es = new EventSource("/api/events");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setLive((l) => ({ ...l, version: l.version + 1 })), 60);
    };
    es.onopen = () => {
      setLive((l) => ({ ...l, connected: true }));
      bump();
    };
    es.onerror = () => setLive((l) => ({ ...l, connected: false }));
    es.addEventListener("hello", (e) => {
      const d = JSON.parse((e as MessageEvent<string>).data) as { ai: string };
      setLive((l) => ({ ...l, ai: d.ai }));
    });
    es.addEventListener("change", (e) => {
      const d = JSON.parse((e as MessageEvent<string>).data) as { type: string; contactId?: number; on?: boolean };
      if (d.type === "typing" && d.contactId) setLive((l) => ({ ...l, typing: { ...l.typing, [d.contactId!]: !!d.on } }));
      else bump();
    });
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, []);
  return live;
}

export function useApi<T>(path: string | null): { data: T | null; error: string | null; reload: () => void } {
  const { version } = useLive();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api<T>("GET", path)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [path, version, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}

// ---- formatting (Spanish)
export const CHANNELS: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", "web-chat": "Chat web" };
export const MODE_LABEL: Record<AiMode, string> = {
  qualify: "Calificar",
  nurture: "Nutrir",
  close_aggressive: "Cierre agresivo",
  support: "Soporte",
};
export const money = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "ahora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

export const TOOL_LABEL: Record<string, string> = {
  update_lead: "Actualizar lead",
  add_tag: "Añadir etiqueta",
  set_lead_score: "Fijar puntaje",
  move_stage: "Mover etapa",
  handoff_to_human: "Traspasar a humano",
};
