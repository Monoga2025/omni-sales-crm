# omni-sales-crm

Producto de Loovo. Solo código: aquí no viven datos de clientes. Hono + Node, SQLite (`node:sqlite`), React 19 + Vite + Tailwind 4, vitest. Reglas generales en `../../AGENTS.md` y `../AGENTS.md`. Memoria viva del módulo: lee `MEMORY.md` al empezar.

## Mapa de archivos clave
- `server/index.ts`: arranque; siembra datos y asegura el embudo Contadores.
- `server/app.ts`: API Hono y webhooks (Meta, Evolution, chat público).
- `server/agent.ts`: `handleInbound`, proveedores IA (OpenAI → NVIDIA NIM → Anthropic) y motor local de respaldo.
- `server/funnels.ts`: embudo Contadores D1/D2/D3 y perfil por etiqueta `embudo-contadores`.
- `server/crm.ts`: dominio (etapas, contactos, reglas, secuencias, perfil de negocio y conocimiento).
- `server/db.ts`: esquema y migraciones aditivas. `server/seed.ts`: negocio demo (clínica).
- `server/channels.ts`: parseo y envío por canal. `server/suggest.ts`: respuesta sugerida. `server/humanize.ts`, `server/guard.ts`: estilo y antialucinación.
- `web/src/`: panel (Inbox, Pipeline, Flows, Today, Settings). Pruebas en `tests/`; specs ODD en `odd/tasks/`.
- Demo para clínicas: README, sección "Demo en vivo"; prompt en `../../ventas/flujo_maestro_reactivacion_loovo.md`.

## Orquestación
Lo trabaja la sesión principal abierta en esta carpeta (es un repositorio git propio, así que aquí funcionan ODD con commits por unidad y la revisión nativa de Gentle AI). `loovo-sistemas` solo con razón nombrada; `loovo-verify` para cambios de riesgo alto (migraciones, webhooks, envío por canal, `guard.ts`). Anota cada tarea "en curso" en `../../SHARED_STATE.md`; al cerrarla actualiza `MEMORY.md` y la sección `2.1` del handoff (máx. 15 líneas).

## Skills activas
`work-unit-commits` y `chained-pr` (commits y PR por unidad), `judgment-day` (revisión dual), `monoga-project-os` (entrega a cliente), `demo-script` (demos). Registro: `.atl/skill-registry.md`.

## Reglas duras
- Un solo proceso ocupa el puerto 3000 y `data/omni.db`: detén el servidor antes de mover o copiar esta carpeta.
- Verifica con `npm test` y `npm run typecheck`. No escanees `node_modules`.
- El agente responde precios y condiciones solo desde la base de conocimiento; sin ella no inventa cifras.
- Nunca se envía un marcador (`[LINK_…]`, `{{campo}}`) a un cliente: si falta un dato, el lead pasa a un humano.
- No toques el embudo de Clínicas al cambiar el de Contadores: se separan por etiqueta y perfil.
- Nada se marca "listo" (🟢) hasta probarlo de punta a punta por el canal real. El CRM lee DMs y chat web; los comentarios de Instagram y TikTok aún no entran.
- Escribe la prueba y obsérvala fallar antes de implementar; tras una mutación rápida confirma que la prueba detecta el fallo.
- Antes de guardar en Engram corre `mem_current_project`; para memoria compartida entre carpetas usa `project: "loovo"` de forma explícita.
- Commits convencionales, sin atribución de IA. Un contacto, un canal, una instancia por cliente (single-tenant).
