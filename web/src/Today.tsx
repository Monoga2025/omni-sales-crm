import { useEffect, useState } from "react";
import { CalendarCheck, Check, Copy, ExternalLink, MessageCircleReply, SkipForward } from "lucide-react";
import { api, STEP_CHANNEL_LABEL, useApi, type SequenceTask } from "./api";
import { Avatar, Btn, cn } from "./ui";

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const DAY = 86_400_000;
const hour = (t: number) => new Date(t).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
const date = (t: number) => new Date(t).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });

/** Daily queue of manual sequence steps: the user sends by hand, then marks the step done. */
export function Today({ onOpen }: { onOpen: (contactId: number) => void }) {
  const [now, setNow] = useState(Date.now());
  const [ahead, setAhead] = useState(false);
  // Steps become due with time, not only on server events.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const until = startOfDay(now) + (ahead ? 2 : 1) * DAY - 1;
  const { data, error, reload } = useApi<SequenceTask[]>(`/api/tasks?until=${until}`);
  const tasks = data ?? [];
  const today = startOfDay(now);
  const groups = [
    { title: "Atrasadas", items: tasks.filter((t) => t.due_at < today) },
    { title: "Hoy", items: tasks.filter((t) => t.due_at >= today && t.due_at < today + DAY) },
    { title: "Mañana", items: tasks.filter((t) => t.due_at >= today + DAY) },
  ].filter((g) => g.items.length);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-6">
        <header className="mb-4 flex items-center gap-3">
          <CalendarCheck size={18} className="text-zinc-500" />
          <h1 className="text-base font-semibold">Hoy</h1>
          <span className="text-xs text-zinc-500">{tasks.filter((t) => t.due_at <= now).length} pendientes ahora</span>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={ahead} onChange={(e) => setAhead(e.target.checked)} /> Ver mañana
          </label>
        </header>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {data && groups.length === 0 && (
          <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No hay pasos pendientes. Inscribe contactos en una secuencia desde el inspector del contacto.
          </p>
        )}
        {groups.map((g) => (
          <section key={g.title} className="mb-6" aria-label={g.title}>
            <h2 className={cn("mb-2 text-xs font-semibold uppercase tracking-wide", g.title === "Atrasadas" ? "text-red-600 dark:text-red-400" : "text-zinc-500")}>
              {g.title} · {g.items.length}
            </h2>
            <ul className="space-y-2">
              {g.items.map((t) => <TaskCard key={t.enrollment.id} t={t} now={now} onOpen={onOpen} onChange={reload} />)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function TaskCard({ t, now, onOpen, onChange }: { t: SequenceTask; now: number; onOpen: (id: number) => void; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const act = (path: string, body: object = {}) => {
    setBusy(true);
    void api("POST", `/api/enrollments/${t.enrollment.id}/${path}`, body).finally(() => {
      setBusy(false);
      onChange();
    });
  };
  const copy = () => {
    void navigator.clipboard?.writeText(t.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const late = t.due_at < startOfDay(now);
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start gap-3">
        <Avatar name={t.contact.name} channel={t.contact.channel} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <button onClick={() => onOpen(t.contact.id)} className="truncate text-sm font-semibold hover:underline">{t.contact.name}</button>
            <span className="text-[11px] text-zinc-500">
              Paso {t.step_number}/{t.total_steps} · {STEP_CHANNEL_LABEL[t.step.channel]} · {t.sequence.name}
            </span>
            <span className={cn("ml-auto text-[11px]", late ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-500")}>
              {late && t.due_at < now - DAY ? date(t.due_at) : hour(t.due_at)}
            </span>
          </div>
          <p className="mt-0.5 text-xs font-medium text-zinc-700 dark:text-zinc-200">{t.step.title}</p>
          {t.enrollment.first_reply_at && (
            <p className="mt-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
              Respondió por WhatsApp a los {Math.round((t.enrollment.first_reply_at - (t.enrollment.last_step_at ?? t.enrollment.enrolled_at)) / 60_000)} min
            </p>
          )}
          {t.text && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-zinc-50 p-2 text-xs text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200">{t.text}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.wa_link && (
              <a href={t.wa_link} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
                <ExternalLink size={13} /> Abrir WhatsApp
              </a>
            )}
            {t.text && <Btn onClick={copy}><Copy size={13} /> {copied ? "Copiado" : "Copiar texto"}</Btn>}
            <Btn variant="primary" disabled={busy} onClick={() => act("complete")}><Check size={13} /> Hecho</Btn>
            <Btn variant="subtle" disabled={busy} onClick={() => act("skip")}><SkipForward size={13} /> Saltar</Btn>
            <Btn variant="subtle" disabled={busy} onClick={() => act("exit", { reason: "Respondió" })}><MessageCircleReply size={13} /> Respondió</Btn>
          </div>
        </div>
      </div>
    </li>
  );
}
