# omni-sales-crm
Objective: unified omnichannel inbox + AI sales agent + Kanban pipeline + flow builder + analytics. Branch: feat/omni-sales-crm. Delivery: single-pr (user decides push/PR). Runner: vitest.

## Specs
- S1: Evidence from REA stored in `odd/evidence/rea-findings.md` and in Engram (done).
- S2: "Inbox Omnicanal + Simulador en Vivo de Clientes": inbound messages handled by a real AI agent with tool-calling to extract lead data, assign dynamic tags, compute Lead Score and change the funnel stage automatically.
- S3: "CRM Kanban / Pipeline Visual Interactivo (Drag & Drop real)": stage columns; both AI agent and human move leads; moving fires real automations (change AI mode to aggressive close, send follow-up, handoff to human).
- S4: "Constructor Visual de Reglas, Flujos y Prompts de IA por Etapa": real configuration persisted in the database.
- S5: "Dashboard de Analítica de Conversión y Embudos en Vivo": computed from real database data.
- S6: Frontend + Backend + persistent SQLite + realtime SSE, served at http://localhost:3000, dark and light modes.
- S7: Visual E2E verification in a real browser (screenshots dark/light, console/network clean).
- Assumption A1: ManyChat could not be captured by REA (permission denied); Mercately only exposed login. Design uses Respond.io evidence only.
- Assumption A2: without `ANTHROPIC_API_KEY` the agent uses a deterministic local engine with the same tool interface; with the key it calls the Anthropic Messages API with tool use (untested here, no key).

- S8 (v2, verbatim): "Instala y configura en el frontend: tailwindcss + @tailwindcss/vite ... lucide-react ... @dnd-kit/core y @dnd-kit/sortable ... @xyflow/react (React Flow)".
- S9: "Unifica todo el idioma de la interfaz a Español profesional".
- S10: Inbox with channel badges, tabs `Todos`/`IA Activa`/`Humano`/`Sin leer`, `⌘K` search, tool_calls breakdown, internal notes, composer modes, `/` templates, attachments, contact inspector accordion.
- S11: Kanban with `@dnd-kit` real drag, per-column count and `$` budget total, dense cards, persistent reorder.
- S12: Flow builder with `@xyflow/react` (Trigger -> Clasificador IA -> Condición -> Acción), MiniMap, properties panel, synced with SQLite rules.
- S13: Analytics with comparison KPIs, funnel with real step rates, per-channel breakdown, AI vs human.
- S14: Verify the 4 views in Chrome, dark (default) and light, real drag.
- Assumption A3: 12/13px, zinc 1px borders and accordion inspector come from the user brief; REA only confirmed Inter (evidence addendum 2). ManyChat is behind an AWS WAF captcha and was not bypassed.

- S15 (v4, verbatim): "MAS QUE EL UI /UX QUIERO QUE TE ENFOQUES EN SUS FUNCIONALIDADES Y QUE FUNCIONE APRA COMENZAR A PODER VENDER EL SERIVIOS APRA EMPRESAS COMO FUNCIONARA EL AGENEDE IA VHIA API POR NVIDIA QUE YA ESTA EN LAS VARIBALES DE NTORNO DE ESTE COMPUTADOR".
- S16: NVIDIA NIM provider with real tool-calling (key from env var `Nvidia`, never printed), model fallback chain, tested live.
- S17: Business profile + knowledge base injected into the agent prompt (agent must not invent prices).
- S18: Real channels: embeddable web-chat widget (works end-to-end locally) and Meta webhooks (WhatsApp, Messenger, Instagram) with inbound + outbound, idempotent, signature-checked.
- S19: Admin login (`ADMIN_PASSWORD`) protecting the panel API; public endpoints separate.
- S20: Deployability: Dockerfile, `.env.example`, README.
- S21 (design, from v4 request): Kanban cards with property chips and live-AI indicator; flow canvas and inbox details only where evidence exists (Respond workflows canvas and ManyChat builder were NOT observable: no workflow exists in the trial and the ManyChat tab sat on a Stripe checkout page, which was not touched).

## Tasks
- [x] T1 (S1) REA evidence + Engram - inline - done
- [x] T2 (S6) scaffold, db schema, seed - inline - cac96b0
- [x] T3 (S2,S3) crm core: moveStage + automations + SSE - inline - cac96b0
- [x] T4 (S2) agent: tools, local engine, Anthropic provider - inline - cac96b0
- [x] T5 (S5) analytics - inline - cac96b0
- [x] T6 (S2-S5) frontend views - inline - see git log
- [x] T7 (S7) browser verification and fixes - inline - see git log

- [x] T8 (S10-S13) backend v2: migrations, placeContact, notes, tool_calls meta, fields API, flow layout, analytics v2, Spanish seed - inline
- [x] T9 (S8-S12) frontend v2 rewrite (Tailwind, lucide, dnd-kit, xyflow) - inline
- [x] T10 (S14) browser verification - inline

- [x] T11 (S16,S17) NVIDIA provider + business profile/knowledge + typing events - inline
- [x] T12 (S18) widget + Meta webhooks + outbound delivery - inline
- [x] T13 (S19) admin auth - inline
- [x] T14 (S15-S21) settings UI, login UI, Kanban chips, Docker/README - inline
- [x] T15 verification incl. live NVIDIA call and widget in browser - inline

## Log
- L1 (2026-10-15): user request, summarized in the Specs above with exact strings quoted. Route: all inline, no writer trigger (single sequential build, no disjoint parallel units).
- L2: Prior-session code from Engram #1802 is absent from the repo (no commits, no branches); rebuilding with the same stack decision (#1801).
- L3 (verification): vitest 13/13, tsc clean. Browser (claude-in-chrome) on http://localhost:3000: dark+light, all 4 views, console errors none, 15 /api calls all 200, SSE live update (list 6->7 without reload), AI chat flow New->Won with tags/score/rules, drag&drop verified via dispatched DragEvents (CDP mouse drag does not start native HTML5 DnD in the tool).
- L4 (defects found in browser and fixed): `.rule` CSS class collided with timeline actor badge; shell grid grew past viewport hiding composer/theme button; funnel showed 300% step conversion (now share of all leads); color input collapsed.
- L5 (known gaps): ManyChat not captured by REA (permission denied); Mercately only login; Anthropic provider unit-tested with a fake fetch, never run against the real API; native mouse drag not exercised.
- L6 (2026-10-15): user v2 request: current UI judged "plantilla escolar"; rebuild frontend with real libs, Spanish UI, visual flow builder, verify in Chrome. All permissions granted. Route: inline.
- L7 (v2 verification, 2026-10-15): vitest 22/22 (RED observed first: 18 failing), tsc clean. Chrome on :3000, dark default + light: Bandeja, Pipeline, Flujos e IA, Analitica. Real checks: AI turn with expandable tool_calls; dnd-kit drag (pointer event sequence) cross-column fires rule + AI mode, same-column reorder persists with no false stage change; React Flow: stage edit saved, palette adds rule, REAL CDP mouse drag stage->action connects and persists trigger_stage_id, node drag persists layout; console errors none; ~130 /api requests all 200/201.
- L8 (v2 defects found in browser and fixed): closestCorners dropped cards in the wrong column (now pointerWithin); AI did not treat "Visitante" as a generic name; textarea text inherited label gray; funnel labels unreadable (blend mode); node overlap in flow layout; flow canvas theme not reactive; seed mixed English.
- L9 (v2 known gaps): ManyChat behind AWS WAF captcha (not bypassed); Mercately login only; the browser tool's single-step left_click_drag does not trigger dnd-kit drags (a multi-step pointer sequence does); attachments store only name/size (no file bytes); local engine ignores stage temperature (only the Anthropic provider sends it); Anthropic provider never run against the real API; main JS bundle ~700 kB (xyflow + icons, not code-split).
- L10 (v3, 2026-10-15): user logged into respond.io and ManyChat in their Chrome. Read respond.io (trial workspace, empty: no conversations/inspector/workflows canvas) with getComputedStyle; ManyChat tab returned "Permission denied for this action on this domain" (extension site permission); Mercately skipped by the user. Evidence in odd/evidence/authenticated-ui-anatomy.md and Engram. Applied: zinc scale retuned to measured hex per theme, accent #6ba4ff (dark), 14px base, 8px radius, 28px buttons, 32px nav rows, 48px rail, new 214px views sidebar (views + Lifecycle + Canales), 299px chat list with Chats header and filter row. Measured in our app after the change: rail 48, views 214, list 299, rows 32/radius 8/#353c45.
- L11 (v3 known gaps): message bubbles, contact inspector, Kanban and flow canvas are NOT copied from a reference (not observable in the empty trial workspace; Respond has no Kanban); they only inherit the tokens. Light theme tokens are partial.
- L12 (2026-10-15, v4 request): user pasted extraction request for Respond chat/inspector/workflows + ManyChat builder + Attio-style Kanban, and added: focus on functionality to start selling the service to companies, AI agent via the NVIDIA API key in the machine env vars. Findings: key is env var `Nvidia` (nvapi..., 70 chars); /v1/models returns 81; Llama 3.x -> 410; several models 404 for this account; tool-calling OK on nemotron-3.5-lightning-30b-a3b, gpt-oss-20b, glm-5.3, nemotron-3-ultra-550b-a55b, deepseek-v4.1-flash (6-17 s). Respond inbox still empty and no workflows; ManyChat tab on Stripe checkout (untouched).
- L13 (v4 verification, 2026-10-15): vitest 57/57 (RED first for each slice), tsc clean. LIVE with the real NVIDIA key (env var `Nvidia`, never printed): first design (single tool loop) failed in production-like use (empty replies, mixed tool args, wrongful handoff); probes showed nemotron-3.5-lightning with thinking disabled answers in ~1.3 s while gpt-oss-20b and nemotron-ultra work in ~4 s and glm-5.3 is slow/unstable. Redesigned as two parallel calls (plain reply + forced update_crm analyst) with deterministic guardrails; live conversation then returned exact knowledge-base prices, saved name/email, Spanish tags, stage moves; analyst placeholder values and stray handoff were found live and fixed with tests; acknowledgment message added so customers are never left in silence. Browser: embeddable widget on /widget-demo answered with KB prices and the conversation appeared in the inbox with CRM data; Settings (Canales, Motor de IA) work and "Probar conexion" returned the model in 723 ms; login verified on a temporary instance (wrong password message, successful entry, logout button).
- L14 (v4 known gaps): WhatsApp/Messenger/Instagram verified only with a mocked Meta API (no live Meta credentials); one tenant per deployment; one shared admin password (no per-agent accounts); attachments store name/size only; Respond inbox/workflows and ManyChat flow builder could not be extracted (empty trial, Stripe checkout tab).
- L15 (v5, 2026-10-15): user asked for a much more human agent. Built persona (agent_name, style_notes), 1-3 short bubbles, human pacing, chat-idiom prompt with rotating examples, deterministic fact/leak/copy/repetition guards. Live testing with NVIDIA nemotron exposed real failures each round (invented "sin intereses", invented 3:00 pm slot and payment link, "no duele", instruction text leaked into the customer chat, copied examples); each was fixed with a test. User then asked to use OpenAI "LUNA" at low effort: the key lists gpt-6-luna and gpt-5.6-luna (no exact 6.1), gpt-6-luna needs no temperature/max_tokens, counts reasoning in max_completion_tokens and rejects function tools with reasoning on, so reply = low reasoning, analyst = reasoning none. Live result: 1.5-3.5 s turns, no invented data, honest AI disclosure, appointment handed to a person. Chain OpenAI -> NVIDIA -> Anthropic. 107 tests.
- L16 (v5 known gaps): after an appointment handoff the conversation is human-owned and the AI stays silent until a person replies or "Reanudar IA" is pressed; the local rule engine is not humanized; widget pacing verified in Chrome only with NVIDIA, not yet with OpenAI.
