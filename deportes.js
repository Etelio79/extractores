(function () {
  'use strict';
  const VERSION = '1.1.1'; 
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
      log && log('   ↳ window[...] base64 detectado (' + raw.length + ' B)');

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
    } catch (e) { log && log('   ↳ window base64 ex: ' + e.message); }
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
        log && log('   ↳ m3u8 vía atob()');
        return absoluta(u[1].replace(/\\\//g, '/'), base);
      }
      if (/^[A-Za-z0-9+/=]+$/.test(dec) && dec.length > 40) {
        const dec2 = tryAtob(dec);
        if (dec2) {
          const u2 = dec2.match(/(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)[^\s"'<>\\]*)/i);
          if (u2) {
            log && log('   ↳ m3u8 vía atob() doble');
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
        log && log('   ↳ m3u8 vía cadena base64 suelta');
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
        log('   ↳ No se encontró iframe.');
        return [];
      }

      iframeSrc = iframeSrc.replace(/&amp;/g, '&');
      const finalIframeUrl = absoluta(iframeSrc, url);
      log('   ↳ Cargando iframe: ' + finalIframeUrl);

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
        log('   ✗ Error al cargar iframe: HTTP ' + (r2 ? r2.status : 'sin respuesta'));
        return [];
      }

      const iframeHtml = await r2.text();
      log('   ↳ Iframe cargado (' + iframeHtml.length + ' B)');
      log('   ↳ Inicio del iframe: ' + iframeHtml.slice(0, 300).replace(/\s+/g, ' '));

      let iframeOrigin = '';
      try { iframeOrigin = new URL(finalIframeUrl).origin; } catch (e) {}

      // A. m3u8 directo
      let videoUrl = extraerM3u8(iframeHtml, finalIframeUrl);
      if (videoUrl) {
        log('   ↳ m3u8 directo encontrado: ' + videoUrl);
        return [{ url: videoUrl, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': iframeOrigin + '/', 'Origin': iframeOrigin } }];
      }

      // B. Clappr Base64 (NH/tv)
      let clapprList = await resolverClapprBase64(finalIframeUrl, iframeHtml);
      if (clapprList.length) {
        log('   ↳ Video encontrado vía Clappr Base64.');
        return clapprList;
      }

      // C. window['...'] = base64
      let windowList = await resolverWindowBase64(finalIframeUrl, iframeHtml, log);
      if (windowList.length) {
        log('   ↳ Video encontrado vía window[...] base64.');
        return windowList;
      }

      // D. m3u8 en scripts ofuscados (atob / cadenas base64)
      videoUrl = extraerM3u8DeScriptOfuscado(iframeHtml, finalIframeUrl, log);
      if (videoUrl) {
        log('   ↳ m3u8 encontrado en script ofuscado.');
        return [{ url: videoUrl, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': iframeOrigin + '/', 'Origin': iframeOrigin } }];
      }

      // E. Log informativo de scripts
      const scripts = iframeHtml.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
      log('   ↳ Scripts en iframe: ' + scripts.length);
      for (let i = 0; i < Math.min(scripts.length, 3); i++) {
        let sc = scripts[i].replace(/<\/?script[^>]*>/gi, '').replace(/\s+/g, ' ');
        if (sc.length > 10) log(`   ↳ Script ${i + 1}: ${sc.slice(0, 200)}...`);
      }

      // F. Seguir iframe anidado (un nivel más) — necesario para tvf90 y otros
      let nestedIframe = extraerIframe(iframeHtml);
      if (nestedIframe) {
        log('   ↳ Iframe anidado encontrado: ' + nestedIframe);
        const nestedUrl = absoluta(nestedIframe.replace(/&amp;/g, '&'), finalIframeUrl);
        log('   ↳ Cargando iframe anidado: ' + nestedUrl);

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
          log('   ↳ Iframe anidado cargado (' + nestedHtml.length + ' B)');
          log('   ↳ Inicio anidado: ' + nestedHtml.slice(0, 300).replace(/\s+/g, ' '));

          // A1. m3u8 directo en anidado
          let nestedVideoUrl = extraerM3u8(nestedHtml, nestedUrl);
          if (nestedVideoUrl) {
            log('   ↳ m3u8 directo encontrado en anidado: ' + nestedVideoUrl);
            return [{ url: nestedVideoUrl, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': nestedOrigin + '/', 'Origin': nestedOrigin } }];
          }

          // B1. Clappr en anidado
          let nestedClappr = await resolverClapprBase64(nestedUrl, nestedHtml);
          if (nestedClappr.length) {
            log('   ↳ Video encontrado vía Clappr en anidado.');
            return nestedClappr;
          }

          // C1. window['...'] en anidado
          let nestedWin = await resolverWindowBase64(nestedUrl, nestedHtml, log);
          if (nestedWin.length) {
            log('   ↳ Video encontrado vía window[...] en anidado.');
            return nestedWin;
          }

          // D1. m3u8 ofuscado en anidado
          nestedVideoUrl = extraerM3u8DeScriptOfuscado(nestedHtml, nestedUrl, log);
          if (nestedVideoUrl) {
            log('   ↳ m3u8 en script ofuscado anidado.');
            return [{ url: nestedVideoUrl, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': nestedOrigin + '/', 'Origin': nestedOrigin } }];
          }

          // E1. Log scripts del anidado
          const nestedScripts = nestedHtml.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
          log('   ↳ Scripts en anidado: ' + nestedScripts.length);
          for (let i = 0; i < Math.min(nestedScripts.length, 3); i++) {
            let sc = nestedScripts[i].replace(/<\/?script[^>]*>/gi, '').replace(/\s+/g, ' ');
            if (sc.length > 10) log(`   ↳ Script anidado ${i + 1}: ${sc.slice(0, 200)}...`);
          }

          log('   ✗ No se encontró video en iframe anidado.');
        } else {
          log('   ✗ Error al cargar iframe anidado: HTTP ' + (r3 ? r3.status : 'sin respuesta'));
        }
      }

      log('   ✗ No se encontró video en el iframe.');
      return [];

    } catch (e) {
      log('   ✗ Excepción en iframe: ' + e.message);
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
      log('Analizando página genérica con iframe...');
      const r = await _nf(url, { headers: { 'User-Agent': UA, 'Referer': url } });
      log('   ↳ Página: HTTP ' + (r ? r.status : 'error'));
      if (!r || !r.ok) return [];

      const html = await r.text();
      log('   ↳ HTML cargado (' + html.length + ' B)');

      // Intentar window['...'] base64 en la página principal
      const winList = await resolverWindowBase64(url, html, log);
      if (winList.length) {
        log('   ↳ Video encontrado vía window[...] base64 en página principal.');
        return winList;
      }

      // Intentar Clappr en la página principal
      const clapprList = await resolverClapprBase64(url, html);
      if (clapprList.length) {
        log('   ↳ Video encontrado vía Clappr en página principal.');
        return clapprList;
      }

      // Intentar m3u8 directo en la página principal
      const directo = extraerM3u8(html, url);
      if (directo) {
        log('   ↳ m3u8 directo en página principal: ' + directo);
        const u = new URL(url);
        return [{ url: directo, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': u.origin + '/', 'Origin': u.origin } }];
      }

      // Ir al iframe
      const cookies = obtenerCookies(r);
      log('   ↳ Cookies: ' + (cookies ? cookies.slice(0, 100) : 'ninguna'));

      return await resolverIframeFirmado(url, html, cookies, log);
    } catch (e) {
      log('   ✗ Excepción en página genérica: ' + e.message);
      return [];
    }
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

      // 1) Enlace directo
      if (/\.(m3u8|mp4|ts|mkv)(\?|#|$)/i.test(url)) {
        log('Enlace directo.');
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
        log('Analizando página embed...');
        const r = await _nf(url, { headers: { 'User-Agent': UA, 'Referer': url } });
        log('Página principal: HTTP ' + (r ? r.status : 'error'));
        if (!r || !r.ok) return { ok: false, ms: Date.now() - t0, status: 0 };

        const html = await r.text();
        log('HTML cargado: ' + html.length + ' B');

        // window['...'] base64 en la página principal
        const winList = await resolverWindowBase64(url, html, log);
        if (winList.length) {
          log('→ ' + winList[0].url);
          return { ok: true, ms: Date.now() - t0, status: 200, play: winList[0] };
        }

        const cookies = obtenerCookies(r);
        log('Cookies: ' + (cookies ? cookies.slice(0, 100) : 'ninguna'));

        const lista = await resolverIframeFirmado(url, html, cookies, log);
        if (lista.length) {
          log('→ ' + lista[0].url);
          return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] };
        }
        return { ok: false, ms: Date.now() - t0, status: 0 };
      }

      // 3) streamx / live1 / global
      if (/streamx|live1\.php|global[123]\.php/i.test(url)) {
        log('Analizando página de TV en vivo...');
        const r = await _nf(url, { headers: { 'User-Agent': UA, 'Referer': url } });
        if (r && r.ok) {
          const html = await r.text();
          let lista = await resolverClapprBase64(url, html);
          if (lista.length) { log('→ ' + lista[0].url); return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] }; }

          lista = await resolverWindowBase64(url, html, log);
          if (lista.length) { log('→ ' + lista[0].url); return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] }; }

          if (/streamx/i.test(url)) {
            lista = await resolverStreamxBypass(url);
            if (lista.length) { log('→ ' + lista[0].url); return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] }; }
          }
        }
      }

      // 4) global1 / streamtp / cdnpeer
      if (/global1\.php/i.test(url) || /streamtp\d*\./i.test(url) || /cdnpeer/i.test(url)) {
        log('Resolviendo página global1...');
        const lista = await resolverGlobal(url);
        if (lista.length) { log('→ ' + lista[0].url); return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] }; }
      }

      // 5) Fallback genérico: cualquier página con iframe (cubre tvf90 y futuros dominios)
      log('Intentando resolver como página genérica con iframe...');
      const listaGen = await resolverPaginaConIframe(url, log);
      if (listaGen.length) {
        log('→ ' + listaGen[0].url);
        return { ok: true, ms: Date.now() - t0, status: 200, play: listaGen[0] };
      }

      log('No se pudo resolver el canal.');
      return { ok: false, ms: Date.now() - t0, status: 0 };
    } catch (e) {
      log('Excepción general: ' + e.message);
      return { ok: false, ms: 0, status: 0 };
    }
  }

  window.SSExtractors = { version: VERSION, resolve: resolve };
})();