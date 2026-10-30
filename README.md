# Omni Sales CRM

An omnichannel inbox with an AI sales agent, a Kanban pipeline, a flow builder, manual follow-up sequences and live analytics. It is single-tenant: one deployment serves one business, so each client gets its own instance.

## Status

| Channel | Status |
|---|---|
| Web chat widget (`/widget-demo`) | 🟡 Covered by the test suite and the demo page. Not yet proven on a client website. |
| WhatsApp, Messenger, Instagram (Meta webhook) | 🟡 Implemented and covered by tests with simulated Meta APIs. **Not validated with live credentials.** |
| Evolution webhook (read-only chat history) | 🟡 Implemented; covered by tests with simulated payloads. |
| Follow-up sequences ("Today" view) | 🟡 Implemented and tested. Sending is manual by design. |

## Architecture

- **Server:** Hono on Node, `node:sqlite` storage, TypeScript (`server/`).
- **Web:** React 19, Vite, Tailwind 4, React Flow for flows, dnd-kit for the pipeline (`web/`).
- **AI:** a reply writer plus a CRM analyst. Providers sit behind a fallback chain (NVIDIA NIM, OpenAI, Anthropic). Without any AI key, a rule engine answers. It is for demos only.
- **Guards:** deterministic checks in `server/guard.ts` rewrite or hand off a draft if it invents prices, schedules, payment links or guarantees. Prices and conditions come only from the knowledge base.

Delivery safety modules (pure, injected clock/client, covered by tests; **not yet wired into the send path**):
- `business-hours.ts`: Ley 2300 contact hours (Mon-Fri 07:00-19:00, Sat 08:00-15:00, never Sundays or Colombian holidays), with next open window.
- `outbound-guard.ts`: blocks unresolved `{{field}}` / `[LINK_x]` markers (hands off to a human) and applies the hours guard; replies to someone who already wrote skip only the hours check.
- `inbound-buffer.ts`: per-contact debounce that merges rapid-fire messages; in-memory store, or Redis via an injected client.

Main modules in `server/`: `agent.ts`, `guard.ts`, `humanize.ts`, `channels.ts`, `widget.ts`, `funnels.ts`, `analytics.ts`, `crm.ts`, `db.ts`, `auth.ts`, `seed.ts`.

## Run it

```bash
npm install
npm run build
ADMIN_PASSWORD=change-me npm start      # http://localhost:3000
npm test                                 # vitest
npm run typecheck
```

Docker: `docker build -t omni-crm .` then run it with a volume for `/data` and an env file. Copy `.env.example` to `.env` for local keys; never commit `.env`.

On an empty database the CRM seeds a fictional demo business and fictional demo contacts so the product is not empty. Replace them in **Settings**.

## Client setup (about 10 minutes)

1. **Settings > Business:** name, offer, tone, hours, conversation goal, and when to hand off to a person.
2. **Settings > Knowledge base:** products, prices, policies, FAQs.
3. **Flows and AI:** pipeline stages, AI prompt per stage, automation rules.
4. **Channels:** connect the entry points described above.
5. The team opens the inbox, watches the AI work, and takes over any conversation.

## Security notes

- Set `ADMIN_PASSWORD`. Login is rate-limited and sessions use HttpOnly cookies. Serve the app over HTTPS.
- Set `META_APP_SECRET` to reject forged webhooks.
- Channel credentials live only in environment variables; the panel shows whether they exist, never their values.

## Known limits

- One business and one administrator password; no per-agent accounts or roles yet.
- Composer attachments store only name and size, not the file.
- The local fallback engine ignores per-stage temperature and the knowledge base.
- WhatsApp allows free text only within 24 hours of the customer's last message; outside that window the send fails and the inbox marks the message as not delivered.

## Folders

| Path | What it is |
|---|---|
| `server/` | API, agent, guards, channels, storage, seed data. |
| `web/` | React single-page app: inbox, pipeline, flows, today, analytics, settings. |
| `tests/` | Vitest suites for the app, guards, sequences, funnels, suggestions and messaging. |
| `odd/` | Specs (`tasks/`) and evidence (`evidence/`) for this product. |
| `data/` | Runtime database location. Excluded from this repository. |

Connections: the accountant-niche n8n flows in `../Agentes de IA/` are separate; the hosted instance is cleaned with the script in `../../ventas/evolution-railway/`.
