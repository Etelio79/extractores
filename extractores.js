(function () {
  'use strict';
  const VERSION = '1.1.0'; // Subí la versión para forzar la actualización en la app
  let nativeFetch = null;

  // ════════════════════════════════════════════════════════════════════════
  // TUS EXTRACTORES PERSONALIZADOS (Ya integrados)
  // ════════════════════════════════════════════════════════════════════════
  const CUSTOM = (() => {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

    const _atob = s => { try { return atob(String(s || '').replace(/\s+/g, '')) } catch (_) { return '' } };
    const _abs  = (u, b) => { try { return new URL(u, b).href } catch (_) { return '' } };
    const _host = u => { try { return new URL(u).hostname.toLowerCase() } catch (_) { return '' } };
    const _orig = u => { try { return new URL(u).origin } catch (_) { return '' } };
    const _safe = h => (h && typeof h === 'object') ? h : {};
    const _ref  = link => (_safe(link.headers).Referer || _safe(link.headers).referer || link.url);

    const _unpackAll = h => {
      const out = [];
      const patron = /eval\(function\(p,a,c,k,e,[a-z]\)\{[\s\S]*?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/g;
      const digitos = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let m;
      while ((m = patron.exec(String(h || '')))) {
        const base = parseInt(m[2], 10);
        const palabras = m[4].split('|');
        const valor = t => { let n = 0; for (const ch of t) { const v = digitos.indexOf(ch); if (v < 0 || v >= base) return -1; n = n * base + v; } return n; };
        out.push(m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, t => { const i = valor(t); return i >= 0 && i < palabras.length && palabras[i] ? palabras[i] : t; }));
      }
      return out.join('\n');
    };

    const _SHA_K = Int32Array.from([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
    const _SHA_M = new Int32Array(64);
    const _SHA_IV = Int32Array.from([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);

    const _sha256 = txt => {
      const l = txt.length, b = ((l + 9 + 63) >> 6) << 4, w = new Int32Array(b);
      for (let i = 0; i < l; i++) w[i >> 2] |= (txt.charCodeAt(i) & 255) << (24 - (i & 3) * 8);
      w[l >> 2] |= 0x80 << (24 - (l & 3) * 8); w[b - 1] = l * 8;
      let h0 = _SHA_IV[0], h1 = _SHA_IV[1], h2 = _SHA_IV[2], h3 = _SHA_IV[3], h4 = _SHA_IV[4], h5 = _SHA_IV[5], h6 = _SHA_IV[6], h7 = _SHA_IV[7];
      const m = _SHA_M;
      for (let bl = 0; bl < b; bl += 16) {
        for (let i = 0; i < 16; i++) m[i] = w[bl + i] | 0;
        for (let i = 16; i < 64; i++) {
          const x = m[i - 15], y = m[i - 2];
          m[i] = (m[i - 16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + m[i - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
        }
        let a = h0, bb = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let i = 0; i < 64; i++) {
          const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
          const t1 = (h + S1 + ((e & f) ^ (~e & g)) + _SHA_K[i] + m[i]) | 0;
          const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
          const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
          h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
      }
      return [h0, h1, h2, h3, h4, h5, h6, h7];
    };

    const _comprimirSha = (estado, bloque, salida) => {
      const m = _SHA_M;
      for (let i = 0; i < 16; i++) m[i] = bloque[i];
      for (let i = 16; i < 64; i++) {
        const x = m[i - 15], y = m[i - 2];
        m[i] = (m[i - 16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + m[i - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      }
      let a = estado[0], b = estado[1], c = estado[2], d = estado[3], e = estado[4], f = estado[5], g = estado[6], h = estado[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + _SHA_K[i] + m[i]) | 0;
        const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      salida[0] = (estado[0] + a) | 0; salida[1] = (estado[1] + b) | 0; salida[2] = (estado[2] + c) | 0; salida[3] = (estado[3] + d) | 0;
      salida[4] = (estado[4] + e) | 0; salida[5] = (estado[5] + f) | 0; salida[6] = (estado[6] + g) | 0; salida[7] = (estado[7] + h) | 0;
    };

    const _shaBytes = bytes => {
      const l = bytes.length, total = ((l + 9 + 63) >> 6) << 4, w = new Int32Array(total);
      for (let i = 0; i < l; i++) w[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
      w[l >> 2] |= 0x80 << (24 - (l & 3) * 8); w[total - 1] = l * 8;
      const estado = Int32Array.from(_SHA_IV);
      for (let i = 0; i < total; i += 16) _comprimirSha(estado, w.subarray(i, i + 16), estado);
      const s = [];
      for (let i = 0; i < 32; i++) s.push((estado[i >> 2] >>> (24 - (i & 3) * 8)) & 255);
      return s;
    };

    const _pbkdf2 = (clave, sal, iteraciones, largo) => {
      const k = clave.length > 64 ? _shaBytes(clave) : clave;
      const interno = new Int32Array(16), externo = new Int32Array(16);
      for (let i = 0; i < 64; i++) {
        const v = i < k.length ? k[i] : 0;
        interno[i >> 2] |= (v ^ 0x36) << (24 - (i & 3) * 8);
        externo[i >> 2] |= (v ^ 0x5c) << (24 - (i & 3) * 8);
      }
      const estadoI = new Int32Array(8), estadoE = new Int32Array(8);
      _comprimirSha(_SHA_IV, interno, estadoI);
      _comprimirSha(_SHA_IV, externo, estadoE);
      const bloque = new Int32Array(16), medio = new Int32Array(8), u = new Int32Array(8);
      bloque[8] = 0x80000000; bloque[15] = 768;
      const salida = [];
      for (let n = 1; salida.length < largo; n++) {
        const primero = sal.concat([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
        const total = ((primero.length + 9 + 63) >> 6) << 4;
        const w = new Int32Array(total);
        for (let i = 0; i < primero.length; i++) w[i >> 2] |= primero[i] << (24 - (i & 3) * 8);
        w[primero.length >> 2] |= 0x80 << (24 - (primero.length & 3) * 8);
        w[total - 1] = (primero.length + 64) * 8;
        const estado = Int32Array.from(estadoI);
        for (let i = 0; i < total; i += 16) _comprimirSha(estado, w.subarray(i, i + 16), estado);
        for (let i = 0; i < 8; i++) bloque[i] = estado[i];
        _comprimirSha(estadoE, bloque, u);
        const t = Int32Array.from(u);
        for (let it = 1; it < iteraciones; it++) {
          for (let i = 0; i < 8; i++) bloque[i] = u[i];
          _comprimirSha(estadoI, bloque, medio);
          for (let i = 0; i < 8; i++) bloque[i] = medio[i];
          _comprimirSha(estadoE, bloque, u);
          for (let i = 0; i < 8; i++) t[i] ^= u[i];
        }
        for (let i = 0; i < 32 && salida.length < largo; i++) salida.push((t[i >> 2] >>> (24 - (i & 3) * 8)) & 255);
      }
      return salida;
    };

    const _hexABytes = hex => { const s = []; for (let i = 0; i + 1 < hex.length; i += 2) s.push(parseInt(hex.slice(i, i + 2), 16)); return s; };
    const _bytesAHex = bytes => { let t = ''; for (const b of bytes) t += (b < 16 ? '0' : '') + b.toString(16); return t; };

    const _b64Bytes = b64 => {
      try {
        const s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
        const pad = s + '='.repeat((4 - s.length % 4) % 4);
        const bin = atob(pad);
        const a = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
        return a;
      } catch (_) { return new Uint8Array() }
    };

    const _aesCbcDec = (ctBytes, keyStr, ivStr) => {
      try {
        const ctWord = CryptoJS.lib.WordArray.create(ctBytes);
        const key = CryptoJS.enc.Utf8.parse(String(keyStr).padEnd(16, '\0').slice(0, 16));
        const iv = CryptoJS.enc.Utf8.parse(String(ivStr).padEnd(16, '\0').slice(0, 16));
        const pt = CryptoJS.AES.decrypt({ ciphertext: ctWord }, key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
        return pt.toString(CryptoJS.enc.Utf8);
      } catch (_) { return null }
    };

    const _aesCtrDec = (keyBytes, ivBytes, payloadBytes) => {
      try {
        if (ivBytes.length !== 12 || payloadBytes.length <= 16) return null;
        const body = payloadBytes.slice(0, payloadBytes.length - 16);
        const clave = CryptoJS.lib.WordArray.create(keyBytes);
        const iv = CryptoJS.lib.WordArray.create(ivBytes);
        const contador = iv.clone().concat(CryptoJS.lib.WordArray.create([2], 4));
        const cifrado = CryptoJS.lib.WordArray.create(body);
        return CryptoJS.AES.decrypt({ ciphertext: cifrado }, clave, {
          iv: contador, mode: CryptoJS.mode.CTR, padding: CryptoJS.pad.NoPadding
        }).toString(CryptoJS.enc.Utf8);
      } catch (_) { return null }
    };

    const _findVideo = (txt, base) => {
      const t = String(txt || '').replace(/\\\//g, '/');
      const links = t.match(/links\s*=\s*(\{[^}]+\})/);
      if (links) {
        try {
          const o = JSON.parse(links[1].replace(/'/g, '"'));
          const v = o.hls4 || o.hls3 || o.hls2 || o.hls;
          if (v) { const u = _abs(v, base); if (u) return { url: u, kind: /\.m3u8/i.test(u) ? 'm3u8' : 'mp4' }; }
        } catch (_) {}
      }
      const m = t.match(/["']?hls[24]?["']?\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i)
        || t.match(/file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i)
        || t.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i)
        || t.match(/["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/i);
      if (!m) return null;
      const u = _abs(m[1], base);
      return u ? { url: u, kind: /\.m3u8/i.test(u) ? 'm3u8' : 'mp4' } : null;
    };

    const _fetch = async (env, url, headers, opts) => {
      opts = opts || {};
      try {
        const r = await env.nativeFetch(url, { ...opts, headers: headers || {} });
        const text = await r.text();
        return { ok: !!r.ok, status: r.status, url: r.url || url, text, headers: r.headers,
                 json: () => { try { return JSON.parse(text) } catch (_) { return null } } };
      } catch (e) {
        if (typeof __native_fetch === 'function') {
          try {
            const cabeceras = {};
            for (const k of Object.keys(headers || {})) cabeceras[k] = String(headers[k]);
            const cuerpo = opts.body == null ? '' : String(opts.body);
            const crudo = await __native_fetch(url, String(opts.method || 'GET').toUpperCase(), JSON.stringify(cabeceras),
              cuerpo === '' ? 'none' : 'text', cuerpo, true);
            const d = JSON.parse(crudo);
            const text = d.body || '';
            return { ok: !!d.ok, status: d.status, url: d.url || url, text,
                     headers: { get: n => (d.headers || {})[String(n).toLowerCase()] || null },
                     json: () => { try { return JSON.parse(text) } catch (_) { return null } } };
          } catch (err) {}
        }
        return { ok: false, status: 0, url, text: '', headers: { get: () => null }, json: () => null };
      }
    };

    // CORRECCIÓN 1: Se eliminó "x !== (link._self)" que causaba problemas.
    const _browse = async (link, log, env, depth) => {
      depth = depth || 0;
      if (depth > 3) return null;
      const ref = _ref(link);
      const h = Object.assign({ 'User-Agent': UA, 'Referer': ref }, _safe(link.headers));
      const r = await _fetch(env, link.url, h);
      if (!r.ok) { log('  HTTP ' + r.status); return null; }
      const code = _unpackAll(r.text) + '\n' + r.text;
      const v = _findVideo(code, r.url);
      if (v) return _mk(v.url, v.kind, ref);
      const fr = r.text.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (fr) {
        const next = _abs(fr[1], r.url);
        if (next && next !== link.url) {
          try {
            const u = new URL(next);
            const sub = EX.find(x => x.match(u));
            if (sub) {
              try {
                const subr = await sub.run({ url: next, headers: { Referer: r.url } }, log, env);
                if (subr) return subr;
              } catch (_) {}
            }
          } catch (_) {}
          return _browse({ url: next, headers: { Referer: r.url } }, log, env, depth + 1);
        }
      }
      return null;
    };

    const _mk = (url, kind, referer) => ({
      url, kind: kind || 'm3u8',
      headers: { 'User-Agent': UA, 'Referer': referer || url }
    });

    const _voeDecode = (cifrado, ruidos) => {
      let t = cifrado.replace(/[a-zA-Z]/g, c => {
        const tope = c <= 'Z' ? 90 : 122;
        const n = c.charCodeAt(0) + 13;
        return String.fromCharCode(n <= tope ? n : n - 26);
      });
      for (const r of ruidos || ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) t = t.split(r).join('');
      const paso = _atob(t); if (!paso) return null;
      let movido = ''; for (let i = 0; i < paso.length; i++) movido += String.fromCharCode(paso.charCodeAt(i) - 3);
      const final = _atob(movido.split('').reverse().join(''));
      try { return JSON.parse(final) } catch (_) { return null }
    };

    const _COMP_RPM = '\nfunction re(n,e){const t=sa();return re=function(s,i){return s=s-109,t[s]},re(n,e)}\nfunction p(...g){return String.fromCodePoint(...g)}\nfunction v(g,b){return g.codePointAt(b)||0}\nfunction S(g){return __utf8Encode(g)}\nT=()=>{const g=re,b=window[g(263)][g(585)],P="10",k=110,U=1;let M="";const B=v("\u1D5F")[g(321)]()[g(199)]("");for(let de=0;de<B.length;de++)M+=p(P+B[de]);M+=p(v(b,P/10)),M+=M[g(336)](1,3),M+=p(k,k-1,k+7);const se=g(370)[g(199)]("");return M+=p(se[3]+se[2],se[1]+se[2]),M+=p(se[0]*U+U+se[3],se[0]*U+U+se[3]),M+=p(se[3]*P+se[3]*U,se[g(580)]()[g(364)]("")[g(336)](0,2)),S(M)}\nC=()=>{const g=re,b=window[g(263)][g(585)],P=b+"//",k=window.location[g(217)],U=b[g(316)]*P[g(316)],M=1;let B="";for(let me=M;me<10;me++)B+=p(me+U);let se="";se=M+se+M+se+M;const de=se[g(316)]*v(k),Ie=se*M+b.length,I=Ie+4,j=v(b,M),oe=j*M-2;return B+=p(U,se,de,Ie,I,j,oe),S(B)}\n';
    const _codigoRpm = {};
    const _bytesUtf8 = t => {
      const b = [];
      for (let i = 0; i < t.length; i++) {
        const c = t.codePointAt(i);
        if (c > 65535) i++;
        if (c < 128) b.push(c);
        else if (c < 2048) b.push(192 | (c >> 6), 128 | (c & 63));
        else if (c < 65536) b.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
        else b.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63));
      }
      return b;
    };
    const _hexDe = b => b.map(x => (`0${(x & 255).toString(16)}`).slice(-2)).join('');
    const _clavesRpm = async (env, base, hash) => {
      if (!_codigoRpm[base]) {
        const html = await _fetch(env, `${base}/`).then(r => r.text).catch(() => '');
        const ruta = (html.match(/src=["'](\/assets\/index-[\w-]+\.js)["']/) || [])[1];
        if (!ruta) return null;
        const js = await _fetch(env, `${base}${ruta}`, { Referer: `${base}/` }).then(r => r.text).catch(() => '');
        const ini = js.indexOf('function sa(){'); if (ini < 0) return null;
        const fin = js.slice(ini).match(/}\)\(sa,\s*\d+\s*\);/); if (!fin) return null;
        _codigoRpm[base] = js.slice(ini, ini + fin.index + fin[0].length) + _COMP_RPM;
      }
      try {
        const v = { location: { protocol: 'https:', hash: `#${hash}` } };
        const r = new Function('window', '__utf8Encode', 'parseInt', 'String',
          `${_codigoRpm[base]}\nreturn { T: T(), C: C() };`)(v, _bytesUtf8, parseInt, String);
        return { clave: CryptoJS.enc.Hex.parse(_hexDe(r.T.slice(0, 16))), vector: CryptoJS.enc.Hex.parse(_hexDe(r.C.slice(0, 16))) };
      } catch (_) { return null }
    };
    const _abrirHexRpm = (cifrado, clave, vector) => {
      try {
        const c = CryptoJS.AES.decrypt({ ciphertext: CryptoJS.enc.Hex.parse(cifrado) }, clave, {
          iv: vector, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7
        }).toString(CryptoJS.enc.Utf8);
        return c && c.includes('{') ? c : '';
      } catch (_) { return '' }
    };
    const _listaViva = async (env, url, headers) => {
      const m = await _fetch(env, url, headers).then(r => r.text).catch(() => '');
      if (!/#EXTM3U/i.test(m)) return false;
      const hijo = m.split(/\r?\n/).find(l => l.trim() && !l.startsWith('#'));
      if (!hijo) return true;
      return /#EXTM3U/i.test(await _fetch(env, _abs(hijo.trim(), url), headers).then(r => r.text).catch(() => ''));
    };

    const EX = [];
    const add = (name, match, run) => { const e = { name, match, run }; EX.push(e); return e; };

    // ---------------- VOE ----------------
    add('Voe',
      u => /voe\.sx|voe-unblock|voeunbl|voeun|v-o-e|voe\./i.test(u.hostname),
      async (link, log, env) => {
        for (let pasada = 0; pasada < 2; pasada++) {
          let url = link.url, html = '', cookies = '';
          for (let i = 0; i < 3; i++) {
            const headers = { 'User-Agent': UA, 'Referer': i === 0 ? _ref(link) : url };
            if (cookies) headers['Cookie'] = cookies;
            const r = await _fetch(env, url, headers);
            if (!r.ok) return null;
            try { const sc = r.headers && r.headers.get ? r.headers.get('set-cookie') : ''; if (sc) cookies = sc.split(/,(?=[^;]+=)|\n/).map(c => c.split(';')[0].trim()).filter(Boolean).join('; '); } catch (_) {}
            html = r.text;
            const jump = html.length < 4000 && html.match(/window\.location\.href\s*=\s*['"]([^"']+)['"]/i);
            if (!jump) { url = r.url || url; break; }
            url = _abs(jump[1], url);
          }
          if (!html) return null;
          const hayAltcha = /altcha-widget/i.test(html);
          const hayJson = /<script type="application\/json">/i.test(html);
          if (hayAltcha && !hayJson && pasada === 0) {
            log('  Altcha detectado');
            const ficha = (html.match(/<input[^>]+name=["']_token["'][^>]*>/i) || [''])[0];
            const token = ((ficha.match(/value=["']([^"']*)["']/i) || [])[1] || '').trim();
            const widget = (html.match(/<altcha-widget\b[^>]*>/i) || [''])[0];
            const challengeUrl = ((widget.match(/\bchallenge(?:-?url)?=["']([^"']+)["']/i) || [])[1] || '').trim();
            if (!token || !challengeUrl) return null;
            let reto = challengeUrl.startsWith('{') ? challengeUrl : '';
            if (!reto) {
              const r = await _fetch(env, _abs(challengeUrl, url), { Referer: url, Accept: 'application/json', ...(cookies ? { Cookie: cookies } : {}) });
              if (!r.ok) return null;
              reto = r.text;
              const sc = r.headers && r.headers.get ? r.headers.get('set-cookie') : '';
              if (sc) cookies = [cookies, sc].filter(Boolean).join('; ');
            }
            const dato = (t, k) => { const m = t.match(new RegExp(`"${k}"\\s*:\\s*(?:"([^"]*)"|(\\d+))`)); return m ? (m[1] !== undefined ? m[1].replace(/\\\//g, '/') : m[2]) : ''; };
            const algo = dato(reto, 'algorithm');
            if (algo && !/pbkdf2\/sha-?256/i.test(algo)) return null;
            const nonce = dato(reto, 'nonce'), sal = dato(reto, 'salt');
            const prefijo = (dato(reto, 'keyPrefix') || '').toLowerCase();
            const costo = parseInt(dato(reto, 'cost'), 10) || 0;
            const keyLen = parseInt(dato(reto, 'keyLength'), 10) || 32;
            if (!/^[0-9a-f]+$/i.test(nonce) || !/^[0-9a-f]+$/i.test(sal) || !/^[0-9a-f]+$/.test(prefijo) || costo <= 0) return null;
            const nativo = typeof __crypto_pbkdf2_hex === 'function';
            const salB = _hexABytes(sal), nonceB = _hexABytes(nonce);
            let sol = null;
            const comienzo = Date.now(); const tope = 8000;
            for (let c = 0; c < 50000; c++) {
              if (Date.now() - comienzo > tope) break;
              const cuenta = [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
              let clave = '';
              try {
                clave = nativo
                  ? String(__crypto_pbkdf2_hex(nonce + _bytesAHex(cuenta), sal, costo, keyLen * 8, 'SHA256') || '').toLowerCase()
                  : _bytesAHex(_pbkdf2(nonceB.concat(cuenta), salB, costo, keyLen));
              } catch (_) { return null; }
              if (clave.startsWith(prefijo)) { sol = { c, clave }; break; }
            }
            if (!sol) return null;
            const params = reto.match(/"parameters"\s*:\s*(\{[^{}]*\})/);
            const firma = (reto.match(/"signature"\s*:\s*"([^"]+)"/) || [])[1];
            if (!params || !firma) return null;
            const carga = btoa(`{"challenge":{"parameters":${params[1]},"signature":"${firma}"},"solution":{"counter":${sol.c},"derivedKey":"${sol.clave}","time":1}}`);
            let ok = false;
            for (const v of [encodeURIComponent(carga), encodeURIComponent(encodeURIComponent(carga))]) {
              const rr = await _fetch(env, url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url, ...(cookies ? { Cookie: cookies } : {}) },
                body: `_token=${encodeURIComponent(token)}&access=0&altcha=${v}`
              });
              if (rr.ok && /<script type="application\/json">/i.test(rr.text)) { ok = true; html = rr.text; break; }
            }
            if (!ok) return null;
          }
          const block = html.match(/<script type="application\/json">([\s\S]*?)<\/script>(?:\s*<script[^>]*src=["']([^"']+)["'])?/i);
          if (block) {
            let enc = '';
            try { const d = JSON.parse(block[1].trim()); enc = Array.isArray(d) ? d[0] : d; } catch (_) {}
            let datos = enc ? _voeDecode(enc) : null;
            if (!datos && enc && block[2]) {
              const c = await _fetch(env, _abs(block[2], url), { Referer: url }).then(r => r.text).catch(() => '');
              const l = (c.match(/\[(?:\s*'[^']{1,10}'\s*,?){4,12}\]/) || c.match(/\[(?:\s*"[^"]{1,10}"\s*,?){4,12}\]/) || [])[0];
              if (l) datos = _voeDecode(enc, (l.match(/['"]([^'"]{1,10})['"]/g) || []).map(x => x.slice(1, -1)));
            }
            const v = datos && (datos.source || datos.direct_access_url);
            if (v) { log('  Voe JSON'); return _mk(v, 'm3u8', url); }
          }
          const direct = html.match(/['"]hls['"]\s*:\s*['"]([^"']+)['"]/i);
          if (direct) {
            const v = /^aHR0/.test(direct[1]) ? _atob(direct[1]) : direct[1];
            return _mk(v, 'm3u8', url);
          }
          if (!hayAltcha) return _browse({ url, headers: { Referer: _ref(link) } }, log, env);
          return null;
        }
        return null;
      }
    );

    // ---------------- StreamWish ----------------
    add('StreamWish',
      u => /streamwish|swdyu|wishembed|playerwish|strwish|swhoi|wishfast|sfastwish|hlswish|embedwish|awish|dwish|streamhg|hglink|habetar|mwish|kswplayer|swiftplayers|hanerix|cdnwish|flaswish|obeywish|davioad|jodwish|ghbrisk|dhcplay|iplayerhls|cybervynx|dumbalag|wishonly|streamwishplayer|asnwish|nekowish|neko-stream|multimovies|streamhls|vibuxer/i.test(u.hostname),
      async (link, log, env) => {
        const probar = async (url, referer) => {
          const r = await _fetch(env, url, { 'User-Agent': UA, 'Referer': referer || url });
          if (!r.ok) return null;
          const code = _unpackAll(r.text) + '\n' + r.text;
          const links = code.match(/links\s*=\s*(\{[^}]+\})/);
          if (links) {
            try {
              const o = JSON.parse(links[1].replace(/'/g, '"'));
              const v = o.hls4 || o.hls3 || o.hls2 || o.hls;
              if (v) return _mk(_abs(v, url), 'm3u8', _orig(url) + '/');
            } catch (_) {}
          }
          const v = _findVideo(code, url);
          if (v) return _mk(v.url, v.kind, _orig(url) + '/');
          return null;
        };
        const directo = await probar(link.url, _ref(link));
        if (directo) { log('  directo'); return directo; }
        const id = link.url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop().replace(/\.html$/, '');
        const mirrors = [`https://hglink.to/e/${id}`, `https://streamwish.to/e/${id}`, `https://vibuxer.com/e/${id}`]
          .filter(e => _host(e) !== _host(link.url));
        for (const m of mirrors) {
          const r = await probar(m, _ref(link));
          if (r) { log('  mirror ' + _host(m)); return r; }
        }
        return _browse(link, log, env);
      }
    );

    // ---------------- VidHide ----------------
    add('VidHide',
      u => /vidhide|filelions|ryderjet|dintezuvio|mivalyo|dhtpre|peytonepre|smoothpre|vidhidepre|louishide|lylxan|movearnpre|kinoger|alions|azipcdn|nikaplayer|fviplions|vidhidevip|niikaplayerr|callistanise|dinisglows|vidhideplus|vidhidehub|dingtezuni|minochinos/i.test(u.hostname),
      (link, log, env) => _browse(link, log, env)
    );

    // ---------------- Doodstream ----------------
    add('Doodstream',
      u => /dood|d0000d|d000d|ds2play|ds2video|dooood|doods|do0od|vide0|vidply|all3do|dsvplay|myvidplay|playmogo|do7go/i.test(u.hostname),
      async (link, log, env) => {
        const embed = link.url.replace(/\/(d|f|download)\//, '/e/');
        const r = await _fetch(env, embed, { 'Referer': embed, 'User-Agent': UA });
        const m = r.text.match(/\/pass_md5\/[\w-]+\/([\w-]+)/);
        if (!m) return null;
        const base = _orig(embed);
        const pref = await _fetch(env, base + m[0], { 'Referer': embed, 'User-Agent': UA });
        if (!/^https?:/.test(pref.text)) return null;
        let rand = '';
        for (let i = 0; i < 10; i++) rand += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)];
        return _mk(`${pref.text}${rand}?token=${m[1]}&expiry=${Date.now()}`, 'mp4', base + '/');
      }
    );

    // ---------------- Streamtape ----------------
    add('Streamtape',
      u => /streamtape|strtape|stape|tapecontent|streamta\.pe|strcloud|streamadblock/i.test(u.hostname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url.replace('/v/', '/e/'), { 'User-Agent': UA });
        const m = r.text.match(/getElementById\(['"](?:robotlink|ideoooolink|botlink)['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\(?['"]([^'"]+)['"]\)?(?:\.substring\((\d+)\))?(?:\.substring\((\d+)\))?/);
        if (!m) return null;
        let rest = m[2];
        if (m[3]) rest = rest.substring(+m[3]);
        if (m[4]) rest = rest.substring(+m[4]);
        return _mk(('https:' + m[1] + rest + '&stream=1').replace('https:https:', 'https:'), 'mp4', 'https://streamtape.com/');
      }
    );

    // ---------------- Uqload ----------------
    add('Uqload',
      u => /uqload|uqloads/i.test(u.hostname),
      async (link, log, env) => {
        const embed = /embed-/.test(link.url) ? link.url : link.url.replace(/\.(?:com|co|io|net|ws|to|cx|bz)\/(?!embed-)/, s => `${s}embed-`);
        const r = await _fetch(env, embed, { 'Referer': embed, 'User-Agent': UA });
        const m = r.text.match(/sources\s*:\s*\[\s*["']([^"']+)["']/);
        return m ? _mk(m[1], 'mp4', _orig(embed) + '/') : null;
      }
    );

    // ---------------- OK.ru ----------------
    add('OK.ru',
      u => /ok\.ru|odnoklassniki/i.test(u.hostname),
      async (link, log, env) => {
        const id = (link.url.match(/(?:videoembed|video)\/([\d-]+)/) || [])[1];
        if (!id) return null;
        const r = await _fetch(env, `https://ok.ru/videoembed/${id}`, { 'User-Agent': UA });
        const m = r.text.match(/data-options=(["'])(\{[\s\S]+?\})\1/);
        if (!m) return null;
        try {
          const raw = m[2].replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
          const o = JSON.parse(raw);
          const vars = o.flashvars || {};
          let meta = null;
          if (vars.metadata) meta = typeof vars.metadata === 'string' ? JSON.parse(vars.metadata) : vars.metadata;
          else if (vars.metadataUrl) {
            const url = decodeURIComponent(vars.metadataUrl);
            const body = vars.location ? `st.location=${encodeURIComponent(vars.location)}` : '';
            const m2 = await _fetch(env, url, { method: 'POST', 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://ok.ru/' }, { method: 'POST', body });
            meta = m2.json();
          }
          if (!meta) return null;
          const q = { ultra: '4K', quad: '1440p', full: '1080p', hd: '720p', sd: '480p', low: '360p', lowest: '240p' };
          const vids = (meta.videos || []).filter(v => v.url && q[v.name]);
          if (vids.length) {
            const peso = c => c === '4K' ? 2160 : parseInt(c, 10) || 0;
            vids.sort((a, b) => peso(q[b.name]) - peso(q[a.name]));
            return _mk(_abs(vids[0].url, 'https://ok.ru/'), 'mp4', 'https://ok.ru/');
          }
          if (meta.hlsManifestUrl) return _mk(meta.hlsManifestUrl, 'm3u8', 'https://ok.ru/');
          if (meta.ondemandHls) return _mk(meta.ondemandHls, 'm3u8', 'https://ok.ru/');
        } catch (_) {}
        return null;
      }
    );

    // ---------------- Mixdrop ----------------
    add('Mixdrop',
      u => /mixdrop|mxdrop|mixdroop|m1xdrop|mdbekjwqa|mdfx9dc8n/i.test(u.hostname),
      async (link, log, env) => {
        const embed = link.url.replace('/f/', '/e/');
        const r = await _fetch(env, embed, { 'Referer': embed, 'User-Agent': UA });
        const m = _unpackAll(r.text).match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/);
        return m ? _mk(_abs(m[1], embed), 'mp4', _orig(embed) + '/') : null;
      }
    );

    // ---------------- VidMoly ----------------
    add('VidMoly',
      u => /vidmoly/i.test(u.hostname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url, { 'Referer': 'https://vidmoly.me/', 'User-Agent': UA });
        const fr = r.text.match(/<iframe[^>]+src=["']([^"']*(?:embed-|vidmoly\.biz)[^"']*)["']/i);
        const page = fr ? (await _fetch(env, _abs(fr[1], link.url), { 'Referer': link.url, 'User-Agent': UA })).text : r.text;
        const m = page.match(/file\s*:\s*["']([^"']+)["']/);
        return m ? _mk(m[1], 'm3u8', 'https://vidmoly.me/') : null;
      }
    );

    // ---------------- Pixeldrain ----------------
    add('Pixeldrain',
      u => /pixeldrain/i.test(u.hostname),
      async (link) => {
        const id = (link.url.match(/\/(?:u|l|api\/file)\/([\w-]+)/) || [])[1];
        return id ? _mk(`https://pixeldrain.com/api/file/${id}?download`, 'mp4', 'https://pixeldrain.com/') : null;
      }
    );

    // ---------------- Sendvid ----------------
    add('Sendvid',
      u => /sendvid/i.test(u.hostname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url, { 'User-Agent': UA });
        if (/unavailable|removed|no longer available|was deleted/i.test(r.text)) return null;
        const m = r.text.match(/property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
          || r.text.match(/<source[^>]+src=["']([^"']+)["']/i);
        if (!m || /unavailable|removed|placeholder|deleted/i.test(m[1])) return null;
        return _mk(m[1], 'mp4', link.url);
      }
    );

    // ---------------- YourUpload ----------------
    add('YourUpload',
      u => /yourupload/i.test(u.hostname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url.replace('/watch/', '/embed/'), { 'Referer': 'https://www.yourupload.com/', 'User-Agent': UA });
        const m = r.text.match(/file\s*:\s*['"]([^'"]+)['"]/) || r.text.match(/property=["']og:video["'][^>]+content=["']([^"']+)["']/i);
        return m ? _mk(m[1], 'mp4', 'https://www.yourupload.com/') : null;
      }
    );

    // ---------------- Nupload ----------------
    add('Nupload',
      u => /nupload/i.test(u.hostname),
      async (link, log, env) => {
        if (!/\/watch\//.test(link.url)) return _browse(link, log, env);
        const base = _orig(link.url);
        const r = await _fetch(env, link.url, { 'Referer': base + '/', 'User-Agent': UA });
        const arr = (r.text.match(/(\w+)\.forEach\s*\([^}]*?atob/) || [])[1];
        const sesz = (r.text.match(/sesz\s*=\s*["']([^"']+)/) || [])[1];
        if (!arr || !sesz) return null;
        const off = parseInt((r.text.match(new RegExp(`${arr}\\.forEach[^-]+-\\s*(\\d+)`)) || [])[1], 10);
        const def = r.text.match(new RegExp(`var\\s+${arr}\\s*=\\s*\\[([^\\]]+)\\]`));
        if (!off || !def) return null;
        const b = (def[1].match(/["'][^"']+["']/g) || []).map(x => {
          const n = parseInt(_atob(x.slice(1, -1)).replace(/\D/g, ''), 10);
          return isNaN(n) ? '' : String.fromCharCode(n - off);
        }).join('');
        if (!/^https?:/.test(b)) return null;
        const headers = { 'Referer': base + '/', 'Origin': base, 'User-Agent': UA };
        const fin = await _fetch(env, b + '?s=' + sesz, headers);
        return _mk(fin.url || b, 'm3u8', base + '/');
      }
    );

    // ---------------- PlayerZilla ----------------
    add('PlayerZilla',
      u => /zilla-networks/i.test(u.hostname),
      async (link) => _mk(link.url.replace('/play/', '/m3u8/'), 'm3u8', 'https://animeav1.com/')
    );

    // ---------------- GoodStream ----------------
    add('GoodStream',
      u => /goodstream/i.test(u.hostname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url, { 'Referer': 'https://goodstream.one', 'User-Agent': UA });
        const m = r.text.match(/file\s*:\s*"([^"]+)"/);
        return m ? _mk(m[1], 'm3u8', link.url) : null;
      }
    );

    // ---------------- Vimeos ----------------
    add('Vimeos',
      u => /vimeos/i.test(u.hostname),
      async (link, log, env) => {
        const embed = /embed-/.test(link.url) ? link.url : link.url.replace(/vimeos\.net\//, 'vimeos.net/embed-');
        for (let i = 0; i < 3; i++) {
          const r = await _fetch(env, embed, { 'Referer': 'https://la.movie/tv/', 'User-Agent': UA });
          const code = _unpackAll(r.text) + '\n' + r.text;
          const m = code.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/) || code.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
          if (m) return _mk(_abs(m[1], embed), 'm3u8', _orig(embed) + '/');
          await new Promise(r2 => setTimeout(r2, 400));
        }
        return null;
      }
    );

    // ---------------- LuluStream ----------------
    add('LuluStream',
      u => /lulustream|luluvdo|lulu\.st|luluvid/i.test(u.hostname),
      (link, log, env) => _browse(link, log, env)
    );

    // ---------------- Mp4Upload ----------------
    add('Mp4Upload',
      u => /mp4upload/i.test(u.hostname),
      async (link, log, env) => {
        const url = link.url.replace(/mp4upload\.com\/(?!embed-)/, 'mp4upload.com/embed-');
        const r = await _fetch(env, url, { 'User-Agent': UA });
        const m = r.text.match(/["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/) || r.text.match(/src\s*:\s*["']([^"']+\.mp4[^"']*)["']/);
        return m ? _mk(_abs(m[1], url), 'mp4', _orig(url) + '/') : null;
      }
    );

    // ---------------- Upstream / Fastream ----------------
    add('Upstream', u => /upstream/i.test(u.hostname), (l, log, env) => _browse(l, log, env));
    add('Fastream', u => /fastream/i.test(u.hostname), (l, log, env) => _browse(l, log, env));

    // ---------------- Netu / Waaw ----------------
    add('Netu/Waaw',
      u => /waaw|netu\.|hqq\./i.test(u.hostname),
      async (link, log, env) => {
        const e = link.url.replace('/f/', '/e/');
        const r = await _fetch(env, e, { 'Referer': e, 'User-Agent': UA });
        const m = r.text.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i) || r.text.match(/file\s*:\s*["']([^"']+)["']/i);
        return m ? _mk(m[0] || m[1], 'm3u8', e) : null;
      }
    );

    // ---------------- Rumble ----------------
    add('Rumble',
      u => /rumble\.com/i.test(u.hostname),
      async (link, log, env) => {
        const id = (link.url.match(/rumble\.com\/embed\/(?:[0-9a-z]+\.)?([0-9a-z]+)/i) || [])[1];
        if (!id) return null;
        const r = await _fetch(env, `https://rumble.com/embedJS/u3/?request=video&ver=2&v=${id}`, { 'Accept': 'application/json', 'Referer': link.url });
        const d = r.json();
        const ua = (d && d.ua) || {};
        const arr = v => Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v).map(k => Object.assign({ alto: +k || 0 }, v[k])) : [];
        const hls = arr(ua.hls).find(x => x && x.url);
        if (hls) return _mk(hls.url, 'm3u8', 'https://rumble.com/');
        const mp4 = arr(ua.mp4).filter(x => x && x.url).sort((a, b) => ((b.meta && b.meta.h) || b.alto) - ((a.meta && a.meta.h) || a.alto))[0];
        if (mp4) return _mk(mp4.url, 'mp4', 'https://rumble.com/');
        const html = await _fetch(env, link.url, { 'Referer': 'https://rumble.com/' }).then(x => x.text).catch(() => '');
        const fm = html.replace(/\\\//g, '/').match(/https:\/\/rumble\.com\/hls-vod\/[^"'\s]+playlist\.m3u8[^"'\s]*/);
        return fm ? _mk(fm[0], 'm3u8', 'https://rumble.com/') : null;
      }
    );

    // ---------------- Dailymotion ----------------
    add('Dailymotion',
      u => /dailymotion|dai\.ly/i.test(u.hostname),
      async (link, log, env) => {
        const id = (link.url.match(/(?:video\/|video=|dai\.ly\/)([a-z0-9]+)/i) || [])[1];
        if (!id) return null;
        const ids = [id];
        if (!/^x/i.test(id)) {
          const d = await _fetch(env, `https://geo.dailymotion.com/videos/${id}`, { 'Accept': 'application/json', 'Referer': 'https://geo.dailymotion.com/' });
          const xid = (d.text.match(/"xid"\s*:\s*"(x[a-z0-9]+)"/i) || d.text.match(/"id"\s*:\s*"(x[a-z0-9]+)"/i) || [])[1];
          if (xid) ids.push(xid);
        }
        for (const v of ids) for (const ex of ['', '?app=com.dailymotion.neon']) {
          const m = await _fetch(env, `https://www.dailymotion.com/player/metadata/video/${v}${ex}`, { 'User-Agent': UA });
          const meta = m.json();
          const auto = meta && meta.qualities && meta.qualities.auto && meta.qualities.auto[0];
          if (auto && auto.url) return _mk(auto.url, 'm3u8', link.url);
        }
        return null;
      }
    );

    // ---------------- Rpmvid / Vidstack ----------------
    add('Rpmvid/Vidstack',
      u => /rpmvid|rpmplay|rpmshare|upns\.|vidstack|cubeembed|uns\.bio|p2pplay|4meplayer|p2pstream|strp2p/i.test(u.hostname),
      async (link, log, env) => {
        const base = _orig(link.url);
        const id = link.url.includes('#')
          ? link.url.split('#').pop().replace(/^\//, '').split('&')[0]
          : ((link.url.match(/[?&]id=([^&#]+)/) || [])[1] || link.url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop());
        const h = { 'Referer': base + '/', 'Origin': base, 'User-Agent': UA };
        const r = await _fetch(env, `${base}/api/v1/video?id=${encodeURIComponent(id)}&w=1920&h=1080&r=${_host(_ref(link))}`, h);
        const hex = r.text.trim();
        let claro = '';
        if (/^[0-9a-f]+$/i.test(hex)) {
          const ct = (() => { const a = new Uint8Array(hex.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16); return a })();
          claro = _aesCbcDec(ct, 'kiemtienmua911ca', '1234567890oiuytr') || _aesCbcDec(ct, 'kiemtienmua911ca', '0123456789abcdef') || '';
          if (!claro || !claro.includes('{')) {
            const d = await _clavesRpm(env, base, id);
            if (d) claro = _abrirHexRpm(hex, d.clave, d.vector) || '';
          }
        }
        if (!claro) {
          const r2 = await _fetch(env, `${base}/api/v1/video`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', ...h },
            body: `url=${encodeURIComponent(id)}`
          });
          const j = r2.json();
          if (j && j.payload) {
            try {
              const ct = _b64Bytes(j.payload);
              claro = _aesCbcDec(ct, 'kiemtienmua911ca', '1234567890oiuytr') || '';
            } catch (_) {}
          }
        }
        if (!claro) return null;
        let d = {};
        try { d = JSON.parse(claro) } catch (_) { d = { source: (claro.match(/"source"\s*:\s*"([^"]+)"/) || [])[1] } }
        const urls = [d.source, d.cfNative, d.hlsVideoTiktok, d.url, d.sources && d.sources[0] && d.sources[0].file]
          .filter(Boolean).map(v => _abs(String(v).replace(/\\\//g, '/'), base))
          .map(v => /\.txt(\?|$)/.test(v) ? `${v}#index.m3u8` : v);
        const uniq = [...new Set(urls)];
        for (const c of uniq) {
          try { if (await _listaViva(env, c, h)) return _mk(c, 'm3u8', base + '/'); } catch (_) {}
        }
        return uniq.length ? _mk(uniq[0], 'm3u8', base + '/') : null;
      }
    );

    // ---------------- Gdtvid / P2PPlay ----------------
    add('Gdtvid/P2PPlay',
      u => /gdtvid|p2pplay/i.test(u.hostname),
      async (link, log, env) => {
        const id = link.url.includes('/') ? link.url.split('/').pop().replace('#', '') : link.url;
        const base = 'https://gdtvid.p2pplay.pro';
        const h = { 'Referer': base + '/', 'User-Agent': UA };
        const info = await env.nativeFetch(`${base}/api/v1/info?id=${id}`, { headers: h });
        let cookie = '';
        try { cookie = info.headers.get('set-cookie') || ''; } catch (_) {}
        const r = await _fetch(env, `${base}/api/v1/video?id=${id}&w=1536&h=864&r=null`, { ...h, ...(cookie ? { Cookie: cookie } : {}) });
        const hex = r.text.trim();
        if (!/^[0-9a-f]+$/i.test(hex)) return null;
        const ct = (() => { const a = new Uint8Array(hex.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16); return a })();
        const clear = _aesCbcDec(ct, 'kiemtienmua911ca', '1234567890oiuytr');
        if (!clear) return null;
        try { const d = JSON.parse(clear); return d.source ? _mk(d.source, 'm3u8', base + '/') : null } catch (_) {}
        return null;
      }
    );

    // ---------------- Filemoon ----------------
    add('Filemoon',
      u => /filemoon|moonplayer|kerapoxy|byse|f16px|filemooon|1azayf|smdfs40r/i.test(u.hostname),
      async (link, log, env) => {
        const base = _orig(link.url);
        const code = link.url.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
        const det = await _fetch(env, `${base}/api/videos/${code}/embed/details`, { 'Referer': link.url, 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': UA });
        const dj = det.json();
        const marco = dj && dj.embed_frame_url;
        if (!marco) return null;
        const baseM = _orig(marco);
        const codeM = marco.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
        const play = await _fetch(env, `${baseM}/api/videos/${codeM}/embed/playback`, { 'Accept': '*/*', 'Referer': marco, 'X-Embed-Parent': link.url });
        const p = play.json();
        const pb = p && p.playback;
        if (!pb || !pb.key_parts || !pb.payload || !pb.iv) return null;
        try {
          const k1 = _b64Bytes(pb.key_parts[0]);
          const k2 = _b64Bytes(pb.key_parts[1]);
          const keyBytes = new Uint8Array(k1.length + k2.length);
          keyBytes.set(k1); keyBytes.set(k2, k1.length);
          const clear = _aesCtrDec(keyBytes, _b64Bytes(pb.iv), _b64Bytes(pb.payload));
          if (!clear) return null;
          const d = JSON.parse(clear.replace(/^\uFEFF/, '').replace(/^﻿/, ''));
          const srcs = [].concat(d.sources || d.source || []);
          const f = srcs.find(x => x && /m3u8/.test(x.url || '')) || srcs[0];
          const url = typeof f === 'string' ? f : f && f.url;
          return url ? _mk(url, 'm3u8', baseM + '/') : null;
        } catch (_) { return null }
      }
    );

    // ---------------- Embed69 ----------------
    add('Embed69',
      u => /embed69/i.test(u.hostname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url, { 'Referer': 'https://sololatino.net/', 'User-Agent': UA });
        const block = r.text.match(/dataLink\s*=\s*(\[[\s\S]*?\]);/);
        if (!block) return null;
        let groups = [];
        try { groups = JSON.parse(block[1]) } catch (_) { return null }
        const powC = (r.text.match(/POW_CHALLENGE\s*=\s*'([^']+)'/) || [])[1];
        const powS = (r.text.match(/POW_SALT\s*=\s*'([^']+)'/) || [])[1];
        const powD = parseInt((r.text.match(/POW_DIFFICULTY\s*=\s*(\d+)/) || [])[1], 10);
        let key = null;
        if (powC && powS && powD) {
          for (let n = 0; n < 200000; n++) {
            const hash = _sha256(powC + n);
            let ok = true;
            for (let i = 0; i < powD; i++) {
              if (((hash[i >> 3] >>> (28 - (i & 7) * 4)) & 15) !== 0) { ok = false; break; }
            }
            if (ok) {
              const full = CryptoJS.SHA256(powC + n + powS);
              key = new Uint8Array(full.sigBytes);
              for (let i = 0; i < full.sigBytes; i++) key[i] = (full.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
              log(`  POW resuelto (${n})`);
              break;
            }
          }
        }
        for (const g of groups) for (const e of (g.sortedEmbeds || [])) {
          if (!e.link || e.servername === 'download') continue;
          let dest = e.link;
          if (key && !/^https?:/.test(e.link)) {
            try {
              const raw = _b64Bytes(e.link);
              const iv = raw.slice(0, 16);
              const ct = raw.slice(16);
              const k = CryptoJS.lib.WordArray.create(key);
              const ivw = CryptoJS.lib.WordArray.create(iv);
              const ctw = CryptoJS.lib.WordArray.create(ct);
              const pt = CryptoJS.AES.decrypt({ ciphertext: ctw }, k, { iv: ivw, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
              const txt = pt.toString(CryptoJS.enc.Utf8);
              if (/^https?:\/\//.test(txt)) dest = txt;
            } catch (_) {}
          }
          if (/^https?:\/\//.test(dest)) {
            // CORRECCIÓN 2: Se eliminó la llamada a audioCodigo() que rompía la app.
            return _mk(dest, 'm3u8', link.url);
          }
        }
        return null;
      }
    );

    // ---------------- Xupalace ----------------
    add('Xupalace',
      u => /xupalace/i.test(u.hostname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url, { 'Referer': 'https://xupalace.org/', 'User-Agent': UA });
        const m = r.text.match(/go_to_player(?:Vast)?\('(https?:\/\/[^']+)'[^)]*\)/);
        return m ? _mk(m[1], 'm3u8', link.url) : null;
      }
    );

    // ---------------- Embedshortener ----------------
    add('Embedshortener',
      u => /embedshortener\.co/i.test(u.hostname),
      async (link) => {
        const m = link.url.match(/embedshortener\.co\/e\/([\w-]+\.([\w-]+)\.[\w-]+)/);
        if (!m) return null;
        try {
          const json = JSON.parse(new TextDecoder().decode(_b64Bytes(m[2])));
          const lk = String(json.link || '');
          const txt = new TextDecoder().decode(_b64Bytes(lk));
          if (txt.startsWith('http')) return _mk(txt, 'm3u8', link.url);
          if (lk.startsWith('http')) return _mk(lk, 'm3u8', link.url);
        } catch (_) {}
        return null;
      }
    );

    // ---------------- Holuagency ----------------
    add('Holuagency',
      u => /holuagency\.[a-z]+/i.test(u.hostname),
      async (link, log, env) => {
        let url = link.url, html = '';
        for (let i = 0; i < 5; i++) {
          const r = await _fetch(env, url, { 'User-Agent': UA });
          if (!r.ok) return null;
          html = r.text;
          const jump = html.match(/window\.location\.href\s*=\s*"([^"]+)"/);
          if (!jump) { url = r.url; break; }
          url = _abs(jump[1], url);
        }
        const form = html.match(/<form[^>]*id=["']link["'][\s\S]*?<\/form>/i);
        if (!form) return null;
        const action = (form[0].match(/action=["']([^"']+)["']/i) || [])[1];
        const v = n => (form[0].match(new RegExp(`name=["']${n}["'][^>]*value=["']([^"']*)["']`, 'i')) || form[0].match(new RegExp(`value=["']([^"']*)["'][^>]*name=["']${n}["']`, 'i')) || [])[1] || '';
        const token = v('token'), back = v('back'), sh = v('sh');
        if (!action) return null;
        const body = `token=${encodeURIComponent(token)}&back=${encodeURIComponent(back)}&sh=${encodeURIComponent(sh)}`;
        const page = await _fetch(env, _abs(action, url), { method: 'POST', 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': url, 'User-Agent': UA }, { method: 'POST', body });
        const cont = (page.text.match(/class=["'][^"']*cs-share__copy-link[^"']*["'][^>]*href=["']([^"']+)["']/) || page.text.match(/href=["']([^"']+)["'][^>]*class=["'][^"']*cs-share__copy-link/i) || [])[1];
        if (!cont) return null;
        const marco = await _fetch(env, cont, { 'Cookie': `t=${token}; b=${back}; s=${sh}`, 'User-Agent': UA });
        const src = (marco.text.match(/id=["']player["'][\s\S]*?<iframe[^>]+src=["']([^"']+)["']/) || [])[1];
        return src ? _mk(_abs(src, cont), 'm3u8', cont) : null;
      }
    );

    // ---------------- GSPlay (JKAnime) ----------------
    add('GSPlay (JKAnime)',
      u => /jkanime\.net\/gsplay|jkanime\.net\/jkmedia/i.test(u.hostname + u.pathname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url, { 'Referer': 'https://jkanime.net/', 'User-Agent': UA });
        const val = (r.text.match(/<form[\s\S]*?<input[^>]+value=["']([^"']+)["']/i) || [])[1];
        if (!val) return null;
        try {
          const resp = await env.nativeFetch('https://jkanime.net/gsplay/redirect_post.php', {
            method: 'POST', redirect: 'manual',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'https://jkanime.net', 'Referer': link.url },
            body: `data=${encodeURIComponent(val)}`
          });
          let loc = null;
          try { loc = resp.headers.get('location'); } catch (_) {}
          if (!loc && resp.url && resp.url !== 'https://jkanime.net/gsplay/redirect_post.php') loc = resp.url;
          if (!loc) return null;
          const k = loc.split('#').pop();
          const resp2 = await _fetch(env, 'https://jkanime.net/gsplay/api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Origin': 'https://jkanime.net', 'Referer': 'https://jkanime.net/gsplay/player.html' },
            body: `v=${encodeURIComponent(k)}`
          });
          const d = resp2.json();
          return d && d.file ? _mk(d.file, 'm3u8', 'https://jkanime.net/') : null;
        } catch (_) { return null }
      }
    );

    // ---------------- MonosChinos reproductor ----------------
    add('MonosChinos reproductor',
      u => /monoschinos2\.com\/reproductor/i.test(u.hostname + u.pathname),
      async (link) => {
        try { const u = new URL(link.url); const t = u.searchParams.get('url'); return t ? _mk(t, 'm3u8', 'https://monoschinos2.com/') : null; } catch (_) { return null }
      }
    );

    // ---------------- Mojon Latanime ----------------
    add('Mojon Latanime',
      u => /mojon\.latanime\.org\/aqua\/fn/i.test(u.hostname + u.pathname),
      async (link) => {
        try { const u = new URL(link.url); const t = u.searchParams.get('url'); return t ? _mk(decodeURIComponent(t), 'm3u8', 'https://latanime.org/') : null; } catch (_) { return null }
      }
    );

    // ---------------- TPlayer ----------------
    add('TPlayer',
      u => /tplayer\.pelisgo\.online|tplayer/i.test(u.hostname),
      async (link, log, env) => {
        const m = link.url.match(/\/embed\/([a-zA-Z0-9_-]+)/);
        if (!m) return null;
        const casa = 'https://tplayer.pelisgo.online';
        const r = await _fetch(env, `${casa}/api/resolve/${m[1]}`, { Referer: link.url });
        const d = r.json();
        if (!d || !d.success || !d.streamUrl) return null;
        const final = d.streamUrl.startsWith('http') ? d.streamUrl : `${casa}${d.streamUrl}`;
        return _mk(final, 'm3u8', link.url);
      }
    );

    // ---------------- GDrive ----------------
    add('GDrive',
      u => /drive\.google\.com|drive\.usercontent\.google\.com/i.test(u.hostname),
      async (link, log, env) => {
        const m = link.url.match(/[?&]id=([a-zA-Z0-9_-]+)/) || link.url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (!m) return null;
        const id = m[1];
        const base = `https://drive.usercontent.google.com/download?id=${id}&export=download`;
        const r = await _fetch(env, base, {});
        if (r.status === 302 || r.status === 303) {
          let loc = null;
          try { loc = r.headers.get('location'); } catch (_) {}
          if (loc) return _mk(loc, 'mp4', 'https://drive.google.com/');
        }
        const confirm = (r.text.match(/name="confirm"\s+value="([^"]+)"/i) || [])[1];
        const uuid = (r.text.match(/name="uuid"\s+value="([^"]+)"/i) || [])[1];
        const final = confirm && uuid ? `${base}&confirm=${confirm}&uuid=${uuid}` : base;
        return _mk(final, 'mp4', 'https://drive.google.com/');
      }
    );

    // ---------------- Esplay ----------------
    add('Esplay',
      u => /player\.html#|esplay\.io/i.test(u.hostname + u.pathname + u.hash),
      async (link, log, env) => {
        let id = '';
        if (/player\.html#/.test(link.url)) id = link.url.split('player.html#')[1];
        else { const m = link.url.match(/esplay\.io\/video\/([\w-]+)/); if (m) id = m[1]; }
        if (!id) return null;
        const r = await _fetch(env, `https://pelisplus.esplay.io/video/${id}`);
        const d = r.json();
        return d && d.file ? _mk(d.file, 'm3u8', link.url) : null;
      }
    );

    // ---------------- KeKi ----------------
    add('KeKi',
      u => /keki\.moe|tnmr\.org/i.test(u.hostname),
      async (link, log, env) => {
        const ref = 'https://lulustream.com/';
        const extract = async e => {
          const html = await _fetch(env, e, { 'User-Agent': UA, 'Referer': ref }).then(r => r.text);
          const packed = html.match(/eval\(function\(p,a,c,k,e,[a-z]\)\{[\s\S]*?\}\s*\('([\s\S]+?)',\s*(\d+),\s*\d+,\s*'([\s\S]+?)'\.split\('\|'\)/);
          if (packed) {
            const des = _unpackAll(packed[0]);
            const m3u = (des.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/) || des.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/) || [])[1];
            if (m3u) return _mk(m3u, 'm3u8', ref);
          }
          const m3u2 = (html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i) || [])[0];
          if (m3u2) return _mk(m3u2, 'm3u8', ref);
          const f = (html.match(/file["']?\s*:\s*["']([^"']+)["']/i) || [])[1];
          return f ? _mk(f, 'm3u8', ref) : null;
        };
        if (/\/[ev]\//i.test(link.url)) return extract(link.url);
        if (link.url.includes('.m3u8')) return _mk(link.url, 'm3u8', ref);
        return extract(link.url);
      }
    );

    // ---------------- Buzzheavier ----------------
    add('Buzzheavier',
      u => /buzzheavier\.com|bzh\.sh/i.test(u.hostname),
      async (link, log, env) => {
        const clean = link.url.split('|')[0].replace(/\/$/, '');
        const host = _host(clean);
        const r = await _fetch(env, `${clean}/download`, {
          'User-Agent': UA, Referer: clean, 'hx-current-url': clean, 'hx-request': 'true', Accept: '*/*'
        }, { method: 'HEAD', redirect: 'manual' });
        let hx = null;
        try { hx = r.headers.get('hx-redirect'); } catch (_) {}
        if (hx) {
          const final = hx.startsWith('/dl/') ? `https://${host}${hx}` : hx;
          return _mk(`${final}#.mp4`, 'mp4', clean);
        }
        const id = clean.split('/').pop();
        return _mk(`https://buzzheavier.com/v/${id}/video.mp4#.mp4`, 'mp4', clean);
      }
    );

    // ---------------- TurboVid ----------------
    add('TurboVid',
      u => /turbovid/i.test(u.hostname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url, { 'Referer': 'https://www.fuegocine.com/', 'User-Agent': UA });
        const m = r.text.match(/data-hash="([^"]+\.m3u8[^"]*)"/);
        return m ? _mk(m[1], 'm3u8', link.url) : null;
      }
    );

    // ---------------- Embedseek ----------------
    add('Embedseek',
      u => /seekplays|seekstreaming|embedseek/i.test(u.hostname),
      async (link, log, env) => {
        const p = (() => { try { return new URL(link.url) } catch (_) { return null } })();
        if (!p) return null;
        const id = p.hash.replace('#', '').split('&')[0];
        if (!id) return null;
        const r = await _fetch(env, `${p.origin}/api/v1/info?id=${id}`, { 'User-Agent': UA, Referer: link.url, Origin: p.origin });
        if (!r.text || r.text.length < 10) return null;
        const host = p.hostname;
        const n = (() => {
          let s = ''; for (const c of '7519') s += String.fromCharCode(parseInt(`10${c}`, 10));
          s += String.fromCharCode(host.charCodeAt(1)); s += s.substring(1, 3); s += String.fromCharCode(110, 109, 117);
          const re = '3579'.split('');
          s += String.fromCharCode(parseInt(re[3] + re[2]), parseInt(re[1] + re[2]));
          const s1 = (parseInt(re[0]) + 1).toString() + re[3]; s += String.fromCharCode(parseInt(s1), parseInt(s1));
          const s2 = (parseInt(re[3]) * 10 + parseInt(re[3])).toString();
          const s3 = re.reverse().join('').substring(0, 2); s += String.fromCharCode(parseInt(s2), parseInt(s3));
          return s.substring(0, 16);
        })();
        const pp = host + '//', g = host.length * pp.length;
        let b = ''; for (let i = 1; i < 10; i++) b += String.fromCharCode(i + g);
        const pe = 3 * link.url.charCodeAt(0), tt = 111 + host.length, k = tt + 4, ie = host.charCodeAt(1), me = ie - 2;
        b += String.fromCharCode(g, 111, pe, tt, k, ie, me);
        const iv = b.substring(0, 16);
        try {
          const dec = CryptoJS.AES.decrypt({ ciphertext: CryptoJS.enc.Hex.parse(r.text) }, CryptoJS.enc.Utf8.parse(n),
            { iv: CryptoJS.enc.Utf8.parse(iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString(CryptoJS.enc.Utf8);
          const d = JSON.parse(dec);
          if (d && d.url) {
            const v = d.url.startsWith('/') ? p.origin + d.url : d.url;
            return _mk(v, 'm3u8', link.url);
          }
        } catch (_) {}
        return null;
      }
    );

    // ---------------- DropCDN ----------------
    add('DropCDN',
      u => /dropcdn\.io|dropload\.io|dr0pstream\.com/i.test(u.hostname),
      async (link, log, env) => {
        const norm = link.url.replace('/d/', '/').replace('/e/', '/').replace('/embed-', '/');
        const idm = norm.match(/\/([a-zA-Z0-9]+)$/) || norm.match(/\/([a-zA-Z0-9]+)_o\//);
        const file = idm ? idm[1] : norm.split('/').pop();
        const embed = `https://dr0pstream.com/e/${file}`;
        const r = await _fetch(env, embed, { 'User-Agent': UA, Referer: 'https://dr0pstream.com/', Origin: 'https://dr0pstream.com' });
        if (!r.ok) return null;
        const m3u = r.text.replace(/\\\//g, '/').match(/https?:\/\/[^"']+\.m3u8[^"']*/);
        if (!m3u) return null;
        let m = m3u[0];
        if (m.includes('dropcdn.io')) {
          m = m.replace('r1.dropcdn.io', 'ds2.dropcdn.io').replace('_o/', '/').replace('_o.m3u8', '.m3u8');
          if (!m.includes('srv=')) m += (m.includes('?') ? '&' : '?') + 'srv=ds2i';
        }
        return _mk(m, 'm3u8', 'https://dr0pstream.com/');
      }
    );

    // ---------------- VidSrc ----------------
    add('VidSrc',
      u => /vidsrc\.xyz|vidsrc\.to|vidsrc\.pm|moviesapi\.to|moviesapi\.club/i.test(u.hostname),
      async (link, log, env) => {
        try {
          const embed = link.url.replace('vidsrc.to', 'vidsrc.xyz').replace('vidsrc.pm', 'vidsrc.xyz')
            .replace('moviesapi.club/movie', 'cdn.moviesapi.to/embed/movie').replace('moviesapi.to/movie', 'cdn.moviesapi.to/embed/movie');
          const h = { 'User-Agent': UA, 'Referer': 'https://vidsrc.xyz/' };
          const r1 = await _fetch(env, embed, h);
          const im = r1.text.match(/src=['"]([^"]+)['"] f/);
          if (!im) return null;
          let next = im[1]; if (next.startsWith('//')) next = 'https:' + next;
          const r2 = await _fetch(env, next, { ...h, Referer: embed });
          const em = r2.text.match(/id="([^"]+)" style="display:none;">([^<]+)/);
          if (!em) return null;
          const decId = em[1], cipher = em[2];
          let decrypted = null;
          if (decId === 'sXnL9MQIry') {
            const b = Array.from('pWB9V)[*4I`nJpp?ozyB~dbr9yt!_n4u').map(c => c.charCodeAt(0));
            const d = cipher.match(/.{2}/g).map(x => parseInt(x, 16));
            decrypted = _atob(String.fromCharCode(...d.map((v, i) => (v ^ b[i % b.length]) - 3)));
          } else if (decId === 'IhWrImMIGL') {
            const d = Array.from(cipher).map(ch => {
              const code = ch.charCodeAt(0);
              if (code >= 97 && code <= 109 || code >= 65 && code <= 77) return String.fromCharCode(code + 13);
              if (code >= 110 && code <= 122 || code >= 78 && code <= 90) return String.fromCharCode(code - 13);
              return ch;
            }).join('');
            decrypted = _atob(d);
          } else if (decId === 'xTyBxQyGTA') {
            const b = cipher.split('').reverse().join('');
            let c = ''; for (let i = 0; i < b.length; i += 2) c += b[i];
            decrypted = _atob(c);
          } else if (['JoAHUMCLXV', 'Oi3v1dAlaM', 'TsA2KGDGux'].includes(decId)) {
            const shift = { JoAHUMCLXV: 3, Oi3v1dAlaM: 5, TsA2KGDGux: 7 }[decId];
            const b64 = cipher.split('').reverse().join('').replace(/-/g, '+').replace(/_/g, '/');
            const dec = _atob(b64);
            decrypted = Array.from(dec).map(ch => String.fromCharCode(ch.charCodeAt(0) - shift)).join('');
          }
          if (!decrypted) return null;
          const final = decrypted.split(' ')[0].replace('{v1}', 'thrumbleandjaxon.com');
          return _mk(final, 'm3u8', next);
        } catch (_) { return null }
      }
    );

    // ---------------- VidNest ----------------
    add('VidNest',
      u => /vidnest\.io/i.test(u.hostname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url, { 'Referer': 'https://www.fuegocine.com/', 'User-Agent': UA });
        const m = r.text.match(/sources\s*:\s*\[\s*\{[^}]*file\s*:\s*"([^"]+\.mp4[^"]*)"/);
        return m ? _mk(m[1], 'mp4', link.url) : null;
      }
    );

    // ---------------- VidSonic ----------------
    add('VidSonic',
      u => /vidsonic\.net/i.test(u.hostname),
      async (link, log, env) => {
        const id = link.url.split('/').pop().replace('.html', '');
        const target = `https://vidsonic.net/e/${id}`;
        const r = await _fetch(env, target, { 'Referer': 'https://www.fuegocine.com/', 'User-Agent': UA });
        const vm = r.text.match(/const\s+_0x1\s*=\s*['"]([^'"]+)['"]/);
        if (vm) {
          const clean = vm[1].split('|').join('');
          let dec = ''; for (let i = 0; i < clean.length; i += 2) dec += String.fromCharCode(parseInt(clean.substr(i, 2), 16));
          const final = dec.split('').reverse().join('');
          if (final.includes('http')) return _mk(final, 'm3u8', target);
        }
        const hm = r.text.match(/\["([a-f0-9]{50,})"\]/);
        if (hm) {
          const hex = hm[1].split('').reverse().join('');
          let dec = ''; for (let i = 0; i < hex.length; i += 2) dec += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
          if (dec.includes('http')) return _mk(dec, 'm3u8', target);
        }
        return null;
      }
    );

    // ---------------- Barmonrey ----------------
    add('Barmonrey',
      u => /barmonrey\.com/i.test(u.hostname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url, { 'Referer': 'https://www.fuegocine.com/', 'User-Agent': UA });
        const m = r.text.match(/https?:\/\/[^"']+\.m3u8[^"']*/);
        return m ? _mk(m[0], 'm3u8', link.url) : null;
      }
    );

    // ---------------- Generic Fuegocine ----------------
    add('Fuegocine',
      u => /unlimplay|krakenfiles/i.test(u.hostname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url, { 'Referer': 'https://www.fuegocine.com/', 'User-Agent': UA });
        const m3u = r.text.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
        if (m3u) return _mk(m3u[0], 'm3u8', link.url);
        const mp4 = r.text.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/i);
        return mp4 ? _mk(mp4[0], 'mp4', link.url) : null;
      }
    );

    // ---------------- LaCloud ----------------
    add('LaCloud',
      u => /lacloud/i.test(u.hostname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url, { 'Referer': _ref(link), 'User-Agent': UA });
        const m = r.text.match(/const src\s*=\s*["']([^"']+)["']/);
        return m ? _mk(m[1], 'm3u8', link.url) : null;
      }
    );

    // ---------------- EarnVids / StreamHG ----------------
    add('EarnVids/StreamHG',
      u => /earnvids|earnl\.|vidnova|streamfort|streamhg/i.test(u.hostname),
      (link, log, env) => _browse(link, log, env)
    );

    // ---------------- VideoSeed ----------------
    add('VideoSeed',
      u => /video-seed/i.test(u.hostname),
      async (link, log, env) => {
        try {
          const p = new URL(link.url);
          const host = p.host || 'video-seed.xyz';
          const token = link.url.split('?url=')[1];
          if (!token) return null;
          const body = `keys=${encodeURIComponent(token)}`;
          const r = await _fetch(env, `https://${host}/api`, {
            'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'x-token': host, Referer: link.url
          }, { method: 'POST', body });
          const m = r.text && r.text.match(/url":"([^"]+)"/);
          return m ? _mk(m[1].replace(/\\\//g, '/'), 'm3u8', link.url) : null;
        } catch (_) { return null }
      }
    );

    // ---------------- VidEasy ----------------
    add('VidEasy',
      u => /speedracelight|api\.videasy|enc-dec\.app.*videasy/i.test(u.hostname),
      async (link, log, env) => {
        const encResp = await _fetch(env, link.url, { 'User-Agent': UA }).then(r => r.text);
        if (!encResp) return null;
        const id = (link.url.match(/tmdbId=(\d+)/) || [])[1] || '0';
        const dec = await _fetch(env, `https://enc-dec.app/api/dec-videasy`, {
          'Content-Type': 'application/json', 'User-Agent': UA
        }, { method: 'POST', body: JSON.stringify({ text: encResp, id }) }).then(r => r.json());
        const datos = dec && dec.result;
        if (!datos || !datos.sources) return null;
        const src = datos.sources.find(s => s.url);
        return src ? _mk(src.url, 'm3u8', 'https://player.videasy.net/') : null;
      }
    );

    // ---------------- VidFast ----------------
    add('VidFast',
      u => /vidfast\.vc/i.test(u.hostname),
      async (link, log, env) => {
        const m = link.url.match(/\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/);
        if (!m) return null;
        const tipo = m[1], id = m[2], s = m[3], e = m[4];
        const base = 'https://vidfast.vc';
        const apiBase = tipo === 'movie' ? `${base}/movie/${id}/` : `${base}/tv/${id}/${s}/${e}/`;
        const html = await _fetch(env, apiBase, { 'User-Agent': UA, Referer: base + '/', 'X-Requested-With': 'XMLHttpRequest' }).then(r => r.text);
        const enc = (html.match(/\\"en\\":\\"(.*?)\\"/) || [])[1];
        if (!enc) return null;
        const dec = await _fetch(env, `https://enc-dec.app/api/enc-vidfast?text=${encodeURIComponent(enc)}&version=1`).then(r => r.json());
        const d = dec && dec.result;
        if (!d) return null;
        const src = d.sources && d.sources[0] && (d.sources[0].url || d.sources[0].file);
        return src ? _mk(src, 'm3u8', base + '/') : null;
      }
    );

    // ---------------- VidLink ----------------
    add('VidLink',
      u => /vidlink\.pro/i.test(u.hostname),
      async (link, log, env) => {
        const m = link.url.match(/\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/);
        if (!m) return null;
        const tipo = m[1], id = m[2], s = m[3], e = m[4];
        const enc = await _fetch(env, `https://enc-dec.app/api/enc-vidlink?id=${id}`).then(r => r.json());
        const realId = enc && enc.result;
        if (!realId) return null;
        const base = 'https://vidlink.pro';
        const final = tipo === 'movie' ? `${base}/api/b/movie/${realId}` : `${base}/api/b/tv/${realId}/${s}/${e}`;
        const datos = await _fetch(env, final, { 'User-Agent': UA, Referer: 'https://vidlink.pro/', Origin: 'https://vidlink.pro' }).then(r => r.json());
        const playlist = datos && datos.stream && datos.stream.playlist;
        return playlist ? _mk(playlist, 'm3u8', 'https://vidlink.pro/') : null;
      }
    );

    // ---------------- Vimeus ----------------
    add('Vimeus',
      u => /vimeus\.com/i.test(u.hostname),
      async (link, log, env) => {
        const r = await _fetch(env, link.url, { 'Referer': 'https://vimeus.com/', 'User-Agent': UA });
        const m = r.text.match(/<script\s+type=["']text\/json["']\s+id=["']data["']>\s*(\{[\s\S]*?\})\s*<\/script>/i);
        if (!m) return null;
        try {
          const d = JSON.parse(m[1]);
          if (!Array.isArray(d.embeds)) return null;
          for (const e of d.embeds) {
            if (!e.url) continue;
            const u = /^https?:/.test(e.url) ? e.url : e.url.startsWith('//') ? `https:${e.url}` : `https://${e.url}`;
            return _mk(u, 'm3u8', 'https://vimeus.com/');
          }
        } catch (_) {}
        return null;
      }
    );

    // ---------------- VitaminaGG ----------------
    add('VitaminaGG',
      u => /vitaminagg\.vip/i.test(u.hostname),
      async (link, log, env) => {
        const html = await _fetch(env, link.url).then(r => r.text);
        const post = (html.match(/data-post-id=["'](\d+)["']/i) || [])[1];
        if (!post) return null;
        const base = _orig(link.url);
        for (const n of [1, 2, 3]) {
          const o = await _fetch(env, `${base}/wstrm-player?id=${post}&plyer-id=opcion-${n}`, { Referer: link.url }).then(r => r.text);
          const src = (o.match(/data-src=["']([^"']+)["']/) || o.match(/<iframe[^>]+src=["']([^"']+)["']/i) || [])[1];
          if (src) return _mk(src, 'm3u8', link.url);
        }
        return null;
      }
    );

    return EX;
  })();

  // ════════════════════════════════════════════════════════════════════════
  // CÓDIGO ORIGINAL DEL EXTRACTORES.JS
  // ════════════════════════════════════════════════════════════════════════

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
