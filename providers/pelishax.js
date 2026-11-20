const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FUENTE = 'PelisHax';
const BASE_URL = 'https://pelishaxpro.com';

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
