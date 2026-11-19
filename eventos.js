(function () {
  'use strict';
  const VERSION = '1.0.7';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  const AGENDA_JSON = 'https://api.wqxag.com/diaries.json';

  const FLAGS = {
    'Brasil': '🇧🇷',
    'Argentina': '🇦🇷',
    'México': '🇲🇽',
    'Colombia': '🇨🇴',
    'Chile': '🇨🇱',
    'Uruguay': '🇺🇾',
    'España': '🇪🇸',
    'Inglaterra': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    'Italia': '🇮🇹',
    'Francia': '🇫🇷',
    'Alemania': '🇩🇪',
    'Estados Unidos': '🇺🇸',
    'Ecuador': '🇪🇨',
    'Perú': '🇵🇪'
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
      const calidad = calidadMatch ? calidadMatch[0] : '';

      canales.push({ name: nombre, url: url, quality: calidad });
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
    } 
    else if (match.includes('–')) {
      const partes = match.split('–');
      liga = partes[0].trim();
      match = partes.slice(1).join('–').trim();
    } 
    else if (match.includes(' - ')) {
      const partes = match.split(' - ');
      liga = partes[0].trim();
      match = partes.slice(1).join(' - ').trim();
    }

    // --- CORRECCIÓN DE LAS 5 HORAS AQUÍ ---
    let time_utc = '';
    let hora_corregida = hora; // Mantenemos el valor original por defecto
    
    if (fechaStr && hora) {
      const [anio, mes, dia] = fechaStr.split('-').map(Number);
      const [h, min] = hora.split(':').map(Number);
      
      // Creamos la fecha en UTC
      const d = new Date(Date.UTC(anio, mes - 1, dia, h, min || 0, 0));
      
      // Le sumamos 5 horas para compensar la resta de tu app
      d.setUTCHours(d.getUTCHours() + 5);
      
      time_utc = d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
      
      // Formateamos la hora adelantada (ej: si era 19:30, ahora es 00:30)
      // Esto es por si tu app usa el campo "time" en vez de "time_utc"
      const nuevaH = String(d.getUTCHours()).padStart(2, '0');
      const nuevoMin = String(d.getUTCMinutes()).padStart(2, '0');
      hora_corregida = `${nuevaH}:${nuevoMin}`;
    }
    // --------------------------------------

    const pais = attrs.country?.data?.attributes?.name || '';
    const flag = FLAGS[pais] || '⚽'; 

    const canales = extraerCanales(attrs.embeds?.data);

    return {
      time: hora_corregida, // <-- Ahora envía la hora + 5
      time_utc: time_utc,   // <-- Ahora envía el UTC + 5
      league: liga,     
      match: match,     
      flag: flag,
      channels: canales
    };
  }

  async function getEventos() {
    const opciones = {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
      }
    };

    try {
      console.log('[Eventos] Consultando API JSON...');
      const respuesta = await fetch(AGENDA_JSON, opciones);

      if (!respuesta.ok) {
        console.warn('[Eventos] Error HTTP:', respuesta.status);
        return [];
      }

      const json = await respuesta.json();
      const items = json.data || [];

      const eventos = items
        .filter(item => item.attributes && item.attributes.diary_description)
        .map(parsearEvento);

      console.log(`[Eventos] Extraídos ${eventos.length} partidos.`);
      return eventos;
    } catch (e) {
      console.warn('[Eventos] Error de red o parseo:', e.message);
      return [];
    }
  }

  window.getEventos = function () {
    return Promise.resolve().then(() => getEventos()).catch(() => []);
  };
})();
