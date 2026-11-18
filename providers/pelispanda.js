const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const FUENTE = 'PelisPanda';
const PANDADOMAIN = 'https://pelispanda.org';
const REFERER = 'https://pelispanda.org/';

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

function get(url, extra) {
  return fetch(url, { headers: Object.assign({ 'User-Agent': UA }, extra || {}), redirect: 'follow' }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (res.headers.get('content-type') || '').indexOf('json') !== -1 ? res.json() : res.text();
  });
}

async function titulo(tmdbId, mediaType) {
  try {
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const data = await get(`https://api.themoviedb.org/3/${tipo}/${tmdbId}?api_key=${TMDB_KEY}&language=es-MX`);
    return data.title || data.name || null;
  } catch (e) {
    return null;
  }
}

async function buscarEmbeds(tmdbId, buscado, mediaType, season, episode) {
  try {
    const consulta = buscado.split(' ').slice(0, 3).join(' ');
    const r = await get(`${PANDADOMAIN}/wp-json/wpreact/v1/search?query=${encodeURIComponent(consulta)}`, { Referer: REFERER });
    if (!r || !r.results) return [];
    const tipoSitio = mediaType === 'movie' ? 'pelicula' : 'serie';
    let hallado = r.results.find((x) => x.tmdb_id == tmdbId && x.type === tipoSitio);
    if (!hallado) hallado = r.results.find((x) => x.type === tipoSitio);
    if (!hallado || !hallado.slug) return [];
    const ruta = mediaType === 'movie' ? 'movie' : 'serie';
    const jugadores = await get(`${PANDADOMAIN}/wp-json/wpreact/v1/${ruta}/${hallado.slug}/related`, { Referer: REFERER });
    const embeds = (jugadores && jugadores.embeds) || [];
    return mediaType === 'movie' ? embeds : embeds.filter((e) => e.season == season && e.episode == episode);
  } catch (e) {
    return [];
  }
}

async function buscar(tmdbId, mediaType, season, episode, tituloDado) {
  try {
    let buscado = tituloDado;
    if (!buscado || buscado === String(tmdbId)) buscado = await titulo(tmdbId, mediaType);
    if (!buscado) return [];
    const embeds = await buscarEmbeds(tmdbId, buscado, mediaType, season, episode);
    return embeds
      .filter((p) => {
        const idioma = String(p.lang || 'Latino').toLowerCase();
        return p.url && !idioma.includes('sub') && !idioma.includes('vose') && !idioma.includes('espana');
      })
      .map((p) => ({ url: p.url, etiqueta: p.serverName || '' }));
  } catch (e) {
    return [];
  }
}

async function getStreams(tmdbId, mediaType, season, episode, title) {
  try {
    let lista;
    // Scrubs (secuela): se busca también la serie original con las temporadas desplazadas
    if (String(tmdbId).trim() === '295778' || String(tmdbId).trim() === 'tt40197357') {
      const original = season ? String(parseInt(season) + 9) : season;
      const [a, b] = await Promise.all([
        buscar(tmdbId, mediaType, season, episode, title),
        buscar('4556', mediaType, original, episode, title)
      ]);
      lista = a.concat(b);
    } else {
      lista = await buscar(tmdbId, mediaType, season, episode, title);
    }
    if (!lista.length) return [];
    return armar(lista, await encabezado(tmdbId, mediaType, season, episode), FUENTE, REFERER);
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams };
