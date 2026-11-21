(function () {
  'use strict';
  const VERSION = '1.0.08;
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  // =====================================================================
  //  FUENTE 1: FutbolLibrePlus (API JSON)  — lógica de futbollibreplus.js
  // =====================================================================
  const FutbolLibre = (function () {
    const AGENDA_JSON = 'https://api.wqxag.com/diaries.json';

    const FLAGS = {
      'Brasil': '🇧🇷', 'Argentina': '🇦🇷', 'México': '🇲🇽', 'Colombia': '🇨🇴',
      'Chile': '🇨🇱', 'Uruguay': '🇺🇾', 'España': '🇪🇸', 'Inglaterra': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
      'Italia': '🇮🇹', 'Francia': '🇫🇷', 'Alemania': '🇩🇪', 'Estados Unidos': '🇺🇸',
      'Ecuador': '🇪🇨', 'Perú': '🇵🇪'
    };

    function b64dec(s) {
      try {
        if (typeof atob === 'function') {
          let str = s.replace(/-/g, '+').replace(/_/g, '/');
          while (str.length % 4) str += '=';
          const bin = atob(str);
          let out = '';
          for (let i = 0; i < bin.length; i++) out += String.fromCharCode(bin.charCodeAt(i));
          return out;
        }
      } catch (e) {}
      return '';
    }

    function extraerCanales(embeds) {
      const canales = [];
      if (!embeds || !Array.isArray(embeds)) return canales;
      for (const embed of embeds) {
        const attrs = embed.attributes || {};
        const nombre = (attrs.embed_name || '').trim();
        const iframe = attrs.embed_iframe || '';
        const match = iframe.match(/[?&]r=([^&]+)/);
        if (!match) continue;
        const url = b64dec(match[1]);
        if (!/^https?:\/\//.test(url)) continue;
        const calidadMatch = nombre.match(/\b(HD|SD|FHD|4K)\b/i);
        canales.push({ name: nombre, url: url, quality: calidadMatch ? calidadMatch[0] : '' });
      }
      return canales;
    }

    function parsearEvento(item) {
      const attrs = item.attributes || {};
      const descripcion = attrs.diary_description || '';
      const hora = attrs.diary_hour ? attrs.diary_hour.substring(0, 5) : '';
      const fechaStr = attrs.date_diary || ''; // YYYY-MM-DD

      let liga = '';
      let match = descripcion.trim();
      if (match.includes(':')) {
        const partes = match.split(':');
        liga = partes[0].trim();
        match = partes.slice(1).join(':').trim();
      } else if (match.includes('–')) {
        const partes = match.split('–');
        liga = partes[0].trim();
        match = partes.slice(1).join('–').trim();
      } else if (match.includes(' - ')) {
        const partes = match.split(' - ');
        liga = partes[0].trim();
        match = partes.slice(1).join(' - ').trim();
      }

      // La API trae hora de Colombia; se suman 5 h para entregar UTC (la app lo vuelve a pasar a Colombia)
      let time_utc = '';
      let hora_corregida = hora;
      if (fechaStr && hora) {
        const [anio, mes, dia] = fechaStr.split('-').map(Number);
        const [h, min] = hora.split(':').map(Number);
        const d = new Date(Date.UTC(anio, mes - 1, dia, h, min || 0, 0));
        d.setUTCHours(d.getUTCHours() + 5);
        time_utc = d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
        hora_corregida = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
      }

      const pais = attrs.country?.data?.attributes?.name || '';
      return {
        time: hora_corregida,
        time_utc: time_utc,
        league: liga,
        match: match,
        flag: FLAGS[pais] || '⚽',
        channels: extraerCanales(attrs.embeds?.data)
      };
    }

    async function getEventos() {
      const opciones = {
        method: 'GET',
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' }
      };
      try {
        console.log('[Eventos:FutbolLibre] Consultando API JSON...');
        const respuesta = await fetch(AGENDA_JSON, opciones);
        if (!respuesta.ok) {
          console.warn('[Eventos:FutbolLibre] Error HTTP:', respuesta.status);
          return [];
        }
        const json = await respuesta.json();
        const items = json.data || [];
        const eventos = items
          .filter(item => item.attributes && item.attributes.diary_description)
          .map(parsearEvento);
        console.log(`[Eventos:FutbolLibre] Extraídos ${eventos.length} partidos.`);
        return eventos;
      } catch (e) {
        console.warn('[Eventos:FutbolLibre] Error de red o parseo:', e.message);
        return [];
      }
    }

    return { getEventos };
  })();

  // =====================================================================
  //  FUENTE 2: Fawanews (HTML)  — lógica de fawanews.js
  // =====================================================================
  const Fawanews = (function () {
    const BASES = ['https://www.fawanews.sc/', 'http://www.fawanews.sc/'];
    const SITE_OFFSET_H = 1;   // la web muestra la hora en GMT+1
    const CONCURRENCIA = 6;

    const FLAGS = [
      ['English', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'], ['Spain', '🇪🇸'], ['Spanish', '🇪🇸'], ['Italy', '🇮🇹'],
      ['German', '🇩🇪'], ['France', '🇫🇷'], ['French', '🇫🇷'], ['Turkey', '🇹🇷'],
      ['Russia', '🇷🇺'], ['Sweden', '🇸🇪'], ['Denmark', '🇩🇰'], ['Serbia', '🇷🇸'],
      ['Romania', '🇷🇴'], ['Bulgaria', '🇧🇬'], ['Hungary', '🇭🇺'], ['Azerbaijan', '🇦🇿'],
      ['UAE', '🇦🇪'], ['India', '🇮🇳'], ['Thailand', '🇹🇭'], ['Vietnam', '🇻🇳'],
      ['Malaysia', '🇲🇾'], ['Australia', '🇦🇺'], ['South Africa', '🇿🇦'],
      ['Bosnia', '🇧🇦'], ['Brazil', '🇧🇷'], ['Argentina', '🇦🇷'], ['Mexico', '🇲🇽']
    ];

    function flagDe(liga) {
      for (const [k, f] of FLAGS) if (liga.indexOf(k) === 0) return f;
      return '⚽';
    }

    function decodeHtml(s) {
      return (s || '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
    }

    // fawanews.sc no envía cabeceras CORS: se usa nativeFetch y fetch solo como respaldo
    async function pedir(url) {
      const opts = {
        method: 'GET',
        headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' }
      };
      let r;
      if (typeof window.nativeFetch === 'function') {
        r = await window.nativeFetch(url, opts);
      } else {
        console.warn('[Eventos:Fawanews] nativeFetch no existe, usando fetch (puede fallar por CORS)');
        r = await fetch(url, opts);
      }
      if (typeof r === 'string') return r;
      if (r && typeof r.data === 'string') return r.data;
      if (r && typeof r.text === 'function') {
        if (r.ok === false) throw new Error('HTTP ' + r.status);
        return r.text();
      }
      throw new Error('Respuesta no reconocida');
    }

    function parsearPortada(html) {
      const bloques = html.split('class="user-item --active"').slice(1);
      const items = [];
      for (const b of bloques) {
        const playing = b.match(/user-item__playing">([^<]+)/);
        if (!playing) continue;
        const href = b.match(/href="([^"]+\.html)"/);
        const nombre = b.match(/user-item__name">([^<]+)/);
        if (!href || !nombre) continue;
        const p = decodeHtml(playing[1]).match(/^(.*?)\s+(\d{1,2}:\d{2})$/);
        if (!p) continue;
        items.push({
          href: href[1],
          match: decodeHtml(nombre[1]),
          league: p[1].trim(),
          hora: p[2].padStart(5, '0')
        });
      }
      return items;
    }

    // La hora de la web es GMT+1 y es la de HOY (en GMT+1)
    function calcularHoras(hora) {
      const ahoraSitio = new Date(Date.now() + SITE_OFFSET_H * 3600000);
      const [h, m] = hora.split(':').map(Number);
      const d = new Date(Date.UTC(ahoraSitio.getUTCFullYear(), ahoraSitio.getUTCMonth(), ahoraSitio.getUTCDate(), h - SITE_OFFSET_H, m, 0));
      return d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
    }

    function extraerCanales(html) {
      const urls = [];
      const add = (u) => { if (/^https?:\/\//.test(u) && urls.indexOf(u) === -1) urls.push(u); };

      // Patrón 1: S1 (array de servidores) + S2 + S3
      const s1 = html.match(/var\s+S1\s*=\s*\[([\s\S]*?)\]/);
      const s2 = html.match(/var\s+S2\s*=\s*["']([^"']*)["']/);
      const s3 = html.match(/var\s+S3\s*=\s*["']([^"']*)["']/);
      if (s1 && s2 && s3) {
        const servers = [...s1[1].matchAll(/["']([^"']+)["']/g)].map(x => x[1]);
        servers.forEach(sv => add(sv + s2[1] + s3[1]));
      }

      // Patrón 2: var d1="..."; var d2="..."; var d3=".m3u8"; var X=[d1 + d2 + d3];
      const vars = {};
      for (const m of html.matchAll(/var\s+(\w+)\s*=\s*["']([^"']*)["']\s*;/g)) vars[m[1]] = m[2];
      for (const m of html.matchAll(/var\s+\w+\s*=\s*\[([^\]]*\+[^\]]*)\]/g)) {
        for (const expr of m[1].split(',')) {
          let out = '', ok = true;
          for (const tok of expr.split('+').map(t => t.trim()).filter(Boolean)) {
            const lit = tok.match(/^["']([^"']*)["']$/);
            if (lit) out += lit[1];
            else if (vars[tok] !== undefined) out += vars[tok];
            else { ok = false; break; }
          }
          if (ok) add(out);
        }
      }

      // Respaldos: m3u8 literales e iframes
      for (const m of html.matchAll(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/g)) add(m[1]);
      for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) add(m[1]);

      return urls.map((u, i) => ({ name: 'Canal ' + (i + 1), url: u, quality: '' }));
    }

    async function canalesDe(base, href) {
      try {
        const url = new URL(encodeURI(decodeURI(href)), base).href;
        return extraerCanales(await pedir(url));
      } catch (e) {
        console.warn('[Eventos:Fawanews] Error en evento', href, e.message);
        return [];
      }
    }

    async function enParalelo(lista, fn, limite) {
      const res = new Array(lista.length);
      let idx = 0;
      async function worker() {
        while (idx < lista.length) {
          const i = idx++;
          res[i] = await fn(lista[i]);
        }
      }
      await Promise.all(Array.from({ length: Math.min(limite, lista.length) }, worker));
      return res;
    }

    async function getEventos() {
      let base = null, html = '';
      for (const b of BASES) {
        try {
          console.log('[Eventos:Fawanews] Consultando', b);
          html = await pedir(b);
          base = b;
          break;
        } catch (e) {
          console.warn('[Eventos:Fawanews] Falló', b, e.message);
        }
      }
      if (!base) return [];

      const items = parsearPortada(html);
      console.log(`[Eventos:Fawanews] ${items.length} eventos en portada, buscando canales...`);
      const canales = await enParalelo(items, it => canalesDe(base, it.href), CONCURRENCIA);

      // Agrupa "X --- CH 1" y "X --- CH 2" en un solo evento
      const grupos = new Map();
      items.forEach((it, i) => {
        const limpio = it.match.replace(/\s*[-–—]+\s*CH\s*\d+\s*$/i, '').trim();
        const clave = (limpio + '|' + it.league + '|' + it.hora).toLowerCase();
        let g = grupos.get(clave);
        if (!g) {
          const tUtc = calcularHoras(it.hora);
          g = {
            time: tUtc.substring(11, 16), // HH:MM en UTC; la app lo pasa a hora local (Colombia)
            time_utc: tUtc,
            league: it.league,
            match: limpio,
            flag: flagDe(it.league),
            urls: []
          };
          grupos.set(clave, g);
        }
        if (!canales[i].length) console.warn('[Eventos:Fawanews] Sin canales:', it.href);
        canales[i].forEach(c => { if (g.urls.indexOf(c.url) === -1) g.urls.push(c.url); });
      });

      const eventos = [];
      grupos.forEach(g => {
        if (!g.urls.length) return;
        eventos.push({
          time: g.time,
          time_utc: g.time_utc,
          league: g.league,
          match: g.match,
          flag: g.flag,
          channels: g.urls.map((u, i) => ({ name: 'Canal ' + (i + 1), url: u, quality: '' }))
        });
      });

      console.log(`[Eventos:Fawanews] ${eventos.length} eventos con canal de ${items.length} entradas.`);
      return eventos;
    }

    return { getEventos };
  })();

  // =====================================================================
  //  FUSIÓN: mismo partido en las dos fuentes = un solo evento con todos los canales
  //  Criterio: hora cercana (±30 min) Y los dos equipos parecidos (en cualquier orden)
  // =====================================================================
  const STOP = new Set(['fc', 'cf', 'cd', 'sc', 'ac', 'afc', 'ud', 'sd', 'club', 'de', 'del', 'la', 'el', 'the']);
  const ALIAS = { utd: 'united', atl: 'atletico', ath: 'athletic', w: 'women', int: 'inter' };

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function tokens(s) {
    return norm(s).split(' ').filter(t => t && !STOP.has(t)).map(t => ALIAS[t] || t);
  }

  function lev(a, b) {
    const m = a.length, n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i].concat(new Array(n).fill(0)));
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[m][n];
  }

  function tokMatch(a, b) {
    if (a === b) return true;
    if (a.length >= 3 && b.startsWith(a)) return true;
    if (b.length >= 3 && a.startsWith(b)) return true;
    if (a.length >= 5 && b.length >= 5 && lev(a, b) <= 1) return true;
    return false;
  }

  // Todos los tokens del nombre más corto deben aparecer en el más largo
  function equipoParecido(x, y) {
    let ta = tokens(x), tb = tokens(y);
    if (!ta.length || !tb.length) return false;
    if (ta.length > tb.length) { const t = ta; ta = tb; tb = t; }
    return ta.every(a => tb.some(b => tokMatch(a, b)));
  }

  function equipos(nombre) {
    const p = String(nombre || '').split(/\s+(?:vs\.?|v|-|–)\s+/i);
    return p.length === 2 ? p : null;
  }

  function mismoEvento(a, b) {
    const ta = Date.parse(a.time_utc), tb = Date.parse(b.time_utc);
    if (isNaN(ta) || isNaN(tb) || Math.abs(ta - tb) > 30 * 60000) return false;
    const ea = equipos(a.match), eb = equipos(b.match);
    if (ea && eb) {
      return (equipoParecido(ea[0], eb[0]) && equipoParecido(ea[1], eb[1])) ||
             (equipoParecido(ea[0], eb[1]) && equipoParecido(ea[1], eb[0]));
    }
    return norm(a.match) === norm(b.match);
  }

  // Base = FutbolLibre (conserva su nombre, liga y bandera); se le suman los canales de Fawanews
  function fusionar(base, extra) {
    const out = (base || []).map(e => Object.assign({}, e, { channels: (e.channels || []).slice() }));
    let fusionados = 0;
    (extra || []).forEach(ev => {
      const dest = out.find(o => mismoEvento(o, ev));
      if (!dest) { out.push(ev); return; }
      fusionados++;
      ev.channels.forEach(c => {
        if (!dest.channels.some(x => x.url === c.url)) dest.channels.push(c);
      });
    });
    console.log(`[Eventos] Fusionados ${fusionados} partidos presentes en ambas fuentes.`);
    return out;
  }

  // =====================================================================
  //  UNIFICADO: cada fuente va por su lado; si una falla, la otra sigue
  // =====================================================================
  async function getEventos() {
    const fuentes = [FutbolLibre, Fawanews];
    const listas = await Promise.all(
      fuentes.map(f => f.getEventos().catch(e => {
        console.warn('[Eventos] Fuente con error:', e && e.message);
        return [];
      }))
    );
    const todos = fusionar(listas[0], listas[1]);
    todos.sort((a, b) => String(a.time_utc).localeCompare(String(b.time_utc)));
    console.log(`[Eventos] Total unificado: ${todos.length} eventos.`);
    return todos;
  }

  window.getEventos = function () {
    return Promise.resolve().then(() => getEventos()).catch(() => []);
  };
  window.getEventos.version = VERSION;
})();
