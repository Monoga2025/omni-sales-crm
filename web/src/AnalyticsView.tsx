import { ArrowDownRight, ArrowUpRight, Bot, Minus, Sparkles, UserRound, Wrench } from "lucide-react";
import { CHANNELS, money, useApi, type Analytics, type Delta } from "./api";
import { ChannelGlyph, cn } from "./ui";

export function AnalyticsView() {
  const { data: a, error } = useApi<Analytics>("/api/analytics");
  if (!a) return <div className="flex h-full items-center justify-center text-xs text-zinc-500">{error ?? "Cargando…"}</div>;

  const maxDay = Math.max(1, ...a.leads_per_day.map((d) => d.count));
  const maxTag = Math.max(1, ...a.top_tags.map((t) => t.count));
  const msgTotal = Object.entries(a.messages).filter(([k]) => k !== "system" && k !== "note").reduce((n, [, v]) => n + v, 0) || 1;
  const sender: [string, string, string][] = [["customer", "Clientes", "bg-zinc-400"], ["ai", "IA", "bg-sky-500"], ["human", "Humanos", "bg-emerald-500"]];

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center border-b border-zinc-200 px-4 dark:border-zinc-800">
        <h1 className="text-base font-semibold">Analítica</h1>
        <span className="ml-3 text-xs text-zinc-500">Calculada en vivo desde la base de datos · comparación: últimos 7 días vs. 7 anteriores</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 border-b border-zinc-200 md:grid-cols-4 xl:grid-cols-6 dark:border-zinc-800">
          <Kpi label="Leads nuevos" value={a.trend.contacts.current} delta={a.trend.contacts} />
          <Kpi label="Ventas cerradas" value={a.trend.won.current} delta={a.trend.won} />
          <Kpi label="Mensajes" value={a.trend.messages.current} delta={a.trend.messages} />
          <Kpi label="Conversión total" value={`${a.totals.conversion_rate}%`} sub={`${a.totals.won} de ${a.totals.contacts} leads`} />
          <Kpi label="Valor en pipeline" value={money(a.totals.open_value)} sub={`${a.totals.open} leads abiertos`} />
          <Kpi label="Valor ganado" value={money(a.totals.won_value)} sub={a.avg_hours_to_win !== null ? `Cierre promedio ${a.avg_hours_to_win} h` : "Sin cierres aún"} tone="text-emerald-600 dark:text-emerald-400" />
        </div>

        <div className="grid xl:grid-cols-[1.4fr_1fr]">
          <Block title="Embudo de conversión" hint="Leads que llegaron a cada etapa o más allá. La tasa de paso compara con la etapa anterior." className="border-r border-zinc-200 dark:border-zinc-800">
            <ul className="space-y-1.5">
              {a.funnel.map((f, i) => (
                <li key={f.stage_id}>
                  {i > 0 && (
                    <div className="flex items-center gap-2 py-0.5 pl-[108px] text-[10px] text-zinc-400">
                      <span className="h-3 w-px bg-zinc-300 dark:bg-zinc-700" />
                      <span className={cn("font-semibold tabular-nums", (f.step_rate ?? 0) < 40 ? "text-amber-600 dark:text-amber-400" : "text-zinc-500")}>{f.step_rate ?? 0}%</span> pasan a {f.name}
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="flex w-24 items-center gap-1.5 truncate text-xs font-medium"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: f.color }} />{f.name}</span>
                    <div className="relative h-6 flex-1 rounded bg-zinc-100 dark:bg-zinc-900">
                      <div className="h-full rounded" style={{ width: `${Math.max(2, f.pct_of_leads)}%`, background: f.color }} />
                      <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-semibold tabular-nums text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.55)]">{f.reached}</span>
                    </div>
                    <span className="w-12 text-right text-xs tabular-nums text-zinc-500">{f.pct_of_leads}%</span>
                  </div>
                </li>
              ))}
            </ul>
          </Block>

          <Block title="Rendimiento: Agente IA vs. Humano" hint="Según quién atiende hoy cada conversación.">
            <div className="grid grid-cols-2 gap-2">
              <Perf icon={<Sparkles size={13} className="text-sky-500" />} label="Agente IA" p={a.handler_perf.ai} />
              <Perf icon={<UserRound size={13} className="text-emerald-500" />} label="Humano" p={a.handler_perf.human} />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Mini label="Ventas sin humano" value={a.handler_perf.autonomous_wins} />
              <Mini label="Turnos de IA" value={a.handler_perf.ai_turns} />
              <Mini label="Tool calls" value={a.handler_perf.tool_calls} icon={<Wrench size={10} />} />
            </dl>
            <div className="mt-4 text-[11px] font-medium text-zinc-500">Mensajes por emisor</div>
            <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
              {sender.map(([k, , c]) => <span key={k} className={c} style={{ width: `${((a.messages[k] ?? 0) / msgTotal) * 100}%` }} />)}
            </div>
            <ul className="mt-1.5 flex gap-4 text-[11px] text-zinc-500">
              {sender.map(([k, l, c]) => <li key={k} className="flex items-center gap-1"><span className={cn("h-2 w-2 rounded-sm", c)} />{l} <b className="text-zinc-900 tabular-nums dark:text-zinc-100">{a.messages[k] ?? 0}</b></li>)}
            </ul>
          </Block>
        </div>

        <div className="grid border-t border-zinc-200 lg:grid-cols-3 dark:border-zinc-800">
          <Block title="Desglose por canal" className="border-r border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-zinc-400">
                <tr><th className="pb-1 text-left font-medium">Canal</th><th className="pb-1 text-right font-medium">Leads</th><th className="pb-1 text-right font-medium">Ganados</th><th className="pb-1 text-right font-medium">Conv.</th></tr>
              </thead>
              <tbody>
                {a.by_channel.map((c) => (
                  <tr key={c.channel} className="border-t border-zinc-100 dark:border-zinc-900">
                    <td className="py-1.5"><span className="flex items-center gap-2"><ChannelGlyph channel={c.channel} size={14} />{CHANNELS[c.channel] ?? c.channel}</span></td>
                    <td className="py-1.5 text-right tabular-nums">{c.contacts}</td>
                    <td className="py-1.5 text-right tabular-nums">{c.won}</td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">{c.conversion_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
          <Block title="Leads nuevos · 7 días" className="border-r border-zinc-200 dark:border-zinc-800">
            <div className="flex h-32 items-end gap-2">
              {a.leads_per_day.map((d) => (
                <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[10px] tabular-nums text-zinc-500">{d.count}</span>
                  <span className="w-full rounded-t bg-sky-500/80" style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: 2 }} />
                  <span className="text-[10px] text-zinc-400">{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
          </Block>
          <Block title="Etiquetas frecuentes">
            <ul className="space-y-1.5">
              {a.top_tags.map((t) => (
                <li key={t.tag} className="flex items-center gap-2 text-xs">
                  <span className="w-32 truncate text-zinc-600 dark:text-zinc-300">{t.tag}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"><span className="block h-full rounded-full bg-zinc-500" style={{ width: `${(t.count / maxTag) * 100}%` }} /></span>
                  <span className="w-5 text-right tabular-nums">{t.count}</span>
                </li>
              ))}
              {a.top_tags.length === 0 && <li className="text-xs text-zinc-400">Sin etiquetas todavía.</li>}
            </ul>
          </Block>
        </div>

        <div className="grid border-t border-zinc-200 lg:grid-cols-2 dark:border-zinc-800">
          <Block title="Automatizaciones ejecutadas" className="border-r border-zinc-200 dark:border-zinc-800">
            <ul className="divide-y divide-zinc-100 text-xs dark:divide-zinc-900">
              {a.automations.map((r) => <li key={r.rule} className="flex justify-between py-1.5"><span>{r.rule}</span><b className="tabular-nums">{r.count}</b></li>)}
              {a.automations.length === 0 && <li className="py-1.5 text-zinc-400">Aún no se ejecutó ninguna regla.</li>}
            </ul>
          </Block>
          <Block title="Movimientos de etapa por actor">
            <ul className="space-y-1.5 text-xs">
              {Object.entries(a.stage_moves_by_actor).map(([k, v]) => (
                <li key={k} className="flex items-center gap-2">
                  {k === "ai" ? <Bot size={12} className="text-sky-500" /> : <UserRound size={12} className="text-emerald-500" />}
                  <span className="w-16 text-zinc-600 dark:text-zinc-300">{({ ai: "IA", human: "Humano", rule: "Regla", system: "Sistema" } as Record<string, string>)[k] ?? k}</span>
                  <b className="tabular-nums">{v}</b>
                </li>
              ))}
              <li className="pt-1 text-zinc-500">Traspasos a humano: <b className="text-zinc-900 tabular-nums dark:text-zinc-100">{a.handoffs}</b></li>
            </ul>
          </Block>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, delta, sub, tone }: { label: string; value: number | string; delta?: Delta; sub?: string; tone?: string }) {
  const diff = delta ? delta.current - delta.previous : 0;
  const pct = delta && delta.previous > 0 ? Math.round((diff / delta.previous) * 100) : null;
  const Up = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <div className="border-r border-zinc-200 px-4 py-3 last:border-r-0 dark:border-zinc-800">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={cn("mt-0.5 text-2xl font-semibold tabular-nums tracking-tight", tone)}>{value}</div>
      {delta ? (
        <div className={cn("mt-0.5 flex items-center gap-1 text-[11px]", diff > 0 ? "text-emerald-600 dark:text-emerald-400" : diff < 0 ? "text-red-500" : "text-zinc-400")}>
          <Up size={12} />
          {pct !== null ? `${pct > 0 ? "+" : ""}${pct}%` : diff === 0 ? "Sin cambio" : `${diff > 0 ? "+" : ""}${diff}`} <span className="text-zinc-400">vs. {delta.previous}</span>
        </div>
      ) : (
        <div className="mt-0.5 text-[11px] text-zinc-400">{sub}</div>
      )}
    </div>
  );
}

const Block = ({ title, hint, children, className }: { title: string; hint?: string; children: React.ReactNode; className?: string }) => (
  <section className={cn("min-w-0 p-4", className)}>
    <h2 className="text-sm font-semibold">{title}</h2>
    {hint && <p className="mb-3 text-[11px] text-zinc-500">{hint}</p>}
    <div className={hint ? "" : "mt-3"}>{children}</div>
  </section>
);

function Perf({ icon, label, p }: { icon: React.ReactNode; label: string; p: { contacts: number; won: number; conversion_rate: number; avg_score: number } }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center gap-1.5 text-xs font-medium">{icon}{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{p.conversion_rate}%</div>
      <div className="text-[11px] text-zinc-500">{p.won} ganados de {p.contacts} · puntaje prom. {p.avg_score}</div>
    </div>
  );
}

const Mini = ({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) => (
  <div className="rounded-lg bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900">
    <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    <dt className="flex items-center justify-center gap-1 text-[10px] text-zinc-500">{icon}{label}</dt>
  </div>
);
