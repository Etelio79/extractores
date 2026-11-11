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

function origen(url) { const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i); return m ? m[1] : ''; }

const ENTIDADES = { amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ntilde:'ñ',Ntilde:'Ñ',aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',Aacute:'Á',Eacute:'É',Iacute:'Í',Oacute:'Ó',Uacute:'Ú',uuml:'ü',iexcl:'¡',iquest:'¿' };
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
  const [es, en] = await Promise.all([json(`${ruta}&language=es-MX`), json(`${ruta}&language=en-US`)]);
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
function slug(t) { return normalizar(t).replace(/\s+/g, '-'); }
function titulosPosibles(datos) {
  const vistos = new Set();
  return [datos.titulo, datos.ingles, datos.original].filter((t) => {
    const n = normalizar(t);
    if (!n || vistos.has(n)) return false;
    vistos.add(n); return true;
  });
}

const RELLENO = new Set(['ver','online','gratis','latino','castellano','subtitulado','espanol','audio','hd','full','completa','pelicula','serie']);
const VACIAS = new Set(['the','and','of','a','el','la','los','las','de','del','y','en','un','una']);
function limpiarTitulo(t) {
  const n = normalizar(String(t || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' '));
  const limpio = n.split(' ').filter((p) => !RELLENO.has(p)).join(' ');
  return limpio || n;
}
function parecido(a, b) {
  const x = limpiarTitulo(a); const y = limpiarTitulo(b);
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
    if (!vistos.has(url)) { vistos.add(url); marcos.push({ url, etiqueta: etiquetas[m[1]] || '' }); }
  }
  if (!marcos.length) {
    const suelto = /<iframe[^>]+?(?:data-src|src)=["']([^"']*trembed=[^"']+)["']/gi;
    while ((m = suelto.exec(html))) {
      const url = absoluta(m[1], pagina);
      if (!vistos.has(url)) { vistos.add(url); marcos.push({ url, etiqueta: '' }); }
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
  const respuesta = await texto(`${base}/wp-admin/admin-ajax.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Origin: base, Referer: pagina },
    body: `action=action_select_season&season=${temporada}&post=${post}`
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

const FUENTE = 'SeriesMetro';
const BASE = 'https://www3.seriesmetro.net';

async function buscar(titulos, tipo) {
  for (const titulo of titulos) {
    const html = await texto(`${BASE}/?s=${encodeURIComponent(titulo)}`);
    let mejor = null; let puntos = 0;
    for (const art of html.split(/<article/i).slice(1)) {
      const href = (art.match(/<a[^>]+class=["'][^"']*lnk-blk[^"']*["'][^>]*href=["']([^"']+)["']|<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*lnk-blk/i) || []).slice(1).find(Boolean);
      const nombre = limpiarHtml((art.match(/class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h[1-3]>/i) || [])[1]);
      if (!href) continue;
      if ((tipo === 'movie') !== /pelicula/.test(href)) continue;
      const s = parecido(nombre, titulo);
      if (s > puntos) { puntos = s; mejor = absoluta(href, BASE); }
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
    const titulo = encabezado(datos, tipo, temporada, episodio);
    const vistos = new Set();
    const tarjetas = [];
    for (const item of lista) {
      if (!item.url || vistos.has(item.url)) continue;
      vistos.add(item.url);
      let host = item.servidor || 'Servidor';
      if (!item.servidor) {
        try { host = new URL(item.url).hostname.replace('www.', '').split('.')[0]; } catch (_) {}
        host = host.charAt(0).toUpperCase() + host.slice(1);
      }
      const audio = item.audio || '';
      const calidad = calidadTexto(item.url);
      tarjetas.push({
        orden: pesoAudio(audio) * 10000 + pesoCalidad(calidad),
        t: tarjeta({ titulo, calidad, audio, fuente: FUENTE, servidor: host, url: item.url, headers: {} })
      });
    }
    return tarjetas.sort((a, b) => b.orden - a.orden).map((x) => x.t);
  } catch (e) {
    console.log(`[${FUENTE}] ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: limitar(getStreams) };