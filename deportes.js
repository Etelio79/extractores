(function () {
  'use strict';
  const VERSION = '1.1.2'; 
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
    const patterns = [
      /"src"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/i,
      /"source"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/i,
      /"file"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/i,
      /src\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
      /(https?:\/\/[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*)/i
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1]) return absoluta(m[1], base);
    }
    const rel = html.match(/["'](\/[^"']+?\.m3u8[^"']*)["']/i);
    if (rel && rel[1]) return absoluta(rel[1], base);
    return null;
  }

  function extraerIframe(html) {
    if (!html) return null;
    const m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (m && m[1] && !/^javascript:/i.test(m[1])) return m[1];
    return null;
  }

  function obtenerCookies(r) {
    try {
      if (r && r.headers && typeof r.headers.get === 'function') {
        return r.headers.get('set-cookie') || '';
      }
    } catch (e) {}
    return '';
  }

  function tryAtob(str) {
    try { return atob(str); } catch (e) { return null; }
  }

  // ---------- extractores ----------

  async function resolverClapprBase64(url, html) {
    try {
      const match = html.match(/(?:NH|tv)\s*=\s*(\[\[[\s\S]*?\]\])/);
      if (!match) return [];
      const arreglo = JSON.parse(match[1]);
      arreglo.sort((a, b) => a[0] - b[0]);
      let base64Str = '';
      for (const item of arreglo) base64Str += atob(item[1]);
      let finalUrl = base64Str.replace(/["'\s]/g, '');
      if (finalUrl.startsWith('//')) finalUrl = 'https:' + finalUrl;
      if (/^https?:\/\//i.test(finalUrl)) {
        const u = new URL(url);
        return [{ url: finalUrl, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': u.origin + '/', 'Origin': u.origin } }];
      }
    } catch (e) { return []; }
    return [];
  }

  async function resolverWindowBase64(url, html, log) {
    try {
      const match = html.match(/window\s*\[\s*['"][^'"]+['"]\s*\]\s*=\s*['"]([A-Za-z0-9+/=\\\/]{40,})['"]/);
      if (!match) return [];
      let raw = match[1].replace(/\\\//g, '/').replace(/[\r\n\s]/g, '');

      let decoded = raw;
      for (let i = 0; i < 3; i++) {
        const dec = tryAtob(decoded);
        if (!dec) break;
        decoded = dec;
        const urlMatch = decoded.match(/(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)[^\s"'<>\\]*)/i);
        if (urlMatch) {
          const u = new URL(url);
          return [{ url: urlMatch[1].replace(/\\\//g, '/'), kind: /\.mp4(\?|$)/i.test(urlMatch[1]) ? 'mp4' : 'm3u8',
                    headers: { 'User-Agent': UA, 'Referer': u.origin + '/', 'Origin': u.origin } }];
        }
        if (!/^[A-Za-z0-9+/=]+$/.test(decoded) || decoded.length < 40) break;
      }

      const anyUrl = decoded.match(/(https?:\/\/[^\s"'<>\\]+)/i);
      if (anyUrl && /\.(m3u8|mp4)/i.test(anyUrl[1])) {
        const u = new URL(url);
        return [{ url: anyUrl[1].replace(/\\\//g, '/'), kind: /\.mp4(\?|$)/i.test(anyUrl[1]) ? 'mp4' : 'm3u8',
                  headers: { 'User-Agent': UA, 'Referer': u.origin + '/', 'Origin': u.origin } }];
      }
    } catch (e) {}
    return [];
  }

  function extraerM3u8DeScriptOfuscado(html, base, log) {
    if (!html) return null;

    const atobRegex = /atob\s*\(\s*['"]([A-Za-z0-9+/=\\\/]{30,})['"]\s*\)/gi;
    let m;
    while ((m = atobRegex.exec(html)) !== null) {
      const raw = m[1].replace(/\\\//g, '/');
      const dec = tryAtob(raw);
      if (!dec) continue;
      const u = dec.match(/(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)[^\s"'<>\\]*)/i);
      if (u) {
        return absoluta(u[1].replace(/\\\//g, '/'), base);
      }
      if (/^[A-Za-z0-9+/=]+$/.test(dec) && dec.length > 40) {
        const dec2 = tryAtob(dec);
        if (dec2) {
          const u2 = dec2.match(/(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)[^\s"'<>\\]*)/i);
          if (u2) {
            return absoluta(u2[1].replace(/\\\//g, '/'), base);
          }
        }
      }
    }

    const b64Regex = /['"]([A-Za-z0-9+/=\\\/]{80,})['"]/g;
    while ((m = b64Regex.exec(html)) !== null) {
      const raw = m[1].replace(/\\\//g, '/');
      const dec = tryAtob(raw);
      if (!dec) continue;
      const u = dec.match(/(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)[^\s"'<>\\]*)/i);
      if (u) {
        return absoluta(u[1].replace(/\\\//g, '/'), base);
      }
    }

    return null;
  }

  async function resolverStreamxBypass(url) {
    try {
      const u = new URL(url);
      const canal = u.searchParams.get('stream') || u.searchParams.get('channel');
      if (!canal) return [];
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
            return [{ url: videoUrl, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': 'https://streamx723.sbs/', 'Origin': 'https://streamx723.sbs' } }];
          }
        }
      }
    } catch (e) { return []; }
    return [];
  }

  // Iframe firmado (ESPN, FOX, tvf90, etc.) — ahora sigue iframes anidados
  async function resolverIframeFirmado(url, html, cookies, log) {
    try {
      let iframeSrc = extraerIframe(html);
      if (!iframeSrc) {
        return [];
      }

      iframeSrc = iframeSrc.replace(/&amp;/g, '&');
      const finalIframeUrl = absoluta(iframeSrc, url);

      // Referer = origen de la página embed (no hardcodeado)
      let pageOrigin = '';
      try { pageOrigin = new URL(url).origin; } catch (e) { pageOrigin = ''; }

      const headers = {
        'User-Agent': UA,
        'Referer': pageOrigin ? pageOrigin + '/' : finalIframeUrl,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8'
      };
      if (cookies) headers['Cookie'] = cookies;

      const r2 = await _nf(finalIframeUrl, { headers });

      if (!r2 || !r2.ok) {
        return [];
      }

      const iframeHtml = await r2.text();

      let iframeOrigin = '';
      try { iframeOrigin = new URL(finalIframeUrl).origin; } catch (e) {}

      // A. m3u8 directo
      let videoUrl = extraerM3u8(iframeHtml, finalIframeUrl);
      if (videoUrl) {
        return [{ url: videoUrl, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': iframeOrigin + '/', 'Origin': iframeOrigin } }];
      }

      // B. Clappr Base64 (NH/tv)
      let clapprList = await resolverClapprBase64(finalIframeUrl, iframeHtml);
      if (clapprList.length) {
        return clapprList;
      }

      // C. window['...'] = base64
      let windowList = await resolverWindowBase64(finalIframeUrl, iframeHtml, log);
      if (windowList.length) {
        return windowList;
      }

      // D. m3u8 en scripts ofuscados (atob / cadenas base64)
      videoUrl = extraerM3u8DeScriptOfuscado(iframeHtml, finalIframeUrl, log);
      if (videoUrl) {
        return [{ url: videoUrl, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': iframeOrigin + '/', 'Origin': iframeOrigin } }];
      }

      // F. Seguir iframe anidado (un nivel más) — necesario para tvf90 y otros
      let nestedIframe = extraerIframe(iframeHtml);
      if (nestedIframe) {
        const nestedUrl = absoluta(nestedIframe.replace(/&amp;/g, '&'), finalIframeUrl);

        let nestedOrigin = '';
        try { nestedOrigin = new URL(nestedUrl).origin; } catch (e) {}

        const r3 = await _nf(nestedUrl, {
          headers: {
            'User-Agent': UA,
            'Referer': finalIframeUrl,
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8'
          }
        });

        if (r3 && r3.ok) {
          const nestedHtml = await r3.text();

          // A1. m3u8 directo en anidado
          let nestedVideoUrl = extraerM3u8(nestedHtml, nestedUrl);
          if (nestedVideoUrl) {
            return [{ url: nestedVideoUrl, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': nestedOrigin + '/', 'Origin': nestedOrigin } }];
          }

          // B1. Clappr en anidado
          let nestedClappr = await resolverClapprBase64(nestedUrl, nestedHtml);
          if (nestedClappr.length) {
            return nestedClappr;
          }

          // C1. window['...'] en anidado
          let nestedWin = await resolverWindowBase64(nestedUrl, nestedHtml, log);
          if (nestedWin.length) {
            return nestedWin;
          }

          // D1. m3u8 ofuscado en anidado
          nestedVideoUrl = extraerM3u8DeScriptOfuscado(nestedHtml, nestedUrl, log);
          if (nestedVideoUrl) {
            return [{ url: nestedVideoUrl, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': nestedOrigin + '/', 'Origin': nestedOrigin } }];
          }

        }
      }

      return [];

    } catch (e) {
      return [];
    }
  }

  async function resolverGlobal(url) {
    try {
      const u = new URL(url);
      const origin = u.origin;
      const r = await _nf(url, { headers: { 'User-Agent': UA, 'Referer': origin + '/', 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' } });
      if (!r || !r.ok) return [];
      const html = await r.text();
      let videoUrl = extraerM3u8(html, url);
      if (!videoUrl) {
        const iframe = extraerIframe(html);
        if (iframe) {
          const iframeUrl = absoluta(iframe.replace(/&amp;/g, '&'), url);
          const r2 = await _nf(iframeUrl, { headers: { 'User-Agent': UA, 'Referer': url, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' } });
          if (r2 && r2.ok) {
            const html2 = await r2.text();
            videoUrl = extraerM3u8(html2, iframeUrl);
          }
        }
      }
      if (!videoUrl) return [];
      videoUrl = videoUrl.replace(/:(443)(?=\/)/, '');
      return [{ url: videoUrl, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': origin + '/', 'Origin': origin } }];
    } catch (e) { return []; }
  }

  // Resolver genérico para páginas con iframe (tvf90 y otros)
  async function resolverPaginaConIframe(url, log) {
    try {
      const r = await _nf(url, { headers: { 'User-Agent': UA, 'Referer': url } });
      if (!r || !r.ok) return [];

      const html = await r.text();

      // Intentar window['...'] base64 en la página principal
      const winList = await resolverWindowBase64(url, html, log);
      if (winList.length) {
        return winList;
      }

      // Intentar Clappr en la página principal
      const clapprList = await resolverClapprBase64(url, html);
      if (clapprList.length) {
        return clapprList;
      }

      // Intentar m3u8 directo en la página principal
      const directo = extraerM3u8(html, url);
      if (directo) {
        const u = new URL(url);
        return [{ url: directo, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': u.origin + '/', 'Origin': u.origin } }];
      }

      // Ir al iframe
      const cookies = obtenerCookies(r);

      return await resolverIframeFirmado(url, html, cookies, log);
    } catch (e) {
      return [];
    }
  }

  // Lee a dónde redirige una URL sin seguir la redirección (plugin nativo); devuelve la URL final o ''
  async function destinoRedireccion(url, hdr) {
    try {
      const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
      if (!cap || !cap.request) return '';
      const r = await cap.request({ url, method: 'GET', headers: hdr, disableRedirects: true, responseType: 'text' });
      const h = r && r.headers ? r.headers : {};
      const loc = h.Location || h.location || h.LOCATION || '';
      if (r && r.status >= 300 && r.status < 400 && loc) return new URL(loc, url).href;
    } catch (e) {}
    return '';
  }

  async function resolve(link, log, env) {
    try {
      _nf = env && env.nativeFetch;
      const url = String(link.url || '');
      const t0 = Date.now();

      // 0) 193.47.62.x (fawanews): el servidor devuelve 403 sin el Referer del sitio
      if (/^https?:\/\/193\.47\.62\.\d+\/.+\.m3u8(\?|#|$)/i.test(url)) {
        return { ok: true, ms: 0, status: 200, play: { url, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': 'http://www.fawanews.sc/', 'Origin': 'http://www.fawanews.sc' } } };
      }

      // 0b) rtmpcdn.com (fawanews): redirige a play.aarray.cn con token; se entrega la URL final
      if (/^https?:\/\/(?:www\.)?rtmpcdn\.com\/.+\.m3u8(\?|#|$)/i.test(url)) {
        const hdr = { 'User-Agent': UA, 'Referer': 'http://www.fawanews.sc/', 'Origin': 'http://www.fawanews.sc' };
        const destino = await destinoRedireccion(url, hdr);
        if (destino) return { ok: true, ms: Date.now() - t0, status: 200, play: { url: destino, kind: 'm3u8', headers: { 'User-Agent': UA } } };
        return { ok: true, ms: Date.now() - t0, status: 200, play: { url, kind: 'm3u8', headers: hdr } };
      }

      // 1) Enlace directo
      if (/\.(m3u8|mp4|ts|mkv)(\?|#|$)/i.test(url)) {
        return { ok: true, ms: 0, status: 200, play: { url, kind: /\.mp4(\?|$)/i.test(url) ? 'mp4' : 'm3u8', headers: { 'User-Agent': UA } } };
      }

      // 1b) GEIL.TO Live TV (acepta geil.to/#/live/play/ID o geil.to/live/play/ID): se convierte en el stream real con /live/resolve
      if (/^https?:\/\/(?:www\.)?geil\.to\/(?:#\/)?live\/play\/\d+/i.test(url)) {
        const rg = await _nf('https://geil.to/live/resolve?url=' + encodeURIComponent('https://geil.to/live/play/' + url.match(/\/play\/(\d+)/)[1]), { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
        if (!rg || !rg.ok) return { ok: false, ms: Date.now() - t0, status: rg ? rg.status : 0 };
        const jg = JSON.parse(await rg.text());
        if (!jg || !jg.url) return { ok: false, ms: Date.now() - t0, status: 0 };
        return { ok: true, ms: Date.now() - t0, status: 200, play: { url: jg.url, kind: /\.mp4(\?|$)/i.test(jg.url) ? 'mp4' : 'm3u8', headers: Object.assign({ 'User-Agent': UA }, jg.headers || {}) } };
      }

      // 2) Páginas embed (ESPN, FOX, tvf90, etc.)
      if (/embed\.|saohgdassregions|ksdjugf|deportes\.|tvf90\./i.test(url)) {
        const r = await _nf(url, { headers: { 'User-Agent': UA, 'Referer': url } });
        if (!r || !r.ok) return { ok: false, ms: Date.now() - t0, status: 0 };

        const html = await r.text();

        // window['...'] base64 en la página principal
        const winList = await resolverWindowBase64(url, html, log);
        if (winList.length) {
          return { ok: true, ms: Date.now() - t0, status: 200, play: winList[0] };
        }

        const cookies = obtenerCookies(r);

        const lista = await resolverIframeFirmado(url, html, cookies, log);
        if (lista.length) {
          return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] };
        }
        return { ok: false, ms: Date.now() - t0, status: 0 };
      }

      // 3) streamx / live1 / global
      if (/streamx|live1\.php|global[123]\.php/i.test(url)) {
        const r = await _nf(url, { headers: { 'User-Agent': UA, 'Referer': url } });
        if (r && r.ok) {
          const html = await r.text();
          let lista = await resolverClapprBase64(url, html);
          if (lista.length) { return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] }; }

          lista = await resolverWindowBase64(url, html, log);
          if (lista.length) { return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] }; }

          if (/streamx/i.test(url)) {
            lista = await resolverStreamxBypass(url);
            if (lista.length) { return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] }; }
          }
        }
      }

      // 4) global1 / streamtp / cdnpeer
      if (/global1\.php/i.test(url) || /streamtp\d*\./i.test(url) || /cdnpeer/i.test(url)) {
        const lista = await resolverGlobal(url);
        if (lista.length) { return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] }; }
      }

      // 5) Fallback genérico: cualquier página con iframe (cubre tvf90 y futuros dominios)
      const listaGen = await resolverPaginaConIframe(url, log);
      if (listaGen.length) {
        return { ok: true, ms: Date.now() - t0, status: 200, play: listaGen[0] };
      }

      return { ok: false, ms: Date.now() - t0, status: 0 };
    } catch (e) {
      return { ok: false, ms: 0, status: 0 };
    }
  }

  window.SSExtractors = { version: VERSION, resolve: resolve };
})();