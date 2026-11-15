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

function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, ' ').trim();
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

function slug(t) { return normalizar(t).replace(/\s+/g, '-'); }

function titulosPosibles(datos) {
  const vistos = new Set();
  return [datos.titulo, datos.ingles, datos.original].filter((t) => {
    const n = normalizar(t);
    if (!n || vistos.has(n)) return false;
    vistos.add(n);
    return true;
  });
}

const RELLENO = new Set(['ver', 'online', 'gratis', 'latino', 'castellano', 'subtitulado', 'espanol', 'audio', 'hd', 'full', 'completa', 'pelicula', 'serie']);
const VACIAS = new Set(['the', 'and', 'of', 'a', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'un', 'una']);

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

function tarjeta(info) {
  const s = {
    name: info.servidor ? `${info.fuente} (${info.servidor})` : info.fuente,
    title: info.titulo,
    url: info.url,
    quality: `Calidad: ${info.calidad || 'Auto'}`,
    provider: info.fuente
  };
  if (info.audio) s.language = `Audio: ${info.audio}`;
  if (info.headers && Object.keys(info.headers).length) s.headers = info.headers;
  return s;
}

function pesoAudio(a) { return { Latino: 3, 'Español': 2, Castellano: 1 }[a] || 0; }
function pesoCalidad(c) { if (/4k/i.test(c)) return 2160; return Number((String(c || '').match(/(\d{3,4})p/i) || [])[1]) || 0; }

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
  const h = dominio(url).replace(/^www\./, '');
  for (const [patron, nombre] of _HOSTERS) if (h.includes(patron)) return nombre;
  const partes = h.split('.');
  const n = partes.length > 1 ? partes[partes.length - 2] : h;
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'Directo';
}

/* ── Armar tarjetas SIN resolver (solo devuelve el embed) ── */
async function armar(lista, titulo, fuente) {
  const vistos = new Set();
  const tarjetas = [];
  for (const item of lista) {
    if (!item.url || vistos.has(item.url)) continue;
    vistos.add(item.url);
    tarjetas.push({
      orden: pesoAudio(item.audio || '') * 10000 + pesoCalidad(item.calidad || ''),
      t: tarjeta({
        titulo,
        calidad: item.calidad || '',
        audio: item.audio || '',
        fuente,
        servidor: item.servidor || nombreServidor(item.url),
        url: item.url,
        headers: item.referer ? { Referer: item.referer, 'User-Agent': UA } : { 'User-Agent': UA }
      })
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

/* ══════════════════ BUSCADOR SERIESMETRO ══════════════════ */
const FUENTE = 'SeriesMetro';
const BASE = 'https://www3.seriesmetro.net';

function etiquetasOpciones(html) {
  const etiquetas = {};
  const patron = /href=["']#options-(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = patron.exec(html))) {
    const servidor = (m[2].match(/class=["'][^"']*server[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1];
    etiquetas[m[1]] = limpiarHtml(servidor || m[2]);
  }
  return etiquetas;
}

async function marcoReal(url, referer) {
  const html = await texto(url, { headers: { Referer: referer } });
  const dentro = html.match(/class=["'][^"']*Video[^"']*["'][\s\S]{0,300}?<iframe[^>]+src=["']([^"']+)["']/i);
  const cualquiera = html.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  const destino = (dentro || cualquiera || [])[1];
  return destino ? absoluta(destino, url) : '';
}

async function opcionesToro(html, pagina) {
  const etiquetas = etiquetasOpciones(html);
  const vistos = new Set();
  const marcos = [];
  const patron = /id=["']options-(\d+)["'][\s\S]{0,400}?<iframe[^>]+?(?:data-src|src)=["']([^"']+)["']/gi;
  let m;
  while ((m = patron.exec(html))) {
    const url = absoluta(m[2], pagina);
    if (!vistos.has(url)) {
      vistos.add(url);
      marcos.push({ url, etiqueta: etiquetas[m[1]] || '' });
    }
  }
  if (!marcos.length) {
    const suelto = /<iframe[^>]+?(?:data-src|src)=["']([^"']*trembed=[^"']+)["']/gi;
    while ((m = suelto.exec(html))) {
      const url = absoluta(m[1], pagina);
      if (!vistos.has(url)) {
        vistos.add(url);
        marcos.push({ url, etiqueta: '' });
      }
    }
  }
  const lista = await Promise.all(marcos.map(async (x) => {
    const destino = /trembed=/.test(x.url) ? await marcoReal(x.url, pagina) : x.url;
    if (!destino) return null;
    const partes = x.etiqueta.split(/\s*[-|·]\s*/);
    const audio = partes.map(audioDe).find(Boolean) || '';
    const servidor = partes.find((p) => p && !audioDe(p) && !/^\d+\.?$/.test(p) && !/opci[oó]n/i.test(p)) || '';
    return { url: destino, audio, servidor, referer: pagina };
  }));
  return lista.filter(Boolean);
}

async function episodioAjax(base, pagina, html, temporada, episodio) {
  const post = (html.match(/data-post=["'](\d+)["']/) || [])[1];
  if (!post) return null;
  const cuerpo = `action=action_select_season&season=${temporada}&post=${post}`;
  const respuesta = await texto(`${base}/wp-admin/admin-ajax.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Origin: base, Referer: pagina },
    body: cuerpo
  });
  const patron = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = patron.exec(respuesta))) {
    const href = m[1];
    const n = href.match(/temporada-(\d+)-capitulo-(\d+)/i) || href.match(/temporada\/(\d+)\/capitulo\/(\d+)/i) || href.replace(/-capitulo-/i, 'x').match(/(\d+)x(\d+)/);
    if (n && Number(n[1]) === temporada && Number(n[2]) === episodio) return absoluta(href, base);
  }
  return null;
}

async function buscar(titulos, tipo) {
  for (const titulo of titulos) {
    const html = await texto(`${BASE}/?s=${encodeURIComponent(titulo)}`);
    let mejor = null;
    let puntos = 0;
    for (const art of html.split(/<article/i).slice(1)) {
      const href = (art.match(/<a[^>]+class=["'][^"']*lnk-blk[^"']*["'][^>]*href=["']([^"']+)["']|<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*lnk-blk/i) || []).slice(1).find(Boolean);
      const nombre = limpiarHtml((art.match(/class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h[1-3]>/i) || [])[1]);
      if (!href) continue;
      if ((tipo === 'movie') !== /pelicula/.test(href)) continue;
      const s = parecido(nombre, titulo);
      if (s > puntos) {
        puntos = s;
        mejor = absoluta(href, BASE);
      }
    }
    if (mejor && puntos >= 0.8) return { url: mejor, html: '' };
  }
  const ruta = tipo === 'movie' ? 'pelicula' : 'serie';
  for (const titulo of titulos) {
    const url = `${BASE}/${ruta}/${slug(titulo)}/`;
    const html = await texto(url);
    if (/trembed=|data-post=/.test(html)) return { url, html };
  }
  return null;
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const datos = await datosTmdb(tmdbId, tipo);
    if (!datos) return [];
    
    const temporada = Number(season) || 1;
    const episodio = Number(episode) || 1;
    
    const hallado = await buscar(titulosPosibles(datos), tipo);
    if (!hallado) return [];
    
    let pagina = hallado.url;
    let html = hallado.html || await texto(pagina);
    
    if (tipo === 'tv') {
      pagina = await episodioAjax(BASE, pagina, html, temporada, episodio);
      if (!pagina) return [];
      html = await texto(pagina, { headers: { Referer: hallado.url } });
    }
    
    const lista = await opcionesToro(html, pagina);
    return await armar(lista, encabezado(datos, tipo, temporada, episodio), FUENTE);
  } catch (e) {
    console.log(`[${FUENTE}] ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: limitar(getStreams) };
