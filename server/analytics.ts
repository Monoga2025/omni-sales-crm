import type { Crm } from "./crm.js";

const DAY = 86_400_000;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

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
  trend: Record<"contacts" | "won" | "messages", { current: number; previous: number }>;
  messages: Record<string, number>;
  handlers: { ai: number; human: number };
  stage_moves_by_actor: Record<string, number>;
  leads_per_day: { day: string; count: number }[];
  avg_hours_to_win: number | null;
  top_tags: { tag: string; count: number }[];
  automations: { rule: string; count: number }[];
  handoffs: number;
}

/** Everything here is computed from the database at request time. */
export function computeAnalytics(crm: Crm, now = Date.now()): Analytics {
  const db = crm.db;
  const stages = crm.listStages();
  const contacts = crm.listContacts();
  const won = stages.find((s) => s.is_won);
  const lost = stages.find((s) => s.is_lost);
  const isWon = (c: { stage_id: number }) => !!won && c.stage_id === won.id;
  const isLost = (c: { stage_id: number }) => !!lost && c.stage_id === lost.id;

  const total = contacts.length;
  const wonCount = contacts.filter(isWon).length;
  const lostCount = contacts.filter(isLost).length;

  // A contact "reached" a stage if it was created there or ever moved into it.
  const reachedBy = new Map<number, Set<number>>();
  const add = (stageId: number, contactId: number) => {
    if (!reachedBy.has(stageId)) reachedBy.set(stageId, new Set());
    reachedBy.get(stageId)!.add(contactId);
  };
  for (const c of contacts) add(c.stage_id, c.id);
  for (const e of db.prepare("SELECT contact_id, type, data FROM events WHERE type IN ('created','stage_changed')").all()) {
    const d = JSON.parse(e.data as string) as { to_id?: number; stage_id?: number };
    const sid = e.type === "created" ? d.stage_id : d.to_id;
    if (sid) add(sid, e.contact_id as number);
  }

  // Funnel by "reached this stage or went beyond it": leads may skip stages, so plain reach can grow downstream.
  const funnelStages = stages.filter((s) => !s.is_lost);
  const maxIdx = new Map<number, number>();
  for (const c of contacts) maxIdx.set(c.id, 0);
  funnelStages.forEach((s, i) => {
    for (const id of reachedBy.get(s.id) ?? []) if (maxIdx.has(id)) maxIdx.set(id, Math.max(maxIdx.get(id)!, i));
  });
  const beyond = funnelStages.map((_, i) => [...maxIdx.values()].filter((m) => m >= i).length);
  const funnel = funnelStages.map((s, i) => ({
    stage_id: s.id,
    name: s.name,
    color: s.color,
    current: contacts.filter((c) => c.stage_id === s.id).length,
    reached: beyond[i]!,
    pct_of_leads: pct(beyond[i]!, total),
    step_rate: i === 0 || beyond[i - 1] === 0 ? null : pct(beyond[i]!, beyond[i - 1]!),
  }));

  const messages: Record<string, number> = {};
  for (const r of db.prepare("SELECT sender, COUNT(*) AS c FROM messages GROUP BY sender").all()) messages[r.sender as string] = Number(r.c);

  const moves: Record<string, number> = {};
  for (const r of db.prepare("SELECT actor, COUNT(*) AS c FROM events WHERE type='stage_changed' GROUP BY actor").all()) moves[r.actor as string] = Number(r.c);

  const startDay = Math.floor(now / DAY) * DAY - 6 * DAY;
  const perDay = new Map<string, number>();
  for (let i = 0; i < 7; i++) perDay.set(new Date(startDay + i * DAY).toISOString().slice(0, 10), 0);
  for (const c of contacts) {
    const k = new Date(Math.floor(c.created_at / DAY) * DAY).toISOString().slice(0, 10);
    if (perDay.has(k)) perDay.set(k, perDay.get(k)! + 1);
  }

  let avgHours: number | null = null;
  if (won) {
    const times: number[] = [];
    for (const c of contacts.filter(isWon)) {
      const ev = crm.events(c.id).filter((e) => e.type === "stage_changed" && e.data.to_id === won.id).pop();
      if (ev) times.push(ev.created_at - c.created_at);
    }
    if (times.length) avgHours = Math.round((times.reduce((a, b) => a + b, 0) / times.length / 3_600_000) * 10) / 10;
  }

  const tagCount = new Map<string, number>();
  for (const c of contacts) for (const t of c.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);

  const automations = db
    .prepare("SELECT json_extract(data,'$.rule') AS rule, COUNT(*) AS c FROM events WHERE type='automation_fired' GROUP BY rule ORDER BY c DESC")
    .all()
    .map((r) => ({ rule: String(r.rule), count: Number(r.c) }));
  const count = (sql: string, ...args: number[]) => Number((db.prepare(sql).get(...args) as { c: number }).c);
  const handoffs = count("SELECT COUNT(*) AS c FROM events WHERE type='handoff'");

  // ---- channels
  const channels = [...new Set(contacts.map((c) => c.channel))];
  const by_channel = channels
    .map((channel) => {
      const rows = contacts.filter((c) => c.channel === channel);
      const w = rows.filter(isWon).length;
      return {
        channel, contacts: rows.length, won: w, conversion_rate: pct(w, rows.length),
        avg_score: Math.round(rows.reduce((a, c) => a + c.score, 0) / rows.length),
      };
    })
    .sort((a, b) => b.contacts - a.contacts);

  // ---- AI vs human (by current handler)
  const perf = (h: "ai" | "human") => {
    const rows = contacts.filter((c) => c.handler === h);
    const w = rows.filter(isWon).length;
    return { contacts: rows.length, won: w, conversion_rate: pct(w, rows.length), avg_score: rows.length ? Math.round(rows.reduce((a, c) => a + c.score, 0) / rows.length) : 0 };
  };
  const withHuman = new Set(db.prepare("SELECT DISTINCT contact_id FROM messages WHERE sender='human'").all().map((r) => r.contact_id as number));
  const autonomous_wins = contacts.filter((c) => isWon(c) && !withHuman.has(c.id)).length;

  // ---- 7 days vs previous 7 days
  const cur = now - 7 * DAY;
  const prev = now - 14 * DAY;
  const window = (sql: string) => ({
    current: count(sql + " >= ? AND created_at <= ?", cur, now),
    previous: count(sql + " >= ? AND created_at < ?", prev, cur),
  });
  const wonEvents = won
    ? window(`SELECT COUNT(*) AS c FROM events WHERE type='stage_changed' AND json_extract(data,'$.to_id')=${won.id} AND created_at`)
    : { current: 0, previous: 0 };

  return {
    totals: {
      contacts: total,
      open: total - wonCount - lostCount,
      won: wonCount,
      lost: lostCount,
      conversion_rate: pct(wonCount, total),
      avg_score: total ? Math.round(contacts.reduce((a, c) => a + c.score, 0) / total) : 0,
      hot_leads: contacts.filter((c) => c.score >= 60 && !isWon(c) && !isLost(c)).length,
      open_value: contacts.filter((c) => !isWon(c) && !isLost(c)).reduce((a, c) => a + c.budget_value, 0),
      won_value: contacts.filter(isWon).reduce((a, c) => a + c.budget_value, 0),
    },
    funnel,
    by_stage_value: stages.map((s) => {
      const rows = contacts.filter((c) => c.stage_id === s.id);
      return { stage_id: s.id, name: s.name, count: rows.length, value: rows.reduce((a, c) => a + c.budget_value, 0) };
    }),
    by_channel,
    handler_perf: {
      ai: perf("ai"),
      human: perf("human"),
      autonomous_wins,
      ai_turns: count("SELECT COUNT(*) AS c FROM events WHERE type='ai_turn'"),
      tool_calls: count("SELECT COALESCE(SUM(json_array_length(json_extract(data,'$.tools'))),0) AS c FROM events WHERE type='ai_turn'"),
    },
    trend: {
      contacts: window("SELECT COUNT(*) AS c FROM contacts WHERE created_at"),
      won: wonEvents,
      messages: window("SELECT COUNT(*) AS c FROM messages WHERE sender IN ('customer','ai','human') AND created_at"),
    },
    messages,
    handlers: { ai: contacts.filter((c) => c.handler === "ai").length, human: contacts.filter((c) => c.handler === "human").length },
    stage_moves_by_actor: moves,
    leads_per_day: [...perDay].map(([day, c]) => ({ day, count: c })),
    avg_hours_to_win: avgHours,
    top_tags: [...tagCount].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, c]) => ({ tag, count: c })),
    automations,
    handoffs,
  };
}
