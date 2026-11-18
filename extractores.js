(function () {
  'use strict';
  const VERSION = '1.0.9';
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

  // ── Red ──
  let _nf = null;
  async function traer(url, opciones) {
    const r = await _nf(url, opciones || {});
    let cuerpo = '';
    try { cuerpo = (await r.text()) || ''; } catch (_) {}
    const h = {};
    try { if (r.headers && r.headers.forEach) r.headers.forEach((v, k) => { h[String(k).toLowerCase()] = v; }); } catch (_) {}
    return {
      ok: !!r.ok, status: r.status, url: r.url || url,
      headers: { get: (n) => h[String(n).toLowerCase()] || null },
      text: () => Promise.resolve(cuerpo)
    };
  }

  const caidos = new Set();

  async function pedir(url, opciones) {
    const host = String(url || '').replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
    if (caidos.has(host) || restante() <= 0) return null;
    const r = await pedirCrudo(url, opciones);
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
    return conLimite(traer(url, o).catch(() => ({ status: 0 })), limite, null);
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

  function unirGalletas(...listas) {
    const todas = new Map();
    for (const lista of listas) for (const par of String(lista || '').split(/;\s*/)) { const corte = par.indexOf('='); if (corte > 0) todas.set(par.slice(0, corte).trim(), par.slice(corte + 1)); }
    return [...todas].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  // ── Utilidades de URL / texto ──
  function origen(url) { const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i); return m ? m[1] : ''; }
  function dominio(url) { const m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i); return m ? m[1].toLowerCase() : ''; }
  function dominioBase(url) { return dominio(url).split('.').slice(-2).join('.'); }

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

  function atobSeguro(t) {
    try { return atob(String(t || '').replace(/\s+/g, '')); } catch (e) { return ''; }
  }

  function bytesHex(hex) { const s = []; for (let i = 0; i + 1 < hex.length; i += 2) s.push(parseInt(hex.slice(i, i + 2), 16)); return s; }
  function hexBytes(b) { let t = ''; for (const x of b) t += (x < 16 ? '0' : '') + x.toString(16); return t; }

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

  function extraerBloque(str, startIdx) {
    const start = str.indexOf('{', startIdx);
    if (start === -1) return '';
    let depth = 0, inStr = false, q = '';
    for (let i = start; i < str.length; i++) {
      const c = str[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === q) inStr = false;
      } else {
        if (c === '"' || c === "'") { inStr = true; q = c; }
        else if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) return str.slice(start, i + 1);
        }
      }
    }
    return '';
  }

  function primerMarco(html) {
    const re = /<iframe[^>]+src=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(String(html || '')))) if (!/^\s*(?:javascript|about|data|blob):/i.test(m[1])) return m[1];
    return '';
  }

  // ── Calidad ──
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

  function altoMaximo(t) {
    let alto = 0, m;
    const patron = /RESOLUTION=\d+x(\d+)/gi;
    while ((m = patron.exec(t))) alto = Math.max(alto, parseInt(m[1], 10));
    return alto;
  }

  async function calidadHls(url, headers) {
    if (!/m3u8|\/hls|master|playlist|\.txt/i.test(url) || restante() < 8000) return '';
    const t = await texto(url, { headers, limite: 5000 });
    return etiquetaAltura(altoMaximo(t));
  }

  function pesoCalidad(c) { if (/4k/i.test(c)) return 2160; return Number((String(c || '').match(/(\d{3,4})p/i) || [])[1]) || 0; }
  function pesoOk(c) { return c === '4K' ? 2160 : parseInt(c, 10) || 0; }

  // ── Búsqueda de video ──
  function enlace(url, servidor, headers, calidad) {
    if (!url || !/^https?:\/\//i.test(url)) return [];
    return [{ url, servidor, headers: headers || {}, calidad: calidad || '' }];
  }

  function esImagen(url) {
    return /\.(?:jpg|jpeg|png|gif|webp|svg|bmp|ico)(?:\?|$)/i.test(url || '');
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

  function candidatosVideo(codigo, base) {
    const lista = [];
    const links = codigo.match(/links\s*=\s*(\{[^}]+\})/);
    if (links) {
      try {
        const o = JSON.parse(links[1].replace(/'/g, '"'));
        for (const k of Object.keys(o).filter((x) => /^hls\d?$/.test(x)).sort().reverse()) if (o[k]) lista.push(absoluta(o[k], base));
      } catch (e) {}
    }
    const extra = buscarVideo(codigo, base);
    if (extra) lista.push(extra);
    return [...new Set(lista.filter(Boolean))];
  }

  async function probarMaster(url, cabeceras) {
    const t = await texto(url, { headers: cabeceras, limite: 4000 });
    if (!/#EXTM3U/.test(t)) return null;
    return { calidad: etiquetaAltura(altoMaximo(t)) };
  }

  function primeroValido(promesas) {
    return new Promise((resolve) => {
      let pendientes = promesas.length;
      if (!pendientes) return resolve(null);
      const fallo = () => { if (--pendientes === 0) resolve(null); };
      promesas.forEach((p, i) => p.then((v) => (v ? resolve({ i, v }) : fallo()), fallo));
    });
  }

  async function elegirVideo(candidatos, base, cabeceras) {
    if (!candidatos.length) return null;
    if (candidatos.length === 1) return { url: candidatos[0], calidad: '' };
    const orden = candidatos
      .map((c, i) => ({ c, p: (dominioBase(c) === dominioBase(base) ? 0 : 10) + i }))
      .sort((a, b) => a.p - b.p).map((x) => x.c);
    if (restante() < 8000) return { url: orden[0], calidad: '' };
    const ganador = await primeroValido(orden.map((c) => probarMaster(c, cabeceras)));
    return ganador ? { url: orden[ganador.i], calidad: ganador.v.calidad } : { url: orden[0], calidad: '' };
  }

  // ── Voe ──
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
      if (clave.startsWith(prefijo)) return { contador, clave };
      if (!nativo && contador === 0 && (Date.now() - comienzo) * Math.min(Math.pow(16, prefijo.length), 1024) / 2 > tope * 4) break;
    }
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
    const parametros = (textoReto.match(/"parameters"\s*:\s*(\{[^{}]*\})/) || [])[1];
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

  async function paginaVoe(url, opciones) {
    const r = await pedir(url, opciones);
    if (!r || !r.ok) return { html: '', galletas: '', url };
    let html = '';
    try { html = (await conLimite(r.text(), 10000, '')) || ''; } catch (e) {}
    return { html, galletas: cookies(r), url: r.url || url };
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
    const directo = html.match(/['"]hls['"]\s*:\s*['"]([^"']+)['"]/i);
    if (directo) return enlace(/^aHR0/.test(directo[1]) ? atobSeguro(directo[1]) : directo[1], 'Voe', { Referer: actual, 'User-Agent': UA });
    return enlace(buscarVideo(html, actual), 'Voe', { Referer: actual, 'User-Agent': UA });
  }

  // ── Empaquetados (StreamWish, VidHide, Fastream) ──
  async function resolverEmpaquetado(url, servidor, referer, siguiendo) {
    const propio = `${origen(url)}/`;
    for (const ref of [...new Set([referer || propio, propio])]) {
      const html = await texto(url, { headers: { Referer: ref } });
      if (!html) continue;
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
    const espejos = ['vidhidepro.com', 'vidhidevip.com', 'vidhidepre.com']
      .map((d) => `https://${d}/v/${id}`).filter((e) => dominio(e) !== dominio(url));
    const listas = await Promise.all(espejos.map((e) => resolverEmpaquetado(e, 'VidHide', referer, true)));
    return listas.find((l) => l.length) || [];
  }

  async function resolverStreamwish(url, referer) {
    const propio = await resolverEmpaquetado(url, 'StreamWish', referer);
    if (propio.length) return propio;
    const id = url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop().replace(/\.html$/, '');
    const espejos = [`https://hglink.to/e/${id}`, `https://streamwish.to/e/${id}`, `https://vibuxer.com/e/${id}`].filter((e) => dominio(e) !== dominio(url));
    const listas = await Promise.all(espejos.map((e) => resolverEmpaquetado(e, 'StreamWish', referer, true)));
    return listas.find((l) => l.length) || [];
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

  // ── Mixdrop ──
  async function resolverMixdrop(url, referer) {
    const embed = url.replace(/^(https?:\/\/[^/]+)\/f\//i, '$1/e/');
    const casa = origen(embed);
    const html = await texto(embed, { headers: { Referer: referer || `${casa}/` } });
    if (!html) return [];
    const codigo = `${desempacar(html)}\n${html}`;
    const patron = (n) => new RegExp(`MDCore\\.${n}\\s*=\\s*\\\\?["']((?:[^"'\\\\]|\\\\\\/)+)`);
    const hallado = (codigo.match(patron('wurl')) || codigo.match(patron('furl')) || [])[1];
    const limpio = codigo.replace(/\\\//g, '/');
    const suelto = (limpio.match(/MDCore\.\w+\s*=\s*["'`]((?:https?:)?\/\/[^"'`\s]+)["'`]/) || [])[1]
      || (limpio.match(/["'`]((?:https?:)?\/\/[^"'`\s<>]+\.(?:mp4|m3u8)[^"'`\s<>]*)["'`]/i) || [])[1]
      || (limpio.match(/((?:https?:)?\/\/[^"'`\s<>]*mxcontent[^"'`\s<>]*)/i) || [])[1];
    const video = hallado ? absoluta(hallado, embed) : (buscarVideo(limpio, embed) || (suelto ? absoluta(suelto, embed) : ''));
    return enlace(video, 'Mixdrop', { Referer: `${casa}/`, 'User-Agent': UA });
  }

  // ── Streamtape ──
  function enlacesStreamtape(html) {
    const js = [];
    const asignacion = /getElementById\(\s*['"][a-z0-9_]*link['"]\s*\)\s*\.innerHTML\s*=\s*([^;]+);/gi;
    let m;
    while ((m = asignacion.exec(html))) {
      const trozos = /\(?\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\)?((?:\s*\.(?:substring|slice)\(\s*\d+\s*(?:,\s*\d+\s*)?\))*)/g;
      let t = '', p;
      while ((p = trozos.exec(m[1]))) {
        let s = p[2];
        const cortes = /\.(?:substring|slice)\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/g;
        let c;
        while ((c = cortes.exec(p[3] || ''))) s = c[2] !== undefined ? s.substring(+c[1], +c[2]) : s.substring(+c[1]);
        t += s;
      }
      if (/get_video\?/.test(t)) js.push(t);
    }
    if (js.length) return js;
    const plano = [];
    const div = /<[a-z]+[^>]+id=["'][a-z0-9_]*link["'][^>]*>\s*([^<]*get_video\?[^<]*)</gi;
    while ((m = div.exec(html))) plano.push(m[1].trim());
    return plano;
  }

  async function resolverStreamtape(url, referer) {
    const embed = url.replace(/^(https?:\/\/[^/]+)\/v\//i, '$1/e/');
    const casa = origen(embed);
    const html = await texto(embed, { headers: { Referer: referer || `${casa}/` } });
    if (!html) return [];
    const candidatos = enlacesStreamtape(html);
    if (!candidatos.length) return [];
    let video = absoluta(candidatos[candidatos.length - 1], embed);
    if (!/[?&]stream=1/.test(video)) video += '&stream=1';
    return enlace(video, 'Streamtape', { Referer: `${casa}/`, 'User-Agent': UA });
  }

  // ── Agregadores (Embed69, Xupalace) ──
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
    const nivel = profundidad || 0;
    const html = await texto(url, { headers: { Referer: referer || `${origen(url)}/` } });
    if (!html) return [];
    if (nivel < 2 && /dataLink\s*=\s*\[/.test(html)) return resolverAgregado(leerEmbed69(html), url, nivel);
    if (nivel < 2 && /go_to_player/.test(html)) return resolverAgregado(leerXupalace(html), url, nivel);
    if (/<script type="application\/json">/i.test(html)) { const voe = await resolverVoe(url); if (voe.length) return voe; }
    const codigo = `${desempacar(html)}\n${html}`;
    const video = buscarVideo(codigo, url) || (html.match(/<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) || [])[1];
    if (!video) {
      const marco = primerMarco(html);
      if (marco && nivel < 2) return resolver(absoluta(marco, url), url, nivel + 1);
      return [];
    }
    return enlace(absoluta(video, url), servidor, { Referer: `${origen(url)}/`, 'User-Agent': UA });
  }

  // ── Vidara ──
  async function resolverVidara(url, referer) {
    let actual = url, html = '';
    for (let i = 0; i < 2; i++) {
      html = await texto(actual, { headers: { Referer: i === 0 && referer ? referer : actual } });
      if (!html) return [];
      const mirror = html.match(/var\s+MIRROR\s*=\s*['"]([^'"]+)['"]/);
      if (mirror && mirror[1]) actual = absoluta(mirror[1], actual);
      else break;
    }

    const cabeceras = { Referer: origen(actual) + '/', Origin: origen(actual), 'User-Agent': UA };
    const filecode = (actual.match(/\/e\/([A-Za-z0-9_-]+)/) || [])[1] || '';

    if (filecode) {
      const resp = await texto(origen(actual) + '/api/stream', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, cabeceras),
        body: JSON.stringify({ filecode: filecode, device: 'web', codecs: [] })
      });
      if (resp) {
        try {
          const data = JSON.parse(resp);
          let v = data.streaming_url || data.file || data.url || data.source || data.link;
          if (!v && data.sources && data.sources[0]) v = data.sources[0].file || data.sources[0].src;
          if (v && !esImagen(v)) return enlace(absoluta(v, actual), 'Vidara', cabeceras);
        } catch (e) {}
      }
    }

    const htmlLimpio = html.replace(/\\\//g, '/');
    let video = buscarVideo(htmlLimpio, actual);
    if (!video) {
      const scripts = htmlLimpio.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
      for (const s of scripts) {
        const inner = s.replace(/^<script[^>]*>|<\/script>$/gi, '');
        if (!inner.includes('jwplayer')) continue;
        const setupIdx = inner.search(/\.setup\s*\(/);
        if (setupIdx === -1) continue;
        const setupJson = extraerBloque(inner, setupIdx);
        const fm = setupJson && setupJson.match(/["']?(?:file|src)["']?\s*:\s*["']([^"']+)["']/i);
        if (fm && !esImagen(fm[1])) { video = fm[1]; break; }
      }
    }
    return video ? enlace(absoluta(video, actual), 'Vidara', cabeceras) : [];
  }

  // ── Doodstream (con respaldo vía playmogo → Vidara) ──
  async function resolverDood(url, referer) {
    const id = url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop();

    const candidatos = [url.replace(/\/(d|f|download)\//, '/e/')];
    for (const d of ['d0000d.com', 'myvidplay.com', 'ds2play.com']) {
      const e = `https://${d}/e/${id}`;
      if (dominio(e) !== dominio(url)) candidatos.push(e);
    }

    for (const embed of candidatos) {
      const html = await texto(embed, { headers: { Referer: referer || embed } });
      if (!html) continue;
      const m = html.match(/\/pass_md5\/[\w-]+\/([\w-]+)/);
      if (!m) continue;
      const base = origen(embed);
      const prefijo = await texto(base + m[0], { headers: { Referer: embed } });
      if (!/^https?:/.test(prefijo)) continue;
      let azar = '';
      const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      for (let i = 0; i < 10; i++) azar += letras[Math.floor(Math.random() * letras.length)];
      return enlace(`${prefijo.trim()}${azar}?token=${m[1]}&expiry=${Date.now()}`, 'Doodstream', { Referer: `${base}/`, 'User-Agent': UA });
    }

    return resolverVidara(`https://playmogo.com/e/${id}`, referer);
  }

  // ── Otros servidores ──
  async function resolverUqload(url, referer) {
    const embed = /embed-/.test(url) ? url : url.replace(/\.(?:com|co|io|net|ws|to|cx|bz)\/(?!embed-)/, (s) => `${s}embed-`);
    const html = await texto(embed, { headers: { Referer: referer || embed } });
    const m = html.match(/sources\s*:\s*\[\s*["']([^"']+)["']/);
    return enlace(m && m[1], 'Uqload', { Referer: `${origen(embed)}/`, 'User-Agent': UA });
  }

  async function resolverOkru(url) {
    const id = (url.match(/(?:videoembed|video)\/([\d-]+)/) || [])[1];
    if (!id) return [];
    const html = await texto(`https://ok.ru/videoembed/${id}`);
    const m = html.match(/data-options=(["'])(\{[\s\S]+?\})\1/);
    if (!m) return [];
    const cab = { Referer: 'https://ok.ru/', 'User-Agent': UA };
    try {
      const opciones = JSON.parse(entidades(m[2]));
      if (opciones.isExternalPlayer) return [];
      const variables = opciones.flashvars || {};
      let meta = null;
      if (variables.metadata) meta = typeof variables.metadata === 'string' ? JSON.parse(variables.metadata) : variables.metadata;
      else if (variables.metadataUrl) {
        meta = await json(decodeURIComponent(variables.metadataUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://ok.ru/' },
          body: variables.location ? `st.location=${encodeURIComponent(variables.location)}` : ''
        });
      }
      if (!meta) return [];
      const orden = { ultra: '4K', quad: '1440p', full: '1080p', hd: '720p', sd: '480p', low: '360p', lowest: '240p', mobile: '144p' };
      const videos = (meta.videos || []).filter((v) => v.url && orden[v.name]);
      if (videos.length) {
        videos.sort((a, b) => pesoOk(orden[b.name]) - pesoOk(orden[a.name]));
        return enlace(absoluta(videos[0].url, 'https://ok.ru/'), 'OK.ru', cab, orden[videos[0].name]);
      }
      return enlace(meta.hlsManifestUrl || meta.ondemandHls, 'OK.ru', cab);
    } catch (e) { return []; }
  }

  async function resolverVidmoly(url) {
    const html = await texto(url, { headers: { Referer: 'https://vidmoly.me/' } });
    const marco = html.match(/<iframe[^>]+src=["']([^"']*(?:embed-|vidmoly\.biz)[^"']*)["']/i);
    const pagina = marco ? await texto(absoluta(marco[1], url), { headers: { Referer: url } }) : html;
    const m = pagina.match(/file\s*:\s*["']([^"']+)["']/);
    return enlace(m && m[1], 'VidMoly', { Referer: 'https://vidmoly.me/', 'User-Agent': UA });
  }

  async function resolverSendvid(url) {
    const html = await texto(url);
    const m = html.match(/property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) || html.match(/<source[^>]+src=["']([^"']+)["']/i);
    return enlace(m && m[1], 'Sendvid', { Referer: url, 'User-Agent': UA });
  }

  async function resolverYourupload(url) {
    const html = await texto(url.replace('/watch/', '/embed/'));
    const m = html.match(/file\s*:\s*['"]([^'"]+)['"]/) || html.match(/property=["']og:video["'][^>]+content=["']([^"']+)["']/i);
    return enlace(m && m[1], 'YourUpload', { Referer: 'https://www.yourupload.com/', 'User-Agent': UA });
  }

  async function resolverPixeldrain(url) {
    const id = (url.match(/\/(?:u|l|api\/file)\/([\w-]+)/) || [])[1];
    return id ? enlace(`https://pixeldrain.com/api/file/${id}?download`, 'Pixeldrain', { 'User-Agent': UA }) : [];
  }

  async function resolverDailymotion(url) {
    const id = (url.match(/(?:video\/|video=|dai\.ly\/)([a-z0-9]+)/i) || [])[1];
    if (!id) return [];
    const meta = await json(`https://www.dailymotion.com/player/metadata/video/${id}`);
    const auto = meta && meta.qualities && meta.qualities.auto && meta.qualities.auto[0];
    return enlace(auto && auto.url, 'Dailymotion', { 'User-Agent': UA });
  }

  // ── Tabla de servidores ──
  const SERVIDORES = [
    [/vidara\.|mxzhxco8dft/i, 'Vidara', (u, r) => resolverVidara(u, r)],
    [/streamwish|swdyu|wishembed|playerwish|strwish|swhoi|wishfast|sfastwish|hlswish|embedwish|awish|dwish|streamhg|hglink|habetar|mwish|kswplayer|swiftplayers|hanerix|cdnwish|flaswish|obeywish|davioad|jodwish|ghbrisk|dhcplay|iplayerhls|cybervynx|dumbalag|wishonly|asnwish|nekowish|streamhls|vibuxer/i, 'StreamWish', (u, r) => resolverStreamwish(u, r)],
    [/dood|d0000d|d000d|ds2play|ds2video|dooood|doods|do0od|vidply|all3do|dsvplay|myvidplay|playmogo|do7go/i, 'Doodstream', (u, r) => resolverDood(u, r)],
    [/uqload/i, 'Uqload', (u, r) => resolverUqload(u, r)],
    [/ok\.ru|odnoklassniki/i, 'OK.ru', (u) => resolverOkru(u)],
    [/vidmoly/i, 'VidMoly', (u) => resolverVidmoly(u)],
    [/sendvid/i, 'Sendvid', (u) => resolverSendvid(u)],
    [/yourupload/i, 'YourUpload', (u) => resolverYourupload(u)],
    [/pixeldrain/i, 'Pixeldrain', (u) => resolverPixeldrain(u)],
    [/dailymotion|dai\.ly/i, 'Dailymotion', (u) => resolverDailymotion(u)],
    [/mp4upload/i, 'Mp4Upload', (u, r) => resolverGenerico(u.replace(/mp4upload\.com\/(?!embed-)/, 'mp4upload.com/embed-'), 'Mp4Upload', r, 1)],
    [/voe\.sx|voe-unblock|voeunbl|v-o-e|voe\./i, 'Voe', (u, r) => resolverVoe(u, r)],
    [/vidhide|filelions|ryderjet|dintezuvio|mivalyo|dhtpre|peytonepre|smoothpre|louishide|lylxan|movearnpre|kinoger|alions|azipcdn|nikaplayer|fviplions|niikaplayerr|callistanise|dinisglows|dingtezuni|minochinos|taylorplayer/i, 'VidHide', (u, r) => resolverVidhide(u, r)],
    [/vimeos/i, 'Vimeos', (u, r) => resolverVimeos(u, r)],
    [/fastream/i, 'Fastream', (u, r) => resolverEmpaquetado(u, 'Fastream', r)],
    [/mixdro*p|mxdrop|m1xdrop|mdbekjwqa|mdfx9dc8n|mdzsmutpcvykb|mdy48tn97/i, 'Mixdrop', (u, r) => resolverMixdrop(u, r)],
    [/streamtape|strtape|strcloud|strtpe|streamta\.(?:pe|site)|stape\.fun|tapewithadblock|tapeadvertisement|shavetape|antiadtape|adblockeronstape|streamadblockplus|adblockstrtech|tapeblocker/i, 'Streamtape', (u, r) => resolverStreamtape(u, r)]
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

  // ── Entrada ──
  async function resolve(link, log, env) {
    _nf = env && env.nativeFetch;
    if (typeof _nf !== 'function') throw new Error('Falta nativeFetch');
    if (!window.CryptoJS) throw new Error('Falta crypto-js');
    inicio = Date.now(); caidos.clear();

    const t0 = Date.now();
    const url = String(link.url || '');
    let u;
    try { u = new URL(url); } catch (_) { return { ok: false, ms: 0, status: 0 }; }

    const LANDING = /^(?:megaup\.net|1fichier\.com|rapidgator\.net|katfile\.com|nitroflare\.com|ddownload\.com|turbobit\.net|uploaded\.net|filefactory\.com|mediafire\.com)$/i;
    const esLanding = LANDING.test(u.hostname) && u.pathname.split('/').filter(Boolean).length >= 2;

    if (/\.(m3u8|mp4|mkv)$/i.test(u.pathname) && !esLanding) {
      const cab = Object.assign({ 'User-Agent': UA, Referer: u.origin + '/' }, link.headers || {});
      return { ok: true, ms: Date.now() - t0, status: 200, play: { url, kind: /\.m3u8$/i.test(u.pathname) ? 'm3u8' : 'mp4', headers: cab } };
    }

    const referer = link.referer || (link.headers && link.headers.Referer) || '';
    let lista = [];
    try { lista = await conLimite(resolver(url, referer), 45000, []); } catch (e) {}

    lista = (lista || []).filter((s) => s && s.url);
    if (!lista.length) return { ok: false, ms: Date.now() - t0, status: 0 };
    lista.sort((a, b) => pesoCalidad(b.calidad) - pesoCalidad(a.calidad));
    const s = lista[0];
    return {
      ok: true, ms: Date.now() - t0, status: 200,
      play: { url: s.url, kind: /\.(mp4|mkv)(\?|#|$)|\/get_video\?|pixeldrain\.com\/api\/file|[?&]expiry=\d/i.test(s.url) ? 'mp4' : 'm3u8', headers: s.headers || {} }
    };
  }

  window.SSExtractors = { version: VERSION, resolve: resolve, custom: [] };
})();
