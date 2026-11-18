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
function atobSeguro(t) { try { return atob(String(t || '').replace(/\s+/g, '')); } catch (e) { return ''; } }
function audioCodigo(codigo) { return { LAT: 'Latino', ESP: 'Castellano', CAS: 'Castellano', SUB: 'Subtitulado', '0': 'Latino', '1': 'Castellano', '2': 'Subtitulado' }[String(codigo).toUpperCase()] || ''; }
function audioDe(t) { const s = normalizar(t); if (!s) return ''; if (/latino|\blat\b|latam|mexic|\bmx\b|419|doblaje latino/.test(s)) return 'Latino'; if (/castellano|espana|\bcast\b|\besp\b|\bes es\b/.test(s)) return 'Castellano'; if (/subtitulad|\bvose\b|\bsub\b|\bsubs\b|\bvo\b|japones|ingles|english|original/.test(s)) return 'Subtitulado'; if (/espanol|spanish/.test(s)) return 'Español'; return ''; }

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
    imdb: (a.external_ids && a.external_ids.imdb_id) || a.imdb_id || b.imdb_id || '',
    alternos: ((a.alternative_titles && (a.alternative_titles.results || a.alternative_titles.titles)) || []).map((x) => ({ pais: x.iso_3166_1 || '', titulo: x.title || '' })),
    temporadas: (a.seasons || b.seasons || []).map((x) => ({ numero: Number(x.season_number), episodios: Number(x.episode_count) || 0 }))
  };
}

function encabezado(datos, tipo, temporada, episodio) { if (tipo === 'tv') return `${datos.titulo} - T${temporada} E${episodio}`; return datos.anio ? `${datos.titulo} (${datos.anio})` : datos.titulo; }
function titulosPosibles(datos) { const vistos = new Set(); return [datos.titulo, datos.ingles, datos.original].filter((t) => { const n = normalizar(t); if (!n || vistos.has(n)) return false; vistos.add(n); return true; }); }

const RELLENO = new Set(['ver', 'online', 'gratis', 'latino', 'castellano', 'subtitulado', 'espanol', 'audio', 'hd', 'full', 'completa', 'pelicula', 'serie']);
const VACIAS = new Set(['the', 'and', 'of', 'a', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'un', 'una']);

function limpiarTitulo(t) { const n = normalizar(String(t || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')); const limpio = n.split(' ').filter((p) => !RELLENO.has(p)).join(' '); return limpio || n; }
function parecido(a, b) { const x = limpiarTitulo(a); const y = limpiarTitulo(b); if (!x || !y) return 0; if (x === y) return 1; const [corto, largo] = x.length <= y.length ? [x, y] : [y, x]; const contiene = ` ${largo} `.includes(` ${corto} `) ? 0.6 + (0.4 * corto.length) / largo.length : 0; const px = new Set(x.split(' ').filter((p) => !VACIAS.has(p))); const py = new Set(y.split(' ').filter((p) => !VACIAS.has(p))); let comunes = 0; for (const p of px) if (py.has(p)) comunes++; const palabras = px.size && py.size ? comunes / Math.max(px.size, py.size) : 0; return Math.max(contiene, palabras); }

function limitar(buscador, respaldo) { return (...argumentos) => { inicio = Date.now(); caidos.clear(); registro = []; const trabajo = conLimite(Promise.resolve().then(() => buscador(...argumentos)), CIERRE, null); return respaldo ? trabajo.then((salida) => (salida && salida.length ? salida : respaldo(salida === null))) : trabajo.then((salida) => salida || []); }; }

/* ══════════════════ BUSCADOR CINEHDPLUS ══════════════════ */
const FUENTE = 'CineHdPlus';
const BASE = 'https://cinehdplus.org';
const API = 'https://api.cinehdplus.org';
/* ── Lista blanca: solo se devuelven embeds de hosts que ya reproducen en la app ── */
const HOSTS_OK = /voe|vidhide|vidhidepro|filelions|dhtpre|minochinos|ryderjet|vimeos|vimeus|morencius|filemoon|moonplayer|byse|kerapoxy|f16px|vidara|mxzhxco8dft/i;

function esFicha(url, tipo) { return tipo === 'movie' ? /\/pelicula/.test(url) : /\/series?-tv-|\/series\/[^/]+/.test(url); }

async function buscarPropia(titulo, tipo) {
  const r = await json(`${BASE}/wp-json/api_v1/buscar/?keyword=${encodeURIComponent(titulo)}`, { headers: { Accept: 'application/json', Referer: `${BASE}/` } });
  return (Array.isArray(r) ? r : []).filter((x) => x && x.permalink).map((x) => ({ url: x.permalink.replace(/\\\//g, '/'), nombre: entidades(x.title || ''), anio: (x.meta && x.meta.date) || '' })).filter((x) => esFicha(x.url, tipo));
}

async function buscarApi(titulo, tipo) {
  const r = await json(`${BASE}/wp-json/wp/v2/search?search=${encodeURIComponent(titulo)}&per_page=20`, { headers: { Accept: 'application/json' } });
  return (Array.isArray(r) ? r : []).filter((x) => x && x.url).map((x) => ({ url: x.url, nombre: entidades(x.title || '') })).filter((x) => esFicha(x.url, tipo));
}

async function buscarPagina(titulo, tipo) {
  const html = await texto(`${BASE}/?s=${encodeURIComponent(titulo)}`);
  const lista = [];
  const patron = /<a[^>]+href=["']((?:https?:\/\/(?:www\.)?cinehdplus\.[a-z]+)?\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = patron.exec(html))) {
    const nombre = entidades((m[2].match(/<img[^>]+alt=["']([^"']+)["']/i) || [])[1] || limpiarHtml(m[2]));
    if (nombre && esFicha(m[1], tipo)) lista.push({ url: absoluta(m[1], BASE), nombre });
  }
  return lista;
}

async function buscar(titulos, tipo, anio) {
  for (const titulo of titulos) {
    const [a, b, c] = await Promise.all([buscarPropia(titulo, tipo).catch(() => []), buscarPagina(titulo, tipo).catch(() => []), buscarApi(titulo, tipo).catch(() => [])]);
    let mejor = null, puntos = 0;
    for (const r of a.concat(b, c)) {
      let s = parecido(r.nombre, titulo);
      if (r.anio && anio) s += Math.abs(Number(r.anio) - Number(anio)) <= 1 ? 0.1 : -0.3;
      if (s > puntos) { puntos = s; mejor = r.url; }
    }
    if (mejor && puntos >= 0.8) return mejor;
  }
  return null;
}

async function paginaEpisodio(serie, temporada, episodio) {
  const html = await texto(serie);
  const directo = /href=["']([^"']*\/episodio-?[^"']*?-(\d+)x(\d+)\/?)["']/gi;
  let d;
  while ((d = directo.exec(html))) if (Number(d[2]) === temporada && Number(d[3]) === episodio) return absoluta(d[1], BASE);
  const bloque = html.split(/(?=<div[^>]*id=["']season-content-\d+["'])/i).find((b) => new RegExp(`^<div[^>]*id=["']season-content-${temporada}["']`, 'i').test(b));
  if (!bloque) return null;
  const enlaces = [];
  const patron = /<a[^>]+class=["'][^"']*\bgroup\b[^"']*["'][^>]*href=["']([^"']+)["']|<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*\bgroup\b/gi;
  let m;
  while ((m = patron.exec(bloque))) enlaces.push(m[1] || m[2]);
  return enlaces[episodio - 1] ? absoluta(enlaces[episodio - 1], BASE) : null;
}

function campo(html, id) { return entidades((html.match(new RegExp(`<input[^>]*id=["']${id}["'][^>]*value=["']([^"']*)["']`, 'i')) || html.match(new RegExp(`<input[^>]*value=["']([^"']*)["'][^>]*id=["']${id}["']`, 'i')) || [])[1] || ''); }
function formulario(cuerpo) { return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${API}/`, Origin: API }, body: cuerpo }; }
function rot13(t) { return String(t || '').replace(/[a-z]/gi, (c) => { const base = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base); }); }

async function desenredar(h) {
  const paso1 = await texto(`${API}/ir/goto.php?h=${h}`, { headers: { Referer: `${BASE}/` } });
  const url1 = campo(paso1, 'url');
  if (!url1) return '';
  let paso2 = await texto(`${API}/ir/rd.php`, formulario(`url=${encodeURIComponent(url1)}`));
  if (!campo(paso2, 'url')) {
    const r = await pedir(`${API}/ir/rd.php`, Object.assign(formulario(`url=${encodeURIComponent(url1)}`), { redirect: 'manual' }));
    const salto = r && r.headers && r.headers.get('location');
    if (salto) paso2 = await texto(absoluta(salto, `${API}/ir/`), { headers: { Referer: `${API}/` } });
  }
  const url2 = campo(paso2, 'url');
  if (!url2) return '';
  const paso3 = await texto(`${API}/ir/redir_ddh.php`, formulario(`url=${encodeURIComponent(url2)}&dl=0`));
  const accion = entidades((paso3.match(/<form[^>]*action=["']([^"']+)["']/i) || [])[1] || '');
  const vid = campo(paso3, 'vid');
  const hash = campo(paso3, 'hash');
  const directo = rot13(atobSeguro(vid));
  if (/^https?:\/\//.test(directo)) return directo;
  if (!accion || !vid || !hash) return '';
  const final = await texto(absoluta(accion, API), formulario(`vid=${encodeURIComponent(vid)}&hash=${encodeURIComponent(hash)}`));
  const codificado = (final.match(/link\s*=\s*'([^']+)'/) || [])[1];
  return codificado ? atobSeguro(codificado) : '';
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
    
    const html = entidades(await texto(pagina));
    const tareas = [];
    const vistos = new Set();
    const agregar = (h, etiqueta) => {
      if (!h || vistos.has(h)) return;
      vistos.add(h);
      const audio = audioDe(etiqueta) || audioCodigo(etiqueta) || 'Latino';
      tareas.push(desenredar(h).then((url) => (url && /^https?:/.test(url) ? { url, audio, referer: `${BASE}/` } : null)).catch(() => null));
    };
    const botones = /<button\b[^>]*>/gi;
    let b;
    while ((b = botones.exec(html))) {
      if (!/class=["'][^"']*\bplayer-tab\b/.test(b[0])) continue;
      const destino = (b[0].match(/data-url=["']([^"']+)["']/) || [])[1] || '';
      agregar((destino.split('player.php?h=')[1] || '').split('&')[0], (b[0].match(/data-lang=["']([^"']*)["']/) || [])[1]);
    }
    const patron = /player\.php\?h=([^&"'\s<>]+)/gi;
    let m;
    while ((m = patron.exec(html))) {
      const contexto = html.slice(Math.max(0, m.index - 600), m.index);
      agregar(m[1], (contexto.match(/data-lang=["']([^"']*)["'][^>]*$/i) || [])[1] || (contexto.match(/\b(LAT|CAS|SUB|Latino|Castellano|Subtitulado)\b(?![\s\S]*\b(?:LAT|CAS|SUB|Latino|Castellano|Subtitulado)\b)/i) || [])[1]);
    }

    const lista = (await Promise.all(tareas)).filter(Boolean);
    const vistosFinal = new Set();
    const tarjetas = [];
    for (const e of lista) {
      if (!e.url || vistosFinal.has(e.url)) continue;
      vistosFinal.add(e.url);
      const hostName = (() => { try { const h = new URL(e.url).hostname.replace(/^www\./, '').toLowerCase(); const p = h.split('.'); return p.length > 1 ? p[p.length - 2].charAt(0).toUpperCase() + p[p.length - 2].slice(1) : h; } catch(_) { return 'Servidor'; } })();
      if (!HOSTS_OK.test(`${hostName} ${e.url}`)) continue;
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
