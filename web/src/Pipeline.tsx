import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, rectIntersection, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock, DollarSign, GripVertical, Search, Sparkles, Target, UserRound } from "lucide-react";
import { api, CHANNELS, money, MODE_LABEL, timeAgo, useApi, useLive, type AiMode, type ContactRow, type Stage } from "./api";
import { Avatar, ChannelGlyph, ModeIcon, ScoreBar, cn, inputCls } from "./ui";

/** The column under the pointer wins; rect intersection is only a fallback (e.g. keyboard drags). */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

type Cols = Record<number, number[]>;
const cid = (id: number) => `c:${id}`;
const sid = (id: number) => `s:${id}`;
const parse = (v: string | number) => Number(String(v).slice(2));

export function Pipeline({ onOpen }: { onOpen: (id: number) => void }) {
  const stages = useApi<Stage[]>("/api/stages");
  const contacts = useApi<ContactRow[]>("/api/contacts");
  const [q, setQ] = useState("");
  const [channel, setChannel] = useState<string | null>(null);
  const [cols, setCols] = useState<Cols>({});
  const [active, setActive] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { typing } = useLive();
  const origin = useRef<{ col: number; index: number } | null>(null);

  const byId = useMemo(() => new Map((contacts.data ?? []).map((c) => [c.id, c])), [contacts.data]);
  const stageList = stages.data ?? [];

  // Rebuild local columns from the server whenever nothing is being dragged.
  useEffect(() => {
    if (active !== null || !contacts.data || !stages.data) return;
    const next: Cols = {};
    for (const s of stages.data) next[s.id] = [];
    for (const c of [...contacts.data].sort((a, b) => a.sort_order - b.sort_order || b.last_message_at - a.last_message_at)) (next[c.stage_id] ??= []).push(c.id);
    setCols(next);
  }, [contacts.data, stages.data, active]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const findCol = (id: string): number | undefined => {
    if (id.startsWith("s:")) return parse(id);
    const cidNum = parse(id);
    return Number(Object.keys(cols).find((k) => cols[Number(k)]!.includes(cidNum)));
  };

  const onDragStart = (e: DragStartEvent) => {
    const item = parse(e.active.id);
    const col = findCol(String(e.active.id));
    origin.current = col === undefined ? null : { col, index: cols[col]!.indexOf(item) };
    setActive(item);
  };

  const onDragOver = (e: DragOverEvent) => {
    const { active: a, over } = e;
    if (!over) return;
    const from = findCol(String(a.id));
    const to = findCol(String(over.id));
    if (from === undefined || to === undefined || from === to) return;
    setCols((prev) => {
      const item = parse(a.id);
      const dest = prev[to]!;
      const overIdx = String(over.id).startsWith("c:") ? dest.indexOf(parse(over.id)) : dest.length;
      const idx = overIdx < 0 ? dest.length : overIdx;
      return { ...prev, [from]: prev[from]!.filter((x) => x !== item), [to]: [...dest.slice(0, idx), item, ...dest.slice(idx)] };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active: a, over } = e;
    const item = parse(a.id);
    let col = findCol(String(a.id));
    let next = cols;
    if (over && col !== undefined) {
      const overCol = findCol(String(over.id));
      if (overCol === col && String(over.id).startsWith("c:")) {
        const oldI = cols[col]!.indexOf(item);
        const newI = cols[col]!.indexOf(parse(over.id));
        if (oldI !== newI && newI >= 0) {
          next = { ...cols, [col]: arrayMove(cols[col]!, oldI, newI) };
          setCols(next);
        }
      }
    }
    setActive(null);
    col = findCol(cid(item)) ?? col;
    if (col === undefined) return;
    const target = next[col] ?? cols[col];
    const index = target ? target.indexOf(item) : 0;
    const start = origin.current;
    origin.current = null;
    if (start && start.col === col && start.index === index) return; // dropped where it started
    api("POST", "/api/pipeline/place", { contact_id: item, stage_id: col, index: Math.max(0, index) })
      .then(() => setErr(null))
      .catch((er: Error) => setErr(er.message))
      .finally(() => contacts.reload());
  };

  const term = q.trim().toLowerCase();
  const match = (c: ContactRow) =>
    (!channel || c.channel === channel) && (!term || c.name.toLowerCase().includes(term) || c.tags.some((t) => t.includes(term)));

  const all = contacts.data ?? [];
  const openValue = all.filter((c) => { const s = stageList.find((x) => x.id === c.stage_id); return s && !s.is_won && !s.is_lost; }).reduce((a, c) => a + c.budget_value, 0);
  const wonValue = all.filter((c) => stageList.find((x) => x.id === c.stage_id)?.is_won).reduce((a, c) => a + c.budget_value, 0);
  const activeContact = active !== null ? byId.get(active) : undefined;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <h1 className="text-base font-semibold">Pipeline</h1>
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span><b className="text-zinc-900 tabular-nums dark:text-zinc-100">{all.length}</b> leads</span>
          <span>Abierto <b className="text-zinc-900 tabular-nums dark:text-zinc-100">{money(openValue)}</b></span>
          <span>Ganado <b className="tabular-nums text-emerald-600 dark:text-emerald-400">{money(wonValue)}</b></span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {err && <span className="text-xs text-red-500" role="alert">{err}</span>}
          <div className="flex items-center gap-0.5">
            {Object.keys(CHANNELS).map((c) => (
              <button
                key={c}
                title={CHANNELS[c]}
                aria-label={`Filtrar por ${CHANNELS[c]}`}
                aria-pressed={channel === c}
                onClick={() => setChannel(channel === c ? null : c)}
                className={cn("flex h-7 w-7 items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900", channel === c && "bg-zinc-100 ring-1 ring-zinc-300 dark:bg-zinc-800 dark:ring-zinc-700")}
              >
                <ChannelGlyph channel={c} size={13} />
              </button>
            ))}
          </div>
          <div className="relative w-52">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por nombre o etiqueta" aria-label="Filtrar leads" className={cn(inputCls, "pl-7")} />
          </div>
        </div>
      </header>

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="flex min-h-0 flex-1 overflow-x-auto">
          {stageList.map((s) => (
            <Column key={s.id} stage={s} ids={cols[s.id] ?? []} byId={byId} match={match} onOpen={onOpen} typing={typing} />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
          {activeContact ? <CardBody c={activeContact} mode={stageList.find((s) => s.id === activeContact.stage_id)?.ai_mode} live={!!typing[activeContact.id]} overlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({ stage, ids, byId, match, onOpen, typing }: { stage: Stage; ids: number[]; byId: Map<number, ContactRow>; match: (c: ContactRow) => boolean; onOpen: (id: number) => void; typing: Record<number, boolean> }) {
  const { setNodeRef, isOver } = useDroppable({ id: sid(stage.id) });
  const rows = ids.map((i) => byId.get(i)).filter((c): c is ContactRow => !!c);
  const total = rows.reduce((a, c) => a + c.budget_value, 0);
  return (
    <section aria-label={`Etapa ${stage.name}`} className={cn("flex w-[288px] shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800", isOver && "bg-accent/5")}>
      <header className="shrink-0 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: stage.color }} />
          <h2 className="text-sm font-semibold">{stage.name}</h2>
          <span className="rounded bg-zinc-100 px-1.5 text-[11px] font-medium tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{rows.length}</span>
          <span className="ml-auto text-xs font-semibold tabular-nums">{money(total)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1 pl-4 text-[11px] text-zinc-500">
          <ModeIcon mode={stage.ai_mode} size={11} /> IA: {MODE_LABEL[stage.ai_mode]}
        </div>
      </header>
      <div ref={setNodeRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        <SortableContext items={rows.map((c) => cid(c.id))} strategy={verticalListSortingStrategy}>
          {rows.map((c) => (
            <SortableCard key={c.id} c={c} dim={!match(c)} onOpen={onOpen} mode={stage.ai_mode} live={!!typing[c.id]} />
          ))}
        </SortableContext>
        {rows.length === 0 && <div className="rounded-lg border border-dashed border-zinc-300 py-6 text-center text-[11px] text-zinc-400 dark:border-zinc-700">Suelta un lead aquí</div>}
      </div>
    </section>
  );
}

function SortableCard({ c, dim, onOpen, mode, live }: { c: ContactRow; dim: boolean; onOpen: (id: number) => void; mode: AiMode; live: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cid(c.id) });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("touch-none", isDragging && "opacity-30", dim && "opacity-35")}
      data-testid={`card-${c.id}`}
      {...attributes}
      {...listeners}
    >
      <CardBody c={c} mode={mode} live={live} onOpen={() => onOpen(c.id)} />
    </div>
  );
}

function CardBody({ c, overlay, onOpen, mode, live }: { c: ContactRow; overlay?: boolean; onOpen?: () => void; mode?: AiMode; live?: boolean }) {
  const breached = c.last_sender === "customer" && c.handler === "human" && Date.now() - c.last_message_at > 15 * 60000;
  return (
    <article
      className={cn(
        "group cursor-grab rounded-lg border border-zinc-200 bg-white p-2.5 text-xs hover:border-zinc-300 active:cursor-grabbing dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700",
        overlay && "rotate-1 cursor-grabbing border-accent shadow-2xl ring-1 ring-accent/40",
      )}
    >
      <div className="flex items-start gap-2">
        <Avatar name={c.name} channel={c.channel} size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <button onClick={onOpen} onPointerDown={(e) => e.stopPropagation()} className="truncate text-sm font-semibold hover:underline">{c.name}</button>
            <GripVertical size={12} className="ml-auto shrink-0 text-zinc-300 opacity-0 group-hover:opacity-100 dark:text-zinc-600" />
          </div>
          <div className="truncate text-zinc-500">{c.last_message ?? "Sin mensajes"}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="inline-flex items-center gap-0.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums dark:bg-zinc-800">
          <DollarSign size={11} className="text-zinc-400" />
          {c.budget_value > 0 ? money(c.budget_value).slice(1) : <span className="font-normal text-zinc-400">sin presupuesto</span>}
        </span>
        {c.fields.interest && (
          <span className="inline-flex max-w-[120px] items-center gap-0.5 truncate rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={`Interés: ${c.fields.interest}`}>
            <Target size={11} className="shrink-0 text-zinc-400" /> <span className="truncate">{c.fields.interest}</span>
          </span>
        )}
        {mode && (
          <span className="inline-flex items-center gap-0.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title="Modo actual de la IA">
            <ModeIcon mode={mode} size={11} /> {MODE_LABEL[mode]}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <ScoreBar score={c.score} className="flex-1" />
        <span className="w-6 text-right text-[11px] font-semibold tabular-nums">{c.score}</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-400">
        <Clock size={11} className={breached ? "text-red-500" : undefined} /> <span className={breached ? "font-medium text-red-500" : undefined}>{timeAgo(c.last_message_at)}</span>
        {live ? (
          <span className="ml-auto flex items-center gap-1 font-medium text-sky-600 dark:text-sky-400" role="status">
            <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500" /></span>
            IA negociando
          </span>
        ) : (
          <span className="ml-auto flex items-center gap-1">
            {c.handler === "ai" ? <Sparkles size={11} className="text-sky-500" /> : <UserRound size={11} className="text-emerald-500" />}
            {c.handler === "ai" ? "IA" : "Humano"}
          </span>
        )}
      </div>
    </article>
  );
}
