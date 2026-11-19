(function () {
  'use strict';
  const VERSION = '1.0.4';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
  let _nf = null;

  // ---------- helpers ----------
  function absoluta(url, base) {
    if (!url) return '';
    const u = url.trim().replace(/\\\//g, '/');
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('//')) return `https:${u}`;
    if (u.startsWith('/')) {
      const m = String(base).match(/^(https?:\/\/[^/?#]+)/i);
      return (m ? m[1] : '') + u;
    }
    const b = String(base || '').replace(/[?#].*$/, '');
    return (/^https?:\/\/[^/]+$/i.test(b) ? `${b}/` : b.replace(/[^/]*$/, '')) + u;
  }

  function extraerM3u8(html, base) {
    if (!html) return null;
    const text = html;
    const patterns = [
      /"src"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/i,
      /"source"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/i,
      /"file"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/i,
      /src\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
      /(https?:\/\/[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*)/i
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1]) return absoluta(m[1], base);
    }
    // Buscar rutas relativas
    const rel = text.match(/["'](\/[^"']+?\.m3u8[^"']*)["']/i);
    if (rel && rel[1]) return absoluta(rel[1], base);
    
    return null;
  }

  function extraerIframe(html) {
    const m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (m && m[1] && !/^javascript:/i.test(m[1])) return m[1];
    return null;
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
        for (const ch of t) { const v = digitos.indexOf(ch); if (v < 0 || v >= base) return -1; n = n * base + v; }
        return n;
      };
      salida.push(m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, (t) => {
        const i = valor(t);
        return i >= 0 && i < palabras.length && palabras[i] ? palabras[i] : t;
      }));
    }
    return salida.join('\n');
  }

  // ---------- extractores ----------

  // 1. Reproductor Clappr con Base64 (Win Sports, Directv Sports)
  async function resolverClapprBase64(url, html) {
    try {
      // Busca arrays como NH=[[45,"dXM3..."],...] o tv=[[58,"Qno3..."],...]
      const match = html.match(/(?:NH|tv)\s*=\s*(\[\[[\s\S]*?\]\])/);
      if (!match) return [];
      
      const arreglo = JSON.parse(match[1]);
      arreglo.sort((a, b) => a[0] - b[0]); // Ordenar por el índice numérico
      
      let base64Str = '';
      for (const item of arreglo) {
        base64Str += atob(item[1]);
      }
      
      // En algunos casos el string resultante tiene partes que deben unirse
      // o limpiarse (ej. si sobran comillas). Validamos que sea una URL.
      let finalUrl = base64Str.replace(/["'\s]/g, '');
      
      if (/^https?:\/\//i.test(finalUrl)) {
        const u = new URL(url);
        return [{
          url: finalUrl,
          kind: 'm3u8',
          headers: { 'User-Agent': UA, 'Referer': u.origin + '/', 'Origin': u.origin }
        }];
      }
    } catch (e) {
      return [];
    }
    return [];
  }

  // 2. Páginas streamx (Liga 1 Max, Premiere 1)
  async function resolverStreamxBypass(url) {
    try {
      const u = new URL(url);
      const canal = u.searchParams.get('stream') || u.searchParams.get('channel');
      if (!canal) return [];

      // Intentamos con streamx723 que es el que usa el JS ofuscado
      const destinos = [
        `https://streamx723.sbs/global1.php?channel=${canal}`,
        `https://streamtp99a.sbs/global1.php?stream=${canal}`
      ];

      for (const destino of destinos) {
        const r = await _nf(destino, { headers: { Referer: 'https://streamx723.sbs/', 'User-Agent': UA } });
        if (r && r.ok) {
          const html = await r.text();
          const videoUrl = extraerM3u8(html, destino);
          if (videoUrl) {
            return [{
              url: videoUrl,
              kind: 'm3u8',
              headers: { 'User-Agent': UA, 'Referer': 'https://streamx723.sbs/', 'Origin': 'https://streamx723.sbs' }
            }];
          }
        }
      }
    } catch (e) { return []; }
    return [];
  }

  // 3. Iframe firmado (ESPN Deportes 2)
  async function resolverIframeFirmado(url, html) {
    try {
      // Busca el iframe que contiene el stream
      const iframeSrc = extraerIframe(html);
      if (!iframeSrc) return [];
      
      const finalIframeUrl = absoluta(iframeSrc, url);
      
      const r = await _nf(finalIframeUrl, { 
        headers: { 
          'User-Agent': UA, 
          'Referer': url, 
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' 
        } 
      });
      
      if (!r || !r.ok) return [];
      
      const iframeHtml = await r.text();
      const videoUrl = extraerM3u8(iframeHtml, finalIframeUrl);
      
      if (videoUrl) {
        const u = new URL(finalIframeUrl);
        return [{
          url: videoUrl,
          kind: 'm3u8',
          headers: { 'User-Agent': UA, 'Referer': u.origin + '/', 'Origin': u.origin }
        }];
      }
    } catch (e) { return []; }
    return [];
  }

  // 4. Tu extractor original (para streamtp99a.sbs)
  async function resolverGlobal(url) {
    try {
      const u = new URL(url);
      const origin = u.origin;
      const r = await _nf(url, {
        headers: {
          'User-Agent': UA,
          'Referer': origin + '/',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8'
        }
      });
      if (!r || !r.ok) return [];

      const html = await r.text();
      let videoUrl = extraerM3u8(html, url);
      
      if (!videoUrl) {
        const iframe = extraerIframe(html);
        if (iframe) {
          const iframeUrl = absoluta(iframe, url);
          const r2 = await _nf(iframeUrl, {
            headers: { 'User-Agent': UA, 'Referer': url, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' }
          });
          if (r2 && r2.ok) {
            const html2 = await r2.text();
            videoUrl = extraerM3u8(html2, iframeUrl);
          }
        }
      }

      if (!videoUrl) return [];

      videoUrl = videoUrl.replace(/:(443)(?=\/)/, '');

      return [{
        url: videoUrl,
        kind: 'm3u8',
        headers: {
          'User-Agent': UA,
          'Referer': origin + '/',
          'Origin': origin
        }
      }];
    } catch (e) { return []; }
  }

  // ---------- entrypoint ----------
  async function resolve(link, log, env) {
    _nf = env && env.nativeFetch;
    const url = String(link.url || '');
    const t0 = Date.now();

    // 1. Video directo
    if (/\.(m3u8|mp4|ts|mkv)(\?|#|$)/i.test(url)) {
      log('Enlace directo.');
      return {
        ok: true, ms: 0, status: 200,
        play: {
          url,
          kind: /\.mp4(\?|$)/i.test(url) ? 'mp4' : 'm3u8',
          headers: { 'User-Agent': UA }
        }
      };
    }

    // 2. Casos especiales (Clappr, ksdjugfsddeports, streamx ofuscados)
    if (/streamx|live1\.php|global[123]\.php/i.test(url) || /ksdjugfssddeports|deportes\.ksdjugfsddeports/i.test(url)) {
      log('Analizando página de TV en vivo...');
      
      const r = await _nf(url, { headers: { 'User-Agent': UA, 'Referer': url } });
      if (r && r.ok) {
        const html = await r.text();

        // A. Intentar Clappr Base64 (Win Sports / Directv)
        let lista = await resolverClapprBase64(url, html);
        if (lista.length) {
          log('→ ' + lista[0].url);
          return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] };
        }

        // B. Intentar Iframe Firmado (ESPN Deportes 2)
        lista = await resolverIframeFirmado(url, html);
        if (lista.length) {
          log('→ ' + lista[0].url);
          return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] };
        }

        // C. Si no es ninguno de los dos, probamos el bypass de streamx
        if (/streamx/i.test(url)) {
          lista = await resolverStreamxBypass(url);
          if (lista.length) {
            log('→ ' + lista[0].url);
            return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] };
          }
        }
      }
    }

    // 3. Streamtp99a.sbs (El que ya funcionaba)
    if (/global1\.php/i.test(url) || /streamtp\d*\./i.test(url) || /cdnpeer/i.test(url)) {
      log('Resolviendo página global1...');
      const lista = await resolverGlobal(url);
      if (lista.length) {
        log('→ ' + lista[0].url);
        return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] };
      }
    }

    log('No se pudo resolver el canal.');
    return { ok: false, ms: Date.now() - t0, status: 0 };
  }

  window.SSExtractors = { version: VERSION, resolve: resolve };
})();
