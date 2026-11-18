(function () {
  'use strict';
  const VERSION = '1.1.0';

  const resolverUniversal = (function () {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
    const RELOJ = typeof setTimeout === 'function';
    const PRESUPUESTO = RELOJ ? 42000 : 25000;
    const CIERRE = RELOJ ? 50000 : 40000;
    let inicio = Date.now();
    let _nf = null;

    function esperar(ms) { return RELOJ ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve(); }
    function transcurrido() { return Date.now() - inicio; }

    function conLimite(promesa, ms, valor) {
      let listo = false;
      const fin = Date.now() + ms;
      const trabajo = Promise.resolve(promesa).then((v) => { listo = true; return v; }, () => { listo = true; return valor; });
      if (!RELOJ) return trabajo;
      const reloj = (async () => {
        while (!listo && Date.now() < fin) await esperar(Math.max(1, Math.min(250, fin - Date.now())));
        return valor;
      })();
      return Promise.race([trabajo, reloj]);
    }

    async function traer(url, opciones) {
      opciones = opciones || {};
      const r = await _nf(url, opciones);
      let cuerpo = '';
      try { cuerpo = (await r.text()) || ''; } catch (_) {}
      return { ok: !!r.ok, status: r.status, statusText: r.statusText, url: r.url || url, text: () => Promise.resolve(cuerpo) };
    }

    async function pedir(url, opciones) {
      const o = Object.assign({}, opciones || {});
      o.headers = Object.assign({ 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' }, o.headers || {});
      return conLimite(traer(url, o).catch((e) => ({ status: 0, statusText: e && e.message })), CIERRE - transcurrido(), null);
    }

    async function texto(url, opciones) {
      const r = await pedir(url, opciones);
      if (!r || !r.ok) return '';
      try { return (await conLimite(r.text(), 10000, '')) || ''; } catch (e) { return ''; }
    }

    function origen(url) { const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i); return m ? m[1] : ''; }
    function dominio(url) { const m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i); return m ? m[1].toLowerCase() : ''; }

    const ENTIDADES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ntilde: 'ñ', Ntilde: 'Ñ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', uuml: 'ü', iexcl: '¡', iquest: '¿' };
    function entidades(t) {
      return String(t || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10))).replace(/&([a-z]+);/gi, (x, n) => (n in ENTIDADES ? ENTIDADES[n] : x));
    }

    function absoluta(url, base) {
      if (!url) return '';
      const u = entidades(String(url).trim().replace(/\\\//g, '/'));
      if (/^https?:\/\//i.test(u)) return u;
      if (u.startsWith('//')) return `https:${u}`;
      if (u.startsWith('/')) return origen(base) + u;
      const b = String(base || '').replace(/[?#].*$/, '');
      return (/^https?:\/\/[^/]+$/i.test(b) ? `${b}/` : b.replace(/[^/]*$/, '')) + u;
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

    function esImagen(url) { return /\.(?:jpg|jpeg|png|gif|webp|svg|bmp|ico)(?:\?|$)/i.test(url || ''); }
    function enlace(url, servidor, headers, calidad) {
      if (!url || !/^https?:\/\//i.test(url)) return [];
      return [{ url, servidor, headers: headers || {}, calidad: calidad || '' }];
    }

    function buscarVideo(t, base) {
      const fuentes = [
        /["']?hls[0-9]?["']?\s*:\s*["']([^"']+)["']/i,
        /sources\s*:\s*\[\s*\{\s*(?:src|file)\s*:\s*["']([^"']+)["']/i,
        /["']?(?:file|src|source|url|link)["']?\s*:\s*["']([^"']+\.(?:m3u8|mp4|txt)[^"']*)["']/i,
        /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i,
        /["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i,
        /(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?)/i
      ];
      for (const f of fuentes) {
        const m = String(t || '').match(f);
        if (m && m[1] && !esImagen(m[1])) return absoluta(m[1], base);
      }
      return '';
    }

    function primerMarco(html) {
      const re = /<iframe[^>]+src=["']([^"']+)["']/gi;
      let m;
      while ((m = re.exec(String(html || '')))) if (!/^\s*(?:javascript|about|data|blob):/i.test(m[1])) return m[1];
      return '';
    }

    function nombreServidor(url) {
      const h = dominio(url).replace(/^www\./, '');
      const partes = h.split('.');
      const n = partes.length > 1 ? partes[partes.length - 2] : h;
      return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'Directo';
    }

    async function resolverGenerico(url, servidor, referer, profundidad) {
      const html = await texto(url, { headers: { Referer: referer || `${origen(url)}/` } });
      if (!html) return [];
      const codigo = `${desempacar(html)}\n${html}`;
      const video = buscarVideo(codigo, url) || (html.match(/<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) || [])[1];
      if (video) return enlace(absoluta(video, url), servidor, { Referer: `${origen(url)}/`, 'User-Agent': UA });
      const marco = primerMarco(html);
      if (marco && (profundidad || 0) < 2) return resolverGenerico(absoluta(marco, url), servidor, url, (profundidad || 0) + 1);
      return [];
    }

    return async function(url, referer, nf) {
      _nf = nf; inicio = Date.now();
      let lista = [];
      try { lista = await conLimite(resolverGenerico(url, nombreServidor(url), referer, 0), 45000, []); } catch (e) { }
      lista = (lista || []).filter((s) => s && s.url);
      if (!lista.length) return { ok: false, ms: 0, status: 0 };
      const s = lista[0];
      return { ok: true, ms: 0, status: 200, play: { url: s.url, kind: /\.m3u8/i.test(s.url) ? 'm3u8' : 'mp4', headers: s.headers || {} } };
    };
  })();

  const resolverVidara = (function () {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
    const RELOJ = typeof setTimeout === 'function';
    const CIERRE = RELOJ ? 50000 : 40000;
    let inicio = Date.now();
    let _nf = null;

    function esperar(ms) { return RELOJ ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve(); }
    function transcurrido() { return Date.now() - inicio; }

    function conLimite(promesa, ms, valor) {
      let listo = false;
      const fin = Date.now() + ms;
      const trabajo = Promise.resolve(promesa).then((v) => { listo = true; return v; }, () => { listo = true; return valor; });
      if (!RELOJ) return trabajo;
      const reloj = (async () => {
        while (!listo && Date.now() < fin) await esperar(Math.max(1, Math.min(250, fin - Date.now())));
        return valor;
      })();
      return Promise.race([trabajo, reloj]);
    }

    async function traer(url, opciones) {
      opciones = opciones || {};
      const r = await _nf(url, opciones);
      let cuerpo = '';
      try { cuerpo = (await r.text()) || ''; } catch (_) {}
      return { ok: !!r.ok, status: r.status, statusText: r.statusText, url: r.url || url, text: () => Promise.resolve(cuerpo) };
    }

    async function pedir(url, opciones) {
      const o = Object.assign({}, opciones || {});
      o.headers = Object.assign({ 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' }, o.headers || {});
      return conLimite(traer(url, o).catch((e) => ({ status: 0, statusText: e && e.message })), CIERRE - transcurrido(), null);
    }

    async function texto(url, opciones) {
      const r = await pedir(url, opciones);
      if (!r || !r.ok) return '';
      try { return (await conLimite(r.text(), 10000, '')) || ''; } catch (e) { return ''; }
    }

    function origen(url) { const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i); return m ? m[1] : ''; }
    function absoluta(url, base) {
      if (!url) return '';
      const u = String(url).trim().replace(/\\\//g, '/');
      if (/^https?:\/\//i.test(u)) return u;
      if (u.startsWith('//')) return `https:${u}`;
      if (u.startsWith('/')) return origen(base) + u;
      const b = String(base || '').replace(/[?#].*$/, '');
      return (/^https?:\/\/[^/]+$/i.test(b) ? `${b}/` : b.replace(/[^/]*$/, '')) + u;
    }
    function enlace(url, servidor, headers, calidad) {
      if (!url || !/^https?:\/\//i.test(url)) return [];
      return [{ url, servidor, headers: headers || {}, calidad: calidad || '' }];
    }
    function esImagen(url) { return /\.(?:jpg|jpeg|png|gif|webp|svg|bmp|ico)(?:\?|$)/i.test(url || ''); }
    function buscarVideo(t, base) {
      const fuentes = [
        /["']?hls[0-9]?["']?\s*:\s*["']([^"']+)["']/i, /sources\s*:\s*\[\s*\{\s*(?:src|file)\s*:\s*["']([^"']+)["']/i, /["']?(?:file|src|source|url|link)["']?\s*:\s*["']([^"']+\.(?:m3u8|mp4|txt)[^"']*)["']/i, /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i, /["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i, /(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?)/i
      ];
      for (const f of fuentes) {
        const m = String(t || '').match(f);
        if (m && m[1] && !esImagen(m[1])) return absoluta(m[1], base);
      }
      return '';
    }
    function extraerBloque(str, startIdx) {
      const start = str.indexOf('{', startIdx); if (start === -1) return '';
      let depth = 0, inStr = false, q = '';
      for (let i = start; i < str.length; i++) {
        const c = str[i];
        if (inStr) { if (c === '\\') i++; else if (c === q) inStr = false; }
        else { if (c === '"' || c === "'") { inStr = true; q = c; } else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return str.slice(start, i + 1); } }
      }
      return '';
    }

    async function resolverVidara(url, referer) {
      let actual = url, html = '';
      for (let i = 0; i < 2; i++) {
        html = await texto(actual, { headers: { Referer: i === 0 && referer ? referer : actual } });
        if (!html) return [];
        const mirror = html.match(/var\s+MIRROR\s*=\s*['"]([^'"]+)['"]/);
        if (mirror && mirror[1]) { actual = absoluta(mirror[1], actual); } else break;
      }
      const cabeceras = { Referer: origen(actual) + '/', Origin: origen(actual), 'User-Agent': UA };
      const filecode = (actual.match(/\/e\/([A-Za-z0-9_-]+)/) || [])[1] || '';
      if (filecode) {
        const apiURL = origen(actual) + '/api/stream';
        const resp = await texto(apiURL, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, cabeceras), body: JSON.stringify({ filecode: filecode, device: 'web', codecs: [] }) });
        if (resp) {
          try {
            const data = JSON.parse(resp);
            let v = data.streaming_url || data.file || data.url || data.source || data.link;
            if (!v && data.sources && data.sources[0]) v = data.sources[0].file || data.sources[0].src;
            if (v && !esImagen(v)) return enlace(absoluta(v, actual), 'Vidara', cabeceras);
          } catch (e) { }
        }
      }
      const htmlLimpio = html.replace(/\\\//g, '/');
      let video = buscarVideo(htmlLimpio, actual);
      if (!video) {
        const scripts = htmlLimpio.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
        for (const s of scripts) {
          const inner = s.replace(/^<script[^>]*>|<\/script>$/gi, '');
          if (inner.includes('jwplayer')) {
            const setupIdx = inner.search(/\.setup\s*\(/);
            if (setupIdx !== -1) {
              const setupJson = extraerBloque(inner, setupIdx);
              if (setupJson) {
                const fm = setupJson.match(/["']?(?:file|src)["']?\s*:\s*["']([^"']+)["']/i);
                if (fm && !esImagen(fm[1])) { video = fm[1]; break; }
              }
            }
          }
        }
      }
      if (video) return enlace(absoluta(video, actual), 'Vidara', cabeceras);
      return [];
    }

    return async function(url, referer, nf) {
      _nf = nf; inicio = Date.now();
      let lista = [];
      try { lista = await conLimite(resolverVidara(url, referer), 45000, []); } catch (e) { }
      lista = (lista || []).filter((s) => s && s.url);
      if (!lista.length) return { ok: false, ms: 0, status: 0 };
      const s = lista[0];
      return { ok: true, ms: 0, status: 200, play: { url: s.url, kind: /\.m3u8/i.test(s.url) ? 'm3u8' : 'mp4', headers: s.headers || {} } };
    };
  })();

  const resolverVidhide = (function () {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
    const RELOJ = typeof setTimeout === 'function';
    const PRESUPUESTO = RELOJ ? 42000 : 25000;
    const CIERRE = RELOJ ? 50000 : 40000;
    let inicio = Date.now();
    let _nf = null;

    function esperar(ms) { return RELOJ ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve(); }
    function transcurrido() { return Date.now() - inicio; }
    function restante() { return PRESUPUESTO - transcurrido(); }

    function conLimite(promesa, ms, valor) {
      let listo = false;
      const fin = Date.now() + ms;
      const trabajo = Promise.resolve(promesa).then((v) => { listo = true; return v; }, () => { listo = true; return valor; });
      if (!RELOJ) return trabajo;
      const reloj = (async () => { while (!listo && Date.now() < fin) await esperar(Math.max(1, Math.min(250, fin - Date.now()))); return valor; })();
      return Promise.race([trabajo, reloj]);
    }

    async function traer(url, opciones) {
      opciones = opciones || {};
      const r = await _nf(url, opciones);
      let cuerpo = '';
      try { cuerpo = (await r.text()) || ''; } catch (_) {}
      const h = {};
      try { if (r.headers && r.headers.forEach) r.headers.forEach((v, k) => { h[String(k).toLowerCase()] = v; }); } catch (_) {}
      return { ok: !!r.ok, status: r.status, statusText: r.statusText, url: r.url || url, headers: { get: (n) => h[String(n).toLowerCase()] || null }, text: () => Promise.resolve(cuerpo), json: () => { try { return Promise.resolve(cuerpo ? JSON.parse(cuerpo) : null); } catch (_) { return Promise.resolve(null); } } };
    }

    async function pedir(url, opciones) {
      const o = Object.assign({}, opciones || {});
      o.headers = Object.assign({ 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' }, o.headers || {});
      return conLimite(traer(url, o).catch((e) => ({ status: 0, statusText: e && e.message })), CIERRE - transcurrido(), null);
    }

    async function texto(url, opciones) {
      const r = await pedir(url, opciones);
      if (!r || !r.ok) return '';
      try { return (await conLimite(r.text(), 10000, '')) || ''; } catch (e) { return ''; }
    }

    function origen(url) { const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i); return m ? m[1] : ''; }
    function dominio(url) { const m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i); return m ? m[1].toLowerCase() : ''; }
    function dominioBase(url) { return dominio(url).split('.').slice(-2).join('.'); }

    const ENTIDADES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ntilde: 'ñ', Ntilde: 'Ñ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', uuml: 'ü', iexcl: '¡', iquest: '¿' };
    function entidades(t) { return String(t || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10))).replace(/&([a-z]+);/gi, (x, n) => (n in ENTIDADES ? ENTIDADES[n] : x)); }

    function absoluta(url, base) {
      if (!url) return '';
      const u = entidades(String(url).trim().replace(/\\\//g, '/'));
      if (/^https?:\/\//i.test(u)) return u;
      if (u.startsWith('//')) return `https:${u}`;
      if (u.startsWith('/')) return origen(base) + u;
      const b = String(base || '').replace(/[?#].*$/, '');
      return (/^https?:\/\/[^/]+$/i.test(b) ? `${b}/` : b.replace(/[^/]*$/, '')) + u;
    }

    function desempacar(html) {
      const salida = [];
      const patron = /eval\(function\(p,a,c,k,e,[a-z]\)\{[\s\S]*?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
      const digitos = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let m;
      while ((m = patron.exec(String(html || '')))) {
        const base = parseInt(m[2], 10);
        const palabras = m[4].split('|');
        const valor = (t) => { let n = 0; for (const ch of t) { const v = digitos.indexOf(ch); if (v < 0 || v >= base) return -1; n = n * base + v; } return n; };
        salida.push(m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, (t) => { const i = valor(t); return i >= 0 && i < palabras.length && palabras[i] ? palabras[i] : t; }));
      }
      return salida.join('\n');
    }

    function etiquetaAltura(alto) { const h = parseInt(alto, 10) || 0; if (!h) return ''; if (h >= 2000) return '4K'; if (h >= 1400) return '1440p'; if (h >= 1000) return '1080p'; if (h >= 700) return '720p'; if (h >= 470) return '480p'; if (h >= 350) return '360p'; return `${h}p`; }
    function esImagen(url) { return /\.(?:jpg|jpeg|png|gif|webp|svg|bmp|ico)(?:\?|$)/i.test(url || ''); }
    function enlace(url, servidor, headers, calidad) { if (!url || !/^https?:\/\//i.test(url)) return []; return [{ url, servidor, headers: headers || {}, calidad: calidad || '' }]; }

    function buscarVideo(t, base) {
      const fuentes = [
        /["']?hls[0-9]?["']?\s*:\s*["']([^"']+)["']/i, /sources\s*:\s*\[\s*\{\s*(?:src|file)\s*:\s*["']([^"']+)["']/i, /["']?(?:file|src|source|url|link)["']?\s*:\s*["']([^"']+\.(?:m3u8|mp4|txt)[^"']*)["']/i, /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i, /["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i, /(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?)/i
      ];
      for (const f of fuentes) { const m = String(t || '').match(f); if (m && m[1] && !esImagen(m[1])) return absoluta(m[1], base); }
      return '';
    }

    function primerMarco(html) { const re = /<iframe[^>]+src=["']([^"']+)["']/gi; let m; while ((m = re.exec(String(html || '')))) if (!/^\s*(?:javascript|about|data|blob):/i.test(m[1])) return m[1]; return ''; }
    function candidatosVideo(codigo, base) {
      const lista = [];
      const links = codigo.match(/links\s*=\s*(\{[^}]+\})/);
      if (links) { try { const o = JSON.parse(links[1].replace(/'/g, '"')); for (const k of Object.keys(o).filter((x) => /^hls\d?$/.test(x)).sort().reverse()) if (o[k]) lista.push(absoluta(o[k], base)); } catch (e) {} }
      const extra = buscarVideo(codigo, base); if (extra) lista.push(extra); return [...new Set(lista.filter(Boolean))];
    }

    async function probarMaster(url, cabeceras) { const t = await texto(url, { headers: cabeceras, limite: 4000 }); if (!/#EXTM3U/.test(t)) return null; let alto = 0, m; const patron = /RESOLUTION=\d+x(\d+)/gi; while ((m = patron.exec(t))) alto = Math.max(alto, parseInt(m[1], 10)); return { calidad: etiquetaAltura(alto) }; }
    function primeroValido(promesas) { return new Promise((resolve) => { let pendientes = promesas.length; if (!pendientes) return resolve(null); const fallo = () => { if (--pendientes === 0) resolve(null); }; promesas.forEach((p, i) => p.then((v) => (v ? resolve({ i, v }) : fallo()), fallo)); }); }
    async function elegirVideo(candidatos, base, cabeceras) { if (!candidatos.length) return null; if (candidatos.length === 1) return { url: candidatos[0], calidad: '' }; const orden = candidatos.map((c, i) => ({ c, p: (dominioBase(c) === dominioBase(base) ? 0 : 10) + i })).sort((a, b) => a.p - b.p).map((x) => x.c); if (restante() < 8000) return { url: orden[0], calidad: '' }; const ganador = await primeroValido(orden.map((c) => probarMaster(c, cabeceras))); const elegido = ganador ? { url: orden[ganador.i], calidad: ganador.v.calidad } : { url: orden[0], calidad: '' }; return elegido; }

    async function resolverEmpaquetado(url, servidor, referer, siguiendo) {
      const propio = `${origen(url)}/`;
      for (const ref of [...new Set([referer || propio, propio])]) {
        const html = await texto(url, { headers: { Referer: ref } }); if (!html) continue;
        const codigo = `${desempacar(html)}\n${html}`;
        const cabeceras = { Referer: propio, Origin: origen(url), 'User-Agent': UA };
        const elegido = await elegirVideo(candidatosVideo(codigo, url), url, cabeceras);
        if (elegido) return enlace(elegido.url, servidor, cabeceras, elegido.calidad);
        const marco = primerMarco(html);
        if (marco && !siguiendo) return resolverEmpaquetado(absoluta(marco, url), servidor, url, true);
      }
      return [];
    }

    async function resolverVidhide(url, referer) {
      const id = url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop().replace(/\.html$/, '');
      const propio = await resolverEmpaquetado(url, 'VidHide', referer);
      if (propio.length) return propio;
      const espejos = ['vidhidepro.com', 'vidhidevip.com', 'vidhidepre.com'].map((d) => `https://${d}/v/${id}`).filter((e) => dominio(e) !== dominio(url));
      const listas = await Promise.all(espejos.map((e) => resolverEmpaquetado(e, 'VidHide', referer, true)));
      return listas.find((l) => l.length) || [];
    }

    return async function(url, referer, nf) {
      _nf = nf; inicio = Date.now();
      let lista = [];
      try { lista = await conLimite(resolverVidhide(url, referer), 45000, []); } catch (e) { }
      lista = (lista || []).filter((s) => s && s.url);
      if (!lista.length) return { ok: false, ms: 0, status: 0 };
      const s = lista[0];
      return { ok: true, ms: 0, status: 200, play: { url: s.url, kind: /\.m3u8/i.test(s.url) ? 'm3u8' : 'mp4', headers: s.headers || {} } };
    };
  })();

  const resolverVimeos = (function () {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
    const RELOJ = typeof setTimeout === 'function';
    const CIERRE = RELOJ ? 50000 : 40000;
    let inicio = Date.now();
    let _nf = null;

    function esperar(ms) { return RELOJ ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve(); }
    function transcurrido() { return Date.now() - inicio; }

    function conLimite(promesa, ms, valor) {
      let listo = false;
      const fin = Date.now() + ms;
      const trabajo = Promise.resolve(promesa).then((v) => { listo = true; return v; }, () => { listo = true; return valor; });
      if (!RELOJ) return trabajo;
      const reloj = (async () => { while (!listo && Date.now() < fin) await esperar(Math.max(1, Math.min(250, fin - Date.now()))); return valor; })();
      return Promise.race([trabajo, reloj]);
    }

    async function traer(url, opciones) {
      opciones = opciones || {};
      const r = await _nf(url, opciones);
      let cuerpo = '';
      try { cuerpo = (await r.text()) || ''; } catch (_) {}
      return { ok: !!r.ok, status: r.status, statusText: r.statusText, url: r.url || url, text: () => Promise.resolve(cuerpo) };
    }

    async function pedir(url, opciones) {
      const o = Object.assign({}, opciones || {});
      o.headers = Object.assign({ 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' }, o.headers || {});
      return conLimite(traer(url, o).catch((e) => ({ status: 0, statusText: e && e.message })), CIERRE - transcurrido(), null);
    }

    async function texto(url, opciones) {
      const r = await pedir(url, opciones);
      if (!r || !r.ok) return '';
      try { return (await conLimite(r.text(), 10000, '')) || ''; } catch (e) { return ''; }
    }

    function origen(url) { const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i); return m ? m[1] : ''; }
    function absoluta(url, base) {
      if (!url) return '';
      const u = String(url).trim().replace(/\\\//g, '/');
      if (/^https?:\/\//i.test(u)) return u;
      if (u.startsWith('//')) return `https:${u}`;
      if (u.startsWith('/')) return origen(base) + u;
      const b = String(base || '').replace(/[?#].*$/, '');
      return (/^https?:\/\/[^/]+$/i.test(b) ? `${b}/` : b.replace(/[^/]*$/, '')) + u;
    }
    function enlace(url, servidor, headers, calidad) { if (!url || !/^https?:\/\//i.test(url)) return []; return [{ url, servidor, headers: headers || {}, calidad: calidad || '' }]; }

    function desempacar(html) {
      const salida = [];
      const patron = /eval\(function\(p,a,c,k,e,[a-z]\)\{[\s\S]*?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
      const digitos = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let m;
      while ((m = patron.exec(String(html || '')))) {
        const base = parseInt(m[2], 10);
        const palabras = m[4].split('|');
        const valor = (t) => { let n = 0; for (const ch of t) { const v = digitos.indexOf(ch); if (v < 0 || v >= base) return -1; n = n * base + v; } return n; };
        salida.push(m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, (t) => { const i = valor(t); return i >= 0 && i < palabras.length && palabras[i] ? palabras[i] : t; }));
      }
      return salida.join('\n');
    }

    async function resolverVimeos(url, referer) {
      const embed = /embed-/.test(url) ? url : url.replace(/vimeos\.net\//, 'vimeos.net/embed-');
      const casa = origen(embed);
      const cabeceras = { Referer: `${casa}/`, Origin: casa, 'User-Agent': UA };
      let ultimo = '';
      for (let intento = 0; intento < 3; intento++) {
        const html = await texto(embed, { headers: { Referer: referer || 'https://la.movie/tv/' } });
        const codigo = `${desempacar(html)}\n${html}`;
        const video = (codigo.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/) || codigo.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/) || [])[1];
        if (video) { ultimo = absoluta(video, embed); if (!/[?&]i=/.test(ultimo) || /[?&]i=0\.0(&|$)/.test(ultimo)) break; }
        await esperar(400);
      }
      return enlace(ultimo, 'Vimeos', cabeceras);
    }

    return async function(url, referer, nf) {
      _nf = nf; inicio = Date.now();
      let lista = [];
      try { lista = await conLimite(resolverVimeos(url, referer), 45000, []); } catch (e) { }
      lista = (lista || []).filter((s) => s && s.url);
      if (!lista.length) return { ok: false, ms: 0, status: 0 };
      const s = lista[0];
      return { ok: true, ms: 0, status: 200, play: { url: s.url, kind: /\.m3u8/i.test(s.url) ? 'm3u8' : 'mp4', headers: s.headers || {} } };
    };
  })();

  const resolverVoe = (function () {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
    const RELOJ = typeof setTimeout === 'function';
    const PRESUPUESTO = RELOJ ? 42000 : 25000;
    const CIERRE = RELOJ ? 50000 : 40000;
    let inicio = Date.now();
    let _nf = null;

    function esperar(ms) { return RELOJ ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve(); }
    function transcurrido() { return Date.now() - inicio; }
    function restante() { return PRESUPUESTO - transcurrido(); }

    function conLimite(promesa, ms, valor) {
      let listo = false;
      const fin = Date.now() + ms;
      const trabajo = Promise.resolve(promesa).then((v) => { listo = true; return v; }, () => { listo = true; return valor; });
      if (!RELOJ) return trabajo;
      const reloj = (async () => { while (!listo && Date.now() < fin) await esperar(Math.max(1, Math.min(250, fin - Date.now()))); return valor; })();
      return Promise.race([trabajo, reloj]);
    }

    async function traer(url, opciones) {
      opciones = opciones || {};
      const r = await _nf(url, opciones);
      let cuerpo = '';
      try { cuerpo = (await r.text()) || ''; } catch (_) {}
      const h = {};
      try { if (r.headers && r.headers.forEach) r.headers.forEach((v, k) => { h[String(k).toLowerCase()] = v; }); } catch (_) {}
      return { ok: !!r.ok, status: r.status, statusText: r.statusText, url: r.url || url, headers: { get: (n) => h[String(n).toLowerCase()] || null }, text: () => Promise.resolve(cuerpo), json: () => { try { return Promise.resolve(cuerpo ? JSON.parse(cuerpo) : null); } catch (_) { return Promise.resolve(null); } } };
    }

    async function pedir(url, opciones) {
      const o = Object.assign({}, opciones || {});
      o.headers = Object.assign({ 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' }, o.headers || {});
      return conLimite(traer(url, o).catch((e) => ({ status: 0, statusText: e && e.message })), CIERRE - transcurrido(), null);
    }

    async function texto(url, opciones) {
      const r = await pedir(url, opciones);
      if (!r || !r.ok) return '';
      try { return (await conLimite(r.text(), 10000, '')) || ''; } catch (e) { return ''; }
    }

    function cookies(respuesta) {
      const crudo = respuesta && respuesta.headers && respuesta.headers.get('set-cookie');
      if (!crudo) return '';
      return crudo.split(/,(?=\s*[A-Za-z0-9_.\-]+=)|\n/).map((c) => c.split(';')[0].trim()).filter((c) => c.includes('=')).join('; ');
    }

    function origen(url) { const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i); return m ? m[1] : ''; }

    const ENTIDADES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ntilde: 'ñ', Ntilde: 'Ñ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', uuml: 'ü', iexcl: '¡', iquest: '¿' };
    function entidades(t) { return String(t || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10))).replace(/&([a-z]+);/gi, (x, n) => (n in ENTIDADES ? ENTIDADES[n] : x)); }

    function absoluta(url, base) {
      if (!url) return '';
      const u = entidades(String(url).trim().replace(/\\\//g, '/'));
      if (/^https?:\/\//i.test(u)) return u;
      if (u.startsWith('//')) return `https:${u}`;
      if (u.startsWith('/')) return origen(base) + u;
      const b = String(base || '').replace(/[?#].*$/, '');
      return (/^https?:\/\/[^/]+$/i.test(b) ? `${b}/` : b.replace(/[^/]*$/, '')) + u;
    }
    function atobSeguro(t) { try { return atob(String(t || '').replace(/\s+/g, '')); } catch (e) { return ''; } }
    function enlace(url, servidor, headers, calidad) { if (!url || !/^https?:\/\//i.test(url)) return []; return [{ url, servidor, headers: headers || {}, calidad: calidad || '' }]; }

    function descifrarVoe(cifrado, ruidos) {
      let t = cifrado.replace(/[a-zA-Z]/g, (c) => { const tope = c <= 'Z' ? 90 : 122; const n = c.charCodeAt(0) + 13; return String.fromCharCode(n <= tope ? n : n - 26); });
      for (const ruido of ruidos || ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) t = t.split(ruido).join('');
      const paso = atobSeguro(t); if (!paso) return null;
      let movido = ''; for (let i = 0; i < paso.length; i++) movido += String.fromCharCode(paso.charCodeAt(i) - 3);
      const final = atobSeguro(movido.split('').reverse().join(''));
      try { return JSON.parse(final); } catch (e) { return null; }
    }

    const SHA_K = Int32Array.from([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
    const SHA_M = new Int32Array(64);
    const SHA_INICIAL = Int32Array.from([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);

    function comprimirSha(estado, bloque, salida) {
      const m = SHA_M; for (let i = 0; i < 16; i++) m[i] = bloque[i];
      for (let i = 16; i < 64; i++) { const x = m[i - 15], y = m[i - 2]; m[i] = (m[i - 16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + m[i - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0; }
      let a = estado[0], b = estado[1], c = estado[2], d = estado[3], e = estado[4], f = estado[5], g = estado[6], h = estado[7];
      for (let i = 0; i < 64; i++) { const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + SHA_K[i] + m[i]) | 0; const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0; h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
      salida[0] = (estado[0] + a) | 0; salida[1] = (estado[1] + b) | 0; salida[2] = (estado[2] + c) | 0; salida[3] = (estado[3] + d) | 0; salida[4] = (estado[4] + e) | 0; salida[5] = (estado[5] + f) | 0; salida[6] = (estado[6] + g) | 0; salida[7] = (estado[7] + h) | 0;
    }
    function palabrasDeBytes(bytes, total) { const w = new Int32Array(total); for (let i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << (24 - (i & 3) * 8); return w; }
    function shaBytes(bytes) { const largo = bytes.length; const total = ((largo + 9 + 63) >> 6) << 4; const w = palabrasDeBytes(bytes, total); w[largo >> 2] |= 0x80 << (24 - (largo & 3) * 8); w[total - 1] = largo * 8; const estado = Int32Array.from(SHA_INICIAL); for (let i = 0; i < total; i += 16) comprimirSha(estado, w.subarray(i, i + 16), estado); const salida = []; for (let i = 0; i < 32; i++) salida.push((estado[i >> 2] >>> (24 - (i & 3) * 8)) & 255); return salida; }

    function pbkdf2Js(clave, sal, iteraciones, largo) {
      const k = clave.length > 64 ? shaBytes(clave) : clave;
      const interno = new Int32Array(16), externo = new Int32Array(16);
      for (let i = 0; i < 64; i++) { const v = i < k.length ? k[i] : 0; interno[i >> 2] |= (v ^ 0x36) << (24 - (i & 3) * 8); externo[i >> 2] |= (v ^ 0x5c) << (24 - (i & 3) * 8); }
      const estadoI = new Int32Array(8), estadoE = new Int32Array(8); comprimirSha(SHA_INICIAL, interno, estadoI); comprimirSha(SHA_INICIAL, externo, estadoE);
      const bloque = new Int32Array(16); bloque[8] = 0x80000000; bloque[15] = 768; const medio = new Int32Array(8), u = new Int32Array(8), salida = [];
      for (let n = 1; salida.length < largo; n++) {
        const primero = sal.concat([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); const total = ((primero.length + 9 + 63) >> 6) << 4;
        const w = palabrasDeBytes(primero, total); w[primero.length >> 2] |= 0x80 << (24 - (primero.length & 3) * 8); w[total - 1] = (primero.length + 64) * 8;
        const estado = Int32Array.from(estadoI); for (let i = 0; i < total; i += 16) comprimirSha(estado, w.subarray(i, i + 16), estado); for (let i = 0; i < 8; i++) bloque[i] = estado[i];
        comprimirSha(estadoE, bloque, u); const t = Int32Array.from(u);
        for (let it = 1; it < iteraciones; it++) { for (let i = 0; i < 8; i++) bloque[i] = u[i]; comprimirSha(estadoI, bloque, medio); for (let i = 0; i < 8; i++) bloque[i] = medio[i]; comprimirSha(estadoE, bloque, u); for (let i = 0; i < 8; i++) t[i] ^= u[i]; }
        for (let i = 0; i < 32 && salida.length < largo; i++) salida.push((t[i >> 2] >>> (24 - (i & 3) * 8)) & 255);
      }
      return salida;
    }
    function bytesHex(hex) { const s = []; for (let i = 0; i + 1 < hex.length; i += 2) s.push(parseInt(hex.slice(i, i + 2), 16)); return s; }
    function hexBytes(b) { let t = ''; for (const x of b) t += (x < 16 ? '0' : '') + x.toString(16); return t; }
    function datoAltcha(textoReto, clave) { const m = textoReto.match(new RegExp(`"${clave}"\\s*:\\s*(?:"([^"]*)"|(\\d+))`)); return m ? (m[1] !== undefined ? m[1].replace(/\\\//g, '/') : m[2]) : ''; }

    function resolverAltcha(textoReto) {
      const algoritmo = datoAltcha(textoReto, 'algorithm'); if (algoritmo && !/pbkdf2\/sha-?256/i.test(algoritmo)) return null;
      const nonce = datoAltcha(textoReto, 'nonce'), sal = datoAltcha(textoReto, 'salt'), prefijo = datoAltcha(textoReto, 'keyPrefix').toLowerCase(), costo = parseInt(datoAltcha(textoReto, 'cost'), 10) || 0, largo = parseInt(datoAltcha(textoReto, 'keyLength'), 10) || 32;
      if (!/^[0-9a-f]+$/i.test(nonce) || !/^[0-9a-f]+$/i.test(sal) || !/^[0-9a-f]+$/.test(prefijo) || costo <= 0) return null;
      const nativo = typeof __crypto_pbkdf2_hex === 'function', comienzo = Date.now(), tope = nativo ? Math.max(4000, restante() - 12000) : RELOJ ? 9000 : 6000, salBytes = bytesHex(sal), nonceBytes = bytesHex(nonce);
      for (let contador = 0; contador < 50000; contador++) {
        if (Date.now() - comienzo > tope) break; const cuenta = [(contador >>> 24) & 255, (contador >>> 16) & 255, (contador >>> 8) & 255, contador & 255]; let clave = '';
        try { clave = nativo ? String(__crypto_pbkdf2_hex(nonce + hexBytes(cuenta), sal, costo, largo * 8, 'SHA256') || '').toLowerCase() : hexBytes(pbkdf2Js(nonceBytes.concat(cuenta), salBytes, costo, largo)); } catch (e) { return null; }
        if (clave.startsWith(prefijo)) return { contador, clave };
        if (!nativo && contador === 0 && (Date.now() - comienzo) * Math.min(Math.pow(16, prefijo.length), 1024) / 2 > tope * 4) break;
      }
      return null;
    }

    async function pasarAltchaVoe(pagina) {
      const ficha = (pagina.html.match(/<input[^>]+name=["']_token["'][^>]*>/i) || [''])[0], token = entidades((ficha.match(/value=["']([^"']*)["']/i) || [])[1] || ''), widget = (pagina.html.match(/<altcha-widget\b[^>]*>/i) || [''])[0], reto = entidades((widget.match(/\bchallenge(?:-?url)?=["']([^"']+)["']/i) || [])[1] || '').trim();
      if (!token || !reto) return null; let galletas = pagina.galletas, textoReto = reto.startsWith('{') ? reto : '';
      if (!textoReto) { const r = await pedir(absoluta(reto, pagina.url), { headers: Object.assign({ Referer: pagina.url, Accept: 'application/json' }, galletas ? { Cookie: galletas } : {}) }); if (!r || !r.ok) return null; galletas = unirGalletas(galletas, cookies(r)); textoReto = (await conLimite(r.text(), 10000, '')) || ''; }
      const solucion = resolverAltcha(textoReto); if (!solucion) return null; let parametros = (textoReto.match(/"parameters"\s*:\s*(\{[^{}]*\})/) || [])[1], firma = (textoReto.match(/"signature"\s*:\s*"([^"]+)"/) || [])[1];
      if (!parametros || !firma) return null; const carga = btoa(`{"challenge":{"parameters":${parametros},"signature":"${firma}"},"solution":{"counter":${solucion.contador},"derivedKey":"${solucion.clave}","time":1}}`), casa = origen(pagina.url);
      for (const valor of [encodeURIComponent(carga), encodeURIComponent(encodeURIComponent(carga))]) {
        const r = await pedir(pagina.url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded', Origin: casa, Referer: pagina.url }, galletas ? { Cookie: galletas } : {}), body: `_token=${encodeURIComponent(token)}&access=0&altcha=${valor}` });
        if (!r || !r.ok) continue; const html = (await conLimite(r.text(), 10000, '')) || ''; if (/<script type="application\/json">/i.test(html)) return { html, galletas: unirGalletas(galletas, cookies(r)), url: r.url || pagina.url };
      }
      return null;
    }

    function unirGalletas(...listas) { const todas = new Map(); for (const lista of listas) for (const par of String(lista || '').split(/;\s*/)) { const corte = par.indexOf('='); if (corte > 0) todas.set(par.slice(0, corte).trim(), par.slice(corte + 1)); } return [...todas].map(([k, v]) => `${k}=${v}`).join('; '); }

    async function paginaVoe(url, opciones) { const r = await pedir(url, opciones); if (!r || !r.ok) return { html: '', galletas: '', url }; let html = ''; try { html = (await conLimite(r.text(), 10000, '')) || ''; } catch (e) {} return { html, galletas: cookies(r), url: r.url || url }; }

    async function resolverVoe(url, referer) {
      let actual = url, html = '', pagina = null;
      for (let i = 0; i < 3; i++) { pagina = await paginaVoe(actual, { headers: { Referer: i === 0 && referer ? referer : actual } }); html = pagina.html; const salto = html.length < 4000 && html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i); if (!salto) break; actual = absoluta(salto[1], actual); }
      if (!html) return [];
      if (/altcha-widget/i.test(html) && !/<script type="application\/json">/i.test(html)) { const pasada = await pasarAltchaVoe(pagina); if (!pasada) return []; html = pasada.html; actual = pasada.url; }
      const bloque = html.match(/<script type="application\/json">([\s\S]*?)<\/script>(?:\s*<script[^>]*src=["']([^"']+)["'])?/i);
      if (bloque) {
        let cifrado = ''; try { const dato = JSON.parse(bloque[1].trim()); cifrado = Array.isArray(dato) ? dato[0] : dato; } catch (e) {}
        let datos = cifrado ? descifrarVoe(cifrado) : null;
        if (!datos && cifrado && bloque[2]) { const cargador = await texto(absoluta(bloque[2], actual), { headers: { Referer: actual } }); const lista = (cargador.match(/\[(?:\s*'[^']{1,10}'\s*,?){4,12}\]/) || cargador.match(/\[(?:\s*"[^"]{1,10}"\s*,?){4,12}\]/) || [])[0]; if (lista) datos = descifrarVoe(cifrado, (lista.match(/['"]([^'"]{1,10})['"]/g) || []).map((x) => x.slice(1, -1))); }
        const video = datos && (datos.source || datos.direct_access_url); if (video) return enlace(video, 'Voe', { Referer: actual, 'User-Agent': UA });
      }
      const directo = html.match(/['"]hls['"]\s*:\s*['"]([^"']+)['"]/i); if (directo) return enlace(/^aHR0/.test(directo[1]) ? atobSeguro(directo[1]) : directo[1], 'Voe', { Referer: actual, 'User-Agent': UA });
      return enlace(buscarVideo(html, actual), 'Voe', { Referer: actual, 'User-Agent': UA });
    }
    
    function buscarVideo(t, base) {
      const fuentes = [/["']?hls[0-9]?["']?\s*:\s*["']([^"']+)["']/i, /sources\s*:\s*\[\s*\{\s*(?:src|file)\s*:\s*["']([^"']+)["']/i, /["']?(?:file|src|source|url|link)["']?\s*:\s*["']([^"']+\.(?:m3u8|mp4|txt)[^"']*)["']/i, /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i, /["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i, /(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?)/i];
      for (const f of fuentes) { const m = String(t || '').match(f); if (m && m[1] && !/\.(?:jpg|jpeg|png|gif|webp|svg|bmp|ico)(?:\?|$)/i.test(m[1])) return absoluta(m[1], base); }
      return '';
    }

    return async function(url, referer, nf) {
      _nf = nf; inicio = Date.now();
      let u; try { u = new URL(url); } catch (_) { return { ok: false, ms: 0, status: 0 }; }
      if (/\.(m3u8|mp4|mkv)$/i.test(u.pathname)) { const cab = Object.assign({ 'User-Agent': UA, Referer: u.origin + '/' }, {}); return { ok: true, ms: 0, status: 200, play: { url, kind: /\.m3u8$/i.test(u.pathname) ? 'm3u8' : 'mp4', headers: cab } }; }
      let lista = [];
      try { lista = await conLimite(resolverVoe(url, referer), 45000, []); } catch (e) { }
      lista = (lista || []).filter((s) => s && s.url);
      if (!lista.length) return { ok: false, ms: 0, status: 0 };
      const s = lista[0];
      return { ok: true, ms: 0, status: 200, play: { url: s.url, kind: /\.m3u8/i.test(s.url) ? 'm3u8' : 'mp4', headers: s.headers || {} } };
    };
  })();

  const resolverWorkers = (function () {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    return async function(linkUrl, referer, nf) {
      let url = String(linkUrl || '').replace(/&amp;/g, '&');
      if (!nf) return { ok: false, ms: 0, status: 0 };
      if (/\.(m3u8|mp4|mkv)$/i.test(url.split('?')[0])) {
        try {
          const r = await nf(url, { method: 'GET', headers: { 'User-Agent': UA, 'Accept': '*/*', 'Range': 'bytes=0-1023' } });
          if (r.status === 200 || r.status === 206) return { ok: true, ms: 0, status: 200, play: { url, kind: 'mp4', headers: { 'User-Agent': UA, 'Accept': '*/*' } } };
        } catch (e) { return { ok: false, ms: 0, status: 0 }; }
      }
      return { ok: false, ms: 0, status: 0 };
    };
  })();

  const SERVIDORES = [
    { patron: /voe\.sx|voe-unblock|voeunbl|v-o-e|voe\./i, run: resolverVoe },
    { patron: /vidhide|filelions|ryderjet|dintezuvio|mivalyo|dhtpre|peytonepre|smoothpre|louishide|lylxan|movearnpre|kinoger|alions|azipcdn|nikaplayer|fviplions|niikaplayerr|callistanise|dinisglows|dingtezuni|minochinos|taylorplayer/i, run: resolverVidhide },
    { patron: /vimeos/i, run: resolverVimeos },
    { patron: /vidara\.|mxzhxco8dft/i, run: resolverVidara },
    { patron: /workers\.dev/i, run: resolverWorkers }
  ];

  async function resolve(link, log, env) {
    const url = String(link.url || '');
    const referer = link.referer || (link.headers && link.headers.Referer) || '';
    const nf = env && env.nativeFetch;
    
    if (!nf) return { ok: false, ms: 0, status: 0 };

    const extractor = SERVIDORES.find((s) => s.patron.test(url));
    
    if (extractor) {
        return await extractor.run(url, referer, nf);
    }
    
    return await resolverUniversal(url, referer, nf);
  }

  window.SSExtractors = { version: VERSION, resolve: resolve, custom: [] };
})();