# Omni Sales CRM

Bandeja omnicanal con un agente de ventas IA, pipeline Kanban, constructor de flujos de automatización y analítica en vivo.
Un despliegue atiende a un solo negocio (single tenant): para vendérselo a varias empresas, levanta una instancia por cliente.

## Cómo levantarlo

```bash
npm install
npm run build
ADMIN_PASSWORD=... NVIDIA_API_KEY=nvapi-... npm start     # http://localhost:3000
```

Docker: `docker build -t omni-crm . && docker run -p 3000:3000 -v omni-data:/data --env-file .env omni-crm`

Sin ninguna clave de IA (`OPENAI_API_KEY`, `NVIDIA_API_KEY` o `ANTHROPIC_API_KEY`) el agente usa un motor de reglas interno: sirve para demos, no para ventas reales.
Con una base de datos nueva se carga un negocio de demostración (una clínica odontológica) para que el producto no esté vacío; reemplázalo desde **Configuración**.

## Demo en vivo para clínicas

1. Ejecuta `npm start` y abre lado a lado `http://localhost:3000` (panel) y `http://localhost:3000/widget-demo` (vista del paciente).
2. Antes de la reunión, carga los servicios y precios reales de la clínica en **Configuración → Base de conocimiento**.
3. Deja que el doctor escriba como paciente en `/widget-demo` y muéstrale cómo el lead aparece en la **Bandeja** y avanza en el pipeline.
4. Para mostrarlo desde el celular del doctor, expón el puerto local por HTTPS con un túnel (por ejemplo `cloudflared tunnel --url http://localhost:3000`) y comparte esa URL + `/widget-demo`.

Arquitectura: Hono (Node) + SQLite (`node:sqlite`) + NVIDIA NIM / OpenAI / Anthropic + React (Vite).

## Alta de un cliente (unos 10 minutos)

1. **Configuración → Negocio:** nombre, qué vende, tono, horario, objetivo de la conversación y cuándo pasar a una persona.
2. **Configuración → Base de conocimiento:** productos, precios, políticas, preguntas frecuentes. El agente responde precios y condiciones *solo* desde aquí.
3. **Flujos e IA:** edita las etapas del embudo, el prompt de IA por etapa y las reglas de automatización.
4. **Canales:** elige cómo llegan los clientes al negocio (abajo).
5. El equipo abre la **Bandeja**, observa a la IA trabajar y toma cualquier conversación con *Tomar control*.

## Secuencias de seguimiento (vista "Hoy")

Pasos manuales en orden, con espera entre uno y otro, al estilo de HubSpot Sequences. El CRM no envía nada: tú envías a mano y marcas el paso.

- Cada paso tiene canal (`whatsapp`, `instagram_dm`, `instagram_comment`, `voice_note`, `other`), título, plantilla y `delay_minutes` desde que se completó el anterior. El paso 1 vence al inscribir.
- La secuencia espera en cada paso hasta que lo marques **Hecho** o **Saltar**. Al terminar el último paso, la inscripción queda terminada.
- `exit_on_reply`: si está activo, una respuesta del contacto por WhatsApp lo saca de la secuencia. Si está apagado, solo se guarda la hora de la primera respuesta. **Respondió** saca al contacto a mano (por ejemplo, si respondió por Instagram).
- Las plantillas usan `{{nombre}}` y los campos del contacto (`{{apellido}}`). Un campo vacío queda visible como `{{campo}}`; nunca se inventa.
- La vista **Hoy** muestra lo atrasado, lo de hoy y, si quieres, lo de mañana. Los pasos de WhatsApp traen un enlace `wa.me` con el texto listo.

API (requiere sesión de administrador):

| Método | Ruta | Uso |
| --- | --- | --- |
| GET / POST | `/api/sequences` | Listar / crear `{name, exit_on_reply, steps}` |
| PUT | `/api/sequences/:id` | Editar; los pasos no cambian mientras haya inscritos activos |
| POST | `/api/contacts/bulk` | Crear contactos de WhatsApp `{contacts:[{name, phone, fields}]}`; no duplica por teléfono y los deja con humano |
| POST | `/api/contacts/:id/enroll` | Inscribir `{sequence_id}` |
| GET | `/api/tasks?until=<ms>` | Pasos pendientes hasta esa hora |
| POST | `/api/enrollments/:id/complete` · `/skip` · `/exit` | Hecho `{note?}` · Saltar · Salir `{reason?}` |

### Mensaje sugerido con IA

En el chat, **Sugerir con IA** redacta el siguiente mensaje a partir de la conversación, los datos del contacto y el paso de la secuencia. Escribe como en el celular: sin puntos, sin comas y sin `¿` ni `¡` de apertura (los números como $480.000 no se tocan), personalizado con lo que dijo el contacto y con redacción distinta para cada uno. Si el mensaje es largo, sale en 2 o 3 partes separadas por una línea en blanco, y cada parte tiene su botón **WhatsApp 1/3, 2/3…**. Tú lo editas y lo envías con **Abrir en WhatsApp** (abre WhatsApp con el texto listo). La IA no guarda ni envía nada. El engranaje junto al botón guarda las instrucciones fijas (quién eres en esos chats, qué buscas, qué nunca decir). Necesita `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` o `NVIDIA_API_KEY`; sin clave el botón muestra el error.

| Método | Ruta | Uso |
| --- | --- | --- |
| POST | `/api/contacts/:id/suggest` | Devuelve `{text, parts, engine}`; 503 sin clave de IA, 502 si la IA falla |
| GET / PUT | `/api/suggest/settings` | Leer / guardar `{instructions}` |

## Canales

| Canal | Configuración | Estado |
| --- | --- | --- |
| Chat web | Pega `<script src="https://TU-HOST/widget.js" async></script>` en el sitio del cliente. Pruébalo en `/widget-demo`. | Funciona de punta a punta |
| WhatsApp, Messenger, Instagram | Webhook `https://TU-HOST/api/webhooks/meta` + las variables de entorno de `.env.example`. | Implementado y cubierto por pruebas con la API de Meta simulada; **aún no probado con credenciales reales de Meta** |

Webhook de Evolution (`/api/webhooks/evolution`, solo lectura): guarda las dos partes del chat. Los mensajes que envías desde el celular vinculado se registran como "Agente humano" con su hora real de WhatsApp y nunca se reenvían; solo se guardan los números de `EVOLUTION_ALLOWED_NUMBERS`.

WhatsApp solo permite texto libre dentro de las 24 h siguientes al último mensaje del cliente; fuera de esa ventana el envío falla y la bandeja marca el mensaje como "No entregado".

## Cómo funciona el agente IA

Orden de motores: OpenAI (`gpt-6-luna`, razonamiento bajo) → NVIDIA → Anthropic; si uno falla, responde el siguiente. Cada mensaje del cliente dispara dos llamadas en paralelo:

1. **Respuesta:** una completion simple que escribe el mensaje que lee el cliente, basada en el perfil del negocio y las entradas relevantes de la base de conocimiento.
2. **Analista:** una función forzada (`update_crm`) que extrae nombre, correo, interés y presupuesto, agrega etiquetas, puntúa el lead, propone la etapa del embudo y pide un humano cuando hace falta.

La salida del analista se valida (sin valores de relleno, los leads solo avanzan, el traspaso a humano solo con una marca explícita) y una red de seguridad determinista completa lo que el modelo omitió. Si todos los modelos fallan, el cliente recibe un acuse de recibo y la conversación pasa a un humano; nunca hay silencio.

### Respuestas que suenan humanas

El redactor interpreta una persona con nombre (Configuración → Personalidad del agente) que chatea como una persona: burbujas cortas una tras otra, expresiones de chat, empatía antes que datos, sin frases de call center, sin markdown, emojis solo si el cliente los usa, y tuteo. Los mensajes llevan ritmo humano (pausa de lectura, indicador de escritura, tiempo de escritura proporcional al largo); usa `HUMAN_PACE=off` para desactivarlo.

Nunca finge ser una persona: si un cliente pregunta en serio, dice que es el asistente virtual del negocio (con un equipo humano detrás).

En cada borrador corren verificaciones deterministas que provocan una reescritura, o una respuesta segura más traspaso a humano si el modelo insiste:
- montos, horarios, links de pago, disponibilidad y condiciones ("sin intereses", "sin compromiso", "garantía", "no duele") que no estén en la base de conocimiento ni en las palabras del cliente;
- instrucciones filtradas al chat, ejemplos de tono copiados y repeticiones de lo ya dicho;
- se limpian deslices de voseo, markdown, signos de exclamación de más y emojis no pedidos.

El agente no tiene integración de calendario ni de pagos: cuando un cliente elige día u hora, registra la preferencia, pide un número de teléfono y pasa la conversación a una persona para confirmar.

## Notas de seguridad

- Define `ADMIN_PASSWORD`; el login tiene límite de intentos y las sesiones son cookies HttpOnly. Pon la app detrás de HTTPS.
- Define `META_APP_SECRET` para rechazar webhooks falsificados.
- Las credenciales de canales viven solo en variables de entorno; el panel muestra si existen, nunca sus valores.

## Límites conocidos

- Un solo negocio y una sola contraseña de administrador (aún sin cuentas ni roles por agente).
- Los adjuntos del compositor guardan solo nombre y tamaño (sin almacenamiento de archivos).
- El motor local de respaldo ignora la temperatura por etapa y la base de conocimiento.

## Desarrollo

`npm test` (vitest), `npm run typecheck`, `npm run dev:server` + `npx vite --config web/vite.config.ts` para recarga en caliente.

## Embudo Contadores (D1 / D2 / D3)

Segundo embudo junto al de clínicas, sin tocarlo. Si el cliente escribe `D1`, `D2` o `D3` (también `de uno` y `dedos` cuando son casi todo el mensaje), el CRM lo etiqueta `embudo-contadores`, sube el puntaje, lo mueve a su etapa y envía la respuesta con el enlace.

| Clave | Etapa | Puntaje |
| --- | --- | --- |
| `D1` | Contadores · Interesado DIAN | 35 |
| `D2` | Contadores · Interesado Extractor | 50 |
| `D3` | Contadores · Cierre / Demo (lead caliente) | 75 |

- Define `CONTADORES_LINK_D1`, `CONTADORES_LINK_D2` y `CONTADORES_LINK_D3` (ver `.env.example`). Si falta uno, el lead pasa a un humano en lugar de recibir un texto con un marcador.
- Los contactos con la etiqueta `embudo-contadores` usan su propio perfil de negocio y base de conocimiento; el resto sigue con los de Configuración. Filtra por `embudo-contadores` en Bandeja y Pipeline.
- Solo reacciona a mensajes directos y al chat; los comentarios de Instagram aún no se reciben.
