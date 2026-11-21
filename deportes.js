(function () {
  'use strict';
  const VERSION = '1.0.9';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
  let _nf = null;

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

  async function resolverWindowBase64(url, html) {
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

  function extraerM3u8DeScriptOfuscado(html, base) {
    if (!html) return null;

    const atobRegex = /atob\s*\(\s*['"]([A-Za-z0-9+/=\\\/]{30,})['"]\s*\)/gi;
    let m;
    while ((m = atobRegex.exec(html)) !== null) {
      const raw = m[1].replace(/\\\//g, '/');
      const dec = tryAtob(raw);
      if (!dec) continue;
      const u = dec.match(/(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)[^\s"'<>\\]*)/i);
      if (u) return absoluta(u[1].replace(/\\\//g, '/'), base);
      if (/^[A-Za-z0-9+/=]+$/.test(dec) && dec.length > 40) {
        const dec2 = tryAtob(dec);
        if (dec2) {
          const u2 = dec2.match(/(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)[^\s"'<>\\]*)/i);
          if (u2) return absoluta(u2[1].replace(/\\\//g, '/'), base);
        }
      }
    }

    const b64Regex = /['"]([A-Za-z0-9+/=\\\/]{80,})['"]/g;
    while ((m = b64Regex.exec(html)) !== null) {
      const raw = m[1].replace(/\\\//g, '/');
      const dec = tryAtob(raw);
      if (!dec) continue;
      const u = dec.match(/(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)[^\s"'<>\\]*)/i);
      if (u) return absoluta(u[1].replace(/\\\//g, '/'), base);
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

  async function resolverIframeFirmado(url, html, cookies) {
    try {
      let iframeSrc = extraerIframe(html);
      if (!iframeSrc) return [];

      iframeSrc = iframeSrc.replace(/&amp;/g, '&');
      const finalIframeUrl = absoluta(iframeSrc, url);

      let pageOrigin = '';
      try { pageOrigin = new URL(url).origin; } catch (e) { pageOrigin = ''; }

      const headers = {
        'User-Agent': UA,
        'Referer': pageOrigin ? pageOrigin + '/' : finalIframeUrl,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8'
      };
      if (cookies) headers['Cookie'] = cookies;

      const r2 = await _nf(finalIframeUrl, { headers });
      if (!r2 || !r2.ok) return [];

      const iframeHtml = await r2.text();

      let iframeOrigin = '';
      try { iframeOrigin = new URL(finalIframeUrl).origin; } catch (e) {}

      let videoUrl = extraerM3u8(iframeHtml, finalIframeUrl);
      if (videoUrl) {
        return [{ url: videoUrl, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': iframeOrigin + '/', 'Origin': iframeOrigin } }];
      }

      let clapprList = await resolverClapprBase64(finalIframeUrl, iframeHtml);
      if (clapprList.length) return clapprList;

      let windowList = await resolverWindowBase64(finalIframeUrl, iframeHtml);
      if (windowList.length) return windowList;

      videoUrl = extraerM3u8DeScriptOfuscado(iframeHtml, finalIframeUrl);
      if (videoUrl) {
        return [{ url: videoUrl, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': iframeOrigin + '/', 'Origin': iframeOrigin } }];
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

  async function resolve(link, log, env) {
    try {
      _nf = env && env.nativeFetch;
      const url = String(link.url || '');
      const t0 = Date.now();

      // Fawanews: los .m3u8 de 193.47.62.x dan 403 sin el Referer de la web
      if (/^https?:\/\/193\.47\.62\.\d+\/.+\.m3u8(\?|#|$)/i.test(url)) {
        return { ok: true, ms: 0, status: 200, play: { url, kind: 'm3u8', headers: { 'User-Agent': UA, 'Referer': 'http://www.fawanews.sc/', 'Origin': 'http://www.fawanews.sc' } } };
      }

      if (/\.(m3u8|mp4|ts|mkv)(\?|#|$)/i.test(url)) {
        return { ok: true, ms: 0, status: 200, play: { url, kind: /\.mp4(\?|$)/i.test(url) ? 'mp4' : 'm3u8', headers: { 'User-Agent': UA } } };
      }

      if (/embed\.|saohgdassregions|ksdjugf|deportes\.|tvf90\./i.test(url)) {
        const r = await _nf(url, { headers: { 'User-Agent': UA, 'Referer': url } });
        if (!r || !r.ok) return { ok: false, ms: Date.now() - t0, status: 0 };

        const html = await r.text();

        const winList = await resolverWindowBase64(url, html);
        if (winList.length) {
          return { ok: true, ms: Date.now() - t0, status: 200, play: winList[0] };
        }

        const cookies = obtenerCookies(r);
        const lista = await resolverIframeFirmado(url, html, cookies);
        if (lista.length) {
          return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] };
        }
        return { ok: false, ms: Date.now() - t0, status: 0 };
      }

      if (/streamx|live1\.php|global[123]\.php/i.test(url)) {
        const r = await _nf(url, { headers: { 'User-Agent': UA, 'Referer': url } });
        if (r && r.ok) {
          const html = await r.text();
          let lista = await resolverClapprBase64(url, html);
          if (lista.length) return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] };

          lista = await resolverWindowBase64(url, html);
          if (lista.length) return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] };

          if (/streamx/i.test(url)) {
            lista = await resolverStreamxBypass(url);
            if (lista.length) return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] };
          }
        }
      }

      if (/global1\.php/i.test(url) || /streamtp\d*\./i.test(url) || /cdnpeer/i.test(url)) {
        const lista = await resolverGlobal(url);
        if (lista.length) return { ok: true, ms: Date.now() - t0, status: 200, play: lista[0] };
      }

      return { ok: false, ms: Date.now() - t0, status: 0 };
    } catch (e) {
      return { ok: false, ms: 0, status: 0 };
    }
  }

  window.SSExtractors = { version: VERSION, resolve: resolve };
})();
