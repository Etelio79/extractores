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

/* ── Lista blanca: solo se devuelven embeds de hosts que ya reproducen en la app ── */
const HOSTS_OK = /voe|vidhide|vidhidepro|filelions|dhtpre|minochinos|ryderjet|vimeos|vimeus|morencius|filemoon|moonplayer|byse|kerapoxy|f16px|vidara|mxzhxco8dft/i;

/* ══════════════════ BUSCADOR CINECALIDAD ══════════════════ */
const FUENTE = 'CineCalidad';
const BASES = ['https://www.cinecalidad.vg', 'https://www.cinecalidad.ec'];

async function buscar(base, titulos, tipo) {
  for (const titulo of titulos) {
    const html = await texto(`${base}/?s=${encodeURIComponent(titulo)}`);
    let mejor = null, puntos = 0;
    for (const art of html.split(/<article[^>]*class=["'][^"']*\bitem\b/i).slice(1)) {
      const href = (art.match(/<a[^>]+href=["']([^"']+)["']/) || [])[1];
      const nombre = limpiarHtml((art.match(/class=["'][^"']*in_title[^"']*["'][^>]*>([\s\S]*?)<\/div>/) || [])[1]) || entidades((art.match(/<img[^>]+alt=["']([^"']+)["']/) || [])[1] || '');
      if (!href) continue;
      const esPeli = /\/(?:ver-)?pelicula\//.test(href);
      const esSerie = /\/(?:ver-)?serie\//.test(href);
      if (tipo === 'movie' ? !esPeli : !esSerie) continue;
      const s = parecido(nombre, titulo);
      if (s > puntos) { puntos = s; mejor = absoluta(href, base); }
    }
    if (mejor && puntos >= 0.8) return mejor;
  }
  return null;
}

function episodioEn(html, temporada, episodio) {
  const directo = new RegExp(`href=["']([^"']*\\/episodio\\/[^"']*?-${temporada}x${episodio}\\/?)["']`, 'i');
  const d = html.match(directo);
  if (d) return d[1];
  const items = html.split(/<li[^>]*>/i);
  for (const li of items) {
    const num = limpiarHtml((li.match(/class=["'][^"']*numerando[^"']*["'][^>]*>([\s\S]*?)<\//) || [])[1]).replace(/[SE]/gi, '');
    const partes = num.split('-').map((x) => parseInt(x, 10)).filter((x) => !isNaN(x));
    if (partes.length === 2 && partes[0] === temporada && partes[1] === episodio) {
      const href = (li.match(/<a[^>]+href=["']([^"']+)["']/) || [])[1];
      if (href) return href;
    }
  }
  return null;
}

async function porSlug(base, datos) {
  for (const t of titulosPosibles(datos)) {
    const s = slug(t);
    if (!s) continue;
    for (const variante of [s, `${s}-2`, `${s}-3`]) {
      const url = `${base}/pelicula/${variante}/`;
      const html = await texto(url, { headers: { Referer: `${base}/` } });
      if (!html) continue;
      const anio = (html.match(/<h1[^>]*>[^<]*\((\d{4})\)[^<]*<\/h1>/) || [])[1];
      if (!anio || !datos.anio || anio === datos.anio) return { url, html };
    }
  }
  return null;
}

async function seriePorSlug(base, datos) {
  for (const t of titulosPosibles(datos)) {
    const s = slug(t);
    if (!s) continue;
    for (const ruta of [`${base}/ver-serie/${s}/`, `${base}/serie/${s}/`]) {
      const html = await texto(ruta, { headers: { Referer: `${base}/` } });
      if (/class=["'][^"']*numerando|\/episodio\//.test(html)) return { url: ruta, html };
    }
  }
  return null;
}

const TRAILER = /youtube\.com|youtu\.be|youtube-nocookie/i;

async function intermedio(url, referer) {
  if (!/cinecalidad\./i.test(dominio(url))) return url;
  const html = await texto(url, { headers: { Referer: referer } });
  const destino = (html.match(/id=["']btn_enlace["'][^>]*>[\s\S]*?href=["']([^"']+)["']/i) || html.match(/<iframe[^>]+src=["']([^"']+)["']/i) || [])[1];
  return destino ? absoluta(destino, url) : '';
}

async function enlacesPagina(html, base, pagina) {
  const crudos = [];
  const po = /<li[^>]*data-option=["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = po.exec(html))) {
    if (/dooplay_player_option_trailer/i.test(m[0])) continue;
    const destino = /^https?:/.test(m[1]) ? m[1] : atobSeguro(m[1]);
    if (/^https?:/.test(destino) && !TRAILER.test(destino)) crudos.push({ url: destino, audio: audioDe(limpiarHtml(m[2])) || 'Latino' });
  }
  const pu = /<a\b[^>]*data-url=["']([A-Za-z0-9+/=]{20,})["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = pu.exec(html))) {
    const destino = atobSeguro(m[1]);
    if (/^https?:/.test(destino) && !TRAILER.test(destino)) crudos.push({ url: destino, audio: audioDe(limpiarHtml(m[2])) || 'Latino' });
  }
  const ps = /data-src=["']([A-Za-z0-9+/=]{20,})["']/g;
  while ((m = ps.exec(html))) {
    const destino = atobSeguro(m[1]);
    if (/^https?:/.test(destino) && !TRAILER.test(destino)) crudos.push({ url: destino, audio: 'Latino' });
  }
  const vistos = new Set();
  const unicos = crudos.filter((x) => !vistos.has(x.url) && vistos.add(x.url));
  const lista = await Promise.all(unicos.map(async (x) => {
    const url = await intermedio(x.url, pagina).catch(() => '');
    return url ? { url, audio: x.audio, referer: `${base}/` } : null;
  }));
  return lista.filter(Boolean);
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const datos = await datosTmdb(tmdbId, tipo);
    if (!datos) return [];
    const temporada = Number(season) || 1;
    const episodio = Number(episode) || 1;
    const titulo = encabezado(datos, tipo, temporada, episodio);
    const enBase = async (base) => {
      let pagina = await buscar(base, titulosPosibles(datos), tipo);
      let html = '';
      if (tipo === 'tv') {
        let serie = pagina ? await texto(pagina) : '';
        let fuenteSerie = pagina;
        if (!/class=["'][^"']*numerando|\/episodio\//.test(serie)) {
          const directa = await seriePorSlug(base, datos);
          serie = directa ? directa.html : '';
          fuenteSerie = directa ? directa.url : '';
        }
        pagina = serie ? episodioEn(serie, temporada, episodio) : null;
        if (!pagina && fuenteSerie) {
          const nombre = fuenteSerie.replace(/\/+$/, '').split('/').pop();
          const supuesta = `${base}/episodio/${nombre}-${temporada}x${episodio}/`;
          const h = await texto(supuesta, { headers: { Referer: fuenteSerie } });
          if (h) { pagina = supuesta; html = h; }
        }
      }
      if (pagina && !html) {
        pagina = absoluta(pagina, base);
        html = await texto(pagina);
      } else if (!pagina && tipo === 'movie') {
        const directo = await porSlug(base, datos);
        if (directo) { pagina = directo.url; html = directo.html; }
      }
      return html ? enlacesPagina(html, base, pagina) : [];
    };
    
    for (const base of BASES) {
      const lista = await enBase(base);
      if (lista.length) {
        const vistos = new Set();
        const tarjetas = [];
        for (const e of lista) {
          if (!e.url || vistos.has(e.url)) continue;
          vistos.add(e.url);
          const hostName = (() => { try { const h = new URL(e.url).hostname.replace(/^www\./, '').toLowerCase(); const p = h.split('.'); return p.length > 1 ? p[p.length - 2].charAt(0).toUpperCase() + p[p.length - 2].slice(1) : h; } catch(_) { return 'Servidor'; } })();
          if (!HOSTS_OK.test(`${hostName} ${e.url}`)) continue;
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
        return tarjetas;
      }
    }
    return [];
  } catch (e) {
    console.log(`[${FUENTE}] ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: limitar(getStreams) };
