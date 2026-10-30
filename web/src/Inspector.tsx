import { useState } from "react";
import {
  ArrowRightLeft, Bot, CalendarCheck, Check, Cpu, Hash, History, ListTree, Mail, Phone, Plus, Sparkles, Tag, Trash2, User, UserRound, X, Zap,
} from "lucide-react";
import { api, money, MODE_LABEL, STEP_CHANNEL_LABEL, timeAgo, useApi, type ContactDetail, type CrmEvent, type Sequence, type Stage } from "./api";
import { Avatar, InlineEdit, ModeIcon, ScoreBar, Section, cn, inputCls } from "./ui";

export function Inspector({ detail, stages }: { detail: ContactDetail; stages: Stage[] }) {
  const { contact: c, events } = detail;
  const id = c.id;
  const stage = stages.find((s) => s.id === c.stage_id);
  const idx = Math.max(0, stages.findIndex((s) => s.id === c.stage_id));
  const patch = (b: object) => void api("PATCH", `/api/contacts/${id}`, b);
  const fields = Object.entries(c.fields).filter(([k]) => !k.startsWith("_"));
  const provider = [...detail.messages].reverse().find((m) => m.sender === "ai" && m.meta.provider)?.meta.provider;

  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-zinc-200 dark:border-zinc-800" aria-label="Inspector de contacto">
      <div className="flex items-center gap-3 border-b border-zinc-200 p-3 dark:border-zinc-800">
        <Avatar name={c.name} channel={c.channel} size={40} />
        <div className="min-w-0 flex-1">
          <InlineEdit value={c.name} onSave={(v) => v && patch({ name: v })} className="text-sm font-semibold" />
          <div className="flex items-center gap-1.5 px-1 text-[11px] text-zinc-500">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: stage?.color }} />
            {stage?.name}
            {c.budget_value > 0 && <span className="font-medium text-zinc-700 dark:text-zinc-300">· {money(c.budget_value)}</span>}
          </div>
        </div>
      </div>

      <Section title="Contacto" icon={<User size={12} />}>
        <dl className="space-y-1">
          <Row icon={<Mail size={12} />} label="Correo"><InlineEdit value={c.email} onSave={(v) => patch({ email: v })} placeholder="Añadir correo" /></Row>
          <Row icon={<Phone size={12} />} label="Teléfono"><InlineEdit value={c.phone} onSave={(v) => patch({ phone: v })} placeholder="Añadir teléfono" /></Row>
        </dl>
      </Section>

      <Section title="Etapa del lifecycle" icon={<ListTree size={12} />}>
        <ol className="relative ml-1.5" aria-label="Etapas">
          {stages.map((s, i) => {
            const done = i < idx && !s.is_lost;
            const current = s.id === c.stage_id;
            return (
              <li key={s.id} className="relative pb-1.5 pl-5 last:pb-0">
                {i < stages.length - 1 && <span className={cn("absolute left-[5px] top-3.5 h-full w-px", done ? "bg-zinc-400 dark:bg-zinc-600" : "bg-zinc-200 dark:bg-zinc-800")} />}
                <button
                  onClick={() => !current && void api("POST", `/api/contacts/${id}/move`, { stage_id: s.id })}
                  className={cn("flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900", current ? "font-semibold text-zinc-900 dark:text-zinc-100" : "text-zinc-500")}
                  aria-current={current ? "step" : undefined}
                >
                  <span
                    className={cn("absolute left-0 flex h-3 w-3 items-center justify-center rounded-full border-2", current ? "" : done ? "border-zinc-400 bg-zinc-400 dark:border-zinc-600 dark:bg-zinc-600" : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950")}
                    style={current ? { borderColor: s.color, background: s.color } : undefined}
                  >
                    {done && <Check size={8} className="text-white" strokeWidth={4} />}
                  </span>
                  {s.name}
                  {s.is_won && <span className="rounded bg-emerald-100 px-1 text-[9px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">META</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </Section>

      <Section title="Agente IA" icon={<Sparkles size={12} />}>
        <dl className="space-y-1.5 text-xs">
          <Row icon={<Bot size={12} />} label="Estado">
            <span className={cn("flex items-center gap-1.5 px-1 font-medium", c.handler === "ai" ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", c.handler === "ai" ? "animate-pulse bg-emerald-500" : "bg-zinc-400")} />
              {c.handler === "ai" ? "Respondiendo" : "En pausa (humano)"}
            </span>
          </Row>
          <Row icon={<ModeIcon mode={detail.ai_mode} />} label="Modo"><span className="px-1">{MODE_LABEL[detail.ai_mode]}</span></Row>
          <Row icon={<Zap size={12} />} label="Temperatura"><span className="px-1">{stage?.ai_temperature ?? 50}/100</span></Row>
          <Row icon={<Cpu size={12} />} label="Motor"><span className="truncate px-1">{provider ?? "—"}</span></Row>
        </dl>
        <div className="mt-2.5">
          <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
            <span>Puntaje del lead</span>
            <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{c.score}</span>
          </div>
          <ScoreBar score={c.score} className="h-1.5" />
        </div>
      </Section>

      <Section title="Campos personalizados" icon={<Hash size={12} />}>
        <dl className="space-y-1">
          {fields.map(([k, v]) => (
            <div key={k} className="group flex items-center gap-1 text-xs">
              <dt className="w-[84px] shrink-0 truncate capitalize text-zinc-500" title={k}>{FIELD_LABEL[k] ?? k}</dt>
              <dd className="min-w-0 flex-1"><InlineEdit value={v} onSave={(nv) => void api("PUT", `/api/contacts/${id}/fields`, { key: k, value: nv })} /></dd>
              <button aria-label={`Eliminar ${k}`} onClick={() => void api("DELETE", `/api/contacts/${id}/fields/${encodeURIComponent(k)}`)} className="text-zinc-400 opacity-0 hover:text-red-500 group-hover:opacity-100">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {fields.length === 0 && <p className="text-xs text-zinc-400">Sin campos todavía.</p>}
        </dl>
        <AddField onAdd={(k, v) => void api("PUT", `/api/contacts/${id}/fields`, { key: k, value: v })} />
      </Section>

      <Section title="Etiquetas" icon={<Tag size={12} />}>
        <div className="flex flex-wrap gap-1">
          {c.tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] dark:border-zinc-800 dark:bg-zinc-900">
              {t}
              <button aria-label={`Quitar ${t}`} onClick={() => void api("DELETE", `/api/contacts/${id}/tags/${encodeURIComponent(t)}`)} className="text-zinc-400 hover:text-red-500"><X size={10} /></button>
            </span>
          ))}
          {c.tags.length === 0 && <span className="text-xs text-zinc-400">Sin etiquetas.</span>}
        </div>
        <AddTag onAdd={(t) => void api("POST", `/api/contacts/${id}/tags`, { tag: t })} />
      </Section>

      <Section title="Secuencia" icon={<CalendarCheck size={12} />}>
        <SequencePanel contactId={id} enrollment={detail.enrollment} />
      </Section>

      <Section title="Actividad" icon={<History size={12} />} defaultOpen>
        <ol className="space-y-1.5">
          {[...events].reverse().slice(0, 12).map((e) => (
            <li key={e.id} className="flex items-start gap-2 text-[11px] leading-snug">
              <EventIcon e={e} />
              <span className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-300">{describe(e)}</span>
              <span className="shrink-0 text-zinc-400">{timeAgo(e.created_at)}</span>
            </li>
          ))}
        </ol>
      </Section>
    </aside>
  );
}

const FIELD_LABEL: Record<string, string> = { interest: "Interés", budget: "Presupuesto", notes: "Notas", empresa: "Empresa" };

const Row = ({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-2 text-xs">
    <dt className="flex w-[84px] shrink-0 items-center gap-1.5 text-zinc-500">{icon}{label}</dt>
    <dd className="min-w-0 flex-1">{children}</dd>
  </div>
);

function AddField({ onAdd }: { onAdd: (k: string, v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="mt-2 flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <Plus size={11} /> Añadir campo
      </button>
    );
  return (
    <form
      className="mt-2 flex gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (k.trim()) onAdd(k.trim().toLowerCase(), v);
        setK(""); setV(""); setOpen(false);
      }}
    >
      <input autoFocus value={k} onChange={(e) => setK(e.target.value)} placeholder="Campo" aria-label="Nombre del campo" className={cn(inputCls, "w-20")} />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Valor" aria-label="Valor del campo" className={inputCls} />
      <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" aria-label="Guardar campo"><Check size={12} /></button>
    </form>
  );
}

function AddTag({ onAdd }: { onAdd: (t: string) => void }) {
  const [t, setT] = useState("");
  return (
    <form className="mt-2" onSubmit={(e) => { e.preventDefault(); if (t.trim()) onAdd(t.trim()); setT(""); }}>
      <input value={t} onChange={(e) => setT(e.target.value)} placeholder="+ Añadir etiqueta" aria-label="Nueva etiqueta" className={inputCls} />
    </form>
  );
}

function EventIcon({ e }: { e: CrmEvent }) {
  const cls = "mt-px shrink-0";
  switch (e.type) {
    case "stage_changed": return <ArrowRightLeft size={12} className={cn(cls, "text-violet-500")} />;
    case "tag_added": return <Tag size={12} className={cn(cls, "text-sky-500")} />;
    case "automation_fired": return <Zap size={12} className={cn(cls, "text-amber-500")} />;
    case "handoff": case "handler_changed": return <UserRound size={12} className={cn(cls, "text-emerald-500")} />;
    case "ai_turn": return <Sparkles size={12} className={cn(cls, "text-sky-500")} />;
    default: return <span className={cn(cls, "mt-1.5 h-1.5 w-1.5 rounded-full bg-zinc-400")} />;
  }
}

const ACTOR: Record<string, string> = { ai: "IA", human: "Humano", rule: "Regla", system: "Sistema" };
function describe(e: CrmEvent): string {
  const x = e.data;
  const who = ACTOR[e.actor] ?? e.actor;
  switch (e.type) {
    case "stage_changed": return `${who} movió ${String(x.from ?? "—")} → ${String(x.to)}`;
    case "tag_added": return `${who} añadió la etiqueta “${String(x.tag)}”`;
    case "score_changed": return `Puntaje ${String(x.from)} → ${String(x.to)}`;
    case "handoff": return `Traspaso a humano: ${String(x.reason)}`;
    case "automation_fired": return `Regla “${String(x.rule)}”`;
    case "fields_updated": return `${who} actualizó ${Object.keys(x).filter((k) => !k.startsWith("_")).join(", ") || "el modo de IA"}`;
    case "handler_changed": return x.to === "human" ? "Un humano tomó el control" : "Se reanudó la IA";
    case "ai_turn": return `Turno de IA (${(x.tools as string[]).length} herramientas)`;
    case "created": return `Creado en ${String(x.stage)}`;
    case "sequence_enrolled": return `${who} inscribió en “${String(x.sequence)}”`;
    case "sequence_step": return `Paso ${Number(x.position) + 1} “${String(x.title)}”: ${x.outcome === "skipped" ? "saltado" : "hecho"}${x.note ? ` (${String(x.note)})` : ""}`;
    case "sequence_reply": return `Primera respuesta a los ${String(x.minutes)} min`;
    case "sequence_exited": return `Salió de “${String(x.sequence)}”: ${x.reason === "reply" ? "respondió" : String(x.reason)}`;
    case "sequence_finished": return `Terminó “${String(x.sequence)}”`;
    default: return e.type;
  }
}

const STATUS_LABEL = { active: "Activa", finished: "Terminada", exited: "Salió" } as const;

function SequencePanel({ contactId, enrollment: e }: { contactId: number; enrollment: ContactDetail["enrollment"] }) {
  const { data: sequences } = useApi<Sequence[]>("/api/sequences");
  const [pick, setPick] = useState("");
  const [error, setError] = useState("");
  const run = (p: Promise<unknown>) => void p.then(() => setError("")).catch((x: Error) => setError(x.message));
  const canEnroll = !e || e.status !== "active";
  return (
    <div className="space-y-2 text-xs">
      {e && (
        <div className="space-y-0.5">
          <p className="font-medium text-zinc-700 dark:text-zinc-200">{e.sequence_name} · {STATUS_LABEL[e.status]}</p>
          {e.status === "active" && e.next_step && (
            <p className="text-zinc-500">
              Paso {e.position + 1}/{e.total_steps}: {e.next_step.title} ({STEP_CHANNEL_LABEL[e.next_step.channel]})
              {e.next_due_at && <> · {new Date(e.next_due_at).toLocaleString("es-CO", { weekday: "short", hour: "numeric", minute: "2-digit" })}</>}
            </p>
          )}
          {e.status === "exited" && <p className="text-zinc-500">Motivo: {e.exit_reason === "reply" ? "respondió" : e.exit_reason}</p>}
          {e.first_reply_at && <p className="text-emerald-600 dark:text-emerald-400">Primera respuesta a los {Math.round((e.first_reply_at - (e.last_step_at ?? e.enrolled_at)) / 60_000)} min</p>}
          {e.status === "active" && (
            <button onClick={() => run(api("POST", `/api/enrollments/${e.id}/exit`, { reason: "Respondió" }))} className="font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              Marcar que respondió (salir)
            </button>
          )}
        </div>
      )}
      {canEnroll && (
        sequences && sequences.length ? (
          <form className="flex gap-1" onSubmit={(ev) => { ev.preventDefault(); if (pick) run(api("POST", `/api/contacts/${contactId}/enroll`, { sequence_id: Number(pick) })); }}>
            <select value={pick} onChange={(ev) => setPick(ev.target.value)} aria-label="Secuencia" className={inputCls}>
              <option value="">Elegir secuencia…</option>
              {sequences.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.steps.length} pasos)</option>)}
            </select>
            <button disabled={!pick} className="flex h-7 shrink-0 items-center rounded-lg bg-zinc-900 px-2 font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Inscribir</button>
          </form>
        ) : (
          <p className="text-zinc-500">Aún no hay secuencias creadas.</p>
        )
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
