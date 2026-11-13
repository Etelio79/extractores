(function () {
  'use strict';
  const VERSION = '1.0.1'; // <-- Recuerda actualizar esto en tu version.json
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
  let _nf = null;

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
      
      // 1. Intentar buscar las variables clásicas
      let match = html.match(/"src"\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/) || 
                  html.match(/"source"\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/) ||
                  html.match(/"file"\s*:\s*"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
      
      if (match && match[1]) {
        const videoUrl = match[1].replace(/\\\//g, '/');
        return [{ url: videoUrl, kind: 'hls', headers: { Referer: base + '/', 'User-Agent': UA } }];
      }

      // 2. FALLBACK: Si lo escondieron, buscar CUALQUIER enlace .m3u8 en el texto
      const fallbackMatch = html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i);
      if (fallbackMatch) {
        const videoUrl = fallbackMatch[0].replace(/\\\//g, '/');
        return [{ url: videoUrl, kind: 'hls', headers: { Referer: base + '/', 'User-Agent': UA } }];
      }
    } catch (e) {}
    return [];
  }

  async function resolve(link, log, env) {
    _nf = env && env.nativeFetch;
    const url = String(link.url || '');
    const t0 = Date.now();

    // 1. Si ya es un video directo (.m3u8, .mp4, .ts)
    if (/\.(m3u8|mp4|ts|mkv)$/i.test(url)) {
      log('Enlace directo.');
      return { ok: true, ms: 0, status: 200, play: { url, kind: url.includes('.mp4') ? 'mp4' : 'hls', headers: { 'User-Agent': UA } } };
    }

    // 2. Si es Streamx (embeds de eventos y canales de Firebase)
    if (/streamx/i.test(url)) {
      log('Resolviendo Streamx...');
      const lista = await resolverStreamx(url);
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
