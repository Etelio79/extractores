const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const RELOJ = typeof setTimeout === 'function';
const PRESUPUESTO = RELOJ ? 42000 : 25000;
const CIERRE = RELOJ ? 50000 : 40000;
let inicio = Date.now();

function esperar(ms) {
  return RELOJ ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

function transcurrido() {
  return Date.now() - inicio;
}

function restante() {
  return PRESUPUESTO - transcurrido();
}

function conLimite(promesa, ms, valor) {
  let listo = false;
  const fin = Date.now() + ms;
  const trabajo = Promise.resolve(promesa).then((v) => {
    listo = true;
    return v;
  }, () => {
    listo = true;
    return valor;
  });
  if (!RELOJ) return trabajo;
  const reloj = (async () => {
    while (!listo && Date.now() < fin) await esperar(Math.max(1, Math.min(250, fin - Date.now())));
    return valor;
  })();
  return Promise.race([trabajo, reloj]);
}

async function traer(url, opciones) {
  if (typeof __native_fetch !== 'function') return fetch(url, opciones);
  const cabeceras = {};
  for (const k of Object.keys(opciones.headers || {})) cabeceras[k] = String(opciones.headers[k]);
  const cuerpo = opciones.body === undefined || opciones.body === null ? null : String(opciones.body);
  const crudo = await __native_fetch(url, String(opciones.method || 'GET').toUpperCase(), JSON.stringify(cabeceras), cuerpo === null ? 'none' : 'text', cuerpo || '', opciones.redirect !== 'manual');
  const d = JSON.parse(crudo);
  const h = d.headers || {};
  return {
    ok: !!d.ok,
    status: d.status,
    statusText: d.statusText,
    url: d.url || url,
    headers: { get: (n) => h[String(n).toLowerCase()] || null },
    text: () => Promise.resolve(d.body || ''),
    json: () => {
      try {
        return Promise.resolve(d.body ? JSON.parse(d.body) : null);
      } catch (e) {
        return Promise.resolve(null);
      }
    }
  };
}

async function pedir(url, opciones) {
  if (restante() <= 0) return null;
  const r = await pedirCrudo(url, opciones);
  if (r && !r.status) return null;
  return r;
}

async function pedirCrudo(url, opciones) {
  const o = Object.assign({}, opciones || {});
  const limite = Math.min(o.limite || CIERRE, CIERRE - transcurrido());
  delete o.limite;
  o.headers = Object.assign({
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
  }, o.headers || {});
  return conLimite(traer(url, o).catch((e) => ({ status: 0, statusText: e && e.message })), limite, null);
}

async function texto(url, opciones) {
  const r = await pedir(url, opciones);
  if (!r || !r.ok) return '';
  try {
    return (await conLimite(r.text(), 10000, '')) || '';
  } catch (e) {
    return '';
  }
}

async function json(url, opciones) {
  const t = await texto(url, opciones);
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch (e) {
    return null;
  }
}

function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function calidadTexto(t) {
  const s = String(t || '');
  if (/2160|4k|uhd/i.test(s)) return '4K';
  const m = s.match(/(1440|1080|720|480|360|240)\s*p?/i);
  return m ? `${m[1]}p` : '';
}

function audioDe(t) {
  const s = normalizar(t);
  if (!s) return '';
  if (/latino|\blat\b|latam|mexic|\bmx\b|419|doblaje latino/.test(s)) return 'Latino';
  if (/castellano|espana|\bcast\b|\besp\b|\bes es\b/.test(s)) return 'Castellano';
  if (/subtitulad|\bvose\b|\bsub\b|\bsubs\b|\bvo\b|japones|ingles|english|original/.test(s)) return 'Subtitulado';
  if (/espanol|spanish/.test(s)) return 'Español';
  return '';
}

function limitar(buscador, respaldo) {
  return (...argumentos) => {
    inicio = Date.now();
    const trabajo = conLimite(Promise.resolve().then(() => buscador(...argumentos)), CIERRE, null);
    return respaldo ? trabajo.then((salida) => (salida && salida.length ? salida : respaldo(salida === null))) : trabajo.then((salida) => salida || []);
  };
}

const TMDB_KEY = '439c478a771f35c05022f9feabcca01c';

async function datosTmdb(tmdbId, tipo) {
  let id = String(tmdbId || '').trim();
  if (/^tt\d+$/.test(id)) {
    const f = await json(`https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id`);
    const r = f && (tipo === 'movie' ? f.movie_results : f.tv_results);
    if (!r || !r[0]) return null;
    id = String(r[0].id);
  }
  const ruta = `https://api.themoviedb.org/3/${tipo}/${id}?api_key=${TMDB_KEY}`;
  const [es, en] = await Promise.all([
    json(`${ruta}&language=es-MX&append_to_response=external_ids,alternative_titles`),
    json(`${ruta}&language=en-US`)
  ]);
  if (!es && !en) return null;
  const a = es || {};
  const b = en || {};
  return {
    id,
    titulo: a.title || a.name || b.title || b.name || '',
    ingles: b.title || b.name || '',
    original: a.original_title || a.original_name || b.original_title || b.original_name || '',
    anio: String(a.release_date || a.first_air_date || b.release_date || b.first_air_date || '').slice(0, 4),
    imdb: (a.external_ids && a.external_ids.imdb_id) || a.imdb_id || b.imdb_id || '',
    alternos: ((a.alternative_titles && (a.alternative_titles.results || a.alternative_titles.titles)) || []).map((x) => ({ pais: x.iso_3166_1 || '', titulo: x.title || '' })),
    temporadas: (a.seasons || b.seasons || []).map((x) => ({ numero: Number(x.season_number), episodios: Number(x.episode_count) || 0 }))
  };
}

function encabezado(datos, tipo, temporada, episodio) {
  if (tipo === 'tv') return `${datos.titulo} - T${temporada} E${episodio}`;
  return datos.anio ? `${datos.titulo} (${datos.anio})` : datos.titulo;
}

function slug(t) {
  return normalizar(t).replace(/\s+/g, '-');
}

function titulosPosibles(datos) {
  const vistos = new Set();
  return [datos.titulo, datos.ingles, datos.original].filter((t) => {
    const n = normalizar(t);
    if (!n || vistos.has(n)) return false;
    vistos.add(n);
    return true;
  });
}

const __SRV = [
  [/voe/i, 'Voe'], [/filemoon|moonplayer|byse|kerapoxy|f16px/i, 'Filemoon'],
  [/streamwish|hglink|vibuxer|hlswish|wishembed|awish|swdyu|strwish|streamhg|dhcplay|wishfast|embedwish|hanerix|cdnwish/i, 'StreamWish'],
  [/vidhide|filelions|dhtpre|minochinos|ryderjet|vidhidepro/i, 'VidHide'],
  [/vimeos|vimeus/i, 'Vimeos'], [/morencius/i, 'Morencius'],
  [/dood|d000d|ds2play/i, 'DoodStream'], [/mixdrop/i, 'MixDrop'], [/streamtape/i, 'StreamTape'],
  [/uqload/i, 'Uqload'], [/mp4upload/i, 'Mp4Upload'], [/ok\.ru/i, 'OK.ru']
];
function __nombreSrv(url) {
  let h = '';
  try { h = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return 'Servidor'; }
  for (const [p, n] of __SRV) if (p.test(h)) return n;
  const partes = h.split('.');
  const n = partes.length > 1 ? partes[partes.length - 2] : h;
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'Servidor';
}

const FUENTE = 'HackStore';
const API_REST = 'https://hackstore2.com/api/rest';
const API_WP = 'https://hackstore.mx/wp-api/v1';
const CABECERAS_API = { Accept: 'application/json', Referer: 'https://hackstore2.com/', Origin: 'https://hackstore2.com' };

function slugs(datos) {
  const lista = [];
  for (const t of titulosPosibles(datos).concat((datos.alternos || []).map((x) => x.titulo))) {
    const s = slug(t);
    if (!s) continue;
    if (datos.anio) lista.push(`${s}-${datos.anio}`);
    lista.push(s);
  }
  return [...new Set(lista)].slice(0, 6);
}

async function metodoDirecto(datos, tipo, temporada, episodio) {
  const base = slug(datos.titulo);
  if (!base) return [];
  const ruta = tipo === 'movie'
    ? `${API_REST}/single?post_name=${datos.anio ? `${base}-${datos.anio}` : base}&post_type=movies`
    : `${API_REST}/single?post_name=${base}-temporada-${temporada}-episodio-${episodio}&post_type=episodes`;
  const r = await json(ruta, { headers: CABECERAS_API });
  const id = r && r.data && (tipo === 'movie' ? r.data._id : r.data.episode && r.data.episode._id);
  if (!id) return [];
  const p = await json(`${API_REST}/player?post_id=${id}`, { headers: CABECERAS_API });
  const embeds = Array.isArray(p && p.data) ? p.data : (p && p.data && p.data.embeds) || [];
  return embeds.filter((e) => e.url).map((e) => ({ url: e.url, audio: audioDe(e.lang) || 'Latino', referer: 'https://hackstore2.com/' }));
}

async function metodoRest(datos, tipo, temporada, episodio) {
  let id = null;
  for (const s of slugs(datos)) {
    if (tipo === 'movie') {
      const r = await json(`${API_REST}/single?post_name=${s}&post_type=movies`);
      id = r && r.data && r.data._id;
    } else {
      const base = s.replace(new RegExp(`-${datos.anio}$`), '');
      const r = await json(`${API_REST}/single?post_name=${base}-temporada-${temporada}-episodio-${episodio}&post_type=episodes`);
      id = r && r.data && r.data.episode && r.data.episode._id;
    }
    if (id) break;
  }
  if (!id) return [];
  const r = await json(`${API_REST}/player?post_id=${id}`);
  const embeds = Array.isArray(r && r.data) ? r.data : (r && r.data && r.data.embeds) || [];
  return embeds.filter((e) => e.url).map((e) => ({ url: e.url, audio: audioDe(e.lang) || 'Latino', referer: 'https://hackstore2.com/' }));
}

async function metodoWp(datos, tipo, temporada, episodio) {
  const clase = tipo === 'movie' ? 'movies' : 'tvshows';
  const ids = await Promise.all(slugs(datos).map((s) => json(`${API_WP}/single/${clase}?slug=${s}&postType=${clase}`).then((r) => (r && r.data && r.data._id) || null)));
  let id = ids.find(Boolean);
  if (!id) return [];
  if (tipo === 'tv') {
    const r = await json(`${API_WP}/single/episodes/list?_id=${id}&season=${temporada}&page=1&postsPerPage=200`);
    const ep = ((r && r.data && r.data.posts) || []).find((p) => Number(p.season_number) === temporada && Number(p.episode_number) === episodio);
    id = ep && ep._id;
    if (!id) return [];
  }
  const r = await json(`${API_WP}/player?postId=${id}`);
  return ((r && r.data && r.data.embeds) || []).filter((e) => e.url && !/la\.movie/.test(e.url)).map((e) => ({ url: e.url, audio: audioDe(e.lang) || 'Latino', referer: 'https://hackstore.mx/' }));
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const datos = await datosTmdb(tmdbId, tipo);
    if (!datos) return [];
    
    const temporada = Number(season) || 1;
    const episodio = Number(episode) || 1;
    const titulo = encabezado(datos, tipo, temporada, episodio);
    
    const metodos = [metodoDirecto, metodoRest, metodoWp];
    for (const metodo of metodos) {
      const lista = await metodo(datos, tipo, temporada, episodio).catch(() => []);
      if (lista && lista.length) {
        const tarjetas = [];
        const vistos = new Set();
        for (const e of lista) {
          if (!e.url || vistos.has(e.url)) continue;
          vistos.add(e.url);

          const hostName = __nombreSrv(e.url);

          tarjetas.push({
            name: `${FUENTE} (${hostName})`,
            title: titulo,
            url: e.url,
            quality: `Calidad: Auto`,
            language: `Audio: ${e.audio}`,
            provider: FUENTE,
            headers: { Referer: e.referer }
          });
        }
        if (tarjetas.length) return tarjetas;
      }
    }
    return [];
  } catch (e) {
    console.log(`[${FUENTE}] ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: limitar(getStreams) };