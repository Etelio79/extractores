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
function slug(t) { return normalizar(t).replace(/\s+/g, '-'); }
function titulosPosibles(datos) { const vistos = new Set(); return [datos.titulo, datos.ingles, datos.original].filter((t) => { const n = normalizar(t); if (!n || vistos.has(n)) return false; vistos.add(n); return true; }); }

const RELLENO = new Set(['ver', 'online', 'gratis', 'latino', 'castellano', 'subtitulado', 'espanol', 'audio', 'hd', 'full', 'completa', 'pelicula', 'serie']);
const VACIAS = new Set(['the', 'and', 'of', 'a', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'un', 'una']);

function limpiarTitulo(t) { const n = normalizar(String(t || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')); const limpio = n.split(' ').filter((p) => !RELLENO.has(p)).join(' '); return limpio || n; }
function parecido(a, b) { const x = limpiarTitulo(a); const y = limpiarTitulo(b); if (!x || !y) return 0; if (x === y) return 1; const [corto, largo] = x.length <= y.length ? [x, y] : [y, x]; const contiene = ` ${largo} `.includes(` ${corto} `) ? 0.6 + (0.4 * corto.length) / largo.length : 0; const px = new Set(x.split(' ').filter((p) => !VACIAS.has(p))); const py = new Set(y.split(' ').filter((p) => !VACIAS.has(p))); let comunes = 0; for (const p of px) if (py.has(p)) comunes++; const palabras = px.size && py.size ? comunes / Math.max(px.size, py.size) : 0; return Math.max(contiene, palabras); }
function audioDe(t) { const s = normalizar(t); if (!s) return ''; if (/latino|\blat\b|latam|mexic|\bmx\b|419|doblaje latino/.test(s)) return 'Latino'; if (/castellano|espana|\bcast\b|\besp\b|\bes es\b/.test(s)) return 'Castellano'; if (/subtitulad|\bvose\b|\bsub\b|\bsubs\b|\bvo\b|japones|ingles|english|original/.test(s)) return 'Subtitulado'; if (/espanol|spanish/.test(s)) return 'Español'; return ''; }

function limitar(buscador, respaldo) { return (...argumentos) => { inicio = Date.now(); caidos.clear(); registro = []; const trabajo = conLimite(Promise.resolve().then(() => buscador(...argumentos)), CIERRE, null); return respaldo ? trabajo.then((salida) => (salida && salida.length ? salida : respaldo(salida === null))) : trabajo.then((salida) => salida || []); }; }

/* ══════════════════ BUSCADOR HENAOJARA ══════════════════ */
const ROMANOS = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };

function esLatino(t) {
  const s = String(t || '').trim();
  if (!s) return false;
  return s.replace(/[^\u0000-\u024f]/g, '').length >= s.length * 0.8;
}

function titulosAnime(datos) {
  const alternos = datos.alternos || [];
  const orden = [
    ...alternos.filter((x) => ['JP', 'CN', 'KR'].includes(x.pais)).map((x) => x.titulo),
    datos.original,
    datos.ingles,
    datos.titulo,
    ...alternos.filter((x) => ['US', 'GB', 'MX', 'ES'].includes(x.pais)).map((x) => x.titulo)
  ];
  const vistos = new Set();
  return orden.filter((t) => {
    const n = normalizar(t);
    if (!n || !esLatino(t) || vistos.has(n)) return false;
    vistos.add(n);
    return true;
  }).slice(0, 4);
}

function doblajeDe(nombre) {
  const s = normalizar(nombre);
  if (/\blatino\b/.test(s)) return 'Latino';
  if (/\bcastellano\b/.test(s)) return 'Castellano';
  return 'Subtitulado';
}

function temporadaDe(nombre) {
  const s = normalizar(nombre);
  const m = s.match(/(?:season|temporada|part|parte|cour)\s*(\d+)/) || s.match(/\b(\d+)(?:st|nd|rd|th)\s+season/) || s.match(/\s(\d{1,2})$/);
  if (m) return Number(m[1]);
  const r = s.match(/\b(ii|iii|iv|v|vi)$/);
  return r ? ROMANOS[r[1]] : 1;
}

function nombreBase(nombre) {
  return normalizar(nombre)
    .replace(/\b(?:audio\s+)?(?:latino|castellano|doblaje|sub\s+espanol|espanol)\b/g, ' ')
    .replace(/(?:season|temporada|part|parte|cour)\s*\d+/g, ' ')
    .replace(/\b\d+(?:st|nd|rd|th)\s+season/g, ' ')
    .replace(/\s\d{1,2}$/, ' ')
    .replace(/\b(?:ii|iii|iv|v|vi)$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function episodioAbsoluto(datos, temporada, episodio) {
  if (temporada <= 1) return episodio;
  const previas = (datos.temporadas || []).filter((t) => t.numero >= 1 && t.numero < temporada);
  if (previas.length < temporada - 1) return 0;
  return previas.reduce((n, t) => n + t.episodios, 0) + episodio;
}

async function elegirAnime(buscar, datos, tipo, temporada, episodio) {
  const absoluto = tipo === 'tv' ? episodioAbsoluto(datos, temporada, episodio) : 1;
  const mejores = {};
  for (const consulta of titulosAnime(datos)) {
    const resultados = await buscar(consulta).catch(() => []);
    for (const r of resultados) {
      if (!r || !r.url || !r.nombre) continue;
      const audio = r.audio || doblajeDe(r.nombre);
      const sinDoblaje = normalizar(r.nombre).replace(/\b(?:audio\s+)?(?:latino|castellano|doblaje|sub\s+espanol|espanol)\b/g, ' ').replace(/\s+/g, ' ').trim();
      const exacto = [consulta, datos.titulo, datos.ingles].some((t) => normalizar(t) === sinDoblaje);
      const puntos = exacto ? 1 : Math.max(parecido(nombreBase(r.nombre), consulta), parecido(nombreBase(r.nombre), datos.titulo), parecido(nombreBase(r.nombre), datos.ingles));
      if (puntos < 0.8) continue;
      const suya = exacto ? 1 : temporadaDe(r.nombre);
      let numero = 0;
      let extra = 0;
      if (tipo === 'movie') {
        numero = 1;
        extra = /pelicula|movie|film/.test(normalizar(r.nombre)) ? 0.1 : 0;
      } else if (suya === temporada) {
        numero = episodio;
        extra = 0.2;
      } else if (suya === 1 && temporada > 1 && absoluto) {
        numero = absoluto;
      }
      if (!numero) continue;
      const total = puntos + extra;
      const grupo = mejores[audio] || (mejores[audio] = []);
      if (!grupo.some((x) => x.url === r.url)) grupo.push({ url: r.url, audio, numero, total });
    }
    const sub = mejores.Subtitulado;
    if (sub && sub.some((x) => x.total >= 1.2)) break;
  }
  return Object.values(mejores).map((grupo) => grupo.sort((a, b) => b.total - a.total).slice(0, 3));
}

async function flujoAnime(sitio, tmdbId, mediaType, season, episode) {
  const tipo = mediaType === 'movie' ? 'movie' : 'tv';
  const datos = await datosTmdb(tmdbId, tipo);
  if (!datos) return [];
  const temporada = tipo === 'tv' ? Number(season) || 1 : 1;
  const episodio = tipo === 'tv' ? Number(episode) || 1 : 1;
  const elegidos = await elegirAnime(sitio.buscar, datos, tipo, temporada, episodio);
  const listas = await Promise.all(elegidos.map(async (grupo) => {
    for (const c of grupo) {
      const pagina = await sitio.episodio(c.url, c.numero).catch(() => null);
      if (!pagina) continue;
      const enlaces = await sitio.enlaces(pagina).catch(() => []);
      if (enlaces.length) return enlaces.map((e) => Object.assign({ referer: pagina }, e, { audio: e.audio || c.audio }));
    }
    return [];
  }));
  
  const titulo = encabezado(datos, tipo, temporada, episodio);
  const tarjetas = [];
  const vistos = new Set();
  
  for (const e of [].concat(...listas)) {
    if (!e.url || vistos.has(e.url)) continue;
    vistos.add(e.url);
    
    const hostName = (() => { try { const h = new URL(e.url).hostname.replace(/^www\./, '').toLowerCase(); const p = h.split('.'); return p.length > 1 ? p[p.length - 2].charAt(0).toUpperCase() + p[p.length - 2].slice(1) : h; } catch(_) { return 'Servidor'; } })();
    
    tarjetas.push({
      name: `${sitio.fuente} (${hostName})`,
      title: titulo,
      url: e.url,
      quality: `Calidad: Auto`,
      language: e.audio ? `Audio: ${e.audio}` : '',
      provider: sitio.fuente,
      headers: { Referer: e.referer }
    });
  }
  
  return tarjetas;
}

const FUENTE = 'Henaojara';
const NUEVO = 'https://ww1.henaojara.net';
const CLASICO = 'https://henaojara.com';
const EVITAR = /mega\.nz|mega\.co|hqq|netuplayer|krakenfiles|hj\.henaojara\.com|streamhj\.top/i;

async function buscarNuevo(consulta) {
  const html = await texto(`${NUEVO}/animes?buscar=${encodeURIComponent(consulta).replace(/%20/g, '+')}`, { headers: { Referer: `${NUEVO}/` } });
  const lista = [];
  for (const art of html.split(/<article\b/i).slice(1)) {
    const href = ((art.match(/<a[^>]+href=["']([^"']+)["']/i) || [])[1] || '').replace(/^\.\//, '/');
    if (!/^\/anime\//.test(href)) continue;
    const nombre = limpiarHtml((art.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]) || entidades((art.match(/<img[^>]+alt=["']([^"']+)["']/i) || [])[1] || '');
    const clase = limpiarHtml((art.match(/<figure[\s\S]*?<a[^>]*>[\s\S]*?<b[^>]*>([\s\S]*?)<\/b>/i) || [])[1]);
    lista.push({ nombre: /pel.cula/i.test(clase) && !/pel.cula|movie/i.test(nombre) ? `${nombre} Pelicula` : nombre, url: `${NUEVO}${href}` });
  }
  return lista;
}

async function buscarClasico(consulta) {
  const html = await texto(`${CLASICO}/?s=${encodeURIComponent(consulta).replace(/%20/g, '+')}`, { headers: { Referer: `${CLASICO}/` } });
  const zona = (html.match(/class=["'][^"']*MovieList[\s\S]*?<\/ul>/i) || [''])[0];
  const lista = [];
  for (const li of zona.split(/<li\b/i).slice(1)) {
    const href = (li.match(/<a[^>]+href=["']([^"']+)["']/i) || [])[1];
    const nombre = limpiarHtml((li.match(/class=["'][^"']*Title[^"']*["'][^>]*>([\s\S]*?)<\//i) || li.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i) || [])[1]);
    if (href && nombre) lista.push({ nombre, url: absoluta(href, CLASICO) });
  }
  return lista;
}

async function buscar(consulta) {
  const [a, b] = await Promise.all([buscarNuevo(consulta).catch(() => []), buscarClasico(consulta).catch(() => [])]);
  return a.concat(b);
}

async function episodio(url, numero) {
  if (url.startsWith(NUEVO)) {
    const nombre = url.replace(/\/+$/, '').split('/').pop();
    return `${NUEVO}/ver/${nombre}-${numero}`;
  }
  const html = await texto(url, { headers: { Referer: `${CLASICO}/` } });
  let otro = null;
  const patron = /href=["']([^"']*?-(\d+)x(\d+)\/?)["']/gi;
  let m;
  while ((m = patron.exec(html))) {
    if (Number(m[3]) !== numero) continue;
    if (Number(m[2]) === 1) return absoluta(m[1], CLASICO);
    if (!otro) otro = absoluta(m[1], CLASICO);
  }
  return otro || (numero === 1 ? url : null);
}

function hexATexto(hex) {
  let salida = '';
  for (let i = 0; i + 1 < hex.length; i += 2) salida += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return salida;
}

async function enlacesNuevo(pagina) {
  let actual = pagina;
  let html = await texto(actual, { headers: { Referer: `${NUEVO}/` } });
  if (!/data-encrypt|data-dwn/.test(html)) {
    const sinNumero = pagina.replace(/-\d+$/, '');
    if (sinNumero !== pagina) {
      const otra = await texto(sinNumero, { headers: { Referer: `${NUEVO}/` } });
      if (/data-encrypt|data-dwn/.test(otra)) {
        html = otra;
        actual = sinNumero;
      }
    }
  }
  const urls = [];
  const cifrado = (html.match(/class=["'][^"']*\bopt\b[^"']*["'][^>]*data-encrypt=["']([^"']+)["']/i) || html.match(/data-encrypt=["']([^"']+)["']/i) || [])[1];
  if (cifrado) {
    const servidores = await texto(`${NUEVO}/hj`, {
      method: 'POST',
      headers: { Accept: '*/*', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: actual },
      body: `acc=opt&i=${encodeURIComponent(cifrado)}`
    });
    const patron = /encrypt=["']([0-9a-fA-F]+)["']/g;
    let m;
    while ((m = patron.exec(servidores))) urls.push(hexATexto(m[1]));
  }
  const descargas = (html.match(/data-dwn=["']([^"']+)["']/i) || [])[1];
  if (descargas) {
    try {
      for (const u of JSON.parse(entidades(descargas))) urls.push(u);
    } catch (e) {}
  }
  return urls.filter((u) => /^https?:/.test(u) && !EVITAR.test(u)).map((url) => ({ url, referer: `${NUEVO}/` }));
}

async function enlacesClasico(pagina) {
  const html = await texto(pagina, { headers: { Referer: `${CLASICO}/` } });
  const tareas = [];
  const patron = /class=["'][^"']*TPlayerTb[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = patron.exec(html))) {
    const contenido = entidades(m[1]);
    const marco = (contenido.match(/<iframe[^>]+src=["']([^"']+)["']/i) || [])[1];
    if (!marco) continue;
    const url = absoluta(marco, pagina);
    tareas.push((async () => {
      const real = /henaojara\./i.test(dominio(url)) ? await marcoReal(url, pagina) : url;
      return real && !EVITAR.test(real) && !/multiplayer/i.test(real) ? { url: real, referer: `${CLASICO}/` } : null;
    })().catch(() => null));
  }
  return (await Promise.all(tareas)).filter(Boolean);
}

async function enlaces(pagina) {
  return pagina.startsWith(NUEVO) ? enlacesNuevo(pagina) : enlacesClasico(pagina);
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    return await flujoAnime({ fuente: FUENTE, buscar, episodio, enlaces }, tmdbId, mediaType, season, episode);
  } catch (e) {
    console.log(`[${FUENTE}] ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: limitar(getStreams) };