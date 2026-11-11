(function () {
  'use strict';
  const VERSION = '1.2.4';
  let _nativeFetch = null;
  
  let CryptoJS = null;
  function initCrypto() {
    if (typeof window !== 'undefined' && window.CryptoJS) {
      CryptoJS = window.CryptoJS;
      return true;
    }
    return false;
  }

  async function pedir(url, opciones) {
    try {
      if (!_nativeFetch) return fetch(url, opciones);
      return _nativeFetch(url, opciones);
    } catch (e) {
      return { ok: false, status: 0, text: () => Promise.resolve('') };
    }
  }

  async function texto(url, opciones) {
    const r = await pedir(url, opciones);
    if (!r || !r.ok) return '';
    try { return (await r.text()) || ''; } catch (e) { return ''; }
  }

  async function json(url, opciones) {
    const t = await texto(url, opciones);
    if (!t) return null;
    try { return JSON.parse(t); } catch (e) { return null; }
  }

  function origen(url) {
    const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i);
    return m ? m[1] : '';
  }

  function dominio(url) {
    const m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i);
    return m ? m[1].toLowerCase() : '';
  }

  function absoluta(url, base) {
    if (!url) return '';
    const u = String(url).trim().replace(/\\\//g, '/');
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('//')) return `https:${u}`;
    if (u.startsWith('/')) return origen(base) + u;
    return base.replace(/[^/]*$/, '') + u;
  }

  function desempacar(html) {
    const salida = [];
    const patron = /eval\(function\(p,a,c,k,e,[a-z]\)\{[\s\S]*?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
    const digitos = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let m;
    while ((m = patron.exec(String(html || '')))) {
      const base = parseInt(m[2], 10);
      const palabras = m[4].split('|');
      const valor = (t) => {
        let n = 0;
        for (const ch of t) {
          const v = digitos.indexOf(ch);
          if (v < 0 || v >= base) return -1;
          n = n * base + v;
        }
        return n;
      };
      salida.push(m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, (t) => {
        const i = valor(t);
        return i >= 0 && i < palabras.length && palabras[i] ? palabras[i] : t;
      }));
    }
    return salida.join('\n');
  }

  function buscarVideo(t, base) {
    const fuentes = [
      /["']?hls[24]["']?\s*:\s*["']([^"']+)["']/i,
      /sources\s*:\s*\[\s*\{\s*(?:src|file)\s*:\s*["']([^"']+)["']/i,
      /file\s*:\s*["']([^"']+\.(?:m3u8|mp4|txt)[^"']*)["']/i,
      /["']file["']\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
      /sources\s*:\s*\[\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
      /src\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
      /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i,
      /["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i
    ];
    for (const f of fuentes) {
      const m = String(t || '').match(f);
      if (m) return absoluta(m[1], base);
    }
    return '';
  }

  async function resolverEmpaquetado(url, referer, siguiendo) {
    const propio = `${origen(url)}/`;
    for (const ref of [...new Set([referer || propio, propio])]) {
      const html = await texto(url, { headers: { Referer: ref } });
      if (!html) continue;
      
      const codigo = `${desempacar(html)}\n${html}`;
      const links = codigo.match(/links\s*=\s*(\{[^}]+\})/);
      let video = '';
      
      if (links) {
        try {
          const o = JSON.parse(links[1].replace(/'/g, '"'));
          video = o.hls4 || o.hls3 || o.hls2 || o.hls || '';
        } catch (e) {}
      }
      
      video = absoluta(video || buscarVideo(codigo, url), url);
      if (video) {
        return { url: video, kind: 'm3u8', headers: { Referer: propio, Origin: origen(url) } };
      }
      
      const marco = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (marco && !siguiendo) {
        return resolverEmpaquetado(absoluta(marco[1], url), url, true);
      }
    }
    return null;
  }

  async function resolverStreamwish(url, referer, log) {
    log('Resolviendo StreamWish...');
    const propio = await resolverEmpaquetado(url, referer, false);
    if (propio) return propio;
    
    const id = url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop().replace(/\.html$/, '');
    const espejos = [`https://hglink.to/e/${id}`, `https://streamwish.to/e/${id}`, `https://vibuxer.com/e/${id}`].filter((e) => dominio(e) !== dominio(url));
    
    for (const e of espejos) {
      log('Probando espejo: ' + e);
      const res = await resolverEmpaquetado(e, referer, true);
      if (res) return res;
    }
    return null;
  }

  function atobSeguro(t) {
    try { return atob(String(t || '').replace(/\s+/g, '')); } catch (e) { return ''; }
  }

  function descifrarVoe(cifrado, ruidos) {
    let t = cifrado.replace(/[a-zA-Z]/g, (c) => {
      const tope = c <= 'Z' ? 90 : 122;
      const n = c.charCodeAt(0) + 13;
      return String.fromCharCode(n <= tope ? n : n - 26);
    });
    for (const ruido of ruidos || ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) t = t.split(ruido).join('');
    const paso = atobSeguro(t);
    if (!paso) return null;
    let movido = '';
    for (let i = 0; i < paso.length; i++) movido += String.fromCharCode(paso.charCodeAt(i) - 3);
    const final = atobSeguro(movido.split('').reverse().join(''));
    try { return JSON.parse(final); } catch (e) { return null; }
  }

  async function resolverVoe(url, referer, log) {
    log('Resolviendo Voe...');
    const html = await texto(url, { headers: { Referer: referer || url } });
    const bloque = html.match(/<script type="application\/json">([\s\S]*?)<\/script>(?:\s*<script[^>]*src=["']([^"']+)["'])?/i);
    
    if (bloque) {
      let cifrado = '';
      try {
        const dato = JSON.parse(bloque[1].trim());
        cifrado = Array.isArray(dato) ? dato[0] : dato;
      } catch (e) {}
      
      let datos = cifrado ? descifrarVoe(cifrado) : null;
      if (!datos && cifrado && bloque[2]) {
        const cargador = await texto(absoluta(bloque[2], url), { headers: { Referer: url } });
        const lista = (cargador.match(/\[(?:\s*'[^']{1,10}'\s*,?){4,12}\]/) || cargador.match(/\[(?:\s*"[^"]{1,10}"\s*,?){4,12}\]/) || [])[0];
        if (lista) datos = descifrarVoe(cifrado, (lista.match(/['"]([^"']{1,10})['"]/g) || []).map((x) => x.slice(1, -1)));
      }
      
      const video = datos && (datos.source || datos.direct_access_url);
      if (video) return { url: video, kind: 'm3u8', headers: { Referer: url } };
    }
    
    const directo = html.match(/['"]hls['"]\s*:\s*['"]([^'"]+)['"]/i);
    if (directo) {
      const v = /^aHR0/.test(directo[1]) ? atobSeguro(directo[1]) : directo[1];
      return { url: v, kind: 'm3u8', headers: { Referer: url } };
    }
    
    return null;
  }

  const CUSTOM = [
    {
      name: 'StreamWish',
      match: (u, link) => /streamwish|swdyu|wishembed|playerwish|strwish|swhoi|wishfast|sfastwish|hlswish|embedwish|awish|dwish|streamhg|hglink|habetar|mwish|kswplayer|swiftplayers|hanerix|cdnwish|flaswish|obeywish|davioad|jodwish|ghbrisk|dhcplay|iplayerhls|cybervynx|dumbalag|wishonly|streamwishplayer|asnwish|nekowish|neko-stream|multimovies|streamhls|vibuxer|hlswish/i.test(u.hostname),
      run: async (link, log, referer) => await resolverStreamwish(link.url, referer || '', log)
    },
    {
      name: 'Voe',
      match: (u, link) => /voe\.sx|voe-unblock|voeunbl|voeun|v-o-e|voe\./i.test(u.hostname),
      run: async (link, log, referer) => await resolverVoe(link.url, referer || '', log)
    }
  ];

  async function resolve(link, log, env) {
    _nativeFetch = env && env.nativeFetch;
    if (typeof _nativeFetch !== 'function') throw new Error('Falta nativeFetch');
    
    if (!CryptoJS) initCrypto();

    const t0 = Date.now();
    const url = String(link.url || '');
    let u;
    try { u = new URL(url); } catch (_) { return { ok: false, ms: 0, status: 0 }; }

    // --- VALIDACIÓN DE ENLACES DIRECTOS (.m3u8, .mp4, .mkv) ---
    if (/\.(m3u8|mp4|mkv)$/i.test(u.pathname)) {
      log('La URL ya es un archivo directo. Inyectando cabeceras de seguridad...');
      
      // Forzamos User-Agent y Referer para evitar bloqueos de Cloudflare/Workers
      const cabecerasSeguras = Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': origen(url) + '/'
      }, link.headers || {});

      return {
        ok: true,
        ms: Date.now() - t0,
        status: 200,
        play: { 
          url: url, 
          kind: /\.m3u8$/i.test(u.pathname) ? 'm3u8' : 'mp4', 
          headers: cabecerasSeguras 
        }
      };
    }
    // ----------------------------------------------------------

    for (const c of CUSTOM) {
      let hit = false;
      try { hit = !!c.match(u, link); } catch (_) {}
      if (!hit) continue;
      
      log('-- Extractor: ' + c.name + ' --');
      try {
        const r = await c.run(link, log, link.referer || link.headers?.Referer);
        if (r && r.url) {
          log('→ ' + r.url);
          return { ok: true, ms: Date.now() - t0, status: 200, play: { url: r.url, kind: r.kind || 'm3u8', headers: r.headers || {} } };
        }
      } catch (e) {
        log('ERROR en extractor: ' + ((e && e.message) || e));
      }
    }
    
    log('No hay extractor disponible para este enlace.');
    return { ok: false, ms: Date.now() - t0, status: 0 };
  }

  window.SSExtractors = { version: VERSION, resolve: resolve, custom: CUSTOM };
})();
