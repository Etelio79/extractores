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
    ok: !!d.ok, status: d.status, statusText: d.statusText, url: d.url || url, tam: (d.body || '').length,
    headers: { get: (n) => h[String(n).toLowerCase()] || null },
    text: () => Promise.resolve(d.body || ''),
    json: () => { try { return Promise.resolve(d.body ? JSON.parse(d.body) : null); } catch (e) { return Promise.resolve(null); } }
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
    'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
    json(`${ruta}&language=es-MX`), json(`${ruta}&language=en-US`)
  ]);
  if (!es && !en) return null;
  const a = es || {}; const b = en || {};
  return {
    id,
    titulo: a.title || a.name || b.title || b.name || '',
    ingles: b.title || b.name || '',
    original: a.original_title || a.original_name || b.original_title || b.original_name || '',
    anio: String(a.release_date || a.first_air_date || b.release_date || b.first_air_date || '').slice(0, 4)
  };
}

function encabezado(datos, tipo, temporada, episodio) {
  if (tipo === 'tv') return `${datos.titulo} - T${temporada} E${episodio}`;
  return datos.anio ? `${datos.titulo} (${datos.anio})` : datos.titulo;
}

const TELE = typeof __plugin_sleep !== 'function' && typeof __cheerio_load === 'function';

function tarjeta(info) {
  const s = {
    name: info.servidor ? `${info.fuente} (${info.servidor})` : info.fuente,
    title: info.titulo, url: info.url,
    quality: `Calidad: ${info.calidad || 'Auto'}`,
    provider: info.fuente
  };
  if (info.audio) s.language = `Audio: ${info.audio}`;
  if (TELE) { s.size = s.quality; s.quality = s.name; }
  if (info.headers && Object.keys(info.headers).length) s.headers = info.headers;
  return s;
}

function pesoCalidad(c) {
  if (/4k/i.test(c)) return 2160;
  return Number((String(c || '').match(/(\d{3,4})p/i) || [])[1]) || 0;
}
function pesoAudio(a) { return { Latino: 3, 'Español': 2, Castellano: 1 }[a] || 0; }

function limitar(buscador, respaldo) {
  return (...argumentos) => {
    inicio = Date.now();
    const trabajo = conLimite(Promise.resolve().then(() => buscador(...argumentos)), CIERRE, null);
    return respaldo ? trabajo.then((s) => (s && s.length ? s : respaldo(s === null))) : trabajo.then((s) => s || []);
  };
}

const FUENTE = 'Vimeus';
const BASE = 'https://vimeus.com';
const LLAVE = 'ttapaNFkp2YbIFMawxmnqCPcs0pRVzbjrI5r1-da5M4';

function datosEmbed(html) {
  const m = String(html || '').match(/<script\s+type=["']text\/json["']\s+id=["']data["']>\s*(\{[\s\S]*?\})\s*<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const temporada = Number(season) || 1;
    const episodio = Number(episode) || 1;
    const info = await datosTmdb(tmdbId, tipo);
    const id = info ? info.id : String(tmdbId);
    const cabeceras = { Referer: `${BASE}/` };
    const rutas = tipo === 'movie'
      ? [`${BASE}/e/movie?tmdb=${id}&view_key=${LLAVE}`]
      : [`${BASE}/e/serie?tmdb=${id}&se=${temporada}&ep=${episodio}&view_key=${LLAVE}`, `${BASE}/e/anime?tmdb=${id}&se=${temporada}&ep=${episodio}&view_key=${LLAVE}`];

    let datos = null;
    for (const ruta of rutas) {
      datos = datosEmbed(await texto(ruta, { headers: cabeceras }));
      if (datos) break;
    }
    if (!datos || !Array.isArray(datos.embeds)) return [];

    const titulo = info ? encabezado(info, tipo, temporada, episodio) : '';
    const vistos = new Set();
    const tarjetas = [];
    for (const e of datos.embeds) {
      if (!e || !e.url) continue;
      const url = /^https?:/.test(e.url) ? e.url : e.url.startsWith('//') ? `https:${e.url}` : `https://${e.url}`;
      if (vistos.has(url)) continue;
      vistos.add(url);
      let host = 'Servidor';
      try { host = new URL(url).hostname.replace('www.', '').split('.')[0]; } catch (_) {}
      host = host.charAt(0).toUpperCase() + host.slice(1);
      const audio = audioDe(e.lang) || 'Latino';
      const calidad = calidadTexto(e.quality);
      tarjetas.push({
        orden: pesoAudio(audio) * 10000 + pesoCalidad(calidad),
        t: tarjeta({ titulo, calidad, audio, fuente: FUENTE, servidor: host, url, headers: {} })
      });
    }
    return tarjetas.sort((a, b) => b.orden - a.orden).map((x) => x.t);
  } catch (e) {
    console.log(`[${FUENTE}] ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: limitar(getStreams) };