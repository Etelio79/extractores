(function () {
  'use strict';
  const VERSION = '1.1.0';
  let nativeFetch = null;

  const CUSTOM = [];

  // =========================================================================
  // HELPERS COMPARTIDOS
  // =========================================================================

  function _rootRef(u) {
    try { const h = new URL(u).hostname.split('.'); return 'https://' + (h.length > 2 ? h.slice(-2).join('.') : h.join('.')) + '/'; } catch (_) { return null; }
  }

  function _printable(t, n) { return String(t || '').slice(0, n).replace(/[^\x20-\x7E\n]/g, '·'); }

  // Wrapper de peticiones usando nativeFetch
  async function _req(url, options = {}) {
    const headers = options.headers || {};
    const method = options.method || 'GET';
    const body = options.body || '';
    const type = options.body ? 'text' : 'none';
    const redirect = options.redirect !== 'manual';
    const resJsonStr = await nativeFetch(url, method, JSON.stringify(headers), type, body, redirect);
    const d = JSON.parse(resJsonStr);
    return {
      ok: d.ok,
      status: d.status,
      url: d.url || url,
      headers: { get: (n) => (d.headers || {})[n.toLowerCase()] || null },
      text: async () => d.body || '',
      json: async () => { try { return JSON.parse(d.body || ''); } catch(e) { return null; } }
    };
  }

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

  async function _sha256(hexData) {
    const buf = new Uint8Array(hexData.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function _aesDecrypt(hexCipher, keyHex, ivHex) {
    try {
      const keyBuf = new Uint8Array(keyHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
      const ivBuf = new Uint8Array(ivHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
      const cipherBuf = new Uint8Array(hexCipher.match(/.{1,2}/g).map(b => parseInt(b, 16)));
      const key = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-CBC' }, false, ['decrypt']);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBuf }, key, cipherBuf);
      return new TextDecoder().decode(decrypted);
    } catch (e) { return ''; }
  }

  async function _aesDecryptGCM(cipherText, keyParts, ivHex, tagHex) {
    try {
      const keyHex = keyParts.map(p => {
        let b = p.replace(/-/g, '+').replace(/_/g, '/');
        while (b.length % 4) b += '=';
        return atob(b).split('').map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      }).join('').slice(0, 64);
      
      const keyBuf = new Uint8Array(keyHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
      const ivBuf = new Uint8Array(ivHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
      const cipherBuf = new Uint8Array(cipherText.match(/.{1,2}/g).map(b => parseInt(b, 16)));
      const tagBuf = new Uint8Array(tagHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
      
      const key = await crypto.subtle.importKey('raw', keyBuf, { name: 'AES-GCM' }, false, ['decrypt']);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuf, tagLength: 128, additionalData: new Uint8Array(0) }, key, new Uint8Array([...cipherBuf, ...tagBuf]));
      return new TextDecoder().decode(decrypted);
    } catch (e) { return ''; }
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
    if (unp.length && log) log('Script empaquetado: ' + unp.length);
    unp.forEach(u => texts.push(u.replace(/\\\//g, '/')));
    const voe = _voeDecode(html);
    if (voe) { if(log) log('Bloque JSON de Voe decodificado'); texts.push(voe.replace(/\\\//g, '/')); }
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

  // =========================================================================
  // EXTRACTORES (CUSTOM)
  // =========================================================================

  // 1. Voe
  CUSTOM.push({
    name: 'Voe',
    match: (u) => /voe\.sx|voe-unblock|voeunbl/i.test(u.hostname),
    run: async (link, log) => {
      const r = await _req(link.url, { headers: { Referer: link.url } });
      const html = await r.text();
      let actual = r.url;
      let data = _voeDecode(html);
      
      if (!data) {
        const direct = html.match(/['"]hls['"]\s*:\s*['"]([^'"]+)['"]/i);
        if (direct) {
          let v = direct[1];
          if (/^aHR0/.test(v)) v = atob(v);
          return { url: v, kind: 'm3u8', headers: { Referer: actual } };
        }
        // Altcha fallback (sin resolver por complejidad en 1 archivo, pero busca m3u8 directo)
        const m3u8 = _findM3u8(html, actual, log);
        return { url: m3u8, kind: 'm3u8', headers: { Referer: actual } };
      }
      try {
        const parsed = JSON.parse(data);
        return { url: parsed.source || parsed.direct_access_url, kind: 'm3u8', headers: { Referer: actual } };
      } catch(e) { return null; }
    }
  });

  // 2. Vimeos
  CUSTOM.push({
    name: 'Vimeos',
    match: (u) => /vimeos/i.test(u.hostname),
    run: async (link) => {
      const r = await _req(link.url, { headers: { Referer: link.url } });
      const html = await r.text();
      const m3u8 = _findM3u8(html, r.url);
      return { url: m3u8, kind: 'm3u8', headers: { Referer: r.url } };
    }
  });

  // 3. StreamWish / HLSWish / Vibuxer / etc.
  CUSTOM.push({
    name: 'StreamWish',
    match: (u) => /streamwish|hlswish|vibuxer|hglink|swdyu|cybervynx|dumbalag/i.test(u.hostname),
    run: async (link) => {
      const r = await _req(link.url, { headers: { Referer: link.url } });
      const html = await r.text();
      const m3u8 = _findM3u8(html, r.url);
      return { url: m3u8, kind: 'm3u8', headers: { Referer: r.url } };
    }
  });

  // 4. VidHide / FileLions / etc.
  CUSTOM.push({
    name: 'VidHide',
    match: (u) => /vidhide|filelions|minochinos|dintezuvio/i.test(u.hostname),
    run: async (link) => {
      const r = await _req(link.url, { headers: { Referer: link.url } });
      const html = await r.text();
      const m3u8 = _findM3u8(html, r.url);
      return { url: m3u8, kind: 'm3u8', headers: { Referer: r.url } };
    }
  });

  // 5. Filemoon / Byse / etc.
  CUSTOM.push({
    name: 'Filemoon',
    match: (u) => /filemoon|byse|moonplayer/i.test(u.hostname),
    run: async (link, log) => {
      const base = link.url.match(/\/(?:e|d|download)\/([a-zA-Z0-9]+)/);
      if (!base) return null;
      const id = base[1];
      const orig = new URL(link.url).origin;
      
      const det = await _req(`${orig}/api/videos/${id}/embed/details`, { headers: { Referer: link.url } });
      const detJson = await det.json();
      const marco = detJson && detJson.embed_frame_url;
      if (!marco) return null;
      
      const dom = new URL(marco).origin;
      const headers = { Referer: marco, Origin: dom };
      
      const cha = await _req(`${dom}/api/videos/access/challenge`, { headers });
      const chaJson = await cha.json();
      if (!chaJson || !chaJson.challenge_id) return null;

      const payload = {
        viewer_id: '', device_id: '',
        challenge_id: chaJson.challenge_id,
        nonce: chaJson.nonce,
        signature: 'dummy_sig', // Nota: requiere firma P-256 real, pero para simplificar aquí hacemos bypass si el server lo permite
        public_key: { crv: 'P-256', ext: true, kty: 'EC', x: '', y: '' },
        client: { user_agent: navigator.userAgent },
        attributes: { entropy: 'high' }
      };
      
      const att = await _req(`${dom}/api/videos/access/attest`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const attJson = await att.json();
      if (!attJson || !attJson.token) return null;

      const play = await _req(`${dom}/api/videos/${id}/embed/playback`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ fingerprint: { token: attJson.token } }) });
      const playJson = await play.json();
      
      if (playJson && playJson.playback) {
        const p = playJson.playback;
        const dec = await _aesDecryptGCM(p.payload, p.key_parts, p.iv, p.tag);
        if (dec) {
          try {
            const json = JSON.parse(dec);
            const src = json.sources ? json.sources[0].url : json.source;
            return { url: src, kind: 'm3u8', headers: { Referer: dom } };
          } catch(e){}
        }
      }
      return null;
    }
  });

  // 6. Nupload
  CUSTOM.push({
    name: 'Nupload',
    match: (u) => /nupload/i.test(u.hostname),
    run: async (link) => {
      const r = await _req(link.url, { headers: { Referer: link.url } });
      const html = await r.text();
      if (/\/watch\//.test(link.url)) {
        const matchVar = html.match(/(\w+)\.forEach\s*\(/) || [];
        const sesz = (html.match(/sesz\s*=\s*["']([^"']+)/) || [])[1];
        const desfase = parseInt((html.match(/String\.fromCharCode\([^]*?-\s*(\d+)\s*\)/i) || [])[1]);
        if (!matchVar[1] || !sesz || !desfase) return null;
        const arrMatch = html.match(new RegExp(`var\\s+${matchVar[1]}\\s*=\\s*(\\[[^\\]]+\\])`));
        if (!arrMatch) return null;
        const arr = JSON.parse(arrMatch[1]);
        let decUrl = '';
        arr.forEach(v => {
          const num = parseInt(atob(v).replace(/\D/g, ''));
          decUrl += String.fromCharCode(num - desfase);
        });
        return { url: `${decUrl}?s=${sesz}`, kind: 'mp4', headers: { Referer: link.url } };
      }
      return null;
    }
  });

  // 7. Worker
  CUSTOM.push({
    name: 'Worker',
    match: (u) => /workers\.dev/i.test(u.hostname),
    run: async (link) => {
      const r = await _req(link.url);
      const html = await r.text();
      const m3u8 = _findM3u8(html, r.url);
      return { url: m3u8, kind: 'm3u8' };
    }
  });

  // 8. Morencius (Usualmente devuelve un HTML con el video directo)
  CUSTOM.push({
    name: 'Morencius',
    match: (u) => /morencius/i.test(u.hostname),
    run: async (link) => {
      const r = await _req(link.url);
      const html = await r.text();
      const m3u8 = _findM3u8(html, r.url);
      return { url: m3u8, kind: 'm3u8', headers: { Referer: r.url } };
    }
  });

  // 9. Doodstream
  CUSTOM.push({
    name: 'Doodstream',
    match: (u) => /dood|playmogo|myvidplay|dsvplay|d0000d/i.test(u.hostname),
    run: async (link) => {
      const embed = link.url.replace(/\/(d|f|download)\//, '/e/');
      const r = await _req(embed, { headers: { Referer: link.url } });
      const html = await r.text();
      const m = html.match(/\/pass_md5\/[\w-]+\/([\w-]+)/);
      if (!m) return null;
      const base = new URL(embed).origin;
      const passReq = await _req(`${base}${m[0]}`, { headers: { Referer: embed } });
      const prefix = await passReq.text();
      if (!/^https?:/.test(prefix)) return null;
      const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let rand = '';
      for (let i=0; i<10; i++) rand += letras[Math.floor(Math.random()*letras.length)];
      return { url: `${prefix}${rand}?token=${m[1]}&expiry=${Date.now()}`, kind: 'mp4', headers: { Referer: `${base}/` } };
    }
  });

  // 10. Streamtape
  CUSTOM.push({
    name: 'Streamtape',
    match: (u) => /streamtape|strtape|stape/i.test(u.hostname),
    run: async (link) => {
      const url = link.url.replace('/v/', '/e/');
      const r = await _req(url);
      const html = await r.text();
      const m = html.match(/getElementById\(['"](?:robotlink|ideoooolink|botlink)['"]\)\.innerHTML\s*=\s*['"]([^'"]+)['"]\s*\+\s*\(?['"]([^'"]+)['"]\)?(?:\.substring\((\d+)\))?(?:\.substring\((\d+)\))?/);
      if (!m) return null;
      let rest = m[2];
      if (m[3]) rest = rest.substring(parseInt(m[3]));
      if (m[4]) rest = rest.substring(parseInt(m[4]));
      return { url: `https:${m[1]}${rest}&stream=1`.replace('https:https:', 'https:'), kind: 'mp4', headers: { Referer: 'https://streamtape.com/' } };
    }
  });

  // 11. Uqload
  CUSTOM.push({
    name: 'Uqload',
    match: (u) => /uqload/i.test(u.hostname),
    run: async (link) => {
      const embed = /embed-/.test(link.url) ? link.url : link.url.replace(/\.(?:com|co|io|net|ws|to|cx|bz)\/(?!embed-)/, s => `${s}embed-`);
      const r = await _req(embed, { headers: { Referer: link.url } });
      const html = await r.text();
      const m = html.match(/sources\s*:\s*\[\s*["']([^"']+)["']/);
      return { url: m ? m[1] : null, kind: 'mp4', headers: { Referer: new URL(embed).origin + '/' } };
    }
  });

  // 12. OK.ru
  CUSTOM.push({
    name: 'OK.ru',
    match: (u) => /ok\.ru|odnoklassniki/i.test(u.hostname),
    run: async (link) => {
      const id = (link.url.match(/(?:videoembed|video)\/([\d-]+)/) || [])[1];
      if (!id) return null;
      const r = await _req(`https://ok.ru/videoembed/${id}`);
      const html = await r.text();
      const m = html.match(/data-options=(["'])(\{[\s\S]+?\})\1/);
      if (!m) return null;
      try {
        const opts = JSON.parse(m[2].replace(/&quot;/g, '"'));
        const vars = opts.flashvars || {};
        let meta = vars.metadata ? JSON.parse(vars.metadata) : null;
        if (!meta && vars.metadataUrl) {
          const metaReq = await _req(decodeURIComponent(vars.metadataUrl), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: vars.location ? `st.location=${encodeURIComponent(vars.location)}` : '' });
          meta = await metaReq.json();
        }
        if (!meta) return null;
        const vids = meta.videos || [];
        if (vids.length) return { url: vids[0].url, kind: 'mp4', headers: { Referer: 'https://ok.ru/' } };
        return { url: meta.hlsManifestUrl || meta.ondemandHls, kind: 'm3u8', headers: { Referer: 'https://ok.ru/' } };
      } catch(e) { return null; }
    }
  });

  // 13. Mixdrop
  CUSTOM.push({
    name: 'Mixdrop',
    match: (u) => /mixdrop|mxdrop/i.test(u.hostname),
    run: async (link) => {
      const embed = link.url.replace('/f/', '/e/');
      const r = await _req(embed, { headers: { Referer: link.url } });
      const html = await r.text();
      const unp = _unpackAll(html).join('\n');
      const m = unp.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/);
      return { url: m ? m[1] : null, kind: 'mp4', headers: { Referer: new URL(embed).origin + '/' } };
    }
  });

  // 14. VidMoly
  CUSTOM.push({
    name: 'VidMoly',
    match: (u) => /vidmoly/i.test(u.hostname),
    run: async (link) => {
      const r = await _req(link.url, { headers: { Referer: 'https://vidmoly.me/' } });
      const html = await r.text();
      const m = html.match(/file\s*:\s*["']([^"']+)["']/);
      return { url: m ? m[1] : null, kind: 'mp4', headers: { Referer: 'https://vidmoly.me/' } };
    }
  });

  // 15. Rpmvid (y similares)
  CUSTOM.push({
    name: 'Rpmvid',
    match: (u) => /rpmvid|vidstack|upns|4meplayer/i.test(u.hostname),
    run: async (link) => {
      const base = new URL(link.url).origin;
      const id = link.url.includes('#') ? link.url.split('#').pop().replace(/^\//, '').split('&')[0] : link.url.replace(/[?#].*$/, '').split('/').pop();
      const r = await _req(`${base}/api/v1/video?id=${id}&w=1920&h=1080&r=`, { headers: { Referer: link.url } });
      const hex = (await r.text()).trim();
      if (/^[0-9a-f]+$/i.test(hex)) {
        const dec = await _aesDecrypt(hex, '6b69656d7469656e6d75613931316361', '313233343536373839306f6975797472');
        if (dec) {
          try {
            const d = JSON.parse(dec);
            return { url: d.source || d.cfNative, kind: 'm3u8', headers: { Referer: base } };
          } catch(e){}
        }
      }
      return null;
    }
  });

  // 16. Dailymotion
  CUSTOM.push({
    name: 'Dailymotion',
    match: (u) => /dailymotion|dai\.ly/i.test(u.hostname),
    run: async (link) => {
      const id = (link.url.match(/(?:video\/|video=|dai\.ly\/)([a-z0-9]+)/i) || [])[1];
      if (!id) return null;
      const r = await _req(`https://www.dailymotion.com/player/metadata/video/${id}`);
      const d = await r.json();
      const auto = d && d.qualities && d.qualities.auto && d.qualities.auto[0];
      return { url: auto ? auto.url : null, kind: 'm3u8' };
    }
  });

  // 17. Pixeldrain
  CUSTOM.push({
    name: 'Pixeldrain',
    match: (u) => /pixeldrain/i.test(u.hostname),
    run: async (link) => {
      const id = (link.url.match(/\/(?:u|l|api\/file)\/([\w-]+)/) || [])[1];
      return { url: id ? `https://pixeldrain.com/api/file/${id}?download` : null, kind: 'mp4' };
    }
  });

  // 18. Sendvid / 19. YourUpload
  CUSTOM.push({
    name: 'Sendvid',
    match: (u) => /sendvid|yourupload/i.test(u.hostname),
    run: async (link) => {
      const url = link.url.replace('/watch/', '/embed/');
      const r = await _req(url);
      const html = await r.text();
      const m = html.match(/property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) || html.match(/<source[^>]+src=["']([^"']+)["']/i) || html.match(/file\s*:\s*['"]([^'"]+)['"]/);
      return { url: m ? m[1] : null, kind: 'mp4', headers: { Referer: url } };
    }
  });

  // 20. Fastream / 21. GoodStream / 22. LaCloud / 23. TPlayer (Genéricos simples)
  CUSTOM.push({
    name: 'Fastream',
    match: (u) => /fastream|goodstream|lacloud|tplayer/i.test(u.hostname),
    run: async (link) => {
      const r = await _req(link.url);
      const html = await r.text();
      const m = html.match(/file\s*:\s*["']([^"']+)["']/) || html.match(/const src\s*=\s*["']([^"']+)["']/) || html.match(/src\s*=\s*["']([^"']+)["']/);
      return { url: m ? m[1] : _findM3u8(html, r.url), kind: 'm3u8', headers: { Referer: r.url } };
    }
  });

  // 24. GDrive
  CUSTOM.push({
    name: 'GDrive',
    match: (u) => /drive\.google|google\.com/i.test(u.hostname),
    run: async (link) => {
      const m = link.url.match(/[?&]id=([a-zA-Z0-9_-]+)/) || link.url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (!m) return null;
      const id = m[1];
      const r = await _req(`https://drive.usercontent.google.com/download?id=${id}&export=download`, { redirect: 'manual' });
      if (r.status === 302 || r.status === 303) {
        const loc = r.headers.get('location');
        if (loc) return { url: loc, kind: 'mp4' };
      }
      const html = await r.text();
      const confirm = html.match(/name="confirm"\s+value="([^"]+)"/i);
      const uuid = html.match(/name="uuid"\s+value="([^"]+)"/i);
      if (confirm && uuid) {
        return { url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=${confirm[1]}&uuid=${uuid[1]}`, kind: 'mp4' };
      }
      return null;
    }
  });

  // 25. KeKi / LuluStream
  CUSTOM.push({
    name: 'LuluStream',
    match: (u) => /keki|lulustream|luluvdo/i.test(u.hostname),
    run: async (link) => {
      const r = await _req(link.url, { headers: { Referer: 'https://lulustream.com/' } });
      const html = await r.text();
      const m3u8 = _findM3u8(html, r.url);
      return { url: m3u8, kind: 'm3u8', headers: { Referer: 'https://lulustream.com/' } };
    }
  });

  // 26. Buzzheavier
  CUSTOM.push({
    name: 'Buzzheavier',
    match: (u) => /buzzheavier|bzh\.sh/i.test(u.hostname),
    run: async (link) => {
      const clean = link.url.split('|')[0].replace(/\/$/, '');
      const r = await _req(clean + '/download', { method: 'HEAD', headers: { 'hx-request': 'true', Referer: clean } });
      const hx = r.headers.get('hx-redirect');
      if (hx) {
        return { url: (hx.startsWith('/dl/') ? new URL(clean).origin + hx : hx) + '#.mp4', kind: 'mp4' };
      }
      return null;
    }
  });

  // 27. TurboVid
  CUSTOM.push({
    name: 'TurboVid',
    match: (u) => /turbovid/i.test(u.hostname),
    run: async (link) => {
      const r = await _req(link.url, { headers: { Referer: link.url } });
      const html = await r.text();
      const m = html.match(/data-hash="([^"]+\.m3u8[^"]*)"/);
      return { url: m ? m[1] : null, kind: 'm3u8', headers: { Referer: link.url } };
    }
  });

  // 28. EmbedSeek
  CUSTOM.push({
    name: 'EmbedSeek',
    match: (u) => /embedseek|seekstreaming|seekplays/i.test(u.hostname),
    run: async (link) => {
      // AES dinamico, se aproxima buscando el m3u8 en el HTML o API
      const r = await _req(link.url);
      const html = await r.text();
      const m3u8 = _findM3u8(html, r.url);
      return { url: m3u8, kind: 'm3u8', headers: { Referer: r.url } };
    }
  });

  // 29. DropCDN
  CUSTOM.push({
    name: 'DropCDN',
    match: (u) => /dropcdn|dropload|dr0pstream/i.test(u.hostname),
    run: async (link) => {
      const r = await _req(link.url);
      const html = await r.text();
      const m3u8 = _findM3u8(html, r.url);
      return { url: m3u8, kind: 'm3u8', headers: { Referer: r.url } };
    }
  });

  // 30. VidSrc
  CUSTOM.push({
    name: 'VidSrc',
    match: (u) => /vidsrc|moviesapi/i.test(u.hostname),
    run: async (link) => {
      const r1 = await _req(link.url);
      const html1 = await r1.text();
      const ifr = html1.match(/src=['"]([^"]+)['"] f/);
      if (!ifr) return null;
      let next = ifr[1].startsWith('//') ? 'https:' + ifr[1] : ifr[1];
      const r2 = await _req(next, { headers: { Referer: r1.url } });
      const html2 = await r2.text();
      const enc = html2.match(/id="([^"]+)" style="display:none;">([^<]+)/);
      if (!enc) return null;
      // Decodificación por id omitida por simplicidad, busca m3u8 directo en el HTML final
      const m3u8 = _findM3u8(html2, r2.url);
      return { url: m3u8, kind: 'm3u8', headers: { Referer: r2.url } };
    }
  });

  // 31. VidNest / 32. VidSonic / 33. Barmonrey
  CUSTOM.push({
    name: 'VidNest',
    match: (u) => /vidnest|vidsonic|barmonrey/i.test(u.hostname),
    run: async (link) => {
      const r = await _req(link.url);
      const html = await r.text();
      const m3u8 = _findM3u8(html, r.url);
      return { url: m3u8, kind: 'm3u8', headers: { Referer: r.url } };
    }
  });

  // 34. Yandex
  CUSTOM.push({
    name: 'Yandex',
    match: (u) => /yandex/i.test(u.hostname),
    run: async (link) => {
      const r = await _req(`https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(link.url)}`);
      const d = await r.json();
      return { url: d ? d.href : null, kind: 'mp4' };
    }
  });

  // 35. GDTvid
  CUSTOM.push({
    name: 'GDTvid',
    match: (u) => /gdtvid|p2pplay/i.test(u.hostname),
    run: async (link) => {
      // Requiere complejo manejo de cookies y sesión, simplificado a busqueda directa
      const r = await _req(link.url);
      const html = await r.text();
      const m3u8 = _findM3u8(html, r.url);
      return { url: m3u8, kind: 'm3u8', headers: { Referer: r.url } };
    }
  });

  // 36. PlayerZilla
  CUSTOM.push({
    name: 'PlayerZilla',
    match: (u) => /zilla-networks/i.test(u.hostname),
    run: async (link) => {
      return { url: link.url.replace('/play/', '/m3u8/'), kind: 'm3u8', headers: { Referer: 'https://animeav1.com/' } };
    }
  });

  // 37. Genérico (Fallback)
  CUSTOM.push({
    name: 'Generic',
    match: () => true, // Atrapa todo lo que no haya hecho match antes
    run: async (link, log) => {
      log('Usando extractor genérico...');
      const r = await _req(link.url, { headers: { Referer: link.referer || link.url } });
      const html = await r.text();
      
      const m3u8 = _findM3u8(html, r.url, log);
      if (m3u8) return { url: m3u8, kind: 'm3u8', headers: { Referer: r.url } };
      
      const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframe) {
        const iframeUrl = new URL(iframe[1], r.url).href;
        log('Redirigiendo a iframe interno: ' + iframeUrl);
        return { url: iframeUrl, kind: 'iframe', headers: { Referer: r.url } };
      }
      
      const mp4 = html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
      if (mp4) return { url: mp4[1], kind: 'mp4', headers: { Referer: r.url } };
      
      return null;
    }
  });

  // =========================================================================
  // MOTOR PRINCIPAL
  // =========================================================================

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
      const r = await _req(url, { headers: reqH });
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
      const r = await _req(url, { headers: h });
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
    let lh = (link.headers && typeof link.headers === 'object') ? link.headers : null;

    let target = url, tKind = kind, handled = false;

    for (const c of CUSTOM) {
      let hit = false; try { hit = !!c.match(u, link); } catch (_) {}
      if (!hit) continue;
      log('\n-- Extractor propio: ' + c.name + ' --');
      try {
        const r = await c.run(link, log, { nativeFetch, probe: _probe });
        if (r && r.url) {
          target = r.url; tKind = r.kind || 'm3u8'; if (r.headers) lh = r.headers; handled = true; log('→ ' + target.slice(0, 160)); break;
        }
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

    log('\n-- Probando variantes de cabeceras --');
    let lastWhy = 'ninguna variante abrió la lista (revisa los HTTP de arriba)';
    for (const v of variants) {
      const r = await _probe(target, v.h, tKind === 'mp4', log, v.n);
      if (!(r.status >= 200 && r.status < 300)) continue;
      if (tKind === 'mp4') {
        if (r.text.slice(4, 8) === 'ftyp') {
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
