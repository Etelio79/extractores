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

function origen(url) {
  const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i);
  return m ? m[1] : '';
}

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

function limpiarHtml(t) {
  return entidades(String(t || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
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
    anio: String(a.release_date || a.first_air_date || b.release_date || b.first_air_date || '').slice(0, 4)
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

function limitar(buscador, respaldo) {
  return (...argumentos) => {
    inicio = Date.now();
    const trabajo = conLimite(Promise.resolve().then(() => buscador(...argumentos)), CIERRE, null);
    return respaldo ? trabajo.then((salida) => (salida && salida.length ? salida : respaldo(salida === null))) : trabajo.then((salida) => salida || []);
  };
}

const __SRV = [
  [/voe/i, 'Voe'], [/filemoon|moonplayer|byse|kerapoxy|f16px/i, 'Filemoon'],
  [/streamwish|hglink|vibuxer|hlswish|wishembed|awish|swdyu|strwish|streamhg|dhcplay|wishfast|embedwish|hanerix|cdnwish/i, 'StreamWish'],
  [/vidhide|filelions|dhtpre|minochinos|ryderjet|vidhidepro/i, 'VidHide'],
  [/vimeos|vimeus/i, 'Vimeos'], [/morencius/i, 'Morencius'],
  [/dood|d000d|ds2play/i, 'DoodStream'], [/mixdrop/i, 'MixDrop'], [/streamtape/i, 'StreamTape'],
  [/uqload/i, 'Uqload'], [/mp4upload/i, 'Mp4Upload'], [/ok\.ru/i, 'OK.ru'],
  [/wolfstream/i, 'Wolfstream'], [/waaw\.to|hqq\.tv|netu\./i, 'Netu']
];
function __nombreSrv(url) {
  let h = '';
  try { h = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return 'Servidor'; }
  for (const [p, n] of __SRV) if (p.test(h)) return n;
  const partes = h.split('.');
  const n = partes.length > 1 ? partes[partes.length - 2] : h;
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'Servidor';
}

const FUENTE = 'AresHD';
const BASE = 'https://areshd.com';

/* ── Filtros de hosts ── */
const HOSTS_BLOQUEADOS = /^(?:megaup\.net|1fichier\.com|mediafire\.com|rapidgator\.net|katfile\.com|nitroflare\.com|ddownload\.com|turbobit\.net|uploaded\.net|filefactory\.com|acortalink\.me|acortalink\.net|adf\.ly|adfly\.com|linkvertise\.com|ouo\.io|shrinkme\.io|shorte\.st|clk\.sh)$/i;

function _limpia(s) {
  return String(s || '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
}

function esValido(url, urlOriginal) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (/^magnet:/i.test(url)) return false;
  if (urlOriginal && _limpia(url) === _limpia(urlOriginal)) return false;
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (HOSTS_BLOQUEADOS.test(h)) return false;
  } catch (_) { return false; }
  return true;
}

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
      if (s > puntos) {
        puntos = s;
        mejor = href;
      }
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

      tareas.push(texto(reproductor, { headers: { Referer: pagina } }).then((h) => {
        const url = (h.match(/var\s+url\s*=\s*'([^']+)'/i) || h.match(/var\s+url\s*=\s*"([^"]+)"/i) || [])[1];
        if (!url) return null;
        const urlFinal = absoluta(url, reproductor);
        if (!esValido(urlFinal, reproductor)) return null;
        return { url: urlFinal, audio, referer: `${BASE}/`, servidor: s[2].trim() };
      }).catch(() => null));
    }
  });

  const listos = await Promise.all(tareas);
  return listos.filter(Boolean);
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const datos = await datosTmdb(tmdbId, tipo);
    if (!datos) return [];

    const temporada = Number(season) || 1;
    const episodio = Number(episode) || 1;

    let pagina = await buscar(titulosPosibles(datos), tipo, datos.anio);
    if (pagina && tipo === 'tv') {
      pagina = await paginaEpisodio(pagina, temporada, episodio);
    }
    if (!pagina) return [];

    const titulo = encabezado(datos, tipo, temporada, episodio);
    const encontrados = await enlaces(pagina);

    const tarjetas = [];
    const vistos = new Set();

    for (const e of encontrados) {
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

    return tarjetas;
  } catch (e) {
    console.log(`[${FUENTE}] ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: limitar(getStreams) };
