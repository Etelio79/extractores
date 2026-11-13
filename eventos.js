(function () {
  'use strict';
  const VERSION = '1.0.2'; // <-- Recuerda subir esto en tu version.json
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
  let _nf = null;

  const BASE   = 'https://futbollibreplus.st'; 
  const AGENDA = `${BASE}/agenda.php`;

  const FLAGS = {
    NAT: '🌍', COL: '🇨🇴', MEX: '🇲🇽', AR: '🇦🇷', URU: '🇺🇾', CHA: '🇨🇱',
    ES: '🇪🇸', ENG: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', IT: '🇮🇹', BRA: '🇧🇷', FRA: '🇫🇷', ALE: '🇩🇪',
    USA: '🇺🇸', ECU: '🇪🇨', PER: '🇵🇪', LIB: '🏆', SUD: '🏆',
    CONNAT: '🌎', CONCACAFCHA: '🌎', UEFA: '🇪🇺',
    NBA: '🏀', NFL: '🏈', MLB: '⚾', NHL: '🏒', UFC: '🥊', F1: '🏎️',
    MOTOGP: '🏍️', BOX: '🥊', WWE: '🤼', VOLEY: '🏐', RUG: '🏉',
    BAS: '🏀', TENIS: '🎾', TE: '🎾'
  };

  const MESES = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
    noviembre: 10, diciembre: 11
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

  function fechaAgenda(html) {
    const m = html.match(/Agenda\s*-\s*[A-Za-záéíóúñ]+\s+(\d{1,2})\s+de\s+([A-Za-záéíóúñ]+)\s+de\s+(\d{4})/i);
    if (!m) return null;
    const mes = MESES[m[2].toLowerCase()];
    if (mes === undefined) return null;
    return { dia: Number(m[1]), mes: mes, anio: Number(m[3]) };
  }

  function aUtc(fecha, hora) {
    if (!fecha) return '';
    const [h, min] = hora.split(':').map(Number);
    const d = new Date(Date.UTC(fecha.anio, fecha.mes, fecha.dia, h, min || 0, 0));
    return d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  }

  function parsearCanales(bloque) {
    const canales = [];
    const rx = /<li class="subitem\d+">\s*<a href="\/eventos\.html\?r=([^"]+)"[^>]*>([\s\S]*?)<\/a><\/li>/g;
    let m;
    while ((m = rx.exec(bloque))) {
      const url = b64dec(m[1]);
      if (!/^https?:\/\//.test(url)) continue;
      const interior = m[2];
      const cm = interior.match(/^([\s\S]*?)(?:<span>\s*([^<]*?)\s*<\/span>)?\s*$/);
      const nombre  = (cm && cm[1] ? cm[1] : interior).replace(/\s+/g, ' ').trim();
      const calidad = (cm && cm[2] ? cm[2] : '').trim();
      canales.push({ name: nombre, url: url, quality: calidad });
    }
    return canales;
  }

  function parsearAgenda(html) {
    const fecha = fechaAgenda(html);
    const eventos = [];
    // FIX: Acepta cualquier etiqueta <a> en el titulo, no solo <a href="#">
    const rx = /<li class="([^"]+)">\s*<a[^>]*>\s*([\s\S]*?)\s*<span class="t">(\d{1,2}:\d{2})<\/span><\/a>\s*<ul>([\s\S]*?)<\/ul>\s*<\/li>/g;
    let m;
    
    while ((m = rx.exec(html))) {
      const clase = m[1].trim();
      const bruto = m[2].replace(/\s+/g, ' ').trim();
      const hora  = m[3];
      const canales = parsearCanales(m[4]);
      
      // FIX: Eliminamos el "if (!canales.length) continue;" para mostrar partidos sin canales
      
      const partes = bruto.split(':');
      const liga   = partes.length > 1 ? partes[0].trim() : '';
      const match  = partes.length > 1 ? partes.slice(1).join(':').trim() : bruto;

      eventos.push({
        time:     hora,
        time_utc: aUtc(fecha, hora),
        match:    match,
        league:   liga || clase,
        flag:     FLAGS[clase] || '⚽',
        channels: canales // Ahora puede venir vacío []
      });
    }
    return eventos;
  }

  async function traer(url, opciones) {
    if (typeof window.nativeFetch === 'function') return window.nativeFetch(url, opciones);
    return fetch(url, opciones);
  }

  async function getEventos() {
    const o = {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        Referer: `${BASE}/`
      }
    };
    
    try {
      const r = await traer(AGENDA, o);
      if (!r || !r.ok) return [];
      const html = await r.text();
      return parsearAgenda(html);
    } catch (e) {
      return [];
    }
  }

  window.getEventos = function() {
    return Promise.resolve().then(() => getEventos()).catch(() => []);
  };
})();
