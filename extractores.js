(function () {
  'use strict';
  const VERSION = '1.0.6';
  const CryptoJS = window.CryptoJS;

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
  const RELOJ = typeof setTimeout === 'function';
  const PRESUPUESTO = RELOJ ? 42000 : 25000;
  const CIERRE = RELOJ ? 50000 : 40000;
  let inicio = Date.now();

  function esperar(ms) { return RELOJ ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve(); }
  function transcurrido() { return Date.now() - inicio; }
  function restante() { return PRESUPUESTO - transcurrido(); }

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

  let _nf = null;
  async function traer(url, opciones) {
    opciones = opciones || {};
    const r = await _nf(url, opciones);
    let cuerpo = '';
    try { cuerpo = (await r.text()) || ''; } catch (_) {}
    const h = {};
    try { if (r.headers && r.headers.forEach) r.headers.forEach((v, k) => { h[String(k).toLowerCase()] = v; }); } catch (_) {}
    return {
      ok: !!r.ok, status: r.status, statusText: r.statusText, url: r.url || url,
      tam: cuerpo.length,
      escudo: r.status >= 400 && /just a moment|cf-chl|challenge-platform|cf_chl|attention required/i.test(cuerpo.slice(0, 6000)),
      headers: { get: (n) => h[String(n).toLowerCase()] || null },
      text: () => Promise.resolve(cuerpo),
      json: () => { try { return Promise.resolve(cuerpo ? JSON.parse(cuerpo) : null); } catch (_) { return Promise.resolve(null); } }
    };
  }

  const caidos = new Set();
  let registro = [];
  function anotar(t) { if (registro.length < 80) registro.push(String(t).replace(/\s+/g, ' ').trim()); }
  function rutaCorta(url) { return String(url || '').replace(/^https?:\/\/(?:www\.)?/i, '').replace(/[?&]api_key=[^&]+/, '').slice(0, 75); }
  function peso(n) { return n < 1024 ? `${n}B` : `${Math.round(n / 1024)}KB`; }

  async function pedir(url, opciones) {
    const host = String(url || '').replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
    const metodo = String((opciones && opciones.method) || 'GET').toUpperCase();
    if (caidos.has(host) || restante() <= 0) { anotar(`${metodo} ${rutaCorta(url)} → omitido`); return null; }
    const comienzo = Date.now();
    const r = await pedirCrudo(url, opciones);
    const estado = !r ? 'tiempo agotado' : !r.status ? `error de red${r.statusText ? ` (${String(r.statusText).slice(0, 40)})` : ''}` : r.status;
    if (!(r && r.ok && /themoviedb/.test(host))) anotar(`${metodo} ${rutaCorta(url)} → ${estado}${r && r.status && r.tam !== undefined ? ` · ${peso(r.tam)}` : ''}${r && r.escudo ? ' · Cloudflare' : ''} · ${((Date.now() - comienzo) / 1000).toFixed(1)}s`);
    if (r && !r.status) { caidos.add(host); return null; }
    return r;
  }

  async function pedirCrudo(url, opciones) {
    const o = Object.assign({}, opciones || {});
    const limite = Math.min(o.limite || CIERRE, CIERRE - transcurrido());
    delete o.limite;
    o.headers = Object.assign({
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
    }, o.headers || {});
    return conLimite(traer(url, o).catch((e) => ({ status: 0, statusText: e && e.message })), limite, null);
  }

  async function texto(url, opciones) {
    const r = await pedir(url, opciones);
    if (!r || !r.ok) return '';
    try { return (await conLimite(r.text(), 10000, '')) || ''; } catch (e) { return ''; }
  }

  async function json(url, opciones) {
    const t = await texto(url, opciones);
    if (!t) return null;
    try { return JSON.parse(t); } catch (e) { return null; }
  }

  function cookies(respuesta) {
    const crudo = respuesta && respuesta.headers && respuesta.headers.get('set-cookie');
    if (!crudo) return '';
    return crudo.split(/,(?=\s*[A-Za-z0-9_.\-]+=)|\n/).map((c) => c.split(';')[0].trim()).filter((c) => c.includes('=')).join('; ');
  }

  function origen(url) { const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i); return m ? m[1] : ''; }
  function dominio(url) { const m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i); return m ? m[1].toLowerCase() : ''; }

  const ENTIDADES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ntilde: 'ñ', Ntilde: 'Ñ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', uuml: 'ü', iexcl: '¡', iquest: '¿' };
  function entidades(t) {
    return String(t || '')
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
      .replace(/&([a-z]+);/gi, (x, n) => (n in ENTIDADES ? ENTIDADES[n] : x));
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

  function etiquetaAltura(alto) {
    const h = parseInt(alto, 10) || 0;
    if (!h) return '';
    if (h >= 2000) return '4K';
    if (h >= 1400) return '1440p';
    if (h >= 1000) return '1080p';
    if (h >= 700) return '720p';
    if (h >= 470) return '480p';
    if (h >= 350) return '360p';
    return `${h}p`;
  }

  function calidadTexto(t) {
    const s = String(t || '');
    if (/2160|4k|uhd/i.test(s)) return '4K';
    const m = s.match(/(1440|1080|720|480|360|240)\s*p?/i);
    return m ? `${m[1]}p` : '';
  }

  async function calidadHls(url, headers) {
    if (!/m3u8|\/hls|master|playlist|\.txt/i.test(url) || restante() < 8000) return '';
    const t = await texto(url, { headers, limite: 5000 });
    let alto = 0;
    const patron = /RESOLUTION=\d+x(\d+)/gi;
    let m;
    while ((m = patron.exec(t))) alto = Math.max(alto, parseInt(m[1], 10));
    return etiquetaAltura(alto);
  }

  function enlace(url, servidor, headers, calidad) {
    if (!url || !/^https?:\/\//i.test(url)) return [];
    return [{ url, servidor, headers: headers || {}, calidad: calidad || '' }];
  }

  function buscarVideo(t, base) {
    const fuentes = [
      /["']?hls[24]["']?\s*:\s*["']([^"']+)["']/i,
      /sources\s*:\s*\[\s*\{\s*(?:src|file)\s*:\s*["']([^"']+)["']/i,
      /file\s*:\s*["']([^"']+\.(?:m3u8|mp4|txt)[^"']*)["']/i,
      /["']file["']\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
      /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i,
      /["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i
    ];
    for (const f of fuentes) {
      const m = String(t || '').match(f);
      if (m) return absoluta(m[1], base);
    }
    return '';
  }

  function atobSeguro(t) {
    try { return atob(String(t || '').replace(/\s+/g, '')); } catch (e) { return ''; }
  }

  function bytesHex(hex) { const s = []; for (let i = 0; i + 1 < hex.length; i += 2) s.push(parseInt(hex.slice(i, i + 2), 16)); return s; }
  function hexBytes(b) { let t = ''; for (const x of b) t += (x < 16 ? '0' : '') + x.toString(16); return t; }
  function bytesBase64Url(t) { let b = String(t || '').replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; return CryptoJS.enc.Base64.parse(b); }

  // ── Voe (Altcha + ROT13) ──
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

  const SHA_K = Int32Array.from([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const SHA_M = new Int32Array(64);
  const SHA_INICIAL = Int32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);

  function comprimirSha(estado, bloque, salida) {
    const m = SHA_M;
    for (let i = 0; i < 16; i++) m[i] = bloque[i];
    for (let i = 16; i < 64; i++) {
      const x = m[i - 15], y = m[i - 2];
      m[i] = (m[i - 16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + m[i - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
    }
    let a = estado[0], b = estado[1], c = estado[2], d = estado[3], e = estado[4], f = estado[5], g = estado[6], h = estado[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + SHA_K[i] + m[i]) | 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    salida[0] = (estado[0] + a) | 0; salida[1] = (estado[1] + b) | 0; salida[2] = (estado[2] + c) | 0; salida[3] = (estado[3] + d) | 0;
    salida[4] = (estado[4] + e) | 0; salida[5] = (estado[5] + f) | 0; salida[6] = (estado[6] + g) | 0; salida[7] = (estado[7] + h) | 0;
  }

  function palabrasDeBytes(bytes, total) {
    const w = new Int32Array(total);
    for (let i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
    return w;
  }

  function shaBytes(bytes) {
    const largo = bytes.length;
    const total = ((largo + 9 + 63) >> 6) << 4;
    const w = palabrasDeBytes(bytes, total);
    w[largo >> 2] |= 0x80 << (24 - (largo & 3) * 8);
    w[total - 1] = largo * 8;
    const estado = Int32Array.from(SHA_INICIAL);
    for (let i = 0; i < total; i += 16) comprimirSha(estado, w.subarray(i, i + 16), estado);
    const salida = [];
    for (let i = 0; i < 32; i++) salida.push((estado[i >> 2] >>> (24 - (i & 3) * 8)) & 255);
    return salida;
  }

  function pbkdf2Js(clave, sal, iteraciones, largo) {
    const k = clave.length > 64 ? shaBytes(clave) : clave;
    const interno = new Int32Array(16), externo = new Int32Array(16);
    for (let i = 0; i < 64; i++) {
      const v = i < k.length ? k[i] : 0;
      interno[i >> 2] |= (v ^ 0x36) << (24 - (i & 3) * 8);
      externo[i >> 2] |= (v ^ 0x5c) << (24 - (i & 3) * 8);
    }
    const estadoI = new Int32Array(8), estadoE = new Int32Array(8);
    comprimirSha(SHA_INICIAL, interno, estadoI);
    comprimirSha(SHA_INICIAL, externo, estadoE);
    const bloque = new Int32Array(16); bloque[8] = 0x80000000; bloque[15] = 768;
    const medio = new Int32Array(8), u = new Int32Array(8), salida = [];
    for (let n = 1; salida.length < largo; n++) {
      const primero = sal.concat([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
      const total = ((primero.length + 9 + 63) >> 6) << 4;
      const w = palabrasDeBytes(primero, total);
      w[primero.length >> 2] |= 0x80 << (24 - (primero.length & 3) * 8);
      w[total - 1] = (primero.length + 64) * 8;
      const estado = Int32Array.from(estadoI);
      for (let i = 0; i < total; i += 16) comprimirSha(estado, w.subarray(i, i + 16), estado);
      for (let i = 0; i < 8; i++) bloque[i] = estado[i];
      comprimirSha(estadoE, bloque, u);
      const t = Int32Array.from(u);
      for (let it = 1; it < iteraciones; it++) {
        for (let i = 0; i < 8; i++) bloque[i] = u[i];
        comprimirSha(estadoI, bloque, medio);
        for (let i = 0; i < 8; i++) bloque[i] = medio[i];
        comprimirSha(estadoE, bloque, u);
        for (let i = 0; i < 8; i++) t[i] ^= u[i];
      }
      for (let i = 0; i < 32 && salida.length < largo; i++) salida.push((t[i >> 2] >>> (24 - (i & 3) * 8)) & 255);
    }
    return salida;
  }

  function datoAltcha(textoReto, clave) {
    const m = textoReto.match(new RegExp(`"${clave}"\\s*:\\s*(?:"([^"]*)"|(\\d+))`));
    return m ? (m[1] !== undefined ? m[1].replace(/\\\//g, '/') : m[2]) : '';
  }

  function resolverAltcha(textoReto) {
    const algoritmo = datoAltcha(textoReto, 'algorithm');
    if (algoritmo && !/pbkdf2\/sha-?256/i.test(algoritmo)) return null;
    const nonce = datoAltcha(textoReto, 'nonce');
    const sal = datoAltcha(textoReto, 'salt');
    const prefijo = datoAltcha(textoReto, 'keyPrefix').toLowerCase();
    const costo = parseInt(datoAltcha(textoReto, 'cost'), 10) || 0;
    const largo = parseInt(datoAltcha(textoReto, 'keyLength'), 10) || 32;
    if (!/^[0-9a-f]+$/i.test(nonce) || !/^[0-9a-f]+$/i.test(sal) || !/^[0-9a-f]+$/.test(prefijo) || costo <= 0) return null;
    const nativo = typeof __crypto_pbkdf2_hex === 'function';
    const comienzo = Date.now();
    const tope = nativo ? Math.max(4000, restante() - 12000) : RELOJ ? 9000 : 6000;
    const salBytes = bytesHex(sal);
    const nonceBytes = bytesHex(nonce);
    for (let contador = 0; contador < 50000; contador++) {
      if (Date.now() - comienzo > tope) break;
      const cuenta = [(contador >>> 24) & 255, (contador >>> 16) & 255, (contador >>> 8) & 255, contador & 255];
      let clave = '';
      try {
        clave = nativo ? String(__crypto_pbkdf2_hex(nonce + hexBytes(cuenta), sal, costo, largo * 8, 'SHA256') || '').toLowerCase() : hexBytes(pbkdf2Js(nonceBytes.concat(cuenta), salBytes, costo, largo));
      } catch (e) { return null; }
      if (clave.startsWith(prefijo)) { anotar(`Voe: desafío resuelto en ${contador + 1} intentos`); return { contador, clave }; }
      if (!nativo && contador === 0 && (Date.now() - comienzo) * Math.min(Math.pow(16, prefijo.length), 1024) / 2 > tope * 4) break;
    }
    anotar(`Voe: desafío sin resolver (costo ${costo})`);
    return null;
  }

  async function pasarAltchaVoe(pagina) {
    const ficha = (pagina.html.match(/<input[^>]+name=["']_token["'][^>]*>/i) || [''])[0];
    const token = entidades((ficha.match(/value=["']([^"']*)["']/i) || [])[1] || '');
    const widget = (pagina.html.match(/<altcha-widget\b[^>]*>/i) || [''])[0];
    const reto = entidades((widget.match(/\bchallenge(?:-?url)?=["']([^"']+)["']/i) || [])[1] || '').trim();
    if (!token || !reto) return null;
    let galletas = pagina.galletas;
    let textoReto = reto.startsWith('{') ? reto : '';
    if (!textoReto) {
      const r = await pedir(absoluta(reto, pagina.url), { headers: Object.assign({ Referer: pagina.url, Accept: 'application/json' }, galletas ? { Cookie: galletas } : {}) });
      if (!r || !r.ok) return null;
      galletas = unirGalletas(galletas, cookies(r));
      textoReto = (await conLimite(r.text(), 10000, '')) || '';
    }
    const solucion = resolverAltcha(textoReto);
    if (!solucion) return null;
    let parametros = (textoReto.match(/"parameters"\s*:\s*(\{[^{}]*\})/) || [])[1];
    const firma = (textoReto.match(/"signature"\s*:\s*"([^"]+)"/) || [])[1];
    if (!parametros || !firma) return null;
    const carga = btoa(`{"challenge":{"parameters":${parametros},"signature":"${firma}"},"solution":{"counter":${solucion.contador},"derivedKey":"${solucion.clave}","time":1}}`);
    const casa = origen(pagina.url);
    for (const valor of [encodeURIComponent(carga), encodeURIComponent(encodeURIComponent(carga))]) {
      const r = await pedir(pagina.url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded', Origin: casa, Referer: pagina.url }, galletas ? { Cookie: galletas } : {}), body: `_token=${encodeURIComponent(token)}&access=0&altcha=${valor}` });
      if (!r || !r.ok) continue;
      const html = (await conLimite(r.text(), 10000, '')) || '';
      if (/<script type="application\/json">/i.test(html)) return { html, galletas: unirGalletas(galletas, cookies(r)), url: r.url || pagina.url };
    }
    return null;
  }

  function unirGalletas(...listas) {
    const todas = new Map();
    for (const lista of listas) for (const par of String(lista || '').split(/;\s*/)) { const corte = par.indexOf('='); if (corte > 0) todas.set(par.slice(0, corte).trim(), par.slice(corte + 1)); }
    return [...todas].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async function resolverVoe(url, referer) {
    let actual = url, html = '', pagina = null;
    for (let i = 0; i < 3; i++) {
      pagina = await paginaVoe(actual, { headers: { Referer: i === 0 && referer ? referer : actual } });
      html = pagina.html;
      const salto = html.length < 4000 && html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
      if (!salto) break;
      actual = absoluta(salto[1], actual);
    }
    if (!html) return [];
    if (/altcha-widget/i.test(html) && !/<script type="application\/json">/i.test(html)) {
      const pasada = await pasarAltchaVoe(pagina);
      if (!pasada) return [];
      html = pasada.html; actual = pasada.url;
    }
    const bloque = html.match(/<script type="application\/json">([\s\S]*?)<\/script>(?:\s*<script[^>]*src=["']([^"']+)["'])?/i);
    if (bloque) {
      let cifrado = '';
      try { const dato = JSON.parse(bloque[1].trim()); cifrado = Array.isArray(dato) ? dato[0] : dato; } catch (e) {}
      let datos = cifrado ? descifrarVoe(cifrado) : null;
      if (!datos && cifrado && bloque[2]) {
        const cargador = await texto(absoluta(bloque[2], actual), { headers: { Referer: actual } });
        const lista = (cargador.match(/\[(?:\s*'[^']{1,10}'\s*,?){4,12}\]/) || cargador.match(/\[(?:\s*"[^"]{1,10}"\s*,?){4,12}\]/) || [])[0];
        if (lista) datos = descifrarVoe(cifrado, (lista.match(/['"]([^'"]{1,10})['"]/g) || []).map((x) => x.slice(1, -1)));
      }
      const video = datos && (datos.source || datos.direct_access_url);
      if (video) return enlace(video, 'Voe', { Referer: actual, 'User-Agent': UA });
    }
    const directo = html.match(/['"]hls['"]\s*:\s*['"]([^'"]+)['"]/i);
    if (directo) return enlace(/^aHR0/.test(directo[1]) ? atobSeguro(directo[1]) : directo[1], 'Voe', { Referer: actual, 'User-Agent': UA });
    return enlace(buscarVideo(html, actual), 'Voe', { Referer: actual, 'User-Agent': UA });
  }

  async function paginaVoe(url, opciones) {
    const r = await pedir(url, opciones);
    if (!r || !r.ok) return { html: '', galletas: '', url };
    let html = '';
    try { html = (await conLimite(r.text(), 10000, '')) || ''; } catch (e) {}
    return { html, galletas: cookies(r), url: r.url || url };
  }

  // ── Filemoon (Luna ECDSA) ──
  const resolverLuna = (() => {
    const CURVA = { p: BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'), n: BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'), x: BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'), y: BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5') };
    const CERO = BigInt(0), UNO = BigInt(1), DOS = BigInt(2), TRES = BigInt(3), CUATRO = BigInt(4), OCHO = BigInt(8);
    let visorLuna = '', dispositivoLuna = '', llaveLuna = null, paseLuna = null, pendienteLuna = null;
    const UA_LUNA = 'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';
    const NAVEGADOR_LUNA = { 'User-Agent': UA_LUNA, 'Accept-Language': 'es-ES,es;q=0.9', 'sec-ch-ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"', 'sec-ch-ua-mobile': '?1', 'sec-ch-ua-platform': '"Android"', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-origin' };

    function resto(a, m) { const r = a % m; return r < CERO ? r + m : r; }
    function potencia(base, exponente, m) { let r = UNO, b = resto(base, m), e = exponente; while (e > CERO) { if (e & UNO) r = (r * b) % m; b = (b * b) % m; e >>= UNO; } return r; }
    function inversoMod(a, m) { return potencia(a, m - DOS, m); }
    function doblar(q) {
      const { p } = CURVA; if (!q || q[1] === CERO) return null;
      const [x, y, z] = q, delta = (z * z) % p, gamma = (y * y) % p, beta = (x * gamma) % p;
      const alfa = resto(TRES * (x - delta) * (x + delta), p), x3 = resto(alfa * alfa - OCHO * beta, p);
      const z3 = resto((y + z) * (y + z) - gamma - delta, p), y3 = resto(alfa * (CUATRO * beta - x3) - OCHO * gamma * gamma, p);
      return [x3, y3, z3];
    }
    function sumar(a, b) {
      const { p } = CURVA; if (!a) return b; if (!b) return a;
      const z1 = (a[2] * a[2]) % p, z2 = (b[2] * b[2]) % p, u1 = (a[0] * z2) % p, u2 = (b[0] * z1) % p;
      const s1 = (((a[1] * z2) % p) * b[2]) % p, s2 = (((b[1] * z1) % p) * a[2]) % p;
      if (u1 === u2) return s1 === s2 ? doblar(a) : null;
      const h = resto(u2 - u1, p), r = resto(s2 - s1, p), h2 = (h * h) % p, h3 = (h2 * h) % p;
      const x3 = resto(r * r - h3 - DOS * u1 * h2, p), y3 = resto(r * (u1 * h2 - x3) - s1 * h3, p), z3 = (((h * a[2]) % p) * b[2]) % p;
      return [x3, y3, z3];
    }
    function multiplicar(k) {
      let r = null, q = [CURVA.x, CURVA.y, UNO], e = k;
      while (e > CERO) { if (e & UNO) r = sumar(r, q); q = doblar(q); e >>= UNO; }
      if (!r) return null;
      const zi = inversoMod(r[2], CURVA.p), zi2 = (zi * zi) % CURVA.p;
      return [(r[0] * zi2) % CURVA.p, (((r[1] * zi2) % CURVA.p) * zi) % CURVA.p];
    }
    function hexAzar(bytes) { let t = ''; for (let i = 0; i < bytes; i++) t += Math.floor(Math.random() * 256).toString(16).padStart(2, '0'); return t; }
    function escalarAzar() { return resto(BigInt(`0x${hexAzar(40)}`), CURVA.n - UNO) + UNO; }
    function hex32(v) { return v.toString(16).padStart(64, '0'); }
    function base64Url(palabras) { return palabras.toString(CryptoJS.enc.Base64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function hexUrl(hex) { return base64Url(CryptoJS.enc.Hex.parse(hex)); }

    function firmarLuna(texto) {
      if (!llaveLuna) { const nueva = escalarAzar(); llaveLuna = { privada: nueva, publica: multiplicar(nueva) }; }
      const { privada, publica } = llaveLuna;
      const e = BigInt(`0x${CryptoJS.SHA256(CryptoJS.enc.Utf8.parse(texto)).toString(CryptoJS.enc.Hex)}`);
      for (let intento = 0; intento < 8; intento++) {
        const k = escalarAzar(), punto = multiplicar(k), r = resto(punto[0], CURVA.n);
        if (r === CERO) continue;
        const s = resto(inversoMod(k, CURVA.n) * (e + r * privada), CURVA.n);
        if (s === CERO) continue;
        return { firma: hexUrl(hex32(r) + hex32(s)), clave: { crv: 'P-256', ext: true, key_ops: ['verify'], kty: 'EC', x: hexUrl(hex32(publica[0])), y: hexUrl(hex32(publica[1])) } };
      }
      return null;
    }
    function abrirLuna(datos) {
      const partes = (datos.key_parts || []).map(bytesBase64Url), cortas = partes.filter((x) => x.sigBytes === 16);
      if (cortas.length < 2 || !datos.iv || !datos.payload) return '';
      const clave = cortas[0].clone().concat(cortas[1]), vector = bytesBase64Url(datos.iv);
      if (vector.sigBytes !== 12) return '';
      const todo = bytesBase64Url(datos.payload);
      try {
        if (CryptoJS.mode.CTR) {
          const contador = vector.clone().concat(CryptoJS.lib.WordArray.create([2], 4));
          const cifrado = CryptoJS.lib.WordArray.create(todo.words.slice(0, Math.ceil((todo.sigBytes - 16) / 4)), todo.sigBytes - 16);
          return CryptoJS.AES.decrypt({ ciphertext: cifrado }, clave, { iv: contador, mode: CryptoJS.mode.CTR, padding: CryptoJS.pad.NoPadding }).toString(CryptoJS.enc.Utf8);
        }
        if (CryptoJS.mode.GCM) return CryptoJS.AES.decrypt({ ciphertext: todo }, clave, { iv: vector, mode: CryptoJS.mode.GCM, padding: CryptoJS.pad.NoPadding }).toString(CryptoJS.enc.Utf8);
      } catch (e) { return ''; }
      return '';
    }

    const TABLA_LUNA = new Int32Array(512);
    function hashLuna(texto) {
      let a = 1779033703 | 0, b = 3144134277 | 0, c = 1013904242 | 0, d = 2773480762 | 0, x;
      for (let i = 0; i < texto.length; i++) {
        a = (a + (texto.charCodeAt(i) & 255)) | 0; a = (a << 7) | (a >>> 25);
        a = (a + b) | 0; x = d ^ a; d = (x << 16) | (x >>> 16);
        c = (c + d) | 0; x = b ^ c; b = (x << 12) | (x >>> 20);
        a = (a + b) | 0; x = d ^ a; d = (x << 8) | (x >>> 24);
        c = (c + d) | 0; x = b ^ c; b = (x << 7) | (x >>> 25);
      }
      for (let i = 0; i < 8; i++) {
        a = (a + b) | 0; x = d ^ a; d = (x << 16) | (x >>> 16);
        c = (c + d) | 0; x = b ^ c; b = (x << 12) | (x >>> 20);
        a = (a + b) | 0; x = d ^ a; d = (x << 8) | (x >>> 24);
        c = (c + d) | 0; x = b ^ c; b = (x << 7) | (x >>> 25);
      }
      const r = TABLA_LUNA;
      for (let i = 0; i < 512; i++) {
        a = (a + b) | 0; x = d ^ a; d = (x << 16) | (x >>> 16);
        c = (c + d) | 0; x = b ^ c; b = (x << 12) | (x >>> 20);
        a = (a + b) | 0; x = d ^ a; d = (x << 8) | (x >>> 24);
        c = (c + d) | 0; x = b ^ c; b = (x << 7) | (x >>> 25);
        r[i] = a ^ c;
      }
      for (let vuelta = 0; vuelta < 2; vuelta++) {
        for (let s = 0; s < 512; s++) {
          let v = (r[s] + r[r[s] & 511]) | 0; v = (v << 13) | (v >>> 19);
          v ^= Math.imul(r[(s + 1) & 511], -1640531535); r[s] = v; a ^= v;
          a = (a + b) | 0; x = d ^ a; d = (x << 16) | (x >>> 16);
          c = (c + d) | 0; x = b ^ c; b = (x << 12) | (x >>> 20);
          a = (a + b) | 0; x = d ^ a; d = (x << 8) | (x >>> 24);
          c = (c + d) | 0; x = b ^ c; b = (x << 7) | (x >>> 25);
        }
      }
      const salida = [];
      for (let i = 0; i < 8; i++) {
        a = (a + b) | 0; x = d ^ a; d = (x << 16) | (x >>> 16);
        c = (c + d) | 0; x = b ^ c; b = (x << 12) | (x >>> 20);
        a = (a + b) | 0; x = d ^ a; d = (x << 8) | (x >>> 24);
        c = (c + d) | 0; x = b ^ c; b = (x << 7) | (x >>> 25);
        let s = a; const base = i * 64;
        for (let k = 0; k < 64; k++) { const v = r[base + k]; s = (s + v) | 0; s = (s << 5) | (s >>> 27); s ^= Math.imul(v, -2048144777); }
        salida.push((s ^ c) >>> 0);
      }
      return salida;
    }
    function cerosLuna(p) { let n = 0; for (let i = 0; i < p.length; i++) { if (p[i] === 0) { n += 32; continue; } return n + Math.clz32(p[i]); } return n; }
    async function trabajoLuna(tarea, tope) {
      if (!(tarea.dificultad > 0)) return '0';
      const prefijo = `${tarea.nonce}:`, comienzo = Date.now();
      for (let n = tarea.siguiente; ; n++) {
        if (cerosLuna(hashLuna(prefijo + n)) >= tarea.dificultad) return String(n);
        if ((n & 1023) === 1023) { tarea.siguiente = n + 1; if (Date.now() - comienzo > tope) return null; await esperar(0); }
      }
    }
    async function captchaLuna(baseMarco, codigo, huella, cabeceras, pasos) {
      let tarea = pendienteLuna && pendienteLuna.base === baseMarco && Date.now() < pendienteLuna.vence ? pendienteLuna : null;
      if (tarea) { pasos.push(`retomando prueba desde ${tarea.siguiente}`); }
      else {
        const reto = await enviarLuna(`${baseMarco}/api/videos/${codigo}/embed/captcha`, { fingerprint: huella }, cabeceras, pasos);
        if (!reto || !reto.pow_token) return '';
        tarea = { base: baseMarco, codigo, token: reto.pow_token, nonce: String(reto.pow_nonce || ''), dificultad: Number(reto.pow_difficulty) || 0, siguiente: 0, vence: Date.now() + (Number(reto.expires_in) || 25) * 1000 - 4000 };
        pendienteLuna = tarea;
      }
      const tope = Math.max(3000, Math.min(tarea.vence - Date.now(), restante() - 8000)), comienzo = Date.now(), desde = tarea.siguiente;
      const solucion = await trabajoLuna(tarea, tope);
      pasos.push(`prueba ${tarea.dificultad} ${solucion === null ? 'sin resolver' : 'resuelta'}`);
      if (solucion === null) return '';
      pendienteLuna = null;
      const r = await enviarLuna(`${baseMarco}/api/videos/${tarea.codigo}/embed/captcha/verify`, { pow_token: tarea.token, solution: solucion, fingerprint: huella }, cabeceras, pasos);
      if (!r || r.status !== 'ok' || !r.token) return '';
      paseLuna = { token: r.token, vence: Date.now() + Math.max(60, (Number(r.expires_in) || 600) - 30) * 1000 };
      return r.token;
    }
    function paseCompartido(baseMarco, codigo, huella, cabeceras, pasos) {
      if (paseLuna && paseLuna.token && Date.now() < paseLuna.vence) return Promise.resolve(paseLuna.token);
      if (paseLuna && paseLuna.promesa) { pasos.push('esperando la prueba de otro servidor'); return paseLuna.promesa; }
      const promesa = captchaLuna(baseMarco, codigo, huella, cabeceras, pasos).catch(() => '');
      paseLuna = { promesa }; promesa.then((t) => { if (!t && paseLuna && paseLuna.promesa === promesa) paseLuna = null; });
      return promesa;
    }
    async function enviarLuna(url, cuerpo, cabeceras, pasos) {
      const r = await fetch(url, { method: 'POST', headers: Object.assign({ Accept: '*/*' }, NAVEGADOR_LUNA, cuerpo === '' ? {} : { 'Content-Type': 'application/json' }, cabeceras), body: cuerpo === '' ? '' : JSON.stringify(cuerpo) });
      const paso = url.replace(/^.*\/api\/videos\//, '').replace(/^[\w-]+\/embed\//, '').replace(/^access\//, '');
      if (!r || !r.status) { pasos.push(`${paso} sin respuesta`); return null; }
      const texto = await r.text();
      if (!r.ok) { pasos.push(`${paso} ${r.status}`); return null; }
      pasos.push(`${paso} ok`); try { return JSON.parse(texto); } catch (e) { return null; }
    }

    return async function resolverLuna(url) {
      const m = url.match(/\/(?:e|d|download)\/([a-zA-Z0-9]+)/);
      if (!m) return [];
      const pasos = [], base = origen(url), embed = `${base}/e/${m[1]}`;
      const detalle = await (await fetch(`${base}/api/videos/${m[1]}/embed/details`, { headers: Object.assign({}, NAVEGADOR_LUNA, { Accept: '*/*', Referer: embed, 'X-Embed-Parent': embed }) })).json().catch(() => null);
      const marco = detalle && detalle.embed_frame_url;
      if (!marco) return [];
      const baseMarco = origen(marco), cabeceras = { Referer: marco, Origin: baseMarco };
      let acceso = null;
      for (let vuelta = 0; vuelta < 3; vuelta++) {
        const reto = await enviarLuna(`${baseMarco}/api/videos/access/challenge`, '', cabeceras, pasos);
        if (!reto || !reto.nonce || !reto.challenge_id) break;
        const prueba = firmarLuna(reto.nonce);
        if (!prueba) break;
        const conocido = visorLuna && dispositivoLuna;
        const respuesta = await enviarLuna(`${baseMarco}/api/videos/access/attest`, {
          viewer_id: conocido ? visorLuna : '', device_id: conocido ? dispositivoLuna : '', challenge_id: reto.challenge_id, nonce: reto.nonce,
          signature: prueba.firma, public_key: prueba.clave, client: { user_agent: UA_LUNA, platform: 'Android' },
          storage: conocido ? { local_storage: visorLuna, indexed_db: `${visorLuna}:${dispositivoLuna}`, cache_storage: `${visorLuna}:${dispositivoLuna}` } : {},
          attributes: { entropy: 'high' }
        }, cabeceras, pasos);
        if (!respuesta || !respuesta.token) break;
        acceso = respuesta;
        if (respuesta.viewer_id) visorLuna = respuesta.viewer_id;
        if (respuesta.device_id) dispositivoLuna = respuesta.device_id;
        if (conocido && Number(respuesta.confidence) >= 0.85) break;
        if (vuelta > 0 && !conocido) break;
      }
      if (!acceso) return [];
      const huella = { token: acceso.token, viewer_id: acceso.viewer_id || visorLuna, device_id: acceso.device_id || dispositivoLuna, confidence: acceso.confidence };
      const cabecerasVideo = Object.assign({ 'X-Embed-Parent': embed }, cabeceras);
      const guardado = paseLuna && paseLuna.token && Date.now() < paseLuna.vence ? paseLuna.token : '';
      let play = await enviarLuna(`${baseMarco}/api/videos/${m[1]}/embed/playback`, { fingerprint: huella }, guardado ? Object.assign({ 'X-Captcha-Token': guardado }, cabecerasVideo) : cabecerasVideo, pasos);
      if ((!play || !play.playback) && guardado) paseLuna = null;
      if (!play || !play.playback) {
        const pase = await paseCompartido(baseMarco, m[1], huella, cabecerasVideo, pasos);
        if (pase) play = await enviarLuna(`${baseMarco}/api/videos/${m[1]}/embed/playback`, { fingerprint: huella }, Object.assign({ 'X-Captcha-Token': pase }, cabecerasVideo), pasos);
      }
      if (!play || !play.playback) return [];
      const claro = abrirLuna(play.playback);
      try {
        const datos = JSON.parse(claro.replace(/^﻿/, ''));
        const fuentes = [].concat(datos.sources || datos.source || []);
        const fuente = fuentes.find((f) => f && /m3u8/.test(f.url || '')) || fuentes[0];
        const destino = typeof fuente === 'string' ? fuente : fuente && fuente.url;
        if (destino) return enlace(destino, 'Filemoon', { Referer: `${baseMarco}/`, Origin: baseMarco, 'User-Agent': UA_LUNA }, calidadTexto(fuente && fuente.label));
      } catch (e) {}
      return [];
    };
  })();

  // ── Doodstream ──
  async function resolverDood(url, referer) {
    const embed = url.replace(/\/(d|f|download)\//, '/e/');
    const html = await texto(embed, { headers: { Referer: referer || embed } });
    const m = html.match(/\/pass_md5\/[\w-]+\/([\w-]+)/);
    if (!m) return [];
    const base = origen(embed);
    const prefijo = await texto(base + m[0], { headers: { Referer: embed } });
    if (!/^https?:/.test(prefijo)) return [];
    let azar = ''; const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 10; i++) azar += letras[Math.floor(Math.random() * letras.length)];
    return enlace(`${prefijo}${azar}?token=${m[1]}&expiry=${Date.now()}`, 'Doodstream', { Referer: `${base}/`, 'User-Agent': UA });
  }

  // ── StreamWish / Empaquetado ──
  async function resolverEmpaquetado(url, servidor, referer, siguiendo) {
    const propio = `${origen(url)}/`;
    for (const ref of [...new Set([referer || propio, propio])]) {
      const html = await texto(url, { headers: { Referer: ref } });
      if (!html) continue;
      const codigo = `${desempacar(html)}\n${html}`;
      const links = codigo.match(/links\s*=\s*(\{[^}]+\})/);
      let video = '';
      if (links) { try { const o = JSON.parse(links[1].replace(/'/g, '"')); video = o.hls4 || o.hls3 || o.hls2 || o.hls || ''; } catch (e) {} }
      video = absoluta(video || buscarVideo(codigo, url), url);
      if (video) return enlace(video, servidor, { Referer: propio, Origin: origen(url), 'User-Agent': UA });
      const marco = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (marco && !siguiendo) return resolverEmpaquetado(absoluta(marco[1], url), servidor, url, true);
    }
    return [];
  }

  async function resolverStreamwish(url, referer) {
    const propio = await resolverEmpaquetado(url, 'StreamWish', referer);
    if (propio.length) return propio;
    const id = url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop().replace(/\.html$/, '');
    const espejos = [`https://hglink.to/e/${id}`, `https://streamwish.to/e/${id}`, `https://vibuxer.com/e/${id}`].filter((e) => dominio(e) !== dominio(url));
    const listas = await Promise.all(espejos.map((e) => resolverEmpaquetado(e, 'StreamWish', referer, true)));
    return listas.find((l) => l.length) || [];
  }

  // ── Vimeos ──
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

  // ── Embed69 / Xupalace ──
  function audioCodigo(codigo) { return { LAT: 'Latino', ESP: 'Castellano', CAS: 'Castellano', SUB: 'Subtitulado', '0': 'Latino', '1': 'Castellano', '2': 'Subtitulado' }[String(codigo).toUpperCase()] || ''; }

  function sha256Palabras(texto) {
    const largo = texto.length, bloques = ((largo + 9 + 63) >> 6) << 4;
    const w = new Int32Array(bloques);
    for (let i = 0; i < largo; i++) w[i >> 2] |= (texto.charCodeAt(i) & 255) << (24 - (i & 3) * 8);
    w[largo >> 2] |= 0x80 << (24 - (largo & 3) * 8); w[bloques - 1] = largo * 8;
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const m = SHA_M;
    for (let b = 0; b < bloques; b += 16) {
      for (let i = 0; i < 16; i++) m[i] = w[b + i] | 0;
      for (let i = 16; i < 64; i++) {
        const x = m[i - 15], y = m[i - 2];
        m[i] = (m[i - 16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + m[i - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      }
      let a = h0, bb = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + SHA_K[i] + m[i]) | 0;
        const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7];
  }

  function nonceTrabajo(reto, dificultad) {
    for (let n = 0; n < 20000000; n++) {
      const p = sha256Palabras(reto + n);
      let ok = true;
      for (let i = 0; i < dificultad && ok; i++) { if (((p[i >> 3] >>> (28 - (i & 7) * 4)) & 15) !== 0) ok = false; }
      if (ok) return n;
    }
    return -1;
  }

  function leerEmbed69(html) {
    const bloque = html.match(/dataLink\s*=\s*(\[[\s\S]*?\]);/);
    if (!bloque) return [];
    let grupos = []; try { grupos = JSON.parse(bloque[1]); } catch (e) { return []; }
    const reto = (html.match(/POW_CHALLENGE\s*=\s*'([^']+)'/) || [])[1];
    const sal = (html.match(/POW_SALT\s*=\s*'([^']+)'/) || [])[1];
    const dificultad = parseInt((html.match(/POW_DIFFICULTY\s*=\s*(\d+)/) || [])[1], 10);
    let clave = null;
    if (reto && sal && dificultad) { const n = nonceTrabajo(reto, dificultad); if (n < 0) return []; clave = CryptoJS.SHA256(reto + n + sal); }
    const salida = [];
    for (const g of grupos) {
      const audio = audioCodigo(g.video_language);
      for (const e of g.sortedEmbeds || []) {
        if (!e.link || e.servername === 'download') continue;
        let destino = e.link;
        if (clave) {
          try {
            const crudo = CryptoJS.enc.Base64.parse(e.link);
            const vector = CryptoJS.lib.WordArray.create(crudo.words.slice(0, 4), 16);
            const cuerpo = CryptoJS.lib.WordArray.create(crudo.words.slice(4), crudo.sigBytes - 16);
            destino = CryptoJS.AES.decrypt({ ciphertext: cuerpo }, clave, { iv: vector, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString(CryptoJS.enc.Utf8);
          } catch (err) { destino = ''; }
        }
        if (/^https?:\/\//.test(destino)) salida.push({ url: destino, audio });
      }
    }
    return salida;
  }

  function leerXupalace(html) {
    const salida = [];
    const patron = /go_to_player(?:Vast)?\('(https?:\/\/[^']+)'[^)]*\)[^<]*?(?:data-lang="(\d+)")?/g;
    let m;
    while ((m = patron.exec(html))) salida.push({ url: m[1], audio: m[2] != null ? audioCodigo(m[2]) : '' });
    return salida;
  }

  async function resolverAgregado(internos, origenUrl, profundidad) {
    const listas = await Promise.all(internos.map(async (x) => {
      const r = await resolver(x.url, origenUrl, profundidad + 1);
      return r.map((s) => Object.assign(s, { audio: s.audio || x.audio }));
    }));
    return [].concat(...listas);
  }

  // ── Genérico ──
  async function resolverGenerico(url, servidor, referer, profundidad) {
    const html = await texto(url, { headers: { Referer: referer || `${origen(url)}/` } });
    if (!html) return [];
    if ((profundidad || 0) < 2 && /dataLink\s*=\s*\[/.test(html)) return resolverAgregado(leerEmbed69(html), url, profundidad || 0);
    if ((profundidad || 0) < 2 && /go_to_player/.test(html)) return resolverAgregado(leerXupalace(html), url, profundidad || 0);
    if (/<script type="application\/json">/i.test(html)) { const voe = await resolverVoe(url); if (voe.length) return voe; }
    const codigo = `${desempacar(html)}\n${html}`;
    const video = buscarVideo(codigo, url) || (html.match(/<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) || [])[1];
    if (!video) {
      const marco = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (marco && (profundidad || 0) < 2) return resolver(absoluta(marco[1], url), url, (profundidad || 0) + 1);
    }
    return enlace(absoluta(video, url), servidor, { Referer: `${origen(url)}/`, 'User-Agent': UA });
  }

  // ── Lista de Servidores ──
  const SERVIDORES = [
    [/voe\.sx|voe-unblock|voeunbl|v-o-e|voe\./i, 'Voe', (u, r) => resolverVoe(u, r)],
    [/filemoon|moonplayer|kerapoxy|byse|bysezoxexe|bysezejataos|byse[a-z]*|f16px|filemooon|1azayf|smdfs40r/i, 'Filemoon', (u) => resolverLuna(u)],
    [/streamwish|swdyu|wishembed|playerwish|strwish|swhoi|wishfast|sfastwish|hlswish|embedwish|awish|dwish|streamhg|hglink|habetar|mwish|kswplayer|swiftplayers|hanerix|cdnwish|flaswish|obeywish|davioad|jodwish|ghbrisk|dhcplay|iplayerhls|cybervynx|dumbalag|wishonly|streamwishplayer|asnwish|nekowish|neko-stream|multimovies|streamhls|vibuxer|premilkyway/i, 'StreamWish', (u, r) => resolverStreamwish(u, r)],
    [/dood|d0000d|d000d|ds2play|ds2video|dooood|doods|do0od|vide0|vidply|all3do|dood\.|d-s\.io|dsvplay|myvidplay|playmogo|do7go/i, 'Doodstream', (u, r) => resolverDood(u, r)],
    [/vimeos/i, 'Vimeos', (u, r) => resolverVimeos(u, r)],
    [/streamsilk|savefiles|vembed|vidguard|listeamed|bembed|embedseek|tplayer|turbovid|vidsonic|vidnest|dropcdn|barmonrey/i, '', (u, r) => resolverGenerico(u, nombreServidor(u), r, 1)]
  ];

  function nombreServidor(url) {
    const h = dominio(url).replace(/^www\./, '');
    for (const [patron, nombre] of SERVIDORES) if (nombre && patron.test(h)) return nombre;
    const partes = h.split('.');
    const n = partes.length > 1 ? partes[partes.length - 2] : h;
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'Directo';
  }

  async function resolver(url, referer, profundidad) {
    const nivel = profundidad || 0;
    if (!url || nivel > 2) return [];
    const u = absoluta(url, referer || '');
    const h = dominio(u);
    let salida = [];
    try {
      if (/embed69\./.test(h)) return await resolverAgregado(leerEmbed69(await texto(u, { headers: { Referer: referer || 'https://sololatino.net/' } })), u, nivel);
      if (/xupalace\./.test(h) && /\/video\//.test(u)) return await resolverAgregado(leerXupalace(await texto(u, { headers: { Referer: 'https://xupalace.org/' } })), u, nivel);
      const servidor = SERVIDORES.find(([patron]) => patron.test(h)) || null;
      if (/\.(m3u8|mp4|mkv)(\?|#|$)/i.test(u)) salida = enlace(u, nombreServidor(u), referer ? { Referer: referer, 'User-Agent': UA } : { 'User-Agent': UA });
      else if (servidor) { salida = await servidor[2](u, referer); if (!salida.length) salida = await resolverGenerico(u, servidor[1] || nombreServidor(u), referer, nivel); }
      else salida = await resolverGenerico(u, nombreServidor(u), referer, nivel);
    } catch (e) { salida = []; }
    await Promise.all(salida.map(async (s) => { if (!s.calidad) s.calidad = (await calidadHls(s.url, s.headers)) || calidadTexto(s.url); }));
    return salida;
  }

  function pesoCalidad(c) { if (/4k/i.test(c)) return 2160; return Number((String(c || '').match(/(\d{3,4})p/i) || [])[1]) || 0; }

  // ── Punto de entrada (Lógica conectada a tu app) ──
  async function resolve(link, log, env) {
    _nf = env && env.nativeFetch;
    if (typeof _nf !== 'function') throw new Error('Falta nativeFetch');
    if (!window.CryptoJS) throw new Error('Falta crypto-js');
    inicio = Date.now(); caidos.clear(); registro = [];

    const t0 = Date.now();
    const url = String(link.url || '');
    let u;
    try { u = new URL(url); } catch (_) { return { ok: false, ms: 0, status: 0 }; }

    const _LANDING = /^(?:megaup\.net|1fichier\.com|rapidgator\.net|katfile\.com|nitroflare\.com|ddownload\.com|turbobit\.net|uploaded\.net|filefactory\.com|mediafire\.com)$/i;
    const _esLanding = _LANDING.test(u.hostname) && u.pathname.split('/').filter(Boolean).length >= 2;

    if (/\.(m3u8|mp4|mkv)$/i.test(u.pathname) && !_esLanding) {
      log('La URL ya es un archivo directo.');
      const cab = Object.assign({ 'User-Agent': UA, Referer: u.origin + '/' }, link.headers || {});
      return { ok: true, ms: Date.now() - t0, status: 200, play: { url, kind: /\.m3u8$/i.test(u.pathname) ? 'm3u8' : 'mp4', headers: cab } };
    }

    const referer = link.referer || (link.headers && link.headers.Referer) || '';
    let lista = [];
    try {
      lista = await conLimite(resolver(url, referer), 45000, []);
    } catch (e) { log('ERROR: ' + ((e && e.message) || e)); }
    for (const l of registro) log(l);

    lista = (lista || []).filter((s) => s && s.url);
    if (!lista.length) {
      log('No se pudo resolver este enlace (' + nombreServidor(url) + ').');
      return { ok: false, ms: Date.now() - t0, status: 0 };
    }
    lista.sort((a, b) => pesoCalidad(b.calidad) - pesoCalidad(a.calidad));
    const s = lista[0];
    log('→ ' + s.url);
    return {
      ok: true, ms: Date.now() - t0, status: 200,
      play: { url: s.url, kind: /\.(mp4|mkv)(\?|#|$)/i.test(s.url) ? 'mp4' : 'm3u8', headers: s.headers || {} }
    };
  }

  window.SSExtractors = { version: VERSION, resolve: resolve, custom: [] };
})();