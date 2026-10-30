# REA findings (captured 2026-10-15)

Tool: `mcp__rea__capture_browser_scenario` (provider `rea-playwright-browser-scenario` v1, headless Chrome, unauthenticated, 6s settle, network response bodies retained).
All findings below come from public, unauthenticated bundles. No private data, no logged-in sessions.

## Coverage

| Target | Result |
| --- | --- |
| app.respond.io | Captured: 855 events, 213 response bodies, ~160 JS chunks from `cdn.respond.io/platform/web/assets/build/`. Vue 3 + vue-query + Vuetify, Vite/rolldown build. |
| app.mercately.com | Captured: login page only (`/sign_in`, Rails + Webpacker `packs/js/*`). Authenticated product code is not served pre-login, so pipeline/card structure could NOT be observed. Gap acknowledged. |
| app.manychat.com | NOT captured. The permission classifier denied the REA call. Nothing inferred about ManyChat internals beyond public product knowledge (trigger -> condition -> action flow model), marked as assumption. |

## Respond.io (observed)

### Domain modules (lazy chunk names)
`contact`, `contacts`, `conversation(s)`, `inbox`, `lifecycle`, `workflows`, `ai_agents`, `respond-ai`, `RespondAI`, `channels`, `dashboard`, `reports`, `broadcasts`, `teams`, `users`, `integrations`, `ClosingNotes`.

### REST contracts observed in bundles (`url` + `method`)
- Contact: `GET /api/v2/contact/{id}`, `PUT /api/v2/contact/{id}/lifecycle`, `PUT /api/v2/contact/{id}/assign`, `PUT /api/v2/contact/tags`, `POST /api/v2/contact/tag/add/bulk`, `POST /api/v2/contact/custom-field-value`, `PUT /api/v2/contact/bot-status`, `POST /api/v2/contact/comment`, `POST /api/v2/contact/merge`, segments: `GET|POST /api/v2/contact/segment`, `GET /api/v2/contact/lifecycle/count`, `GET /api/v2/contact/ai-agent/count`.
- Conversation: `POST /api/v2/conversation/list`, `POST /conversation/status` (open/closed), `PUT /conversation/snoozed`, `GET /api/v2/conversation/count/lifecycle`, `GET /api/v3/conversation/dashboard/lifecycles/count`, `GET /api/v3/conversation/count/ai-agent`, `GET /conversation/count/team`.
- AI assist: `POST /conversation/respond-ai/prompt/assist`, `.../assist-reply`, `.../assist-reply-rating`, `.../summary`.

### Entity model inferred from contracts
- Contact owns: lifecycle stage (single), tags (many), custom fields (key/value), assignee, collaborators, channels (contact-inbox per channel), bot-status (AI on/off).
- Conversation is separate from Contact: has status (open/closed), snooze, assignee (human, team, or AI Agent).
- Counters are first-class API calls: per lifecycle, per AI Agent, per team, per standard inbox view. The dashboard reads counts, it does not aggregate client-side.

### Lifecycle stages (from i18n strings)
- Lifecycle is opt-in ("Lifecycle isn't enabled yet" callout).
- Stages are renameable, reorderable, deletable (contacts must be moved to a target stage or have it removed).
- Special stages: **Default Stage** (assigned to new contacts) and **Won Stage** (marks conversion). Deleting a stage warns it is removed from Workflows and Reports.

### AI Agent skills and handoff (from i18n strings)
- AI Agent skills: "Update Lifecycle stage" (user defines *when* to move a contact and *to which* stage, with example "If the Contact is interested in buying a product, change the Lifecycle stage to Hot Lead"), update Contact fields, auto-routing ("Assigns conversations to other agents, teams and AI Agents"), knowledge sources, handle calls.
- Handoff: escalation to human agent, another AI Agent or a team (round robin supported), with `handoff`, `handoff_comment`, `escalation_comment` (internal comment written on escalation) and `human_agent_requested` as a trigger. Business hours are configured so the agent knows when the team is offline.
- A default AI Agent can be set; all new open conversations are assigned to it.

## Mercately (observed)
Only the sign-in surface and Webpacker chunk manifest. Sales-funnel card model for WhatsApp is unverified. Treat the Kanban-card design as our own, informed by the Respond.io lifecycle model.

## ManyChat (not observed)
Denied by permission classifier. Flow builder design (trigger -> condition -> action) is an assumption from public product knowledge, not REA evidence.

## Design implications for our build (what we replicate: state machines and contracts, not code or brand)
1. Contact has exactly one lifecycle stage; stages are data (default + won flags), not an enum.
2. Stage change is one operation (`move`) used identically by UI drag-drop, the AI tool, and automations; it emits an event that triggers rules.
3. Conversation handler is one of {AI, human, team}; handoff writes an internal comment and flips bot-status.
4. Dashboard counts come from server-side count queries per stage/agent.
5. AI skills are configured as natural-language "when -> to which stage" instructions per stage.

## Addendum 2 (2026-10-15, user-authorized retry)

### ManyChat (app.manychat.com) - observed
- REA `capture_browser_scenario` succeeded this time (permission granted). Only 4 requests to `app.manychat.com` plus AWS WAF token/captcha hosts (`*.awswaf.com`). Served documents: `index.html` and `signin`.
- The unauthenticated surface sits behind an AWS WAF captcha. Completing or bypassing CAPTCHAs is prohibited, so the flow-builder bundles (authenticated) were NOT obtained. Flow-builder node design (trigger -> condition -> action) remains an assumption from public product knowledge.

### Respond.io UI tokens - observed in captured JS/HTML
- Typography: `font-family: Inter` (28 occurrences); icon font `Material Icons`; Vuetify build (`vuetify.*.js`).
- Not verifiable from the unauthenticated capture: 12/13px density, zinc border colors, 1px edge-to-edge layout, channel badge overlay, accordion inspector. Styles are injected at runtime after login. These come from the product brief given by the user, not from REA evidence, and are applied as design decisions.

### Mercately - unchanged
Login page only (Rails/Webpacker). Kanban card model is our own design.
