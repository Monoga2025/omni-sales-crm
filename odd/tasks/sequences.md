# sequences
Objective: HubSpot-style sales sequences in the CRM: ordered manual steps with delays, a daily task queue, and exit when the contact replies.
Branch: feat/sequences. Delivery: ask-on-risk (forecast ~700 authored lines). Runner: vitest (`npm test`, `npm run typecheck`).

## Specs
- S1: The user wants follow-up inside the CRM: "ese seguimiento no esta en el CRM para saber paso a paso qeu seguira y cuando hacerle y depende si respondo o no".
- S2: Model the behavior on HubSpot Sequences ("Listo entonces con ese si"). Evidence from HubSpot docs: by default "a sequence will pause until the task is complete"; by default contacts are "automatically unenrolled when they reply"; this trigger can be turned off per sequence; unenrolling "only stops upcoming scheduled steps".
- S3: A sequence has ordered steps. Each step has a channel (whatsapp, instagram_dm, instagram_comment, voice_note, other), a title, a message template and a delay from the previous step's completion. Step 1 is due on enrollment.
- S4: A contact has at most one active enrollment. Completing or skipping a step logs an event and schedules the next one; after the last step the enrollment is finished.
- S5: Exit on reply: when a customer message arrives for an enrolled contact and the sequence has `exit_on_reply`, the enrollment ends with reason `reply`. When `exit_on_reply` is off, the first reply time is recorded instead (audit metric). Manual exit with a reason (for example a reply on Instagram) is always available.
- S6: Daily queue ("Hoy"): due and overdue steps with the contact, the rendered message and, for WhatsApp steps, a wa.me link. Templates use `{{nombre}}` and `{{campo}}` from contact fields; unknown placeholders stay visible (never invented).
- S7: Safety: completing a step never creates an outbound message or sends anything; the user sends by hand.
- S8: Contacts can be created through the API (bulk) with the phone as the WhatsApp external id, so later webhook replies attach to them; created contacts are handled by a human, not the AI.
- S9: UI: a "Hoy" view and enrollment controls in the contact inspector, in Spanish.
- Assumption A1: REA was not needed; HubSpot public docs covered the behavior. No HubSpot code is copied.

## Tasks
- [x] T1 (S3-S5, S7) schema + Crm sequence methods + reply hook + tests - inline - RED 13/13, GREEN 127/127 + tsc
- [x] T2 (S6, S8) API routes: sequences, enroll, tasks, complete/skip/exit, bulk contacts + tests - inline - RED 4, GREEN 131 + tsc
- [x] T3 (S9) frontend: Hoy view, inspector enrollment - inline - tsc + build + Chrome check
- [x] T4 docs (README) + browser check - inline

## Log
- L1 (2026-10-16): "Quiero poder manejarlo desde el CRM pero usando el MCP REA a alguien que ya lo hace y solo implementarlo". Reference chosen: HubSpot Sequences. Route: all inline (single sequential build, no writer trigger).
- L2: Evolution work committed separately first (8fcf0a0) at the user's request; this branch starts there.
- L3: Decision: the Loovo 8-touch sequence uses `exit_on_reply = false`, because WhatsApp replies in step 1 come from reception (the audit) and not from the doctor; the doctor's Instagram reply is marked by hand.
- L4 (verification, 2026-10-16): vitest 131/131, tsc clean, vite build ok. Chrome on a local server (port 3100, scratch DB, synthetic contacts): Hoy lists due steps with wa.me and rendered text; unknown placeholder stays visible; Hecho moves the step to tomorrow; inspector shows the active enrollment and enrolls from the select; no console errors. UTF-8 names round-trip (mojibake seen came from Git Bash curl argument encoding, not the app).
- L5 (fix found in browser): due-now steps were shown in red; red now only for steps due before today.
- L6 (known gaps): no UI to create or edit sequences yet (API only); Instagram replies are marked by hand; not deployed to Railway yet (user decision).
- L7 (2026-10-17): fix found before loading production: reply time was measured from enrollment; now from the last completed step (last_step_at), RED then GREEN 132.
