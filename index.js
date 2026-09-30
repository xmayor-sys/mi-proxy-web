addEventListener('fetch', event => {
  event.respondWith(
    handleRequest(event.request).catch(err => new Response('Error: ' + err.message, { status: 500 }))
  )
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*'
}

// Cabeceras de la web original que rompen el proxy
const STRIP = [
  'content-security-policy', 'content-security-policy-report-only', 'x-frame-options',
  'x-content-type-options', 'strict-transport-security', 'set-cookie',
  'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy',
  'referrer-policy', 'permissions-policy', 'report-to', 'nel', 'clear-site-data'
]

// URL, dominio o texto de búsqueda -> URL final
function normalizeInput(input) {
  input = (input || '').trim()
  if (/^https?:\/\//i.test(input)) return input
  if (!/\s/.test(input) && /^[\w-]+(\.[\w-]+)+(:\d+)?([\/?#].*)?$/.test(input)) return 'https://' + input
  return 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(input)
}

// Reescribe "location" en el JS de las webs para que las redirecciones pasen por el proxy
function jsRewrite(js) {
  return js
    .replace(/\b(?:window|document|self|top|parent)\.location\b/g, '__pxL')
    .replace(/(?<![\w$.'"`])location(?![\w$'"`:])/g, '__pxL')
}

// Script que se inyecta en cada página para que el JS de la web también pase por el proxy
const CLIENT_JS = String.raw`(function(){
if (window.__PX_LOADED__) return; window.__PX_LOADED__ = 1;
var C = __CFG__;
var P = C.origin, T = C.target, PFX = P + '/?url=';
var SKIP = /^(#|javascript:|mailto:|tel:|data:|blob:|about:)/i;
function un(u){ try { if (u.indexOf(PFX) === 0) return new URL(u).searchParams.get('url') || u; } catch (e) {} return u; }
function cur(){ var l = location.href; return l.indexOf(PFX) === 0 ? un(l) : T; }
function px(u){
  if (u === null || u === undefined) return u;
  if (typeof u === 'object' && u.href) u = u.href;
  u = String(u).trim();
  if (u === '' || SKIP.test(u) || u.indexOf(PFX) === 0) return u;
  if (u.indexOf(P + '/') === 0) u = u.slice(P.length);
  try { return PFX + encodeURIComponent(new URL(u, cur()).href); } catch (e) { return u; }
}
function fixSet(v){
  return v.split(',').map(function(p){
    p = p.trim(); if (!p) return p;
    var s = p.split(/\s+/); s[0] = px(s[0]); return s.join(' ');
  }).join(', ');
}
var _sa = Element.prototype.setAttribute;

/* "location" falso: el JS de la web lo usa en vez del real */
var L = {
  get href(){ return cur(); },
  set href(v){ location.href = px(v); },
  assign: function(v){ location.href = px(v); },
  replace: function(v){ location.replace(px(v)); },
  reload: function(){ location.reload(); },
  toString: function(){ return cur(); }
};
['origin','protocol','host','hostname','port','pathname','search'].forEach(function(k){
  Object.defineProperty(L, k, {
    get: function(){ return new URL(cur())[k]; },
    set: function(v){ var u = new URL(cur()); u[k] = v; location.href = px(u.href); },
    enumerable: true
  });
});
Object.defineProperty(L, 'hash', {
  get: function(){ return location.hash; },
  set: function(v){ location.hash = v; },
  enumerable: true
});
window.__pxL = L;

/* fetch */
var _fetch = window.fetch;
if (_fetch) window.fetch = function(i, o){
  try { if (i instanceof Request) i = new Request(px(i.url), i); else i = px(i); } catch (e) {}
  return _fetch.call(this, i, o);
};
/* XMLHttpRequest */
var _open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(m, u){
  var a = Array.prototype.slice.call(arguments); a[1] = px(u); return _open.apply(this, a);
};
/* window.open */
var _wo = window.open;
window.open = function(u){
  var a = Array.prototype.slice.call(arguments); if (u) a[0] = px(u); return _wo.apply(this, a);
};
/* history (webs tipo SPA) */
['pushState', 'replaceState'].forEach(function(n){
  var o = history[n];
  history[n] = function(s, t, u){ return o.call(this, s, t, (u === null || u === undefined) ? u : px(u)); };
});
/* propiedades src / href / action */
[['HTMLImageElement','src'],['HTMLScriptElement','src'],['HTMLIFrameElement','src'],
 ['HTMLSourceElement','src'],['HTMLMediaElement','src'],['HTMLLinkElement','href'],
 ['HTMLAnchorElement','href'],['HTMLFormElement','action']].forEach(function(p){
  try {
    var proto = window[p[0]].prototype, d = Object.getOwnPropertyDescriptor(proto, p[1]);
    if (!d || !d.set) return;
    Object.defineProperty(proto, p[1], {
      get: d.get, set: function(v){ d.set.call(this, px(v)); }, configurable: true, enumerable: d.enumerable
    });
  } catch (e) {}
});
Element.prototype.setAttribute = function(n, v){
  if (typeof n === 'string' && typeof v === 'string') {
    if (/^(src|href|action|poster)$/i.test(n)) v = px(v);
    else if (/^srcset$/i.test(n)) v = fixSet(v);
  }
  return _sa.call(this, n, v);
};
/* elementos añadidos dinamicamente (innerHTML, etc.) */
function fixEl(el){
  if (!el || el.nodeType !== 1 || !el.getAttribute) return;
  ['src','href','poster'].forEach(function(a){
    var v = el.getAttribute(a);
    if (v && v.indexOf(PFX) !== 0 && !SKIP.test(v.trim())) _sa.call(el, a, px(v));
  });
  var ss = el.getAttribute('srcset');
  if (ss && ss.indexOf(PFX) === -1) _sa.call(el, 'srcset', fixSet(ss));
}
new MutationObserver(function(ms){
  ms.forEach(function(m){
    m.addedNodes.forEach(function(n){
      fixEl(n);
      if (n.querySelectorAll) n.querySelectorAll('[src],[href],[srcset],[poster]').forEach(fixEl);
    });
  });
}).observe(document.documentElement, { childList: true, subtree: true });

/* clicks en enlaces */
document.addEventListener('click', function(e){
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!a) return;
  var h = a.getAttribute('href');
  if (!h || SKIP.test(h.trim()) || h.indexOf(PFX) === 0) return;
  e.preventDefault();
  location.href = px(h);
}, false);

/* formularios (buscadores, login, etc.) */
document.addEventListener('submit', function(e){
  var f = e.target;
  if (!f || f.tagName !== 'FORM' || e.defaultPrevented) return;
  var raw = un(f.getAttribute('action') || '');
  var dest;
  try { dest = new URL(raw || cur(), cur()); } catch (err) { return; }
  var method = (f.getAttribute('method') || 'get').toLowerCase();
  if (method === 'get') {
    e.preventDefault();
    var fd; try { fd = new FormData(f, e.submitter); } catch (err) { fd = new FormData(f); }
    var sp = new URLSearchParams();
    fd.forEach(function(v, k){ if (typeof v === 'string') sp.append(k, v); });
    dest.search = sp.toString();
    location.href = px(dest.href);
  } else {
    _sa.call(f, 'action', px(dest.href));
  }
}, false);

/* interceptar CUALQUIER navegación (botones, location.href, JS de la web) */
if (window.navigation) {
  navigation.addEventListener('navigate', function(e){
    if (!e.cancelable || e.hashChange || e.downloadRequest !== null) return;
    var d = e.destination.url;
    if (d.indexOf(PFX) === 0 || d.indexOf(P + '/?home') === 0 || SKIP.test(d)) return;
    e.preventDefault();
    location.href = px(d);
  });
}

/* barra flotante: ir a otra URL / buscar / inicio */
function bar(){
  if (window.top !== window.self) return;
  var host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' +
    '*{box-sizing:border-box;font:14px monospace}' +
    '#w{display:flex;flex-direction:column;align-items:flex-end}' +
    '.b{width:44px;height:44px;border-radius:50%;border:1px solid #00ff41;background:#000;color:#00ff41;font-size:20px;cursor:pointer;box-shadow:0 0 12px #00ff4188}' +
    '.p{display:none;gap:6px;background:#000;border:1px solid #00ff41;padding:8px;border-radius:8px;box-shadow:0 0 14px #00ff4166;margin-bottom:8px}' +
    '.o .p{display:flex}' +
    'input{width:min(55vw,360px);padding:8px;border-radius:6px;border:1px solid #0a5;background:#050505;color:#00ff41;outline:0}' +
    '.g{padding:8px 12px;border-radius:6px;border:1px solid #00ff41;background:#000;color:#00ff41;cursor:pointer}' +
    '.g:hover{background:#00ff41;color:#000}' +
    '</style><div id="w"><div class="p"><input id="i" placeholder="URL o busqueda"><button class="g" id="go">Ir</button><button class="g" id="hm">Inicio</button></div><button class="b" id="t">\u{1F310}</button></div>';
  var w = root.getElementById('w'), i = root.getElementById('i');
  i.value = cur();
  function go(){ if (i.value.trim()) location.href = P + '/?url=' + encodeURIComponent(i.value.trim()); }
  root.getElementById('t').onclick = function(){ w.classList.toggle('o'); if (w.classList.contains('o')) i.focus(); };
  root.getElementById('go').onclick = go;
  root.getElementById('hm').onclick = function(){ location.href = P + '/?home=1'; };
  i.addEventListener('keydown', function(e){ e.stopPropagation(); if (e.key === 'Enter') go(); });
  i.addEventListener('keyup', function(e){ e.stopPropagation(); });
  i.addEventListener('keypress', function(e){ e.stopPropagation(); });
  document.documentElement.appendChild(host);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bar); else bar();
})();`

function homePage() {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Xabier Proxy</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #000; color: #00ff41; font-family: 'Courier New', monospace; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
    #m { position: fixed; inset: 0; z-index: 0; opacity: .35; }
    main { position: relative; z-index: 1; width: 100%; max-width: 640px; text-align: center; }
    h1 { font-size: 2.4rem; margin: 0 0 6px; text-shadow: 0 0 12px #00ff41; letter-spacing: 2px; }
    .sub { color: #0a8; margin: 0 0 28px; font-size: .9rem; }
    form { display: flex; align-items: center; gap: 8px; background: #000c; border: 1px solid #00ff41; border-radius: 8px; padding: 8px 10px; box-shadow: 0 0 18px #00ff4144; }
    .pr { white-space: nowrap; color: #0c6; font-size: .85rem; }
    input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: #00ff41; font: 1rem 'Courier New', monospace; padding: 8px 4px; }
    input::placeholder { color: #0a6; }
    button { background: #00ff41; color: #000; border: 0; border-radius: 6px; padding: 10px 18px; font: bold 1rem 'Courier New', monospace; cursor: pointer; }
    button:hover { box-shadow: 0 0 14px #00ff41; }
    .grid { margin-top: 26px; display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }
    .grid a { display: block; text-decoration: none; color: #00ff41; background: #000c; border: 1px solid #0a5; border-radius: 8px; padding: 16px 8px; transition: .15s; }
    .grid a:hover { border-color: #00ff41; box-shadow: 0 0 16px #00ff4166; transform: translateY(-3px); }
    .grid span { display: block; font-size: 1.8rem; margin-bottom: 6px; }
    h2 { font-size: .95rem; color: #0c6; margin: 26px 0 0; font-weight: normal; text-align: left; }
    .note { color: #086; font-size: .8rem; margin-top: 22px; }
    footer { position: relative; z-index: 1; margin-top: 30px; color: #0a6; font-size: .85rem; text-shadow: 0 0 6px #00ff4155; }
  </style>
</head>
<body>
  <canvas id="m"></canvas>
  <main>
    <h1>&gt; XABIER PROXY_</h1>
    <p class="sub">// navega sin salirte del proxy</p>
    <form action="/" method="GET">
      <span class="pr">root@xabier:~$</span>
      <input type="text" name="url" placeholder="url o busqueda..." required autofocus autocomplete="off">
      <button type="submit">IR</button>
    </form>

    <h2># accesos directos</h2>
    <div class="grid">
      <a href="/?url=https%3A%2F%2Fwww.google.com"><span>&#128269;</span>Google</a>
      <a href="/?url=https%3A%2F%2Fwww.youtube.com"><span>&#9654;&#65039;</span>YouTube</a>
      <a href="/?url=https%3A%2F%2Fduckduckgo.com"><span>&#129414;</span>DuckDuckGo</a>
      <a href="/?url=https%3A%2F%2Fes.wikipedia.org"><span>&#128214;</span>Wikipedia</a>
    </div>

    <h2># juegos</h2>
    <div class="grid">
      <a href="/?url=https%3A%2F%2Fpoki.com"><span>&#127918;</span>Poki</a>
      <a href="/?url=https%3A%2F%2Fwww.crazygames.com"><span>&#128377;&#65039;</span>CrazyGames</a>
      <a href="/?url=https%3A%2F%2Fwww.y8.com"><span>&#128126;</span>Y8</a>
      <a href="/?url=https%3A%2F%2Fnews.ycombinator.com"><span>&#128225;</span>Hacker News</a>
    </div>

    <p class="note">Si escribes algo que no es una URL, lo busca en DuckDuckGo.</p>
  </main>
  <footer>Made by Xabier Mayor &copy; 2026</footer>
  <script>
    var c = document.getElementById('m'), x = c.getContext('2d'), d = [];
    function r() { c.width = innerWidth; c.height = innerHeight; d = Array(Math.ceil(c.width / 16)).fill(1); }
    r(); onresize = r;
    setInterval(function () {
      x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#0f0'; x.font = '14px monospace';
      d.forEach(function (v, i) {
        x.fillText(String.fromCharCode(0x30A0 + Math.random() * 96), i * 16, v * 16);
        d[i] = (v * 16 > c.height && Math.random() > 0.975) ? 0 : v + 1;
      });
    }, 50);
  </script>
</body>
</html>`
  return new Response(html, { headers: { 'content-type': 'text/html;charset=UTF-8' } })
}

async function handleRequest(request) {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  let targetUrl = url.searchParams.get('url')

  // Rutas sueltas que se escapan del proxy: las resolvemos con el Referer o con la cookie
  if (!targetUrl && url.pathname !== '/') {
    let base = null
    const ref = request.headers.get('Referer')
    if (ref) {
      try {
        const r = new URL(ref)
        const t = r.searchParams.get('url')
        if (r.origin === url.origin && t) base = normalizeInput(t)
      } catch (e) {}
    }
    if (!base) {
      const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)__pxo=([^;]+)/)
      if (m) base = decodeURIComponent(m[1])
    }
    if (base) {
      try { targetUrl = new URL(url.pathname + url.search, base).href } catch (e) {}
    }
  }

  if (!targetUrl) {
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 })
    return homePage()
  }

  const target = new URL(normalizeInput(targetUrl))
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return new Response('Solo se permiten URLs http/https.', { status: 400 })
  }
  if (target.host === url.host) {
    return new Response('No puedes usar el proxy sobre sí mismo.', { status: 400 })
  }

  // Convierte cualquier enlace en un enlace que pase por el proxy
  const proxify = (link) => {
    if (!link) return link
    const l = link.trim()
    if (/^(#|javascript:|mailto:|tel:|data:|blob:|about:)/i.test(l)) return link
    try {
      return url.origin + '/?url=' + encodeURIComponent(new URL(l, target).href)
    } catch (e) {
      return link
    }
  }

  const rewriteSet = (v) => v.split(',').map(p => {
    p = p.trim()
    if (!p) return p
    const parts = p.split(/\s+/)
    parts[0] = proxify(parts[0])
    return parts.join(' ')
  }).join(', ')

  const cssRewrite = (css) => css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) =>
      /^data:/i.test(u) ? m : 'url("' + proxify(u.trim()) + '")')
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => '@import "' + proxify(u) + '"')

  // Cabeceras hacia la web original
  const isBody = !(request.method === 'GET' || request.method === 'HEAD')
  const headers = new Headers()
  headers.set('User-Agent', request.headers.get('User-Agent') || 'Mozilla/5.0')
  headers.set('Accept', request.headers.get('Accept') || '*/*')
  headers.set('Accept-Language', request.headers.get('Accept-Language') || 'es-ES,es;q=0.9')
  headers.set('Referer', target.origin + '/')
  const range = request.headers.get('Range')
  if (range) headers.set('Range', range)
  if (isBody) {
    const ct = request.headers.get('Content-Type')
    if (ct) headers.set('Content-Type', ct)
    headers.set('Origin', target.origin)
  }

  const response = await fetch(target.href, {
    method: request.method,
    headers: headers,
    body: isBody ? request.body : null,
    redirect: 'manual'
  })

  const newHeaders = new Headers(response.headers)
  STRIP.forEach(h => newHeaders.delete(h))
  Object.keys(CORS).forEach(k => newHeaders.set(k, CORS[k]))

  // Redirecciones: mantenerlas dentro del proxy
  const loc = newHeaders.get('location')
  if (response.status >= 300 && response.status < 400 && loc) {
    newHeaders.set('location', proxify(loc))
    return new Response(null, { status: response.status, headers: newHeaders })
  }

  const contentType = (newHeaders.get('content-type') || '').toLowerCase()

  // CSS
  if (contentType.includes('text/css')) {
    const css = cssRewrite(await response.text())
    newHeaders.delete('content-length')
    newHeaders.delete('content-encoding')
    return new Response(css, { status: response.status, headers: newHeaders })
  }

  // JavaScript: reescribimos "location" para que no se escape del proxy
  if (/javascript|ecmascript/.test(contentType)) {
    const js = jsRewrite(await response.text())
    newHeaders.delete('content-length')
    newHeaders.delete('content-encoding')
    return new Response(js, { status: response.status, headers: newHeaders })
  }

  // HTML
  if (contentType.includes('text/html')) {
    newHeaders.delete('content-length')
    // Cookie propia para recordar la web actual (rescata rutas sueltas)
    newHeaders.append('Set-Cookie', '__pxo=' + encodeURIComponent(target.origin) + '; Path=/; SameSite=Lax; Secure')

    const attr = (name) => ({
      element(el) {
        const v = el.getAttribute(name)
        if (v) el.setAttribute(name, proxify(v))
      }
    })
    const srcset = {
      element(el) {
        const v = el.getAttribute('srcset')
        if (v) el.setAttribute('srcset', rewriteSet(v))
      }
    }
    const noIntegrity = { element(el) { el.removeAttribute('integrity') } }

    const clientScript = CLIENT_JS.replace('__CFG__', () =>
      JSON.stringify({ origin: url.origin, target: target.href }).replace(/</g, '\\u003c'))

    const rewriter = new HTMLRewriter()
      .on('head', {
        element(el) {
          el.prepend('<meta name="referrer" content="same-origin"><script>' + clientScript + '</script>', { html: true })
        }
      })
      .on('base', { element(el) { el.remove() } })
      .on('meta[http-equiv]', {
        element(el) {
          const he = (el.getAttribute('http-equiv') || '').toLowerCase()
          if (he === 'content-security-policy') {
            el.remove()
          } else if (he === 'refresh') {
            const c = el.getAttribute('content') || ''
            const m = c.match(/^(\s*[\d.]+\s*;\s*url\s*=\s*)(.+)$/i)
            if (m) el.setAttribute('content', m[1] + proxify(m[2].replace(/^['"]|['"]$/g, '')))
          }
        }
      })
      .on('a[href]', attr('href'))
      .on('area[href]', attr('href'))
      .on('link[href]', attr('href'))
      .on('link[integrity]', noIntegrity)
      .on('script[integrity]', noIntegrity)
      .on('script[src]', attr('src'))
      .on('img[src]', attr('src'))
      .on('img[srcset]', srcset)
      .on('source[src]', attr('src'))
      .on('source[srcset]', srcset)
      .on('video[src]', attr('src'))
      .on('video[poster]', attr('poster'))
      .on('audio[src]', attr('src'))
      .on('track[src]', attr('src'))
      .on('embed[src]', attr('src'))
      .on('iframe[src]', attr('src'))
      .on('frame[src]', attr('src'))
      .on('object[data]', attr('data'))
      .on('input[src]', attr('src'))
      .on('image[href]', attr('href'))
      .on('form[action]', attr('action'))
      .on('[style]', {
        element(el) {
          const v = el.getAttribute('style')
          if (v && /url\(/i.test(v)) el.setAttribute('style', cssRewrite(v))
        }
      })
      .on('style', {
        buf: '',
        text(t) {
          this.buf += t.text
          if (t.lastInTextNode) {
            t.replace(cssRewrite(this.buf), { html: true })
            this.buf = ''
          } else {
            t.remove()
          }
        }
      })
      // JS dentro del HTML (<script>...</script>)
      .on('script', {
        ok: true,
        buf: '',
        element(el) {
          if (el.getAttribute('src')) { this.ok = false; return }
          const ty = (el.getAttribute('type') || '').toLowerCase()
          this.ok = !ty || ty.includes('javascript') || ty === 'module'
        },
        text(t) {
          if (!this.ok) return
          this.buf += t.text
          if (t.lastInTextNode) {
            t.replace(jsRewrite(this.buf), { html: true })
            this.buf = ''
          } else {
            t.remove()
          }
        }
      })

    return rewriter.transform(new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    }))
  }

  // Todo lo demás (imágenes, fuentes, vídeo...) tal cual
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  })
}
