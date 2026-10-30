/** Embeddable web-chat widget. One <script> tag on the customer's website; it talks to /api/public/chat. */
export const WIDGET_JS = String.raw`(function () {
  if (window.__omniChat) return;
  window.__omniChat = true;
  var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  var base = new URL(script.src, location.href).origin;
  var accent = script.getAttribute('data-color') || '#196eff';
  var KEY = 'omni_chat_token';
  var token = null;
  try { token = localStorage.getItem(KEY); } catch (e) {}
  var seen = {}, lastId = 0, isOpen = false, unread = 0, busy = false, typingNow = false, fastUntil = 0, config = { name: 'Chat', agent: '', greeting: '' };

  function api(path, opts) {
    return fetch(base + '/api/public/chat' + path, opts).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; });
    });
  }
  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:Inter,system-ui,sans-serif';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML =
    '<style>' +
    '*{box-sizing:border-box}button{font:inherit;cursor:pointer}' +
    '.fab{width:56px;height:56px;border-radius:50%;border:0;background:' + accent + ';color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.25);position:relative}' +
    '.badge{position:absolute;top:-2px;right:-2px;background:#ef4444;color:#fff;border-radius:99px;font-size:11px;min-width:18px;height:18px;display:none;align-items:center;justify-content:center;padding:0 4px}' +
    '.panel{display:none;flex-direction:column;position:absolute;right:0;bottom:68px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);background:#fff;color:#18181b;border-radius:14px;box-shadow:0 12px 48px rgba(0,0,0,.28);overflow:hidden;border:1px solid #e4e4e7}' +
    '.head{padding:14px 16px;background:' + accent + ';color:#fff;font-weight:600;font-size:15px}' +
    '.msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f4f4f5}' +
    '.m{max-width:82%;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}' +
    '.m.customer{align-self:flex-end;background:' + accent + ';color:#fff;border-bottom-right-radius:4px}' +
    '.m.ai,.m.human{align-self:flex-start;background:#fff;border:1px solid #e4e4e7;border-bottom-left-radius:4px}' +
    '.who{font-size:11px;color:#71717a;margin-bottom:2px}' +
    '.typing{color:#71717a;font-size:12px;display:none;padding:0 14px 8px;background:#f4f4f5}' +
    'form{display:flex;gap:8px;padding:10px;border-top:1px solid #e4e4e7;background:#fff}' +
    'input{flex:1;border:1px solid #d4d4d8;border-radius:10px;padding:9px 12px;font:inherit;font-size:14px;outline:none}input:focus{border-color:' + accent + '}' +
    '.send{border:0;border-radius:10px;background:' + accent + ';color:#fff;padding:0 14px;font-weight:600}.send:disabled{opacity:.5}' +
    '.foot{font-size:10px;color:#a1a1aa;text-align:center;padding:0 0 6px;background:#fff}' +
    '</style>' +
    '<div class="panel" role="dialog" aria-label="Chat"><div class="head"></div><div class="msgs" aria-live="polite"></div><div class="typing"></div>' +
    '<form><input type="text" maxlength="2000" placeholder="Escribe tu mensaje…" aria-label="Mensaje"><button class="send" type="submit">Enviar</button></form>' +
    '<div class="foot">Atendido por IA y un equipo humano</div></div>' +
    '<button class="fab" aria-label="Abrir chat"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="badge"></span></button>';
  document.body.appendChild(host);

  var $ = function (s) { return root.querySelector(s); };
  var panel = $('.panel'), msgs = $('.msgs'), typing = $('.typing'), badge = $('.badge'), input = $('input'), sendBtn = $('.send');

  function render(m) {
    if (seen[m.id]) return;
    seen[m.id] = true;
    if (m.id > lastId) lastId = m.id;
    var el = document.createElement('div');
    el.className = 'm ' + m.sender;
    if (m.sender !== 'customer') {
      var w = document.createElement('div');
      w.className = 'who';
      w.textContent = m.sender === 'ai' ? (config.agent || 'Asistente') : 'Equipo';
      el.appendChild(w);
    }
    el.appendChild(document.createTextNode(m.body));
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    if (!isOpen && m.sender !== 'customer') { unread++; badge.textContent = unread; badge.style.display = 'flex'; }
  }
  function renderAll(list) { list.forEach(render); }

  function start() {
    return post('/session', { token: token || undefined }).then(function (s) {
      token = s.token;
      try { localStorage.setItem(KEY, token); } catch (e) {}
      if (!s.messages.length && config.greeting) renderAll([{ id: -1, sender: 'ai', body: config.greeting }]);
      renderAll(s.messages);
    });
  }
  function showTyping(on) { typingNow = on; typing.style.display = on ? 'block' : 'none'; typing.textContent = (config.agent || 'Alguien') + ' está escribiendo…'; if (on) msgs.scrollTop = msgs.scrollHeight; }
  function poll() {
    if (!token) return Promise.resolve();
    return api('/messages?token=' + encodeURIComponent(token) + '&after=' + lastId)
      .then(function (j) { renderAll(j.messages); showTyping(!!j.typing); })
      .catch(function () {});
  }
  function loop() {
    poll().then(function () { setTimeout(loop, (typingNow || Date.now() < fastUntil) ? 900 : 3000); });
  }

  function toggle(open) {
    isOpen = open;
    panel.style.display = open ? 'flex' : 'none';
    if (open) { unread = 0; badge.style.display = 'none'; setTimeout(function () { input.focus(); }, 50); }
  }
  root.querySelector('.fab').addEventListener('click', function () { toggle(!isOpen); });
  root.querySelector('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy || !token) return;
    busy = true; sendBtn.disabled = true; input.value = '';
    post('/message', { token: token, text: text })
      .then(function (j) { renderAll(j.messages); fastUntil = Date.now() + 60000; })
      .catch(function (err) { render({ id: 'e' + Date.now(), sender: 'ai', body: 'No pudimos enviar tu mensaje (' + err.message + '). Inténtalo de nuevo.' }); })
      .then(function () { busy = false; sendBtn.disabled = false; });
  });

  api('/config').then(function (c) { config = c; $('.head').textContent = c.agent ? c.agent + ' · ' + (c.name || 'Chat') : (c.name || 'Chat'); }).catch(function () {}).then(start).then(loop);
})();
`;

export const WIDGET_DEMO_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demostración del chat</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#18181b;line-height:1.6}code{background:#f4f4f5;padding:2px 6px;border-radius:6px}pre{background:#18181b;color:#e4e4e7;padding:16px;border-radius:10px;overflow:auto}</style>
</head>
<body>
<h1>Tu sitio web</h1>
<p>Esta página simula el sitio de un cliente. El botón de chat de la esquina inferior derecha es el widget: el agente de IA responde, y tu equipo ve y puede tomar la conversación desde la bandeja.</p>
<p>Para instalarlo en cualquier sitio, pega este código antes de <code>&lt;/body&gt;</code>:</p>
<pre>&lt;script src="/widget.js" async&gt;&lt;/script&gt;</pre>
<script src="/widget.js" async></script>
</body>
</html>`;
