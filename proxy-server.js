const express = require('express');
const axios   = require('axios');
const cors    = require('cors');
const zlib    = require('zlib');

const app    = express();
const TARGET = 'https://kevins.com.co';

app.use(cors());

// Tracker
app.get('/tracker.js', (req, res) => {
  res.type('application/javascript');
  res.send(`
    (function(){
      const ORIGINAL = 'https://kevins.com.co';

      // Convierte CUALQUIER variante de localhost a URL original de kevins
      function toOriginal(url) {
        if (!url) return url;

        // http://localhost:3001/kevins/ruta  ó  http://localhost:3001/ruta
        if (url.includes('localhost')) {
          const match = url.match(/localhost:\\d+(?:\\/kevins)?(\\/.*)?$/);
          return ORIGINAL + (match && match[1] ? match[1] : '/');
        }

        // Ya es kevins.com.co → dejar igual
        if (url.startsWith(ORIGINAL)) return url;

        // Ruta relativa como /kevins/ruta ó /ruta
        if (url.startsWith('/kevins/')) return ORIGINAL + url.substring('/kevins'.length);
        if (url.startsWith('/')) return ORIGINAL + url;

        return url;
      }

      function post(tipo, payload) {
        try {
          window.parent.postMessage(Object.assign({ tipo: tipo }, payload || {}), '*');
        } catch(e) {}
      }


      window.addEventListener('popstate', function() {
        post('navegacion', { url: toOriginal(window.location.href) });
      });

      // ✅ CLICK GENERAL: captura cualquier click y espera a que el router navegue
      document.addEventListener('click', function(e) {
        const before = window.location.href;

        // Extraer info del elemento clickeado
        const target = e.target;
        const pick   = target && target.closest
          ? target.closest('a, button, [href], [onclick], [role="button"], [data-href]')
          : null;

        const texto    = pick ? (pick.textContent || '').trim().slice(0, 80) : '';
        const elemento = pick
          ? (pick.tagName + (pick.className ? '.' + String(pick.className).split(' ')[0] : ''))
          : 'UNKNOWN';

        // Esperar que el router SPA procese la navegación
        setTimeout(function() {
          const after = window.location.href;

          // CASO 1: La URL cambió → la nueva URL es la de la categoría/producto
          if (after !== before) {
            const finalUrl = toOriginal(after);
            post('clickReal', {
              url     : finalUrl,
              texto   : texto,
              titulo  : document.title,
              posicion: { x: Math.round(e.clientX), y: Math.round(e.clientY) },
              elemento: elemento,
              timestamp: Date.now()
            });
            return;
          }

          // CASO 2: La URL no cambió pero el elemento tiene href directo
          const href = pick && (pick.href || pick.getAttribute('href') || pick.dataset.href || '');
          if (href && !href.startsWith('javascript') && !href.startsWith('#')) {
            post('clickReal', {
              url     : toOriginal(href),
              texto   : texto,
              titulo  : document.title,
              posicion: { x: Math.round(e.clientX), y: Math.round(e.clientY) },
              elemento: elemento,
              timestamp: Date.now()
            });
            return;
          }

          // CASO 3: Ni cambio de URL ni href → reportar URL actual (sin sobreescribir)
          // NO enviamos nada para no "pisar" la URL que ya capturó getHeadScript

        }, 150); // 150ms: suficiente para que cualquier router SPA procese

      }, true);

      // URL inicial al cargar
      post('navegacion', { url: toOriginal(window.location.href) });
      console.log('Tracker activo');
    })();
  `);
});

// Script inyectado PRIMERO en <head> para interceptar pushState
function getHeadScript() {
  return `<script>
(function(){
  var _push    = history.pushState.bind(history);
  var _replace = history.replaceState.bind(history);

  // Convierte URL absoluta de kevins a relativa para proxy
  function convertirUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.match(/https?:\\/\\/kevins\\.com\\.co/)) {
      var path = url.replace(/https?:\\/\\/kevins\\.com\\.co/, '');
      return path || '/';
    }
    return url;
  }


  function notificar(url) {
    var fullUrl = (typeof url === 'string' && !url.startsWith('http'))
      ? '${TARGET}' + (url.startsWith('/') ? url : '/' + url)
      : (url || window.location.href);
    try { window.parent.postMessage({ tipo: 'navegacion', url: fullUrl }, '*'); } catch(e){}
  }

  history.pushState = function(state, title, url) {
    var safeUrl = convertirUrl(url);
    notificar(url);
    try { _push(state, title, safeUrl); } catch(err) {
      console.log('pushState corregido:', safeUrl);
    }
  };

  history.replaceState = function(state, title, url) {
    var safeUrl = convertirUrl(url);
    notificar(url);
    try { _replace(state, title, safeUrl); } catch(err){}
  };

  // Suprimir errores de SecurityError para que Angular no redirija al inicio
  window.addEventListener('error', function(e) {
    if (e.message && (
      e.message.includes('SecurityError') ||
      e.message.includes('pushState') ||
      e.message.includes('history')
    )) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return false;
    }
  }, true);

  window.addEventListener('unhandledrejection', function(e) {
    if (e.reason && e.reason.toString().includes('SecurityError')) {
      e.preventDefault();
    }
  });

  console.log('✅ History interceptor activo');
})();
</script>`;
}

// Descomprimir respuesta
function descomprimir(data, encoding) {
  try {
    if (encoding === 'gzip')    return zlib.gunzipSync(data);
    if (encoding === 'deflate') return zlib.inflateSync(data);
    if (encoding === 'br')      return zlib.brotliDecompressSync(data);
  } catch(e) { console.warn('⚠️ Descomprimir:', e.message); }
  return data;
}

// Proxy principal
app.use('/kevins', async (req, res) => {
  try {
    const rutaOriginal = req.url || '/';
    const urlDestino   = TARGET + rutaOriginal;
    console.log('🔁 Proxy →', urlDestino);

    const response = await axios.get(urlDestino, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
        'Accept'         : '*/*',
        'Accept-Language': 'es-CO,es;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'Referer'        : TARGET,
        'Origin'         : TARGET
      },
      maxRedirects : 10,
      timeout      : 20000,
      validateStatus: () => true
    });

    const contentType = response.headers['content-type'] || 'text/html';
    const encoding    = response.headers['content-encoding'];
    const bodyBuffer  = descomprimir(response.data, encoding);
    let   content     = bodyBuffer.toString('utf-8');

    console.log(`📥 ${response.status} | ${content.length} bytes | ${contentType}`);

    if (contentType.includes('text/html')) {

      // 🔑 CLAVE: Eliminar <base href> original de kevins
      content = content.replace(/<base[^>]*>/gi, '');

      // 🔑 CLAVE: Inyectar nuevo <base href="/kevins/"> para que
      //    el router de kevins use rutas del proxy (/kevins/ruta)
      //    y pushState sea siempre same-origin (localhost:3001)
      const baseTag    = `<base href="/kevins/">`;
      const trackerTag = `<script src="http://localhost:3001/tracker.js"></script>`;
      const headScript = getHeadScript();

      // Inyectar PRIMERO en <head> (antes de scripts de kevins)
      if (content.includes('<head>')) {
        content = content.replace('<head>', `<head>${baseTag}${headScript}`);
      } else if (content.includes('<HEAD>')) {
        content = content.replace('<HEAD>', `<HEAD>${baseTag}${headScript}`);
      } else {
        content = baseTag + headScript + content;
      }

      // Tracker al final
      content = content.includes('</body>')
        ? content.replace('</body>', `${trackerTag}</body>`)
        : content + trackerTag;
    }

    res.set({
      'Content-Type'               : contentType,
      'Access-Control-Allow-Origin': '*',
      'X-Frame-Options'            : 'ALLOWALL',
      'Content-Security-Policy'    : "frame-ancestors *; script-src * 'unsafe-inline' 'unsafe-eval';",
      'Cache-Control'              : 'no-cache'
    });

    res.status(response.status).send(content);

  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).send(`
      <html>
        <body style="font-family:sans-serif;padding:30px;">
          <h2>❌ Error Proxy</h2>
          <p><b>Ruta:</b> ${req.url}</p>
          <p><b>Error:</b> ${err.message}</p>
          <button onclick="history.back()">⬅ Volver</button>
          <button onclick="location.reload()">🔄 Reintentar</button>
        </body>
      </html>
    `);
  }
});

app.listen(3001, () => {
  console.log('');
  console.log('Proxy NAVEGACION LIVE');
  console.log('kevins : http://localhost:3001/kevins');
  console.log('tracker: http://localhost:3001/tracker.js');
  console.log('Angular : http://localhost:4200');
  console.log('');
});