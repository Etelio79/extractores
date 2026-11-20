const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const RELOJ = typeof setTimeout === 'function';
const PRESUPUESTO = RELOJ ? 42000 : 25000;
const CIERRE = RELOJ ? 50000 : 40000;
let inicio = Date.now();

function esperar(ms) { return RELOJ ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve(); }
function transcurrido() { return Date.now() - inicio; }
function restante() { return PRESUPUESTO - transcurrido(); }

function conLimite(promesa, ms, valor) {
  let listo = false;
  const fin = Date.now() + ms;
  const trabajo = Promise.resolve(promesa).then((v) => { listo = true; return v; }, () => { listo = true; return valor; });
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
    ok: !!d.ok, status: d.status, statusText: d.statusText, url: d.url || url,
    tam: (d.body || '').length,
    escudo: d.status >= 400 && /just a moment|cf-chl|challenge-platform|cf_chl|attention required/i.test(String(d.body || '').slice(0, 6000)),
    headers: { get: (n) => h[String(n).toLowerCase()] || null },
    text: () => Promise.resolve(d.body || ''),
    json: () => { try { return Promise.resolve(d.body ? JSON.parse(d.body) : null); } catch (e) { return Promise.resolve(null); } }
  };
}

const caidos = new Set();
let registro = [];
function anotar(t) { if (registro.length < 80) registro.push(String(t).replace(/\s+/g, ' ').trim()); }
function rutaCorta(url) { return String(url || '').replace(/^https?:\/\/(?:www\.)?/i, '').replace(/[?&]api_key=[^&]+/, '').slice(0, 75); }
function peso(n) { return n < 1024 ? `${n}B` : `${Math.round(n / 1024)}KB`; }

async function pedir(url, opciones) {
  const host = String(url || '').replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
  const metodo = String((opciones && opciones.method) || 'GET').toUpperCase();
  if (caidos.has(host) || restante() <= 0) { anotar(`${metodo} ${rutaCorta(url)} → omitido`); return null; }
  const comienzo = Date.now();
  const r = await pedirCrudo(url, opciones);
  const estado = !r ? 'tiempo agotado' : !r.status ? `error de red${r.statusText ? ` (${String(r.statusText).slice(0, 40)})` : ''}` : r.status;
  if (!(r && r.ok && /themoviedb/.test(host))) anotar(`${metodo} ${rutaCorta(url)} → ${estado}${r && r.status && r.tam !== undefined ? ` · ${peso(r.tam)}` : ''}${r && r.escudo ? ' · Cloudflare' : ''} · ${((Date.now() - comienzo) / 1000).toFixed(1)}s`);
  if (r && !r.status) { caidos.add(host); return null; }
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
  try { return (await conLimite(r.text(), 10000, '')) || ''; } catch (e) { return ''; }
}

async function json(url, opciones) {
  const t = await texto(url, opciones);
  if (!t) return null;
  try { return JSON.parse(t); } catch (e) { return null; }
}

function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, ' ').trim();
}

const VACIAS = new Set(['the', 'and', 'of', 'a', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'un', 'una']);
const RELLENO = new Set(['ver', 'online', 'gratis', 'latino', 'castellano', 'subtitulado', 'espanol', 'audio', 'hd', 'full', 'completa', 'pelicula', 'serie']);

function limpiarTitulo(t) {
  const n = normalizar(String(t || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' '));
  const limpio = n.split(' ').filter((p) => !RELLENO.has(p)).join(' ');
  return limpio || n;
}

function parecido(a, b) {
  const x = limpiarTitulo(a);
  const y = limpiarTitulo(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [corto, largo] = x.length <= y.length ? [x, y] : [y, x];
  const contiene = ` ${largo} `.includes(` ${corto} `) ? 0.6 + (0.4 * corto.length) / largo.length : 0;
  const px = new Set(x.split(' ').filter((p) => !VACIAS.has(p)));
  const py = new Set(y.split(' ').filter((p) => !VACIAS.has(p)));
  let comunes = 0;
  for (const p of px) if (py.has(p)) comunes++;
  const palabras = px.size && py.size ? comunes / Math.max(px.size, py.size) : 0;
  return Math.max(contiene, palabras);
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

function calidadTexto(t) {
  const s = String(t || '');
  if (/2160|4k|uhd/i.test(s)) return '4K';
  const m = s.match(/(1440|1080|720|480|360|240)\s*p?/i);
  return m ? `${m[1]}p` : '';
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

function titulosPosibles(datos) {
  const vistos = new Set();
  return [datos.titulo, datos.ingles, datos.original].filter((t) => {
    const n = normalizar(t);
    if (!n || vistos.has(n)) return false;
    vistos.add(n);
    return true;
  });
}

/* ── Nombres de servidores para la interfaz ── */
const _HOSTERS = [
  ['streamwish','StreamWish'],['hlswish','StreamWish'],['wishembed','StreamWish'],['vibuxer','StreamWish'],['awish','StreamWish'],
  ['voe','Voe'],['nupload','Nupload'],['yourupload','YourUpload'],['hqq','Hqq'],['netu','Hqq'],
  ['filemoon','Filemoon'],['moonplayer','Filemoon'],['doodstream','DoodStream'],['dood','DoodStream'],['d0000d','DoodStream'],['ds2play','DoodStream'],
  ['vidhide','VidHide'],['filelions','FileLions'],['mixdrop','MixDrop'],['mxdrop','MixDrop'],['streamtape','StreamTape'],['strtape','StreamTape'],
  ['uqload','Uqload'],['mp4upload','Mp4Upload'],['ok.ru','OK.ru'],['fembed','Fembed'],['upstream','Upstream'],
  ['vimeo','Vimeo'],['pixeldrain','Pixeldrain'],['sendvid','Sendvid'],['lulustream','LuluStream'],
  ['vidguard','VidGuard'],['listeamed','VidGuard'],['vidmoly','Vidmoly'],['dailymotion','Dailymotion'],
  ['rpmvid','Rpmvid'],['rpmplay','Rpmvid'],['embed69','Embed69'],['xupalace','Xupalace']
];

function nombreServidor(url) {
  const m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i);
  const h = m ? m[1].toLowerCase().replace(/^www\./, '') : '';
  for (const [patron, nombre] of _HOSTERS) if (h.includes(patron)) return nombre;
  const partes = h.split('.');
  const n = partes.length > 1 ? partes[partes.length - 2] : h;
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'Directo';
}

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

/* ── Armar tarjetas SIN resolver ── */
async function armar(lista, titulo, fuente) {
  const vistos = new Set();
  const tarjetas = [];
  for (const item of lista) {
    if (!item.url || vistos.has(item.url)) continue;
    vistos.add(item.url);
    
    const s = {
      name: item.servidor ? `${fuente} (${item.servidor})` : fuente,
      title: titulo,
      url: item.url,
      quality: `Calidad: ${item.calidad || 'Auto'}`,
      provider: fuente
    };
    if (item.audio) s.language = `Audio: ${item.audio}`;
    if (item.referer) s.headers = { Referer: item.referer, 'User-Agent': UA };

    tarjetas.push({
      orden: (item.audio === 'Latino' ? 30000 : item.audio === 'Español' ? 20000 : 0) + (Number((item.calidad||'').match(/\d+/)) || 0),
      t: s
    });
  }
  return tarjetas.sort((a, b) => b.orden - a.orden).map((x) => x.t);
}

function limitar(buscador) {
  return (...argumentos) => {
    inicio = Date.now();
    caidos.clear();
    registro = [];
    const trabajo = conLimite(Promise.resolve().then(() => buscador(...argumentos)), CIERRE, null);
    return trabajo.then((salida) => salida || []);
  };
}

/* ══════════════════ BUSCADOR ALLPELICULAS ══════════════════ */
const FUENTE = 'AllpeliculasSE';
const BASE = 'https://allpeliculas.la';
const CABECERAS = { Accept: 'application/json, text/plain, */*', Referer: `${BASE}/` };

function consultaDe(titulo) {
  return String(titulo || '').split(':')[0].replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function buscarPost(datos, tipo) {
  const clase = tipo === 'movie' ? 'movies' : 'tvshows';
  let mejor = null;
  let puntos = 0;
  for (const titulo of titulosPosibles(datos)) {
    const consulta = consultaDe(titulo);
    if (!consulta) continue;
    const r = await json(`${BASE}/wp-api/v1/search?filter=[]&q=${encodeURIComponent(consulta)}&orderBy=latest&order=desc&postType=${clase}&postsPerPage=20&page=1`, { headers: CABECERAS });
    for (const p of (r && r.data && r.data.posts) || []) {
      if (p.type && p.type !== clase) continue;
      let s = Math.max(parecido(p.title, titulo), parecido(p.original_title, datos.original));
      const anio = String(p.release_date || '').slice(0, 4);
      if (datos.anio && /^\d{4}$/.test(anio)) s += anio === datos.anio ? 0.2 : Math.abs(Number(anio) - Number(datos.anio)) > 1 ? -0.3 : 0;
      if (s > puntos) {
        puntos = s;
        mejor = p;
      }
    }
    if (puntos >= 1.1) break;
  }
  return puntos >= 0.8 ? mejor : null;
}

/* ══════════════════ PUNTO DE ENTRADA ══════════════════ */
async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const datos = await datosTmdb(tmdbId, tipo);
    if (!datos) return [];
    
    const temporada = Number(season) || 1;
    const episodio = Number(episode) || 1;
    
    const post = await buscarPost(datos, tipo);
    if (!post) return [];
    
    let id = post._id;
    if (tipo === 'tv') {
      const r = await json(`${BASE}/wp-api/v1/single/episodes/list?_id=${post._id}&season=${temporada}&postsPerPage=100&page=1`, { headers: CABECERAS });
      const ep = ((r && r.data && r.data.posts) || []).find((e) => Number(e.season_number) === temporada && Number(e.episode_number) === episodio);
      if (!ep) return [];
      id = ep._id;
    }
    
    const r = await json(`${BASE}/wp-api/v1/player?postId=${id}&demo=0`, { headers: CABECERAS });
    
    // Extraer los embeds de la respuesta de la API
    const lista = ((r && r.data && r.data.embeds) || [])
      .filter((e) => e.url && /^https?:/.test(e.url) && hostPermitido(e.url))
      .map((e) => ({ 
        url: e.url, 
        audio: audioDe(e.lang) || 'Latino', 
        calidad: calidadTexto(e.quality), 
        referer: `${BASE}/`,
        servidor: hostPermitido(e.url)
      }));
      
    return await armar(lista, encabezado(datos, tipo, temporada, episodio), FUENTE);
  } catch (e) {
    console.log(`[${FUENTE}] ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: limitar(getStreams) };
