import { serve } from "@hono/node-server";
import { openDb } from "./db.js";
import { Crm } from "./crm.js";
import { makeProvider } from "./agent.js";
import { createApp } from "./app.js";
import { seedIfEmpty } from "./seed.js";
import { ensureContadoresFunnel } from "./funnels.js";
import { humanPace, instantPace } from "./humanize.js";

const port = Number(process.env.PORT ?? 3000);
const crm = new Crm(openDb(process.env.DB_PATH ?? "data/omni.db"));
// SEED_DEMO_CONTACTS=false seeds stages and rules only, so production never shows fake contacts.
if (seedIfEmpty(crm, Date.now(), { demoContacts: process.env.SEED_DEMO_CONTACTS !== "false" })) console.log("Seeded demo data");

ensureContadoresFunnel(crm); // adds the D1/D2/D3 funnel next to the default one; existing stages and data are untouched

const provider = makeProvider();
if (!process.env.ADMIN_PASSWORD) console.warn("WARNING: ADMIN_PASSWORD is not set; the panel is open to anyone who can reach this address.");
if (provider.name === "local-engine") console.warn("WARNING: no AI key configured; using the local rule engine (demo quality).");
if (process.env.WHATSAPP_TOKEN && !process.env.META_APP_SECRET) console.warn("WARNING: META_APP_SECRET is not set; Meta webhooks are not signature-checked.");
// HUMAN_PACE: "off" answers instantly (demos/tests), "fast" halves the delays, anything else is the default human timing.
const pace = process.env.HUMAN_PACE === "off" ? instantPace : humanPace(process.env.HUMAN_PACE === "fast" ? 2 : 1);
serve({ fetch: createApp(crm, provider, undefined, { pace }).fetch, port }, () => {
  console.log(`Omni Sales CRM on http://localhost:${port} (AI: ${provider.name})`);
});
