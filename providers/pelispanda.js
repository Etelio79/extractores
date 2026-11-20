const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const FUENTE = 'PelisPanda';
const PANDADOMAIN = 'https://pelispanda.org';
const REFERER = 'https://pelispanda.org/';

/* ── Lista blanca: solo los 7 hosts que ya reproducen en extractores.js (mismos patrones). Sin lista negra. ── */
const HOSTS_REPRODUCEN = [
  ['Voe', /voe\.sx|voe-unblock|voeunbl|v-o-e|voe\./i],
  ['VidHide', /vidhide|filelions|ryderjet|dintezuvio|mivalyo|dhtpre|peytonepre|smoothpre|louishide|lylxan|movearnpre|kinoger|alions|azipcdn|nikaplayer|fviplions|niikaplayerr|callistanise|dinisglows|dingtezuni|minochinos|taylorplayer/i],
  ['Vimeos', /vimeos/i],
  ['Vidara', /vidara\.|mxzhxco8dft/i],
  ['StreamWish', /streamwish|embedwish|hlswish|playerwish|swiftplayers|swishsrv|wishembed|wishfast|sfastwish|strmwis|\b[amd]wish\.(?:pro|top)|hglink\.to|hgcloud\.to|dhcplay|gradehgplus|ultpreplayer|haxloppd|stbhg|playnixes|hanerix|hglamioz|niramirus|medixiru|audinifer|vibuxer|hgplaycdn|vsembed|ajmidyad|khadhnayad|atabknha/i],
  ['Filemoon', /filemoon|moonplayer|byse[a-z]*\.|bf0skv|moflix-stream/i],
  ['Workers', /workers\.dev/i]
];

/* Devuelve el nombre del host si es uno de los 7; si no, null. Solo hostname (no path/query) y solo https. */
function hostPermitido(url, etiqueta) {
  let u;
  try { u = new URL(url); } catch (_) { return null; }
  if (u.protocol !== 'https:') return null;
  const base = u.hostname.toLowerCase().split('.').slice(-2).join('.');
  for (const [nombre, patron] of HOSTS_REPRODUCEN) if (patron.test(base)) return nombre;
  // Voe y otros usan muchos dominios: se acepta si el sitio lo etiqueta como uno de los 7
  const et = String(etiqueta || '').toLowerCase();
  if (et) for (const [nombre, patron] of HOSTS_REPRODUCEN) if (et.includes(nombre.toLowerCase()) || patron.test(et)) return nombre;
  return null;
}

function dominio(url) {
  const m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

function nombreServidor(url, etiqueta) {
  return hostPermitido(url, etiqueta) || 'Servidor';
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
