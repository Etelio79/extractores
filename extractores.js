(function () {
  'use strict';
  const VERSION = '1.1.0';
  let nativeFetch = null;

  const CUSTOM = [];

  function _rootRef(u) {
    try { const h = new URL(u).hostname.split('.'); return 'https://' + (h.length > 2 ? h.slice(-2).join('.') : h.join('.')) + '/'; } catch (_) { return null; }
  }

  function _printable(t, n) { return String(t || '').slice(0, n).replace(/[^\x20-\x7E\n]/g, '·'); }

  function _unpackAll(html) {
    const out = [];
    const re = /eval\(function\(p,a,c,k,e,[dr]\)\{.*?\}\('((?:[^'\\]|\\.)*)',\s*(\d+),\s*(\d+),\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/gs;
    let m;
    while ((m = re.exec(html))) {
      try {
        let pl = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        const a = +m[2]; let c = +m[3]; const k = m[4].split('|');
        const enc = n => (n < a ? '' : enc(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
        const d = {};
        while (c--) d[enc(c)] = k[c] || enc(c);
        out.push(pl.replace(/\b\w+\b/g, w => (d[w] !== undefined ? d[w] : w)));
      } catch (_) {}
    }
    return out;
  }

  function _voeDecode(html) {
    const m = html.match(/<script[^>]*type=["']application\/json["'][^>]*>\s*\[?\s*"([^"]+)"\s*\]?\s*<\/script>/i);
    if (!m) return null;
    try {
      let v = m[1].replace(/[a-zA-Z]/g, ch => { const c = ch.charCodeAt(0) + 13; return String.fromCharCode((ch <= 'Z' ? 90 : 122) >= c ? c : c - 26); });
      ['@$', '^^', '~@', '%?', '*~', '!!', '#&'].forEach(p => { v = v.split(p).join(''); });
      v = atob(v);
      v = Array.from(v, ch => String.fromCharCode(ch.charCodeAt(0) - 3)).join('');
      v = atob(v.split('').reverse().join(''));
      return v;
    } catch (e) { return null; }
  }

  function _findM3u8(html, pageUrl, log) {
    const texts = [html.replace(/\\\//g, '/')];
    const unp = _unpackAll(html);
    if (unp.length) log('Script empaquetado: ' + unp.length);
    unp.forEach(u => texts.push(u.replace(/\\\//g, '/')));
    const voe = _voeDecode(html);
    if (voe) { log('Bloque JSON de Voe decodificado'); texts.push(voe.replace(/\\\//g, '/')); }
    const abs = u => { try { return new URL(u, pageUrl).href; } catch (_) { return null; } };
    for (const t of texts) {
      let m = t.match(/["']hls[234]?["']\s*:\s*["']([^"']+)["']/);
      if (m) { const u = abs(m[1]); if (u) return u; }
      m = t.match(/["'](?:source|file|src|direct_access_url)["']?\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/);
      if (m) { const u = abs(m[1]); if (u) return u; }
      m = t.match(/https?:\/\/[^\s"'\\<>]+?\.m3u8[^\s"'\\<>]*/);
      if (m) return m[0];
    }
    return null;
  }

  async function extractM3u8(embedUrl, log, hdrs) {
    const t0 = Date.now();
    let url = embedUrl, referer = null, html = '', status = 0;

    try {
      if (/\.m3u8$/i.test(new URL(url).pathname)) {
        log('El embed ya es un .m3u8: se usa directo');
        return { m3u8: url, referer: new URL(url).origin + '/', ms: Date.now() - t0, html: '', status: 0 };
      }
    } catch (_) {}
    for (let hop = 0; hop < 3; hop++) {
      const reqH = hdrs ? Object.assign({ 'Accept': 'text/html,application/xhtml+xml,*/*' }, hdrs)
                        : { 'Accept': 'text/html,application/xhtml+xml,*/*', 'Referer': referer || (new URL(url).origin + '/') };
      if (hdrs) log('Cabeceras del enlace: ' + Object.keys(hdrs).join(', '));
      const r = await nativeFetch(url, { headers: reqH });
      status = r.status;
      html = await r.text();
      log('GET ' + url + ' → ' + status + ' · ' + html.length + ' bytes · ' + (Date.now() - t0) + ' ms');
      if (/^\s*#EXTM3U/.test(html)) { log('La respuesta ya es una lista m3u8'); return { m3u8: url, referer: new URL(url).origin + '/', ms: Date.now() - t0, html, status }; }
      const found = _findM3u8(html, url, log);
      if (found) { log('m3u8: ' + found); return { m3u8: found, referer: url, ms: Date.now() - t0, html, status }; }
      const m = html.match(/(?:window\.)?location(?:\.href)?\s*=\s*['"](https?:\/\/[^'"]+)['"]/);
      if (m) { referer = url; url = m[1]; log('Redirige a ' + url); continue; }
      break;
    }
    log('No se encontró ningún m3u8');
    return { m3u8: null, html, status, ms: Date.now() - t0 };
  }

  async function _probe(url, headers, range, log, label) {
    const t0 = Date.now();
    try {
      const h = Object.assign({}, headers);
      if (range) h['Range'] = (typeof range === 'string') ? range : 'bytes=0-1023';
      const r = await nativeFetch(url, { headers: h });
      const txt = await r.text();
      const g = k => { try { return r.headers.get(k) || ''; } catch (_) { return ''; } };
      log('  [' + label + '] HTTP ' + r.status + ' · ' + (g('content-type') || 's/tipo') + ' · ' + txt.length + ' car. · ' + (Date.now() - t0) + ' ms');
      const cr = g('content-range'), mt = /\/(\d+)\s*$/.exec(cr);
      return { status: r.status, text: txt, total: mt ? +mt[1] : 0 };
    } catch (e) {
      log('  [' + label + '] ERROR de red: ' + ((e && e.message) || e));
      return { status: 0, text: '', total: 0 };
    }
  }

  async function _chainCheck(target, h, masterTxt, log, label) {
    if (!/^\s*#EXTM3U/.test(masterTxt)) return { ok: false, why: 'la respuesta NO es una lista m3u8' };
    log('Inicio de la lista:\n' + _printable(masterTxt, 220));
    const abs = (x, base) => { try { return new URL(x, base).href; } catch (_) { return null; } };
    const firstUri = t => t.split(/\r?\n/).map(x => x.trim()).find(l => l && l[0] !== '#');
    let mediaTxt = masterTxt, mediaUrl = target;
    if (/#EXT-X-STREAM-INF/.test(masterTxt)) {
      const v = abs(firstUri(masterTxt), target);
      if (!v) return { ok: false, why: 'no se pudo resolver la variante' };
      log('-- Lista de variante --\n' + v.slice(0, 160));
      const rv = await _probe(v, h, false, log, label);
      if (!(rv.status >= 200 && rv.status < 300)) return { ok: false, why: 'la lista abre pero la variante falla (HTTP ' + rv.status + ')' };
      mediaTxt = rv.text; mediaUrl = v;
    }
    const seg = abs(firstUri(mediaTxt), mediaUrl);
    if (!seg) return { ok: false, why: 'no se halló ningún segmento' };
    log('-- Primer segmento --\n' + seg.slice(0, 160));
    const rs = await _probe(seg, h, true, log, label);
    return (rs.status >= 200 && rs.status < 300) ? { ok: true } : { ok: false, why: 'el SEGMENTO falla (HTTP ' + rs.status + ')' };
  }

  async function diagnoseEmbed(link, log) {
    const t0 = Date.now();
    const url = String(link.url || '');
    let u; try { u = new URL(url); } catch (_) { log('URL inválida'); return { ok: false, ms: 0, status: 0 }; }
    const kind = /\.m3u8$/i.test(u.pathname) ? 'm3u8' : /\.mp4$/i.test(u.pathname) ? 'mp4' : 'otro';
    log('Tipo por URL: ' + kind);
    log('Campos del enlace: ' + Object.keys(link).join(', '));
    ['headers', 'referer', 'referrer', 'origin', 'userAgent', 'type', 'quality', 'language', 'lang'].forEach(k => {
      if (link[k] !== undefined && link[k] !== null) { try { log('  ' + k + ' = ' + JSON.stringify(link[k]).slice(0, 220)); } catch (_) {} }
    });
    let lh = (link.headers && typeof link.headers === 'object') ? link.headers : null;

    let target = url, tKind = kind, handled = false;

    for (const c of CUSTOM) {
      let hit = false; try { hit = !!c.match(u, link); } catch (_) {}
      if (!hit) continue;
      log('\n-- Extractor propio: ' + c.name + ' --');
      try {
        const r = await c.run(link, log, { nativeFetch, probe: _probe });
        if (r && r.url) { target = r.url; tKind = r.kind || 'm3u8'; if (r.headers) lh = r.headers; handled = true; log('→ ' + target.slice(0, 160)); break; }
        log('El extractor propio no devolvió enlace; se sigue con el método general');
      } catch (e) { log('ERROR en extractor propio: ' + ((e && e.message) || e)); }
    }

    if (!handled && kind === 'otro') {
      log('\n-- Detectando el tipo por contenido (solo el primer KB) --');
      const sr = await _probe(url, lh || {}, true, log, lh ? 'headers del enlace' : 'sin cabeceras');
      if (sr.status >= 200 && sr.status < 300) {
        if (/^\s*#EXTM3U/.test(sr.text)) { tKind = 'm3u8'; handled = true; log('→ es una lista m3u8'); }
        else if (sr.text.slice(4, 8) === 'ftyp') { tKind = 'mp4'; handled = true; log('→ es un MP4 directo'); }
        else log('→ parece una página: se busca el m3u8 dentro');
      }
    }
    if (!handled && kind === 'otro') {
      log('\n-- Extractor (página) --');
      try {
        const ex = await extractM3u8(url, log, lh);
        if (!ex.m3u8) return { ok: false, ms: Date.now() - t0, status: ex.status || 0 };
        target = ex.m3u8; tKind = 'm3u8'; log('→ m3u8: ' + ex.m3u8);
      } catch (e) { log('ERROR: ' + ((e && e.message) || e)); return { ok: false, ms: Date.now() - t0, status: 0 }; }
    }

    const tu = new URL(target);
    const origin = tu.origin + '/', root = _rootRef(target);
    const variants = [];
    const addV = (n, h) => { if (!variants.some(v => JSON.stringify(v.h) === JSON.stringify(h))) variants.push({ n, h }); };
    if (lh) addV('headers del enlace', lh);
    addV('Referer=' + origin, { Referer: origin });
    if (root && root !== origin) addV('Referer=' + root, { Referer: root });
    addV('sin Referer', {});

    log('\n-- Probando variantes de cabeceras (se usa la primera que funcione de punta a punta) --');
    let lastWhy = 'ninguna variante abrió la lista (revisa los HTTP de arriba)';
    for (const v of variants) {
      const r = await _probe(target, v.h, tKind === 'mp4', log, v.n);
      if (!(r.status >= 200 && r.status < 300)) continue;
      if (tKind === 'mp4') {
        if (r.text.slice(4, 8) === 'ftyp') {
          log('Inicio del archivo: ' + _printable(r.text, 40));

          if (r.status === 206 && r.total > 4 * 1024 * 1024) {
            const mid = Math.floor(r.total / 2);
            const rs = await _probe(target, v.h, 'bytes=' + mid + '-' + (mid + 1023), log, 'salto a la mitad del archivo');
            if (rs.status === 206) log('Salto en el archivo: OK');
            else if (rs.status === 200) log('ADVERTENCIA: el servidor IGNORA el salto (devuelve desde el inicio); al seguir bajando puede repetir desde el principio.');
            else log('ADVERTENCIA: el salto a mitad del archivo falla (HTTP ' + rs.status + ').');
          } else if (r.status === 200) {
            log('ADVERTENCIA: el servidor no acepta Range (respondió 200); puede no dejar avanzar ni seguir bajando.');
          } else if (!r.total) {
            log('ADVERTENCIA: el servidor no informa el tamaño total del archivo.');
          }
          log('\nRESULTADO: MP4 válido con "' + v.n + '" → se puede reproducir.');
          return { ok: true, ms: Date.now() - t0, status: r.status, play: { url: target, kind: 'mp4', headers: v.h, via: v.n } };
        }
        lastWhy = 'responde, pero NO es un MP4 (empieza con: ' + _printable(r.text, 30).replace(/\n/g, ' ') + ')';
        continue;
      }
      log('-- Comprobando lista y segmentos con "' + v.n + '" --');
      const c = await _chainCheck(target, v.h, r.text, log, v.n);
      if (c.ok) {
        log('\nRESULTADO: lista y segmento accesibles con "' + v.n + '" → se puede reproducir.');
        return { ok: true, ms: Date.now() - t0, status: 200, play: { url: target, kind: 'm3u8', headers: v.h, via: v.n } };
      }
      lastWhy = c.why; log('  ✗ ' + c.why);
    }
    log('\nRESULTADO: NO reproducible → ' + lastWhy);
    return { ok: false, ms: Date.now() - t0, status: 0 };
  }

  async function resolve(link, log, env) {
    nativeFetch = env && env.nativeFetch;
    if (typeof nativeFetch !== 'function') throw new Error('Falta nativeFetch');
    return diagnoseEmbed(link, log || function () {});
  }

  window.SSExtractors = { version: VERSION, resolve: resolve, custom: CUSTOM };
})();
