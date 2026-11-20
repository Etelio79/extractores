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

function origen(url) { const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i); return m ? m[1] : ''; }
function dominio(url) { const m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i); return m ? m[1].toLowerCase() : ''; }

const ENTIDADES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ntilde: 'ñ', Ntilde: 'Ñ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', uuml: 'ü', iexcl: '¡', iquest: '¿' };

function entidades(t) {
  return String(t || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (x, n) => (n in ENTIDADES ? ENTIDADES[n] : x));
}

function absoluta(url, base) {
  if (!url) return '';
  const u = entidades(String(url).trim().replace(/\\\//g, '/'));
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return origen(base) + u;
  const b = String(base || '').replace(/[?#].*$/, '');
  return (/^https?:\/\/[^/]+$/i.test(b) ? `${b}/` : b.replace(/[^/]*$/, '')) + u;
}

function limpiarHtml(t) { return entidades(String(t || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function normalizar(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, ' ').trim(); }
function calidadTexto(t) { const s = String(t || ''); if (/2160|4k|uhd/i.test(s)) return '4K'; const m = s.match(/(1440|1080|720|480|360|240)\s*p?/i); return m ? `${m[1]}p` : ''; }

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
    id, titulo: a.title || a.name || b.title || b.name || '', ingles: b.title || b.name || '',
    original: a.original_title || a.original_name || b.original_title || b.original_name || '',
    anio: String(a.release_date || a.first_air_date || b.release_date || b.first_air_date || '').slice(0, 4),
    imdb: (a.external_ids && a.external_ids.imdb_id) || a.imdb_id || b.imdb_id || ''
  };
}

function encabezado(datos, tipo, temporada, episodio) { if (tipo === 'tv') return `${datos.titulo} - T${temporada} E${episodio}`; return datos.anio ? `${datos.titulo} (${datos.anio})` : datos.titulo; }
function titulosPosibles(datos) { const vistos = new Set(); return [datos.titulo, datos.ingles, datos.original].filter((t) => { const n = normalizar(t); if (!n || vistos.has(n)) return false; vistos.add(n); return true; }); }

const RELLENO = new Set(['ver', 'online', 'gratis', 'latino', 'castellano', 'subtitulado', 'espanol', 'audio', 'hd', 'full', 'completa', 'pelicula', 'serie']);
const VACIAS = new Set(['the', 'and', 'of', 'a', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'un', 'una']);

function limpiarTitulo(t) { const n = normalizar(String(t || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')); const limpio = n.split(' ').filter((p) => !RELLENO.has(p)).join(' '); return limpio || n; }
function parecido(a, b) { const x = limpiarTitulo(a); const y = limpiarTitulo(b); if (!x || !y) return 0; if (x === y) return 1; const [corto, largo] = x.length <= y.length ? [x, y] : [y, x]; const contiene = ` ${largo} `.includes(` ${corto} `) ? 0.6 + (0.4 * corto.length) / largo.length : 0; const px = new Set(x.split(' ').filter((p) => !VACIAS.has(p))); const py = new Set(y.split(' ').filter((p) => !VACIAS.has(p))); let comunes = 0; for (const p of px) if (py.has(p)) comunes++; const palabras = px.size && py.size ? comunes / Math.max(px.size, py.size) : 0; return Math.max(contiene, palabras); }
function audioDe(t) { const s = normalizar(t); if (!s) return ''; if (/latino|\blat\b|latam|mexic|\bmx\b|419|doblaje latino/.test(s)) return 'Latino'; if (/castellano|espana|\bcast\b|\besp\b|\bes es\b/.test(s)) return 'Castellano'; if (/subtitulad|\bvose\b|\bsub\b|\bsubs\b|\bvo\b|japones|ingles|english|original/.test(s)) return 'Subtitulado'; if (/espanol|spanish/.test(s)) return 'Español'; return ''; }

function limitar(buscador, respaldo) { return (...argumentos) => { inicio = Date.now(); caidos.clear(); registro = []; const trabajo = conLimite(Promise.resolve().then(() => buscador(...argumentos)), CIERRE, null); return respaldo ? trabajo.then((salida) => (salida && salida.length ? salida : respaldo(salida === null))) : trabajo.then((salida) => salida || []); }; }

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

/* ══════════════════ BUSCADOR ARESHD ══════════════════ */
const FUENTE = 'AresHD';
const BASE = 'https://areshd.com';

async function buscar(titulos, tipo, anio) {
  let mejor = null;
  let puntos = 0;
  for (const titulo of titulos) {
    const html = await texto(`${BASE}/search/${encodeURIComponent(titulo).replace(/%20/g, '+')}`, { headers: { Referer: `${BASE}/` } });
    const patron = /<a class="Posters-link"[\s\S]*?href="([^"]+)"[\s\S]*?<img alt="([^"]+)"/g;
    let m;
    while ((m = patron.exec(html))) {
      const href = absoluta(m[1], BASE);
      const esSerie = /\/serie\//.test(href);
      if ((tipo === 'tv') !== esSerie) continue;
      const nombre = entidades(m[2]);
      let s = parecido(nombre, titulo);
      const suyo = (nombre.match(/\b(19|20)\d{2}\b/) || [])[0];
      if (anio && suyo) s += suyo === anio ? 0.2 : -0.3;
      if (s > puntos) { puntos = s; mejor = href; }
    }
    if (puntos >= 1) break;
  }
  return puntos >= 0.8 ? mejor : null;
}

async function paginaEpisodio(serie, temporada, episodio) {
  const nombre = (serie.match(/\/serie\/([^/?#]+)/) || [])[1];
  if (nombre) return `${BASE}/episodio/${nombre}-temporada-${temporada}-episodio-${episodio}`;
  const html = await texto(serie, { headers: { Referer: `${BASE}/` } });
  const m = html.match(new RegExp(`"slug":"([^"]*${temporada}-episodio-${episodio}(?!\\d)[^"]*)"`, 'i'));
  return m ? `${BASE}/episodio/${m[1]}` : null;
}

async function enlaces(pagina) {
  const html = await texto(pagina, { headers: { Referer: `${BASE}/` } });
  const idiomas = [...html.matchAll(/<li class="pres"><a class="playr">([^<]+)<\/a><\/li>/g)].map((m) => audioDe(m[1]) || 'Latino');
  const bloques = [...html.matchAll(/<ul class="TbVideoNv nav nav-tabs hide" role="tablist">([\s\S]*?)<\/ul>/g)];
  const tareas = [];
  bloques.forEach((bloque, i) => {
    const audio = idiomas[i] || 'Latino';
    for (const s of bloque[1].matchAll(/<li class="pres" data-tr="([^"]+)"[\s\S]*?a class="playr">([^<]+)<\/a>/g)) {
      if (/youtube/i.test(s[2])) continue;
      const reproductor = absoluta(entidades(s[1]), BASE);
      tareas.push(texto(reproductor, { headers: { Referer: pagina } }).then(async (h) => {
        const url = (h.match(/var\s+url\s*=\s*'([^']+)'/i) || h.match(/var\s+url\s*=\s*"([^"]+)"/i) || [])[1];
        if (!url) return [];
        return [{ url, audio, referer: `${BASE}/` }];
      }).catch(() => []));
    }
  });
  return [].concat(...(await Promise.all(tareas)));
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const datos = await datosTmdb(tmdbId, tipo);
    if (!datos) return [];
    const temporada = Number(season) || 1;
    const episodio = Number(episode) || 1;
    let pagina = await buscar(titulosPosibles(datos), tipo, datos.anio);
    if (pagina && tipo === 'tv') pagina = await paginaEpisodio(pagina, temporada, episodio);
    if (!pagina) return [];
    const lista = await enlaces(pagina);
    const tarjetas = [];
    const vistos = new Set();
    for (const e of lista) {
      if (!e.url || vistos.has(e.url)) continue;
      vistos.add(e.url);
      const hostName = hostPermitido(e.url);
      if (!hostName) continue;
      tarjetas.push({
        name: `${FUENTE} (${hostName})`,
        title: encabezado(datos, tipo, temporada, episodio),
        url: e.url,
        quality: `Calidad: Auto`,
        language: `Audio: ${e.audio}`,
        provider: FUENTE,
        headers: { Referer: e.referer }
      });
    }
    return tarjetas;
  } catch (e) {
    console.log(`[${FUENTE}] ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: limitar(getStreams) };
