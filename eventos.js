(function () {
  'use strict';
  const VERSION = '1.0.6';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  // Nueva fuente de datos (API JSON)
  const AGENDA_JSON = 'https://api.wqxag.com/diaries.json';

  // Mapeo de países para las banderas (basado en lo que devuelve la API)
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

      // Extraer calidad del nombre (HD, SD, etc.)
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

    // --- LÓGICA MEJORADA PARA SEPARAR LIGA Y EQUIPOS ---
    let liga = '';
    let match = descripcion.trim();

    // 1. Intentar dividir por ':' (Ej: "Brasileirão: Remo vs Chapecoense")
    if (match.includes(':')) {
      const partes = match.split(':');
      liga = partes[0].trim();
      match = partes.slice(1).join(':').trim();
    } 
    // 2. Intentar dividir por '–' o '-' (Ej: "Tenis – Nitto ATP Final" o "NBA - Dallas...")
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

    // Construir fecha UTC (AQUÍ ESTÁ LA CORRECCIÓN DE LAS 5 HORAS)
    let time_utc = '';
    if (fechaStr && hora) {
      const [anio, mes, dia] = fechaStr.split('-').map(Number);
      const [h, min] = hora.split(':').map(Number);
      
      // Se suma +5 a la hora (h + 5) antes de crear el objeto Date.
      // Date.UTC maneja automáticamente si las horas pasan de 23 (ej. 22:00 + 5h = 03:00 del día siguiente).
      const d = new Date(Date.UTC(anio, mes - 1, dia, h + 5, min || 0, 0));
      
      time_utc = d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
    }

    // País y bandera
    const pais = attrs.country?.data?.attributes?.name || '';
    // Si el país no está en el diccionario (como NBA o Tenis), usa el balón de fútbol por defecto
    const flag = FLAGS[pais] || '⚽'; 

    // Canales
    const canales = extraerCanales(attrs.embeds?.data);

    return {
      time: hora,
      time_utc: time_utc,
      league: liga,     // Arriba: Liga o Deporte
      match: match,     // Abajo: Equipos o Evento
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

  // Exponer la función globalmente
  window.getEventos = function () {
    return Promise.resolve().then(() => getEventos()).catch(() => []);
  };
})();
