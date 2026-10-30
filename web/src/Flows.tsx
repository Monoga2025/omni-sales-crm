import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addEdge, Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Panel, Position,
  ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import {
  Filter, Hand, LayoutGrid, MessageSquare, MessagesSquare, Plus, Save, Sparkles, Tag, Trash2, Zap,
} from "lucide-react";
import { api, CHANNELS, MODE_LABEL, TOOL_LABEL, useApi, type AiMode, type ContactRow, type Rule, type Stage } from "./api";
import { Btn, ChannelGlyph, ModeIcon, cn, inputCls, useTheme } from "./ui";

type D = Record<string, unknown>;
type FNode = Node<D>;

const TRIGGER_LABEL: Record<Rule["trigger_type"], string> = {
  stage_enter: "El lead entra a una etapa",
  score_gte: "El puntaje alcanza",
  tag_added: "Se añade una etiqueta",
};
const ACTION_LABEL: Record<Rule["action_type"], string> = {
  send_message: "Enviar plantilla de mensaje",
  handoff: "Traspasar a un humano",
  add_tag: "Añadir etiqueta",
  set_ai_mode: "Cambiar modo de la IA",
};
const SWATCHES = ["#71717a", "#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#ec4899", "#14b8a6"];

// ---------------------------------------------------------------------------------------------
// Node renderers
// ---------------------------------------------------------------------------------------------

const shell = (selected: boolean, extra?: string) =>
  cn(
    "w-[230px] rounded-lg border bg-white text-xs shadow-sm dark:bg-zinc-900",
    selected ? "border-accent ring-2 ring-accent/30" : "border-zinc-300 dark:border-zinc-700",
    extra,
  );
const Tag2 = ({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: string }) => (
  <div className={cn("flex items-center gap-1.5 rounded-t-lg border-b px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide", tone)}>{icon}{label}</div>
);

function EntryNode({ selected }: NodeProps<FNode>) {
  return (
    <div className={shell(selected)}>
      <Tag2 icon={<MessagesSquare size={12} />} label="Trigger de entrada" tone="border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300" />
      <div className="space-y-1.5 p-2.5">
        <div className="text-sm font-semibold">Mensaje entrante</div>
        <div className="flex gap-1.5">{Object.keys(CHANNELS).map((c) => <ChannelGlyph key={c} channel={c} size={13} />)}</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function AiNode({ selected, data }: NodeProps<FNode>) {
  return (
    <div className={shell(selected)}>
      <Handle type="target" position={Position.Left} />
      <Tag2 icon={<Sparkles size={12} />} label="Clasificador IA" tone="border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/50 dark:text-sky-300" />
      <div className="space-y-1.5 p-2.5">
        <div className="text-sm font-semibold">Agente de ventas</div>
        <div className="text-zinc-500">Extrae datos, etiqueta, puntúa y decide la etapa.</div>
        <div className="truncate text-[10px] text-zinc-400">Motor: {String(data.provider || "—")}</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function StageNode({ selected, data }: NodeProps<FNode>) {
  const s = data.stage as Stage;
  return (
    <div className={shell(selected)}>
      <Handle type="target" position={Position.Left} />
      <Tag2 icon={<span className="h-2 w-2 rounded-full" style={{ background: s.color }} />} label={`Etapa${s.is_won ? " · meta" : s.is_lost ? " · descarte" : ""}`} tone="border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300" />
      <div className="space-y-1 p-2.5">
        <div className="flex items-center justify-between"><span className="text-sm font-semibold">{s.name}</span><span className="text-zinc-500">{String(data.count)} leads</span></div>
        <div className="flex items-center gap-1 text-zinc-500"><ModeIcon mode={s.ai_mode} size={11} /> {MODE_LABEL[s.ai_mode]} · temp. {s.ai_temperature}</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function CondNode({ selected, data }: NodeProps<FNode>) {
  const r = data.rule as Rule;
  return (
    <div className={shell(selected, !r.enabled ? "opacity-50" : "")}>
      <Handle type="target" position={Position.Left} />
      <Tag2 icon={<Filter size={12} />} label="Condición" tone="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/50 dark:text-violet-300" />
      <div className="p-2.5 text-sm font-semibold">{r.trigger_type === "score_gte" ? `Puntaje ≥ ${r.trigger_value}` : `Etiqueta “${r.trigger_value}”`}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const ACTION_ICON = { send_message: MessageSquare, handoff: Hand, add_tag: Tag, set_ai_mode: Sparkles } as const;
function ActNode({ selected, data }: NodeProps<FNode>) {
  const r = data.rule as Rule;
  const stage = data.stage as Stage | undefined;
  const I = ACTION_ICON[r.action_type];
  const detail =
    r.action_type === "send_message" ? `“${r.action_value}”` : r.action_type === "add_tag" ? `“${r.action_value}”` : r.action_type === "set_ai_mode" ? MODE_LABEL[r.action_value as AiMode] ?? r.action_value : r.action_value || "Sin motivo";
  return (
    <div className={shell(selected, !r.enabled ? "opacity-50" : "")}>
      <Handle type="target" position={Position.Left} />
      <Tag2 icon={<I size={12} />} label="Acción" tone="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300" />
      <div className="space-y-0.5 p-2.5">
        <div className="text-sm font-semibold">{ACTION_LABEL[r.action_type]}</div>
        <div className="line-clamp-2 text-zinc-500">{detail}</div>
        {stage && <div className="pt-0.5 text-[10px] text-zinc-400">Al entrar a {stage.name}</div>}
        {!r.enabled && <div className="text-[10px] font-medium text-amber-600">Desactivada</div>}
      </div>
    </div>
  );
}

const nodeTypes = { entry: EntryNode, ai: AiNode, stage: StageNode, cond: CondNode, act: ActNode };

// ---------------------------------------------------------------------------------------------
// Graph derived from the database
// ---------------------------------------------------------------------------------------------

type Layout = Record<string, { x: number; y: number }>;

function buildGraph(stages: Stage[], rules: Rule[], layout: Layout, counts: Map<number, number>, provider: string, selectedId: string | null) {
  const pos = (id: string, x: number, y: number) => layout[id] ?? { x, y };
  const nodes: FNode[] = [];
  const edges: Edge[] = [];
  const mark = { type: MarkerType.ArrowClosed, width: 14, height: 14 };
  const edge = (id: string, source: string, target: string, dashed = false): Edge => ({
    id, source, target, markerEnd: mark, deletable: false, selectable: false,
    style: { strokeWidth: 1.5, ...(dashed ? { strokeDasharray: "5 4" } : {}) },
    className: "[&_path]:stroke-zinc-400 dark:[&_path]:stroke-zinc-600",
  });

  const stageRules = (id: number) => rules.filter((r) => r.trigger_type === "stage_enter" && r.trigger_stage_id === id);
  let y = 0;
  const stageY = new Map<number, number>();
  for (const s of stages) {
    stageY.set(s.id, y);
    y += Math.max(1, stageRules(s.id).length) * 120 + 24;
  }
  nodes.push({ id: "entry", type: "entry", position: pos("entry", 0, Math.max(0, y / 2 - 50)), data: {}, selected: selectedId === "entry" });
  nodes.push({ id: "ai", type: "ai", position: pos("ai", 310, Math.max(0, y / 2 - 60)), data: { provider }, selected: selectedId === "ai" });
  edges.push(edge("e:entry-ai", "entry", "ai"));

  for (const s of stages) {
    const sy = stageY.get(s.id)!;
    nodes.push({ id: `stage:${s.id}`, type: "stage", position: pos(`stage:${s.id}`, 650, sy), data: { stage: s, count: counts.get(s.id) ?? 0 }, selected: selectedId === `stage:${s.id}` });
    edges.push(edge(`e:ai-stage:${s.id}`, "ai", `stage:${s.id}`, true));
    stageRules(s.id).forEach((r, k) => {
      nodes.push({ id: `act:${r.id}`, type: "act", position: pos(`act:${r.id}`, 1010, sy + k * 120), data: { rule: r, stage: s }, selected: selectedId === `act:${r.id}` });
      edges.push(edge(`e:stage:${s.id}-act:${r.id}`, `stage:${s.id}`, `act:${r.id}`));
    });
  }
  let cy = y + 20;
  for (const r of rules.filter((x) => x.trigger_type !== "stage_enter")) {
    nodes.push({ id: `cond:${r.id}`, type: "cond", position: pos(`cond:${r.id}`, 650, cy), data: { rule: r }, selected: selectedId === `cond:${r.id}` });
    nodes.push({ id: `act:${r.id}`, type: "act", position: pos(`act:${r.id}`, 1010, cy), data: { rule: r }, selected: selectedId === `act:${r.id}` });
    edges.push(edge(`e:ai-cond:${r.id}`, "ai", `cond:${r.id}`, true), edge(`e:cond:${r.id}-act:${r.id}`, `cond:${r.id}`, `act:${r.id}`));
    cy += 124;
  }
  return { nodes, edges };
}

// ---------------------------------------------------------------------------------------------

export function Flows() {
  return (
    <ReactFlowProvider>
      <Builder />
    </ReactFlowProvider>
  );
}

function Builder() {
  const stages = useApi<Stage[]>("/api/stages");
  const rules = useApi<Rule[]>("/api/rules");
  const contacts = useApi<ContactRow[]>("/api/contacts");
  const layout = useApi<Layout>("/api/flow/layout");
  const health = useApi<{ ai: string }>("/api/health");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const theme = useTheme();

  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of contacts.data ?? []) m.set(c.stage_id, (m.get(c.stage_id) ?? 0) + 1);
    return m;
  }, [contacts.data]);

  const ready = stages.data && rules.data && layout.data;
  useEffect(() => {
    if (!stages.data || !rules.data || !layout.data) return;
    const g = buildGraph(stages.data, rules.data, layout.data, counts, health.data?.ai ?? "", selectedId);
    setNodes(g.nodes);
    setEdges(g.edges);
  }, [stages.data, rules.data, layout.data, counts, health.data, selectedId, setNodes, setEdges]);

  useEffect(() => {
    if (ready) setTimeout(() => void fitView({ padding: 0.15, duration: 250 }), 60);
    // fit once when the graph first becomes available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!ready]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source?.startsWith("stage:") && c.target?.startsWith("act:")) {
        const stageId = Number(c.source.slice(6));
        const ruleId = Number(c.target.slice(4));
        setEdges((es) => addEdge({ ...c, deletable: false }, es));
        api("PUT", `/api/rules/${ruleId}`, { trigger_type: "stage_enter", trigger_stage_id: stageId })
          .then(() => { rules.reload(); flash("Regla conectada a la etapa."); })
          .catch((e: Error) => flash(e.message));
      } else flash("Conecta una etapa con una acción para definir cuándo se ejecuta.");
    },
    [setEdges, rules],
  );

  const saveLayout = (list: FNode[]) =>
    void api("PUT", "/api/flow/layout", { nodes: list.map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) })) }).then(() => layout.reload())
      .catch((e: Error) => flash(e.message));

  const addAction = async (action_type: Rule["action_type"]) => {
    const first = stages.data?.[0];
    if (!first) return;
    const defaults: Record<Rule["action_type"], string> = {
      send_message: "Hola {{name}}, ¿sigues interesado?",
      handoff: "Revisión humana",
      add_tag: "etiqueta-nueva",
      set_ai_mode: "nurture",
    };
    try {
      const r = await api<Rule>("POST", "/api/rules", {
        name: ACTION_LABEL[action_type], trigger_type: "stage_enter", trigger_stage_id: first.id, trigger_value: "", action_type, action_value: defaults[action_type], enabled: true,
      });
      rules.reload();
      setSelectedId(`act:${r.id}`);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const selectedRule = selectedId && /^(act|cond):/.test(selectedId) ? rules.data?.find((r) => r.id === Number(selectedId.split(":")[1])) : undefined;
  const selectedStage = selectedId?.startsWith("stage:") ? stages.data?.find((s) => s.id === Number(selectedId.slice(6))) : undefined;

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1">
        <header className="absolute left-0 right-0 top-0 z-10 flex h-11 items-center border-b border-zinc-200 bg-white/90 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
          <h1 className="text-base font-semibold">Flujos e IA</h1>
          <span className="ml-3 text-xs text-zinc-500">Arrastra los nodos, conecta etapas con acciones y haz clic para editar. Todo se guarda en la base de datos.</span>
        </header>
        <div className="h-full pt-11">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={(c) => !!c.source?.startsWith("stage:") && !!c.target?.startsWith("act:")}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            onNodeDragStop={(_, __, all) => saveLayout(all as FNode[])}
            deleteKeyCode={null}
            colorMode={theme}
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} className="[&_circle]:fill-zinc-300 dark:[&_circle]:fill-zinc-800" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap pannable zoomable position="bottom-right" className="!bg-white dark:!bg-zinc-900" maskColor="rgba(113,113,122,0.15)" nodeColor={(n) => (n.type === "ai" ? "#0ea5e9" : n.type === "act" ? "#10b981" : n.type === "cond" ? "#8b5cf6" : n.type === "stage" ? "#f59e0b" : "#a1a1aa")} />
            <Panel position="top-left" className="!mt-3">
              <div className="w-48 space-y-1 rounded-lg border border-zinc-200 bg-white p-2 shadow-md dark:border-zinc-800 dark:bg-zinc-900">
                <div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Añadir al flujo</div>
                <PaletteBtn icon={<MessageSquare size={13} />} label="Enviar plantilla" onClick={() => void addAction("send_message")} />
                <PaletteBtn icon={<Hand size={13} />} label="Traspaso a humano" onClick={() => void addAction("handoff")} />
                <PaletteBtn icon={<Tag size={13} />} label="Añadir etiqueta" onClick={() => void addAction("add_tag")} />
                <PaletteBtn icon={<Sparkles size={13} />} label="Cambiar modo IA" onClick={() => void addAction("set_ai_mode")} />
                <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
                <PaletteBtn icon={<Plus size={13} />} label="Nueva etapa" onClick={() => void api("POST", "/api/stages", { name: `Etapa ${(stages.data?.length ?? 0) + 1}` }).then(() => stages.reload()).catch((e: Error) => flash(e.message))} />
                <PaletteBtn icon={<LayoutGrid size={13} />} label="Ajustar vista" onClick={() => void fitView({ padding: 0.15, duration: 300 })} />
              </div>
            </Panel>
          </ReactFlow>
        </div>
        {toast && <div role="status" className="animate-pop absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">{toast}</div>}
      </div>

      <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l border-zinc-200 pt-0 dark:border-zinc-800" aria-label="Propiedades">
        <div className="flex h-11 shrink-0 items-center border-b border-zinc-200 px-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800">Propiedades</div>
        {selectedStage ? (
          <StageForm key={`${selectedStage.id}:${JSON.stringify(selectedStage)}`} stage={selectedStage} onDone={() => { stages.reload(); setSelectedId(null); }} flash={flash} onSaved={() => stages.reload()} />
        ) : selectedRule ? (
          <RuleForm key={`${selectedRule.id}:${JSON.stringify(selectedRule)}`} rule={selectedRule} stages={stages.data ?? []} onDone={() => { rules.reload(); setSelectedId(null); }} onSaved={() => rules.reload()} flash={flash} />
        ) : selectedId === "ai" ? (
          <AiInfo provider={health.data?.ai ?? ""} />
        ) : (
          <div className="space-y-3 p-4 text-xs text-zinc-500">
            <p>Selecciona un nodo para editarlo.</p>
            <ul className="space-y-1.5">
              <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm bg-amber-500" /> Etapa: modo, temperatura y prompt de la IA</li>
              <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm bg-violet-500" /> Condición: puntaje o etiqueta</li>
              <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Acción: mensaje, etiqueta, traspaso, modo IA</li>
              <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm bg-sky-500" /> Clasificador IA: motor y herramientas</li>
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

const PaletteBtn = ({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) => (
  <button onClick={onClick} className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
    {icon}{label}
  </button>
);

function AiInfo({ provider }: { provider: string }) {
  return (
    <div className="space-y-3 p-4 text-xs">
      <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={15} className="text-sky-500" /> Clasificador IA</div>
      <p className="text-zinc-500">Cada mensaje entrante pasa por el agente. El motor activo es <b className="text-zinc-900 dark:text-zinc-100">{provider || "—"}</b>. El prompt y la temperatura se definen por etapa.</p>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Herramientas disponibles</div>
      <ul className="space-y-1">
        {Object.entries(TOOL_LABEL).map(([k, v]) => (
          <li key={k} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1.5 dark:border-zinc-800"><Zap size={12} className="text-amber-500" /><span className="font-medium">{v}</span><code className="ml-auto text-[10px] text-zinc-400">{k}</code></li>
        ))}
      </ul>
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1 text-[11px] font-medium text-zinc-500">{label}{children}</label>
);
const selectCls = cn(inputCls, "pr-6");
const areaCls = "w-full rounded-lg border border-zinc-200 bg-white p-2 text-xs text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 focus:border-accent focus:outline-none dark:border-zinc-800 dark:bg-zinc-900";

function StageForm({ stage, onDone, onSaved, flash }: { stage: Stage; onDone: () => void; onSaved: () => void; flash: (m: string) => void }) {
  const [d, setD] = useState(stage);
  const dirty = JSON.stringify(d) !== JSON.stringify(stage);
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} /> Etapa: {stage.name}</div>
      <Field label="Nombre"><input className={inputCls} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
      <div className="flex gap-1.5" role="group" aria-label="Color">
        {SWATCHES.map((c) => <button key={c} aria-label={`Color ${c}`} aria-pressed={d.color === c} onClick={() => setD({ ...d, color: c })} className={cn("h-5 w-5 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-zinc-950", d.color === c && "ring-2 ring-zinc-900 dark:ring-zinc-100")} style={{ background: c }} />)}
      </div>
      <Field label="Modo de la IA">
        <select className={selectCls} value={d.ai_mode} onChange={(e) => setD({ ...d, ai_mode: e.target.value as AiMode })}>
          {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label={`Temperatura comercial: ${d.ai_temperature}/100`}>
        <input type="range" min={0} max={100} step={5} value={d.ai_temperature} onChange={(e) => setD({ ...d, ai_temperature: Number(e.target.value) })} className="w-full accent-[var(--color-accent)]" aria-label="Temperatura comercial" />
        <span className="flex justify-between text-[10px] font-normal text-zinc-400"><span>Consultiva</span><span>Presión de venta</span></span>
      </Field>
      <Field label="System prompt del agente en esta etapa"><textarea rows={4} className={areaCls} value={d.ai_prompt} onChange={(e) => setD({ ...d, ai_prompt: e.target.value })} /></Field>
      <Field label="Regla de entrada (la IA la usa para decidir el movimiento)"><textarea rows={3} className={areaCls} value={d.stage_rule} onChange={(e) => setD({ ...d, stage_rule: e.target.value })} /></Field>
      <div className="flex flex-wrap gap-3 text-xs">
        {(["is_default", "is_won", "is_lost"] as const).map((k) => (
          <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.checked })} />{k === "is_default" ? "Etapa inicial" : k === "is_won" ? "Etapa ganada" : "Etapa perdida"}</label>
        ))}
      </div>
      <div className="flex justify-between pt-1">
        <Btn variant="danger" onClick={() => void api("DELETE", `/api/stages/${stage.id}`).then(onDone).catch((e: Error) => flash(e.message))}><Trash2 size={12} /> Eliminar</Btn>
        <Btn variant="primary" disabled={!dirty} onClick={() => void api("PUT", `/api/stages/${stage.id}`, d).then(onSaved).catch((e: Error) => flash(e.message))}><Save size={12} /> Guardar</Btn>
      </div>
    </div>
  );
}

function RuleForm({ rule, stages, onDone, onSaved, flash }: { rule: Rule; stages: Stage[]; onDone: () => void; onSaved: () => void; flash: (m: string) => void }) {
  const [d, setD] = useState(rule);
  const dirty = JSON.stringify(d) !== JSON.stringify(rule);
  const save = () => {
    const body: Partial<Rule> = { ...d };
    if (d.trigger_type === "stage_enter") body.trigger_value = "";
    else body.trigger_stage_id = null;
    api("PUT", `/api/rules/${rule.id}`, body).then(onSaved).catch((e: Error) => flash(e.message));
  };
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold"><Zap size={14} className="text-amber-500" /> Regla de automatización</div>
      <Field label="Nombre"><input className={inputCls} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
      <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-2 dark:border-violet-900/50 dark:bg-violet-950/20">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">Cuando</div>
        <Field label="Disparador">
          <select className={selectCls} value={d.trigger_type} onChange={(e) => setD({ ...d, trigger_type: e.target.value as Rule["trigger_type"], trigger_stage_id: e.target.value === "stage_enter" ? (d.trigger_stage_id ?? stages[0]?.id ?? null) : null })}>
            {Object.entries(TRIGGER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <div className="mt-2">
          {d.trigger_type === "stage_enter" ? (
            <Field label="Etapa">
              <select className={selectCls} value={d.trigger_stage_id ?? ""} onChange={(e) => setD({ ...d, trigger_stage_id: Number(e.target.value) })}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          ) : (
            <Field label={d.trigger_type === "score_gte" ? "Puntaje mínimo (0-100)" : "Etiqueta"}>
              <input className={inputCls} value={d.trigger_value} onChange={(e) => setD({ ...d, trigger_value: e.target.value })} />
            </Field>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2 dark:border-emerald-900/50 dark:bg-emerald-950/20">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-300">Entonces</div>
        <Field label="Acción">
          <select className={selectCls} value={d.action_type} onChange={(e) => setD({ ...d, action_type: e.target.value as Rule["action_type"], action_value: e.target.value === "set_ai_mode" ? "nurture" : d.action_value })}>
            {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <div className="mt-2">
          {d.action_type === "send_message" ? (
            <Field label="Plantilla ({{name}} = nombre del lead)"><textarea rows={3} className={areaCls} value={d.action_value} onChange={(e) => setD({ ...d, action_value: e.target.value })} /></Field>
          ) : d.action_type === "set_ai_mode" ? (
            <Field label="Modo">
              <select className={selectCls} value={d.action_value} onChange={(e) => setD({ ...d, action_value: e.target.value })}>
                {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          ) : (
            <Field label={d.action_type === "add_tag" ? "Etiqueta" : "Motivo del traspaso"}><input className={inputCls} value={d.action_value} onChange={(e) => setD({ ...d, action_value: e.target.value })} /></Field>
          )}
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} /> Regla activa</label>
      <div className="flex justify-between pt-1">
        <Btn variant="danger" onClick={() => void api("DELETE", `/api/rules/${rule.id}`).then(onDone).catch((e: Error) => flash(e.message))}><Trash2 size={12} /> Eliminar</Btn>
        <Btn variant="primary" disabled={!dirty} onClick={save}><Save size={12} /> Guardar</Btn>
      </div>
    </div>
  );
}
