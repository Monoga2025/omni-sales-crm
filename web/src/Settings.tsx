import { useEffect, useState } from "react";
import { BookOpen, Building2, Check, Copy, Cpu, ExternalLink, Plus, Radio, Save, Trash2, TriangleAlert } from "lucide-react";
import { api, useApi, type AiStatus, type Business, type ChannelInfo, type Knowledge } from "./api";
import { Btn, ChannelGlyph, cn, inputCls } from "./ui";

type Tab = "business" | "knowledge" | "channels" | "ai";
const TABS: { id: Tab; label: string; icon: typeof Cpu }[] = [
  { id: "business", label: "Negocio", icon: Building2 },
  { id: "knowledge", label: "Base de conocimiento", icon: BookOpen },
  { id: "channels", label: "Canales", icon: Radio },
  { id: "ai", label: "Motor de IA", icon: Cpu },
];

export function Settings() {
  const [tab, setTab] = useState<Tab>("business");
  return (
    <div className="flex h-full">
      <aside className="w-[214px] shrink-0 border-r border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900" aria-label="Configuración">
        <div className="flex h-10 items-center px-2"><h1 className="text-base font-semibold">Configuración</h1></div>
        <div className="space-y-0.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-[#2f2f32]",
                tab === id && "bg-[#e5efff] font-semibold dark:bg-[#353c45]",
              )}
            >
              <Icon size={18} strokeWidth={1.75} className="text-zinc-500" />
              {label}
            </button>
          ))}
        </div>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-6">
          {tab === "business" && <BusinessTab />}
          {tab === "knowledge" && <KnowledgeTab />}
          {tab === "channels" && <ChannelsTab />}
          {tab === "ai" && <AiTab />}
        </div>
      </div>
    </div>
  );
}

const Head = ({ title, text }: { title: string; text: string }) => (
  <header className="mb-5">
    <h2 className="text-base font-semibold">{title}</h2>
    <p className="mt-1 text-sm text-zinc-500">{text}</p>
  </header>
);
const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block space-y-1">
    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{label}</span>
    {children}
    {hint && <span className="block text-xs text-zinc-400">{hint}</span>}
  </label>
);
const areaCls = "w-full rounded-lg border border-zinc-200 bg-white p-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-accent focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100";

function BusinessTab() {
  const { data } = useApi<Business>("/api/business");
  const [d, setD] = useState<Business | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (data && !d) setD(data);
  }, [data, d]);
  if (!d) return <p className="text-sm text-zinc-500">Cargando…</p>;
  const set = (k: keyof Business, v: string) => {
    setD({ ...d, [k]: v });
    setSaved(false);
  };
  const save = () =>
    api("PUT", "/api/business", d)
      .then(() => { setSaved(true); setErr(null); })
      .catch((e: Error) => setErr(e.message));
  return (
    <div className="space-y-4">
      <Head title="Perfil del negocio" text="Esto es lo que el agente de IA sabe de tu empresa. Se incluye en cada respuesta, así que cuanto más claro, mejor vende." />
      <Field label="Nombre del negocio"><input className={inputCls} value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Clínica Sonrisa" /></Field>
      <div className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <h3 className="text-sm font-semibold">Personalidad del agente</h3>
          <p className="text-xs text-zinc-500">Escribe en mensajes cortos, con expresiones de chat, sin repetirse y reconociendo lo que siente el cliente. Si alguien le pregunta en serio si es una IA, responde con la verdad (es la asistente virtual del negocio): no engaña a tus clientes y te protege de problemas con Meta y con la ley.</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nombre del agente" hint="Cómo se presenta: Sofi, Camilo…"><input className={inputCls} value={d.agent_name} onChange={(e) => set("agent_name", e.target.value)} placeholder="Sofi" /></Field>
          <Field label="Notas de estilo" hint="Regionalismos, formalidad, palabras que sí o no usar"><input className={inputCls} value={d.style_notes} onChange={(e) => set("style_notes", e.target.value)} placeholder="bogotana, cálida; usa listo, claro que sí, con gusto" /></Field>
        </div>
      </div>
      <Field label="Qué hace tu negocio"><textarea rows={3} className={areaCls} value={d.description} onChange={(e) => set("description", e.target.value)} placeholder="Qué vendes, a quién y qué te diferencia" /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tono de voz" hint="Cómo debe hablar el agente"><input className={inputCls} value={d.tone} onChange={(e) => set("tone", e.target.value)} placeholder="cercano, profesional y breve" /></Field>
        <Field label="Horario de atención"><input className={inputCls} value={d.hours} onChange={(e) => set("hours", e.target.value)} placeholder="Lunes a viernes 8:00-18:00" /></Field>
      </div>
      <Field label="Objetivo de cada conversación" hint="Ej.: agendar una valoración, cerrar la venta, tomar un pedido"><input className={inputCls} value={d.goals} onChange={(e) => set("goals", e.target.value)} /></Field>
      <Field label="Cuándo pasar a una persona" hint="La IA traspasa la conversación cuando se cumpla esto (además de cuando el cliente lo pida)"><textarea rows={3} className={areaCls} value={d.handoff_rules} onChange={(e) => set("handoff_rules", e.target.value)} placeholder="negocia descuentos, reporta una urgencia, quiere pagar a cuotas…" /></Field>
      <div className="flex items-center gap-3">
        <Btn variant="primary" onClick={() => void save()}><Save size={14} /> Guardar</Btn>
        {saved && <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><Check size={14} /> Guardado</span>}
        {err && <span className="text-xs text-red-500">{err}</span>}
      </div>
    </div>
  );
}

function KnowledgeTab() {
  const list = useApi<Knowledge[]>("/api/knowledge");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const add = () =>
    api("POST", "/api/knowledge", { title, content })
      .then(() => { setTitle(""); setContent(""); setErr(null); list.reload(); })
      .catch((e: Error) => setErr(e.message));
  return (
    <div className="space-y-4">
      <Head title="Base de conocimiento" text="Productos, precios, políticas y preguntas frecuentes. El agente responde precios y condiciones SOLO con esto: si no está aquí, dice que lo consulta con el equipo y te pasa la conversación." />
      <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (ej. Ortodoncia)" aria-label="Título" />
        <textarea rows={3} className={areaCls} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Precios, duración, requisitos, condiciones…" aria-label="Contenido" />
        <div className="flex items-center gap-3">
          <Btn variant="primary" disabled={!title.trim() || !content.trim()} onClick={() => void add()}><Plus size={14} /> Añadir</Btn>
          {err && <span className="text-xs text-red-500">{err}</span>}
        </div>
      </div>
      <ul className="space-y-2">
        {(list.data ?? []).map((k) => <KnowledgeRow key={`${k.id}:${k.title}:${k.content}`} k={k} onChange={list.reload} />)}
        {list.data?.length === 0 && (
          <li className="flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            <TriangleAlert size={16} /> Sin conocimiento cargado, el agente no podrá dar precios ni condiciones.
          </li>
        )}
      </ul>
    </div>
  );
}

function KnowledgeRow({ k, onChange }: { k: Knowledge; onChange: () => void }) {
  const [t, setT] = useState(k.title);
  const [c, setC] = useState(k.content);
  const dirty = t !== k.title || c !== k.content;
  return (
    <li className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <input className={cn(inputCls, "font-medium")} value={t} onChange={(e) => setT(e.target.value)} aria-label="Título" />
      <textarea rows={3} className={areaCls} value={c} onChange={(e) => setC(e.target.value)} aria-label="Contenido" />
      <div className="flex justify-between">
        <Btn variant="danger" onClick={() => void api("DELETE", `/api/knowledge/${k.id}`).then(onChange)}><Trash2 size={13} /> Eliminar</Btn>
        <Btn variant="primary" disabled={!dirty} onClick={() => void api("PUT", `/api/knowledge/${k.id}`, { title: t, content: c }).then(onChange)}><Save size={13} /> Guardar</Btn>
      </div>
    </li>
  );
}

function CopyBox({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950">
      <code className="min-w-0 flex-1 truncate text-xs">{value}</code>
      <button
        aria-label="Copiar"
        onClick={() => void navigator.clipboard?.writeText(value).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })}
        className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {ok ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function ChannelCard({ channel, title, info, children }: { channel: string; title: string; info: ChannelInfo; children?: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <header className="flex items-center gap-2">
        <ChannelGlyph channel={channel} size={18} />
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium", info.configured ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400")}>
          {info.configured ? "Conectado" : "Falta configurar"}
        </span>
      </header>
      {!info.configured && <p className="text-xs text-zinc-500">Variables de entorno que faltan en el servidor: <code>{info.missing.join(", ")}</code></p>}
      {children}
    </section>
  );
}

function ChannelsTab() {
  const { data: s } = useApi<AiStatus>("/api/ai/status");
  if (!s) return <p className="text-sm text-zinc-500">Cargando…</p>;
  const ch = s.channels;
  return (
    <div className="space-y-4">
      <Head title="Canales" text="Por dónde te escriben tus clientes. Las credenciales se configuran como variables de entorno del servidor (nunca se guardan ni se muestran aquí)." />
      <ChannelCard channel="web-chat" title="Chat web (widget)" info={ch["web-chat"]}>
        <p className="text-xs text-zinc-500">Pega este código antes de <code>&lt;/body&gt;</code> en el sitio de tu cliente:</p>
        <CopyBox value={s.widget_snippet} />
        <a href="/widget-demo" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">Probar el widget <ExternalLink size={12} /></a>
      </ChannelCard>
      <ChannelCard channel="whatsapp" title="WhatsApp Business (Cloud API)" info={ch.whatsapp}>
        <p className="text-xs text-zinc-500">En Meta for Developers, configura el webhook con esta URL y el token de verificación <code>META_VERIFY_TOKEN</code> {s.webhook.verify_token_set ? "(ya definido)" : "(aún no definido)"}:</p>
        <CopyBox value={s.webhook.url} />
        <p className="text-xs text-zinc-400">WhatsApp solo permite texto libre dentro de las 24 h posteriores al último mensaje del cliente; fuera de esa ventana el envío falla y la bandeja lo marca como “No entregado”.</p>
      </ChannelCard>
      <ChannelCard channel="messenger" title="Facebook Messenger" info={ch.messenger}><p className="text-xs text-zinc-500">Usa el mismo webhook de Meta (suscribe la página al evento <code>messages</code>).</p></ChannelCard>
      <ChannelCard channel="instagram" title="Instagram Direct" info={ch.instagram}><p className="text-xs text-zinc-500">Usa el mismo webhook de Meta (objeto <code>instagram</code>).</p></ChannelCard>
      <p className={cn("flex items-center gap-1.5 text-xs", ch.signature ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
        {ch.signature ? <Check size={14} /> : <TriangleAlert size={14} />}
        {ch.signature ? "Los webhooks de Meta se verifican con la firma de tu app (META_APP_SECRET)." : "Define META_APP_SECRET para rechazar webhooks falsos: hoy cualquiera que conozca la URL podría enviar mensajes."}
      </p>
    </div>
  );
}

function AiTab() {
  const { data: s } = useApi<AiStatus>("/api/ai/status");
  const [test, setTest] = useState<{ ok: boolean; model?: string; ms?: number; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!s) return <p className="text-sm text-zinc-500">Cargando…</p>;
  const run = async () => {
    setBusy(true);
    setTest(null);
    try {
      setTest(await api("POST", "/api/ai/test"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Head title="Motor de IA" text="Qué modelo atiende las conversaciones. Cada mensaje usa dos llamadas en paralelo: una redacta la respuesta y otra registra los datos del lead en el CRM." />
      <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-sm">
          <span className={cn("h-2 w-2 rounded-full", s.live ? "bg-emerald-500" : "bg-amber-500")} />
          <b>{s.provider}</b>
          <span className="text-xs text-zinc-500">{s.live ? "modelo en línea" : "motor local de reglas (sin modelo de lenguaje)"}</span>
        </div>
        {s.models.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-zinc-500">Orden de modelos (si uno falla, se usa el siguiente)</div>
            <ol className="list-decimal space-y-0.5 pl-5 text-sm">{s.models.map((m) => <li key={m}><code className="text-xs">{m}</code></li>)}</ol>
          </div>
        )}
        <div className="flex items-center gap-3">
          <Btn onClick={() => void run()} disabled={busy}>{busy ? "Probando…" : "Probar conexión"}</Btn>
          {test?.ok && <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><Check size={14} /> Responde ({test.model}, {test.ms} ms)</span>}
          {test && !test.ok && <span className="text-xs text-red-500">{test.error}</span>}
        </div>
      </div>
      <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div className="mb-1 font-medium">Acceso al panel</div>
        {s.auth.required ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"><Check size={14} /> Protegido con contraseña.</p>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400"><TriangleAlert size={14} className="mt-px shrink-0" /> Sin contraseña: cualquiera que llegue a esta dirección ve y controla todo. Define <code>ADMIN_PASSWORD</code> en el servidor antes de publicarlo.</p>
        )}
      </div>
    </div>
  );
}
