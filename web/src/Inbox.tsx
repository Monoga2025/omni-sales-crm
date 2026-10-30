import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check, ChevronDown, ChevronRight, Clock, ExternalLink, Hand, Inbox as Inbox2, Mail, Paperclip, Play, Plus, Search, Send,
  Settings2, Sparkles, StickyNote, UserRound, Wrench, X,
} from "lucide-react";
import {
  api, CHANNELS, TOOL_LABEL, timeAgo, useApi, useLive,
  type ContactDetail, type ContactRow, type Message, type Stage,
} from "./api";
import { Avatar, Btn, ChannelGlyph, Kbd, ModeIcon, cn, inputCls } from "./ui";
import { Inspector } from "./Inspector";

const TEMPLATES = [
  { key: "saludo", text: "Hola {{nombre}}, gracias por escribirnos. ¿En qué puedo ayudarte?" },
  { key: "precio", text: "Con gusto, {{nombre}}. El plan Pro cuesta $49 por usuario al mes. ¿Cuántos usuarios serían?" },
  { key: "demo", text: "¿Te parece si agendamos una demo de 15 minutos esta semana?" },
  { key: "pago", text: "Te comparto el enlace de pago seguro. Cuando lo completes activamos tu cuenta de inmediato." },
  { key: "gracias", text: "¡Gracias por tu tiempo, {{nombre}}! Quedo atento a cualquier duda." },
];

type Tab = "all" | "ai" | "human" | "unread";
const TAB_LABEL: Record<Tab, string> = { all: "Todos", ai: "IA activa", human: "Humano", unread: "Sin leer" };

export function Inbox({ selected, onSelect }: { selected: number | null; onSelect: (id: number | null) => void }) {
  const contacts = useApi<ContactRow[]>("/api/contacts");
  const stages = useApi<Stage[]>("/api/stages");
  const [tab, setTab] = useState<Tab>("all");
  const [channel, setChannel] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<number | null>(null);
  const [unreplied, setUnreplied] = useState(false);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener("focus-search", focus);
    return () => window.removeEventListener("focus-search", focus);
  }, []);

  const all = useMemo(() => [...(contacts.data ?? [])], [contacts.data]);
  const stageList = stages.data ?? [];
  const counts: Record<Tab, number> = {
    all: all.length,
    ai: all.filter((c) => c.handler === "ai").length,
    human: all.filter((c) => c.handler === "human").length,
    unread: all.filter((c) => c.unread > 0).length,
  };
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = all.filter((c) => {
      if (tab === "ai" && c.handler !== "ai") return false;
      if (tab === "human" && c.handler !== "human") return false;
      if (tab === "unread" && !c.unread) return false;
      if (channel && c.channel !== channel) return false;
      if (stageFilter !== null && c.stage_id !== stageFilter) return false;
      if (unreplied && c.last_sender !== "customer") return false;
      return !term || c.name.toLowerCase().includes(term) || (c.last_message ?? "").toLowerCase().includes(term) || c.tags.some((t) => t.includes(term));
    });
    return rows.sort((a, b) => (oldestFirst ? a.last_message_at - b.last_message_at : b.last_message_at - a.last_message_at));
  }, [all, tab, channel, stageFilter, unreplied, oldestFirst, q]);

  const active = selected ?? list[0]?.id ?? null;

  return (
    <div className="flex h-full">
      <ViewsSidebar
        tab={tab} onTab={setTab} counts={counts}
        stages={stageList} stageFilter={stageFilter} onStage={setStageFilter} contacts={all}
        channel={channel} onChannel={setChannel} onCreate={() => setCreating(true)}
      />
      <aside className="flex w-[299px] shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <span className="relative flex h-full items-center text-base font-semibold text-accent">
            Chats
            <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t bg-accent" />
          </span>
          <span className="text-xs text-zinc-400">{list.length}</span>
        </div>
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-200 px-2 dark:border-zinc-800">
          <button
            onClick={() => setOldestFirst(!oldestFirst)}
            className="flex h-7 items-center gap-1 rounded-lg px-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
            aria-label="Cambiar orden"
          >
            Abiertas, {oldestFirst ? "antiguas" : "recientes"} <ChevronDown size={14} className="text-zinc-400" />
          </button>
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-200">
            <input type="checkbox" checked={unreplied} onChange={(e) => setUnreplied(e.target.checked)} className="peer sr-only" />
            <span className="relative h-4 w-7 rounded-full bg-zinc-300 transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent dark:bg-zinc-600">
              <span className={cn("absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform", unreplied && "translate-x-3")} />
            </span>
            Sin responder
          </label>
        </div>
        <div className="shrink-0 border-b border-zinc-200 p-2 dark:border-zinc-800">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conversaciones" aria-label="Buscar conversaciones" className={cn(inputCls, "pl-7 pr-12")} />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"><Kbd>⌘K</Kbd></span>
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {list.map((c) => (
            <li key={c.id}>
              <ConversationRow c={c} stage={stageList.find((s) => s.id === c.stage_id)} selected={active === c.id} onClick={() => onSelect(c.id)} />
            </li>
          ))}
          {contacts.data && list.length === 0 && <li className="p-6 text-center text-xs text-zinc-400">No hay conversaciones con esos filtros.</li>}
        </ul>
      </aside>

      {active ? (
        <Conversation key={active} id={active} stages={stageList} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-zinc-500">Crea un cliente simulado para iniciar una conversación.</div>
      )}
      {creating && (
        <NewCustomer
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            onSelect(id);
          }}
        />
      )}
    </div>
  );
}

const VIEWS: { id: Tab; label: string; icon: typeof Inbox2 }[] = [
  { id: "all", label: "Todas", icon: Inbox2 },
  { id: "ai", label: "IA activa", icon: Sparkles },
  { id: "human", label: "Humano", icon: UserRound },
  { id: "unread", label: "Sin leer", icon: Mail },
];

function NavRow({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-[#2f2f32]",
        active && "bg-[#e5efff] font-semibold text-zinc-900 hover:bg-[#e5efff] dark:bg-[#353c45] dark:text-zinc-200 dark:hover:bg-[#353c45]",
      )}
    >
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-zinc-500 dark:text-zinc-500">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-xs font-normal tabular-nums text-zinc-400">{count}</span>}
    </button>
  );
}

function SideSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-8 w-full items-center justify-between rounded-lg px-2 text-xs font-semibold text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
        {title}
        <ChevronDown size={14} className={cn("transition-transform", !open && "-rotate-90")} />
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

function ViewsSidebar(p: {
  tab: Tab; onTab: (t: Tab) => void; counts: Record<Tab, number>;
  stages: Stage[]; stageFilter: number | null; onStage: (id: number | null) => void; contacts: ContactRow[];
  channel: string | null; onChannel: (c: string | null) => void; onCreate: () => void;
}) {
  return (
    <aside className="flex w-[214px] shrink-0 flex-col border-r border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900" aria-label="Vistas">
      <div className="flex h-10 items-center justify-between px-2">
        <h1 className="text-base font-semibold">Bandeja</h1>
        <Btn variant="primary" onClick={p.onCreate} className="h-6 w-6 !px-0" aria-label="Nuevo cliente simulado" title="Nuevo cliente simulado">
          <Plus size={14} />
        </Btn>
      </div>
      <div className="space-y-0.5">
        {VIEWS.map((v) => (
          <NavRow key={v.id} active={p.tab === v.id && p.stageFilter === null} onClick={() => { p.onTab(v.id); p.onStage(null); }} icon={<v.icon size={18} strokeWidth={1.75} />} label={v.label} count={p.counts[v.id]} />
        ))}
      </div>
      <SideSection title="Lifecycle">
        {p.stages.map((s) => (
          <NavRow
            key={s.id}
            active={p.stageFilter === s.id}
            onClick={() => p.onStage(p.stageFilter === s.id ? null : s.id)}
            icon={<span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />}
            label={s.name}
            count={p.contacts.filter((c) => c.stage_id === s.id).length}
          />
        ))}
      </SideSection>
      <SideSection title="Canales">
        {Object.keys(CHANNELS).map((c) => (
          <NavRow key={c} active={p.channel === c} onClick={() => p.onChannel(p.channel === c ? null : c)} icon={<ChannelGlyph channel={c} size={16} />} label={CHANNELS[c]!} count={p.contacts.filter((x) => x.channel === c).length} />
        ))}
      </SideSection>
    </aside>
  );
}

function ConversationRow({ c, stage, selected, onClick }: { c: ContactRow; stage?: Stage; selected: boolean; onClick: () => void }) {
  const waitMin = Math.floor((Date.now() - c.last_message_at) / 60000);
  const breached = c.last_sender === "customer" && c.handler === "human" && waitMin >= 15;
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex w-full items-start gap-2.5 border-b border-zinc-100 px-3 py-2.5 text-left hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-[#2f2f32]",
        selected && "bg-[#e5efff] hover:bg-[#e5efff] dark:bg-[#353c45] dark:hover:bg-[#353c45]",
      )}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
      <Avatar name={c.name} channel={c.channel} size={34} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{c.name}</span>
          <span className={cn("shrink-0 text-[11px]", breached ? "font-medium text-red-500" : "text-zinc-400")}>{timeAgo(c.last_message_at)}</span>
        </span>
        <span className={cn("block truncate text-xs", c.unread ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-500")}>{c.last_message ?? "Sin mensajes"}</span>
        <span className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: stage?.color }} />
            {stage?.name}
          </span>
          {c.handler === "ai" ? (
            <span className="flex items-center gap-0.5 text-sky-600 dark:text-sky-400"><Sparkles size={11} /> IA</span>
          ) : (
            <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"><UserRound size={11} /> Humano</span>
          )}
          {breached && (
            <span className="flex items-center gap-0.5 text-red-500" title="SLA vencido: el cliente espera respuesta">
              <Clock size={11} /> SLA {waitMin} min
            </span>
          )}
          {c.unread > 0 && <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">{c.unread}</span>}
        </span>
      </span>
    </button>
  );
}

function NewCustomer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("whatsapp");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ contact: { id: number } }>("POST", "/api/simulate/customer", { name, channel, message });
      onCreated(r.contact.id);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="animate-pop w-[400px] space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h2 className="text-sm font-semibold">Nuevo cliente simulado</h2>
        <label className="block space-y-1 text-xs text-zinc-500">
          Nombre (opcional)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Visitante aleatorio si lo dejas vacío" className={inputCls} />
        </label>
        <div className="space-y-1 text-xs text-zinc-500">
          Canal
          <div className="flex gap-1.5">
            {Object.entries(CHANNELS).map(([k, v]) => (
              <button
                type="button"
                key={k}
                onClick={() => setChannel(k)}
                aria-pressed={channel === k}
                className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border text-xs text-zinc-700 dark:text-zinc-200", channel === k ? "border-accent bg-accent/10" : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900")}
              >
                <ChannelGlyph channel={k} size={13} /> {v}
              </button>
            ))}
          </div>
        </div>
        <label className="block space-y-1 text-xs text-zinc-500">
          Primer mensaje (opcional)
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hola, busco un CRM" className={inputCls} />
        </label>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex justify-end gap-2">
          <Btn type="button" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" disabled={busy}>{busy ? "Iniciando…" : "Iniciar conversación"}</Btn>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Conversation({ id, stages }: { id: number; stages: Stage[] }) {
  const detail = useApi<ContactDetail>(`/api/contacts/${id}`);
  const d = detail.data;
  const { typing } = useLive();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [d?.messages.length, typing[id]]);
  useEffect(() => {
    if (d?.contact.unread) void api("POST", `/api/contacts/${id}/read`).catch(() => undefined);
  }, [d?.contact.unread, id]);

  if (!d) return <div className="flex flex-1 items-center justify-center text-xs text-zinc-500">{detail.error ?? "Cargando…"}</div>;
  const c = d.contact;
  const stage = stages.find((s) => s.id === c.stage_id);

  return (
    <>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-zinc-200 px-3 dark:border-zinc-800">
          <Avatar name={c.name} channel={c.channel} size={28} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">{c.name}</div>
            <div className="flex items-center gap-1 text-[11px] text-zinc-500">
              <ChannelGlyph channel={c.channel} size={11} /> {CHANNELS[c.channel] ?? c.channel}
              {c.phone && <span>· {c.phone}</span>}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <StageMenu stages={stages} current={stage} onPick={(sid) => void api("POST", `/api/contacts/${id}/move`, { stage_id: sid })} />
            <span className="hidden items-center gap-1 text-[11px] text-zinc-500 md:flex" title="Modo actual de la IA">
              <ModeIcon mode={d.ai_mode} />
            </span>
            {c.handler === "ai" ? (
              <Btn onClick={() => void api("PATCH", `/api/contacts/${id}`, { handler: "human" })}>
                <Hand size={13} /> Tomar control
              </Btn>
            ) : (
              <Btn variant="primary" onClick={() => void api("PATCH", `/api/contacts/${id}`, { handler: "ai" })}>
                <Play size={13} /> Reanudar IA
              </Btn>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
          {d.messages.map((m) => (
            <Bubble key={m.id} m={m} name={c.name} />
          ))}
          {typing[id] && (
            <div className="flex justify-end" role="status" aria-label="La IA está escribiendo">
              <span className="flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-sky-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-sky-300">
                <Sparkles size={12} /> IA escribiendo
                <span className="flex gap-0.5">
                  {[0, 150, 300].map((delay) => <span key={delay} className="h-1 w-1 animate-bounce rounded-full bg-current" style={{ animationDelay: `${delay}ms` }} />)}
                </span>
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <Composer id={id} name={c.name} handler={c.handler} waNumber={c.channel === "whatsapp" ? c.phone.replace(/\D/g, "") : ""} />
      </section>
      <Inspector detail={d} stages={stages} />
    </>
  );
}

function StageMenu({ stages, current, onPick }: { stages: Stage[]; current?: Stage; onPick: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Btn onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="h-2 w-2 rounded-full" style={{ background: current?.color }} />
        {current?.name}
        <ChevronDown size={12} />
      </Btn>
      {open && (
        <ul role="listbox" className="animate-pop absolute right-0 top-8 z-30 w-44 rounded-lg border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          {stages.map((s) => (
            <li key={s.id}>
              <button
                role="option"
                aria-selected={s.id === current?.id}
                onClick={() => {
                  setOpen(false);
                  onPick(s.id);
                }}
                className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900", s.id === current?.id && "font-semibold")}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.name}
                <ModeIcon mode={s.ai_mode} size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Bubble({ m, name }: { m: Message; name: string }) {
  const [open, setOpen] = useState(false);
  if (m.sender === "system")
    return <div className="mx-auto w-fit max-w-[80%] rounded-full border border-zinc-200 px-3 py-0.5 text-center text-[11px] text-zinc-500 dark:border-zinc-800">{m.body}</div>;
  if (m.sender === "note")
    return (
      <div className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/30">
        <div className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
          <StickyNote size={12} /> Nota interna · solo visible para el equipo <span className="ml-auto font-normal opacity-70">{hhmm(m.created_at)}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm text-amber-950 dark:text-amber-100">{m.body}</p>
        {m.meta.attachment && <Attachment a={m.meta.attachment} />}
      </div>
    );
  const mine = m.sender !== "customer";
  const calls = m.meta.tool_calls ?? [];
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[72%] rounded-xl border px-3 py-2",
          m.sender === "customer" && "rounded-tl-sm border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900",
          m.sender === "ai" && "rounded-tr-sm border-blue-200 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/40",
          m.sender === "human" && "rounded-tr-sm border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30",
        )}
      >
        <div className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-zinc-500">
          {m.sender === "ai" && <><Sparkles size={11} className="text-sky-500" /> Agente IA</>}
          {m.sender === "human" && <><UserRound size={11} className="text-emerald-500" /> Agente humano</>}
          {m.sender === "customer" && name}
          <span className="ml-2 font-normal opacity-70">{hhmm(m.created_at)}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm">{m.body}</p>
        {m.meta.attachment && <Attachment a={m.meta.attachment} />}
        {mine && <Delivery d={m.meta.delivery} />}
        {calls.length > 0 && (
          <div className="mt-1.5 border-t border-blue-200/70 pt-1.5 dark:border-blue-900/50">
            <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:underline dark:text-sky-400">
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Wrench size={11} /> {calls.length} {calls.length === 1 ? "herramienta ejecutada" : "herramientas ejecutadas"}
            </button>
            {open && (
              <ol className="mt-1 space-y-1">
                {calls.map((t, i) => (
                  <li key={i} className="rounded-lg border border-blue-200/70 bg-white/70 px-2 py-1 font-mono text-[11px] dark:border-blue-900/50 dark:bg-zinc-950/50">
                    <div className="flex items-center gap-1.5 font-sans font-medium text-zinc-800 dark:text-zinc-100">
                      <span className="rounded bg-zinc-200 px-1 font-mono text-[10px] dark:bg-zinc-800">{t.name}</span>
                      {TOOL_LABEL[t.name] ?? t.name}
                    </div>
                    <div className="truncate text-zinc-500" title={JSON.stringify(t.input)}>{JSON.stringify(t.input)}</div>
                    <div className="text-emerald-700 dark:text-emerald-400">→ {t.result}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Delivery({ d }: { d: NonNullable<Message["meta"]["delivery"]> | undefined }) {
  if (!d || d.status === "simulated") return null;
  if (d.status === "sent") return <div className="mt-1 flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"><Check size={11} /> Entregado al canal</div>;
  return (
    <div className={cn("mt-1 text-[11px]", d.status === "failed" ? "text-red-500" : "text-amber-600 dark:text-amber-400")} title={d.error}>
      {d.status === "failed" ? `No entregado: ${d.error ?? "error del canal"}` : "Canal sin configurar: no se envió"}
    </div>
  );
}

const Attachment = ({ a }: { a: { name: string; size: number } }) => (
  <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white/70 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950/40">
    <Paperclip size={12} /> {a.name} <span className="text-zinc-400">{fmtSize(a.size)}</span>
  </div>
);

type Mode = "agent" | "note" | "customer";
const MODES: { id: Mode; label: string }[] = [
  { id: "agent", label: "Responder como agente" },
  { id: "note", label: "Nota interna" },
  { id: "customer", label: "Simular cliente" },
];

function Composer({ id, name, handler, waNumber }: { id: number; name: string; handler: "ai" | "human"; waNumber: string }) {
  const [mode, setMode] = useState<Mode>(handler === "human" ? "agent" : "customer");
  const [suggesting, setSuggesting] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [text, setText] = useState("");
  // A long reply goes out as 2-3 WhatsApp messages: parts are separated by a blank line.
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const [opened, setOpened] = useState<number[]>([]);
  useEffect(() => setOpened([]), [text]);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const slash = text.startsWith("/") ? text.slice(1).toLowerCase() : null;
  const matches = slash === null ? [] : TEMPLATES.filter((t) => t.key.includes(slash));
  const picking = matches.length > 0;
  const fill = (t: string) => t.replaceAll("{{nombre}}", name.split(" ")[0] ?? "");

  // Drafts the next message with AI; the user reviews it and sends it from WhatsApp.
  const suggest = async () => {
    setSuggesting(true);
    setErr(null);
    try {
      setText((await api<{ text: string }>("POST", `/api/contacts/${id}/suggest`)).text);
      setMode("agent");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || busy || picking) return;
    setBusy(true);
    setErr(null);
    try {
      const path = mode === "customer" ? "inbound" : mode === "note" ? "note" : "reply";
      await api("POST", `/api/contacts/${id}/${path}`, { body, ...(file && mode !== "customer" ? { attachment: file } : {}) });
      setText("");
      setFile(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative shrink-0 border-t border-zinc-200 p-3 dark:border-zinc-800">
      {matches.length > 0 && (
        <ul className="animate-pop absolute bottom-full left-3 z-20 mb-1 w-[460px] rounded-lg border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-800 dark:bg-zinc-950" role="listbox" aria-label="Plantillas rápidas">
          {matches.map((t) => (
            <li key={t.key}>
              <button onClick={() => setText(fill(t.text))} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900">
                <span className="mt-px rounded bg-zinc-200 px-1 font-mono text-[10px] dark:bg-zinc-800">/{t.key}</span>
                <span className="text-zinc-600 dark:text-zinc-300">{fill(t.text)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mb-2 flex items-center gap-0.5" role="tablist" aria-label="Modo del compositor">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              "h-6 rounded-lg px-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900",
              mode === m.id && m.id === "note" && "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
              mode === m.id && m.id !== "note" && "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
            )}
          >
            {m.label}
          </button>
        ))}
        {mode === "agent" && handler === "ai" && <span className="ml-2 text-[11px] text-zinc-400">Al enviar tomas el control de la conversación.</span>}
        <span className="ml-auto flex items-center gap-1">
          <Btn variant="subtle" onClick={() => void suggest()} disabled={suggesting}>
            <Sparkles size={12} className="text-sky-500" /> {suggesting ? "Pensando…" : "Sugerir con IA"}
          </Btn>
          <button onClick={() => setShowRules(!showRules)} aria-expanded={showRules} aria-label="Instrucciones de la IA" title="Instrucciones de la IA" className="flex h-6 w-6 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <Settings2 size={13} />
          </button>
        </span>
      </div>
      {showRules && <SuggestRules />}
      <div className={cn("rounded-lg border bg-white focus-within:border-accent dark:bg-zinc-900", mode === "note" ? "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20" : "border-zinc-200 dark:border-zinc-800")}>
        <textarea
          value={text}
          rows={Math.min(8, Math.max(2, text.split("\n").length))}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (picking) setText(fill(matches[0]!.text));
              else void send();
            }
          }}
          placeholder={mode === "customer" ? "Escribe lo que diría el cliente…" : mode === "note" ? "Escribe una nota interna…" : "Responde al cliente… (escribe / para plantillas)"}
          aria-label="Mensaje"
          className="block w-full resize-none bg-transparent px-3 pt-2 text-sm placeholder:text-zinc-400 focus:outline-none"
        />
        <div className="flex items-center gap-2 px-2 pb-1.5">
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile({ name: f.name, size: f.size }); e.target.value = ""; }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={mode === "customer"}
            aria-label="Adjuntar archivo"
            title={mode === "customer" ? "Los adjuntos no están disponibles al simular un cliente" : "Adjuntar archivo"}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
          >
            <Paperclip size={14} />
          </button>
          {file && (
            <span className="flex items-center gap-1 rounded-lg border border-zinc-200 px-1.5 py-0.5 text-[11px] dark:border-zinc-700">
              <Paperclip size={10} /> {file.name}
              <button aria-label="Quitar adjunto" onClick={() => setFile(null)}><X size={10} /></button>
            </span>
          )}
          <span className="ml-auto flex items-center gap-2 text-[11px] text-zinc-400">
            <span className="hidden sm:inline"><Kbd>/</Kbd> plantillas · <Kbd>↵</Kbd> enviar</span>
            {mode === "agent" && waNumber && parts.length > 0 && (
              <span className="flex items-center gap-1" aria-label="Enviar por WhatsApp">
                {parts.map((part, i) => (
                  <a
                    key={i}
                    href={`https://wa.me/${waNumber}?text=${encodeURIComponent(part)}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      const next = [...opened, i];
                      if (parts.every((_, j) => next.includes(j))) setText("");
                      else setOpened(next);
                    }}
                    title={parts.length > 1 ? `Abre WhatsApp con la parte ${i + 1}: "${part}"` : "Abre WhatsApp con el texto listo; tu mensaje aparece aquí cuando lo envíes"}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium",
                      opened.includes(i)
                        ? "border-zinc-200 text-zinc-400 line-through dark:border-zinc-800"
                        : "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40",
                    )}
                  >
                    <ExternalLink size={12} /> {parts.length > 1 ? `WhatsApp ${i + 1}/${parts.length}` : "Abrir en WhatsApp"}
                  </a>
                ))}
              </span>
            )}
            <Btn variant="primary" onClick={() => void send()} disabled={busy || !text.trim() || picking}>
              <Send size={12} /> {busy ? "Enviando…" : "Enviar"}
            </Btn>
          </span>
        </div>
      </div>
      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
    </div>
  );
}

/** Standing instructions for the suggested reply (who "I" am, the goal, what never to do). */
function SuggestRules() {
  const { data } = useApi<{ instructions: string }>("/api/suggest/settings");
  const [value, setValue] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const current = value ?? data?.instructions ?? "";
  const save = async () => {
    await api("PUT", "/api/suggest/settings", { instructions: current });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <div className="mb-2 rounded-lg border border-sky-200 bg-sky-50/60 p-2 dark:border-sky-900/60 dark:bg-sky-950/20">
      <label className="mb-1 block text-[11px] font-medium text-sky-800 dark:text-sky-300" htmlFor="suggest-rules">Instrucciones de la IA (se usan en todas las sugerencias)</label>
      <textarea
        id="suggest-rules"
        rows={5}
        value={current}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Quién eres en estos chats, qué buscas y qué nunca debe decir la IA."
        className={cn(inputCls, "w-full resize-y text-xs")}
      />
      <div className="mt-1 flex justify-end">
        <Btn variant="primary" onClick={() => void save()}>{saved ? "Guardado" : "Guardar"}</Btn>
      </div>
    </div>
  );
}
