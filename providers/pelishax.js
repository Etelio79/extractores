const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FUENTE = 'PelisHax';
const BASE_URL = 'https://pelishaxpro.com';

/* ── Lista blanca: solo se devuelven embeds de hosts que ya reproducen en la app ──
   Se compara contra el dominio del embed y contra el nombre que da el sitio (no contra la ruta). */
const HOSTS_OK = /voe|marissashare|cloudwindow|vidhide|dintezuvio|diasfem|minochinos|dhtpre|ryderjet|filelions|vimeos|vimeus|morencius|filemoon|moonplayer|moonalu|moonembed|fmoon|byse|kerapoxy|f16px|r66nv9ed|398fitus|vidara|mxzhxco8dft/i;
const NOMBRES = [
  [/voe|marissashare|cloudwindow/i, 'Voe'], [/filemoon|moonplayer|moonalu|moonembed|fmoon|byse|kerapoxy|f16px|r66nv9ed|398fitus/i, 'Filemoon'],
  [/vidhide|dintezuvio|diasfem|minochinos|dhtpre|ryderjet/i, 'VidHide'], [/filelions/i, 'FileLions'],
  [/vimeos|vimeus/i, 'Vimeos'], [/morencius/i, 'Morencius'], [/vidara|mxzhxco8dft/i, 'Vidara']
];

function dominio(url) {
  const m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

function hostPermitido(url, etiqueta) {
  return HOSTS_OK.test(dominio(url)) || HOSTS_OK.test(String(etiqueta || ''));
}

function nombreServidor(url, etiqueta) {
  const h = dominio(url);
  for (const [p, n] of NOMBRES) if (p.test(h)) return n;
  for (const [p, n] of NOMBRES) if (p.test(String(etiqueta || ''))) return n;
  const partes = h.split('.');
  const n = partes.length > 1 ? partes[partes.length - 2] : h;
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'Servidor';
}

const ES_TV = typeof __plugin_sleep !== 'function' && typeof __cheerio_load === 'function';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';

async function encabezado(tmdbId, mediaType, season, episode) {
  try {
    let id = String(tmdbId || '').trim();
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    if (/^tt\d+$/.test(id)) {
      const f = await fetch(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id`).then((r) => r.json());
      const lista = f && (tipo === 'movie' ? f.movie_results : f.tv_results);
      if (!lista || !lista[0]) return '';
      id = String(lista[0].id);
    }
    const d = await fetch(`https://api.themoviedb.org/3/${tipo}/${id}?api_key=${TMDB_KEY}&language=es-MX`).then((r) => r.json());
    const titulo = d && (d.title || d.name);
    if (!titulo) return '';
    if (tipo === 'tv') return `${titulo} - T${parseInt(season) || 1} E${parseInt(episode) || 1}`;
    const anio = String(d.release_date || '').slice(0, 4);
    return anio ? `${titulo} (${anio})` : titulo;
  } catch (e) {
    return '';
  }
}

/* Convierte los embeds {url, etiqueta} en tarjetas SIN resolverlos */
function armar(lista, titulo, fuente, referer) {
  const vistos = new Set();
  const tarjetas = [];
  for (const e of lista) {
    if (!e || !e.url || !/^https?:\/\//i.test(e.url) || vistos.has(e.url)) continue;
    vistos.add(e.url);
    if (!hostPermitido(e.url, e.etiqueta)) continue;
    const t = {
      name: `${fuente} (${nombreServidor(e.url, e.etiqueta)})`,
      title: titulo || fuente,
      url: e.url,
      quality: 'Calidad: Auto',
      language: 'Audio: Latino',
      provider: fuente,
      headers: { Referer: referer, 'User-Agent': UA }
    };
    if (ES_TV) {
      t.size = t.quality;
      t.quality = t.name;
    }
    tarjetas.push(t);
  }
  return tarjetas;
}

async function getStreams(tmdbId, mediaType, season, episode) {
  if (!tmdbId) return [];
  try {
    let pagina;
    if (mediaType === 'movie') {
      pagina = `${BASE_URL}/movies/${tmdbId}`;
    } else {
      pagina = `${BASE_URL}/tv/${tmdbId}/${parseInt(season) || 1}/${parseInt(episode) || 1}`;
    }
    const res = await fetch(pagina, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-MX,es;q=0.9' },
      redirect: 'follow'
    });
    if (!res.ok) return [];
    const html = await res.text();
    const patron = /<li\s+class="server-item"\s+data-link="([^"]+)"\s+data-lang="([^"]+)"/gi;
    const lista = [];
    let m;
    while ((m = patron.exec(html)) !== null) {
      if (m[2].toLowerCase().indexOf('latino') === -1) continue;
      lista.push({ url: m[1], etiqueta: '' });
    }
    if (!lista.length) return [];
    return armar(lista, await encabezado(tmdbId, mediaType, season, episode), FUENTE, `${BASE_URL}/`);
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams };
