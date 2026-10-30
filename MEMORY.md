# Memoria viva: omni-sales-crm

Estado, decisiones y aprendizajes de este módulo. `CLAUDE.md` guarda las reglas estables; aquí va lo que cambia. Se actualiza al cerrar cada tarea. Última actualización: 2026-10-18.

## Estado
- Rama `feat/omni-sales-crm`, sin push. Último trabajo: `a53d06a` feat(funnels), `26b2a0d` y `f45f5d1` docs. 169/169 tests, typecheck limpio.
- **Hecho:** embudo Contadores D1/D2/D3 (`server/funnels.ts`, enganche en `handleInbound` de `server/agent.ts`, pruebas en `tests/funnels.test.ts`).
  - Detecta `D1`/`D2`/`D3` en cualquier parte del mensaje (gana el más alto). `de uno` y `dedos` solo cuentan en mensajes de 3 palabras o menos.
  - Etiqueta `embudo-contadores`, puntaje 35/50/75, etapas `Contadores · Interesado DIAN` / `Interesado Extractor` / `Cierre / Demo` sin retroceder, respuesta en 2 burbujas.
  - Perfil de negocio y conocimiento por etiqueta (`settings business:contadores`, columna `knowledge.profile`). El embudo de Clínicas no se toca.

## Pendiente (en orden)
1. Definir `CONTADORES_LINK_D1/D2/D3` en el `.env`. Sin ellos el lead pasa a un humano; nunca se envía un marcador.
2. Los comentarios de Instagram NO disparan nada: el webhook de Meta solo lee DMs (`messaging`). Falta recibir `changes` de comments y responder con Private Reply. TikTok no tiene canal.
3. Revisar el perfil "contadores" (agente "Asistente Loovo", sin precios): es un borrador.
4. Nunca se probó con IA real ni con Meta en vivo.
5. Verificar licencia (¿MIT?) y Agent Bots de Chatwoot antes de integrarlo.

## Decisiones
- **Chatwoot (2026-10-17):** sin fork ni reescritura. Chatwoot hace de bandeja y canales por Agent Bots; este CRM es el motor comercial (agente IA, Kanban, reactivación). Razón: Chatwoot gana en madurez; el diferenciador es el agente con conocimiento por negocio. REA no aplica porque su código ya es abierto.
- Perfiles por etiqueta en vez de multi-pipeline: cambio mínimo, sin tocar el esquema de etapas.
- Limitaciones aceptadas: single-tenant (una instancia por cliente), SQLite y un solo proceso.

## Aprendizajes (errores que no deben repetirse)
- Nada va en 🟢 sin probarlo de punta a punta por el canal real. El estado marcaba "listo" y los comentarios no entraban.
- Escribe la prueba y obsérvala fallar antes de implementar; sin RED previo, haz una mutación para comprobar que la prueba detecta el fallo.
- Nunca envíes un marcador (`[LINK_…]`, `{{campo}}`) a un cliente: pasa el lead a un humano y anota el motivo.
- Engram: corre `mem_current_project` primero y guarda lo compartido con `project: "loovo"` explícito.
- Verifica antes de afirmar (licencias, APIs, estados). No cambies lo que no se pidió.

## Al cerrar una sesión
Commit convencional sin atribución de IA, este archivo actualizado, tu sección en `../../SHARED_STATE.md` (máx. 15 líneas) y `mem_save` en Engram con `project: "loovo"`.
