(function () {
  'use strict';
  const VERSION = '1.0.3'; // <-- Recuerda actualizar esto
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
  let _nf = null;

  // ---------- helpers ----------

  function extraerM3u8(html) {
    const patterns = [
      /"src"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/i,
      /"source"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/i,
      /"file"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/i,
      /src\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
      /(https?:\/\/[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*)/i
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1]) return m[1].replace(/\\\//g, '/');
    }
    return null;
  }

  function esPaginaGlobal(url) {
    return /global1\.php/i.test(url) ||
           /streamtp\d*\./i.test(url) ||
           /cdnpeer/i.test(url);
  }

  // ---------- extractores ----------

  async function resolverStreamx(url) {
    try {
      const u = new URL(url);
      const canal = u.searchParams.get('stream') || u.searchParams.get('channel') || u.pathname.split('/').pop();
      if (!canal) return [];

      const base = 'https://streamx723.sbs';
      const urlFinal = `${base}/global1.php?channel=${canal}`;

      const r = await _nf(urlFinal, { headers: { Referer: base + '/', 'User-Agent': UA } });
      if (!r || !r.ok) return [];

      const html = await r.text();
      const videoUrl = extraerM3u8(html);
      if (!videoUrl) return [];

      return [{
        url: videoUrl,
        kind: 'hls',
        headers: { Referer: base + '/', 'User-Agent': UA, Origin: base }
      }];
    } catch (e) { return []; }
  }

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
      let videoUrl = extraerM3u8(html);
      if (!videoUrl) return [];

      videoUrl = videoUrl.replace(/:(443)(?=\/)/, '');

      return [{
        url: videoUrl,
        kind: 'hls',
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

    if (/\.(m3u8|mp4|ts|mkv)(\?|#|$)/i.test(url)) {
      log('Enlace directo.');
      return {
        ok: true, ms: 0, status: 200,
        play: {
          url,
          kind: /\.mp4(\?|$)/i.test(url) ? 'mp4' : 'hls',
          headers: { 'User-Agent': UA }
        }
      };
    }

    if (/streamx/i.test(url)) {
      log('Resolviendo Streamx...');
      const lista = await resolverStreamx(url);
      if (lista.length) {
        log('→ ' + lista[0].url);
        return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] };
      }
    }

    if (esPaginaGlobal(url)) {
      log('Resolviendo página global1...');
      const lista = await resolverGlobal(url);
      if (lista.length) {
        log('→ ' + lista[0].url);
        return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] };
      }
    }

    log('No es un enlace de Streamx ni un video directo.');
    return { ok: false, ms: Date.now() - t0, status: 0 };
  }

  window.SSExtractors = { version: VERSION, resolve: resolve };
})();
