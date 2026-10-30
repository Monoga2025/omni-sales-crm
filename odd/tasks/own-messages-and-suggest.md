# Own WhatsApp messages in the CRM + AI suggested reply

Objective: show the messages the user sends from their phone in the CRM chat and draft the next reply with AI.
Branch: feat/omni-sales-crm · Delivery: ask-on-risk · Runner: vitest (`npx vitest run`).

## Specs

- S1 — "En el CRM no se ven los mensjaes enviados por mi arregla eso porfavor". Messages the user sends from the linked phone (Evolution `fromMe`) are stored as `human` messages in the contact's chat, with the WhatsApp timestamp, and are never re-sent (no outbound delivery). The allowed-numbers filter still applies. Duplicates (same message id) are ignored.
- S2 — Chat order and recency follow the message timestamp, so messages recorded late (backfill) show in their real place.
- S3 — "y el mensaje de ia sugerido porfa". Earlier context: "con IA en el CRM podria decirme mensaje sugerido y opcion de enviar". The chat composer has a "Sugerir con IA" action that drafts the next message from the conversation; the user can edit it and open it in WhatsApp with the text prefilled. The AI never sends anything by itself. Without an AI key it returns a clear error.
- S4 — Messages already exchanged on 2026-10-17 are backfilled from Evolution into production.

## Tasks

- [x] T1 — S1, S2 · inline · own messages via webhook + timestamp ordering · a159f9c (RED 4 failing → GREEN 136/136)
- [x] T2 — S3 · inline · suggest endpoint + composer UI (RED 3 failing → GREEN 140/140, tsc + vite build clean)
- [x] T3 — S4 · inline · deploy + backfill: DB backup /data/omni.db.bak-20261017-own, `railway up` OK, 21 allowed-number messages replayed, chats verified in order

## Log

- L1 (2026-10-17, user): "En el CRM no se ven los mensjaes enviados por mi arregla eso porfavor.... y el mensaje de ia sugerido porfa"
- L2: Root cause S1: `parseEvolutionWebhook` skips `key.fromMe` (server/channels.ts). Production has no AI key (no ANTHROPIC/OPENAI/NVIDIA variable), so S3 needs the user to add one in Railway.
- L3: Decision: "send" stays manual (open WhatsApp with prefilled text) — sending through Evolution from the CRM is not built in this feature.
- L4: Production: study instructions saved in `suggest_instructions`; `/suggest` returns 503 until an AI key is added in Railway (user action, secret).
