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
    tam: (d.body || '').length,
    escudo: d.status >= 400 && /just a moment|cf-chl|challenge-platform|cf_chl|attention required/i.test(String(d.body || '').slice(0, 6000)),
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

const caidos = new Set();
let registro = [];

function anotar(t) {
  if (registro.length < 80) registro.push(String(t).replace(/\s+/g, ' ').trim());
}

function rutaCorta(url) {
  return String(url || '').replace(/^https?:\/\/(?:www\.)?/i, '').replace(/[?&]api_key=[^&]+/, '').slice(0, 75);
}

function peso(n) {
  return n < 1024 ? `${n}B` : `${Math.round(n / 1024)}KB`;
}

async function pedir(url, opciones) {
  const host = String(url || '').replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
  const metodo = String((opciones && opciones.method) || 'GET').toUpperCase();
  if (caidos.has(host) || restante() <= 0) {
    anotar(`${metodo} ${rutaCorta(url)} → omitido`);
    return null;
  }
  const comienzo = Date.now();
  const r = await pedirCrudo(url, opciones);
  const estado = !r ? 'tiempo agotado' : !r.status ? `error de red${r.statusText ? ` (${String(r.statusText).slice(0, 40)})` : ''}` : r.status;
  const marca = opciones && opciones.headers && opciones.headers.RSC ? ' (RSC)' : '';
  if (!(r && r.ok && /themoviedb/.test(host))) anotar(`${metodo}${marca} ${rutaCorta(url)} → ${estado}${r && r.status && r.tam !== undefined ? ` · ${peso(r.tam)}` : ''}${r && r.escudo ? ' · Cloudflare' : ''} · ${((Date.now() - comienzo) / 1000).toFixed(1)}s${r && r.status && r.url && rutaCorta(r.url) !== rutaCorta(url) ? ` → ${rutaCorta(r.url).slice(0, 45)}` : ''}`);
  if (r && !r.status) {
    caidos.add(host);
    return null;
  }
  return r;
}

async function pedirCrudo(url, opciones) {
  const o = Object.assign({}, opciones || {});
  const limite = Math.min(o.limite || CIERRE, CIERRE - transcurrido());
  const sinCabeceras = o.sinCabeceras;
  delete o.limite;
  delete o.sinCabeceras;
  o.headers = sinCabeceras ? Object.assign({}, o.headers || {}) : Object.assign({
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

function cookies(respuesta) {
  const crudo = respuesta && respuesta.headers && respuesta.headers.get('set-cookie');
  if (!crudo) return '';
  return crudo.split(/,(?=\s*[A-Za-z0-9_.\-]+=)|\n/).map((c) => c.split(';')[0].trim()).filter((c) => c.includes('=')).join('; ');
}

function conClases(html, clases) {
  const cuerpo = String(html || '');
  const inicios = [];
  const patron = /<[a-z][a-z0-9]*\b[^>]*?\bclass\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let m;
  while ((m = patron.exec(cuerpo))) {
    const tiene = m[1].split(/\s+/);
    if (clases.every((c) => tiene.includes(c))) inicios.push(m.index);
  }
  return inicios.map((inicio, i) => cuerpo.slice(inicio, i + 1 < inicios.length ? inicios[i + 1] : cuerpo.length));
}

function origen(url) {
  const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i);
  return m ? m[1] : '';
}

function dominio(url) {
  const m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase() : '';
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

function etiquetaAltura(alto) {
  const h = parseInt(alto, 10) || 0;
  if (!h) return '';
  if (h >= 2000) return '4K';
  if (h >= 1400) return '1440p';
  if (h >= 1000) return '1080p';
  if (h >= 700) return '720p';
  if (h >= 470) return '480p';
  if (h >= 350) return '360p';
  return `${h}p`;
}

function calidadTexto(t) {
  const s = String(t || '');
  if (/2160|4k|uhd/i.test(s)) return '4K';
  const m = s.match(/(1440|1080|720|480|360|240)\s*p?/i);
  return m ? `${m[1]}p` : '';
}

function atobSeguro(t) {
  try {
    return atob(String(t || '').replace(/\s+/g, ''));
  } catch (e) {
    return '';
  }
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

function nombreServidor(url, etiqueta) {
  return hostPermitido(url, etiqueta) || 'Servidor';
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
    paises: [].concat(a.origin_country || b.origin_country || [], ((a.production_countries || b.production_countries || []).map((x) => x.iso_3166_1))).filter(Boolean),
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

const TELE = typeof __plugin_sleep !== 'function' && typeof __cheerio_load === 'function';

function tarjeta(info) {
  const s = {
    name: info.servidor ? `${info.fuente} (${info.servidor})` : info.fuente,
    title: info.titulo,
    url: info.url,
    quality: `Calidad: ${info.calidad || 'Auto'}`,
    provider: info.fuente
  };
  if (info.tamano) s.size = `Tamaño: ${info.tamano}`;
  if (info.audio) s.language = `Audio: ${info.audio}`;
  if (TELE) {
    s.size = [s.quality, s.size].filter(Boolean).join(' • ');
    s.quality = s.name;
  }
  if (info.headers && Object.keys(info.headers).length) s.headers = info.headers;
  return s;
}

function pesoCalidad(c) {
  if (/4k/i.test(c)) return 2160;
  return Number((String(c || '').match(/(\d{3,4})p/i) || [])[1]) || 0;
}

function pesoAudio(a) {
  return { Latino: 3, 'Español': 2, Castellano: 1 }[a] || 0;
}

async function armar(lista, titulo, fuente) {
  const vistos = new Set();
  const tarjetas = [];
  for (const item of lista) {
    if (!item || !item.url || vistos.has(item.url)) continue;
    vistos.add(item.url);
    if (!hostPermitido(item.url, item.servidor)) continue;
    tarjetas.push({
      orden: pesoAudio(item.audio || '') * 10000 + pesoCalidad(item.calidad || ''),
      t: tarjeta({
        titulo,
        calidad: item.calidad || '',
        audio: item.audio || '',
        fuente,
        servidor: nombreServidor(item.url, item.servidor),
        url: item.url,
        headers: item.referer ? { Referer: item.referer, 'User-Agent': UA } : { 'User-Agent': UA }
      })
    });
  }
  return tarjetas.sort((a, b) => b.orden - a.orden).map((x) => x.t);
}

async function enCadena(tareas, procesar) {
  const pendientes = tareas.map((tarea) => Promise.resolve().then(tarea).catch(() => []));
  for (const pendiente of pendientes) {
    const lista = await pendiente;
    if (!lista || !lista.length) continue;
    const salida = await procesar(lista);
    if (salida.length) return salida;
  }
  return [];
}

async function enOrden(tareas, procesar) {
  for (const tarea of tareas) {
    const lista = await Promise.resolve().then(tarea).catch(() => []);
    if (!lista || !lista.length) continue;
    const salida = await procesar(lista);
    if (salida.length) return salida;
  }
  return [];
}

function limitar(buscador, respaldo) {
  return (...argumentos) => {
    inicio = Date.now();
    caidos.clear();
    registro = [];
    const trabajo = conLimite(Promise.resolve().then(() => buscador(...argumentos)), CIERRE, null);
    return respaldo ? trabajo.then((salida) => (salida && salida.length ? salida : respaldo(salida === null))) : trabajo.then((salida) => salida || []);
  };
}

function muestra(html, patron, ancho) {
  const t = String(html || '');
  const m = patron.exec(t);
  if (!m) return '';
  const desde = Math.max(0, m.index - Math.floor((ancho || 160) / 3));
  return t.slice(desde, desde + (ancho || 160)).replace(/\s+/g, ' ').trim();
}

function contar(html, patron) {
  return (String(html || '').match(patron) || []).length;
}

function tarjetaRastro(fuente, agotado) {
  let lineas = registro.slice();
  if (lineas.length > 22) lineas = lineas.slice(0, 10).concat(['…'], lineas.slice(-11));
  if (agotado) lineas.push('se acabó el tiempo antes de terminar');
  const texto = lineas.length ? lineas.map((l) => `› ${l}`).join('\n') : 'no se hizo ninguna petición';
  return [{
    name: `${fuente} (Diagnóstico)`,
    title: texto,
    url: 'https://example.com/diagnostico',
    quality: texto,
    provider: fuente
  }];
}

const FUENTE = 'PelisGo';
const BASE = 'https://pelisgo.online';
let paginaVacia = false;
const NAVEGADOR = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'es-US,es;q=0.9,en-US;q=0.8,en;q=0.7,es-419;q=0.6',
  'sec-ch-ua': '"Chromium";v="137", "Not-A.Brand";v="24", "Google Chrome";v="137"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

function campo(obj, nombre) {
  return ((obj.match(new RegExp(`${nombre}[\\\\"' ]+:[\\\\"' ]+([^\\\\"',}]+)`, 'i')) || [])[1] || '').trim();
}

function slugSitio(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s-]/gi, '').toLowerCase().trim().replace(/\s+/g, '-');
}

function ruta(tipo, s, temporada, episodio) {
  return tipo === 'movie' ? `${BASE}/movies/${s}` : `${BASE}/series/${s}/temporada/${temporada}/episodio/${episodio}`;
}

function conServidores(html) {
  return html && /server[\\"' ]+:/.test(html) ? html : '';
}

let mostrado = false;

async function crudo(url, opciones) {
  const r = await pedir(url, opciones);
  if (!r || !r.status) return { status: 0, html: '' };
  return { status: r.status, html: (await conLimite(r.text(), 10000, '')) || '' };
}

async function revisar(url) {
  const a = await crudo(url, { sinCabeceras: true });
  if (conServidores(a.html)) {
    anotar(`servidores en la página: ${contar(a.html, /\{[^{}]*?server[\\"' ]+:/gi)}`);
    return a.html;
  }
  if (a.status !== 200) return '';
  const b = await crudo(url, { sinCabeceras: true, headers: { RSC: '1' } });
  if (conServidores(b.html)) return b.html;
  if (!mostrado) {
    mostrado = true;
    anotar(`página sin servidores · contiene "404": ${/404/.test(a.html) ? 'sí' : 'no'} · tplayer ${contar(a.html, /tplayer/gi)} · pixeldrain ${contar(a.html, /pixeldrain/gi)} · filemoon ${contar(a.html, /filemoon/gi)}`);
    anotar(`muestra: ${muestra(a.html, /magi|pixeldrain|filemoon|tplayer|servidor|"server/i, 220) || muestra(a.html, /<title/i, 160) || 'vacía'}`);
  }
  return '';
}

async function servidores(html) {
  const objetos = html.match(/\{[^{}]*?server[\\"' ]+:[^{}]*?\}/gi) || [];
  anotar(`servidores: ${objetos.map((o) => `${campo(o, 'server')} ${dominio(campo(o, '(?:url|download)').replace(/\\/g, '')) || '?'}`).join(' | ').slice(0, 160) || 'ninguno'}`);
  const vistos = new Set();
  const tareas = objetos.map(async (obj) => {
    const servidor = campo(obj, 'server');
    let url = campo(obj, '(?:url|download)').replace(/\\/g, '');
    if (!servidor || !url) return null;
    if (/\/download\//.test(url)) {
      const r = await json(`${BASE}/api/download/${url.split('/').pop()}`, { headers: Object.assign({}, NAVEGADOR, { Referer: `${BASE}/`, Origin: BASE, 'X-Requested-With': 'XMLHttpRequest' }) });
      if (!r || !r.url) anotar(`descarga ${servidor}: ${r ? JSON.stringify(r).slice(0, 100) : 'la API no devolvió JSON'}`);
      url = (r && r.url) || '';
    }
    if (!/^https?:/.test(url) || vistos.has(url)) return null;
    vistos.add(url);
    const audio = audioDe(campo(obj, 'language')) || 'Latino';
    const calidad = calidadTexto(campo(obj, 'quality'));
    return { url, audio, calidad, servidor, referer: `${BASE}/` };
  });
  return (await Promise.all(tareas)).filter(Boolean);
}

async function titulosSitio(datos, tipo) {
  const es = await json(`https://api.themoviedb.org/3/${tipo}/${datos.id}?api_key=${TMDB_KEY}&language=es-ES`);
  return [...new Set([datos.titulo, es && (es.title || es.name), datos.ingles, datos.original].concat((datos.alternos || []).map((x) => x.titulo)).filter(Boolean))];
}

async function paginaDirecta(datos, tipo, temporada, episodio) {
  const titulos = await titulosSitio(datos, tipo);
  const candidatos = [];
  for (const t of titulos) {
    const s = slugSitio(t);
    if (s) candidatos.push(s, s.replace(/-\d{4}$/, ''));
  }
  for (const s of [...new Set(candidatos)].filter(Boolean).slice(0, 16)) {
    if (restante() < 20000) break;
    const html = await revisar(ruta(tipo, s, temporada, episodio));
    if (html) return html;
  }
  for (const t of titulos.slice(0, 3)) {
    if (restante() < 15000) break;
    const html = (await crudo(`${BASE}/search?q=${encodeURIComponent(t)}`, { sinCabeceras: true })).html;
    const patron = /href=[\\"']+([^"'\\]*\/(movies|series)\/([\w-]+))[\\"']+/gi;
    let mejor = '';
    let puntos = 0;
    let total = 0;
    let m;
    while ((m = patron.exec(html))) {
      total++;
      if ((tipo === 'movie') !== (m[2] === 'movies')) continue;
      const p = parecido(m[3].replace(/-/g, ' '), t);
      if (p > puntos) {
        puntos = p;
        mejor = m[3];
      }
    }
    anotar(`búsqueda "${t}": ${total} enlaces · mejor ${mejor || 'ninguno'} (${puntos.toFixed(2)})`);
    if (mejor && puntos > 0.7) {
      const pagina = await revisar(ruta(tipo, mejor, temporada, episodio));
      if (pagina) return pagina;
    }
  }
  return '';
}

async function paginaNavegador(datos, tipo, temporada, episodio) {
  const candidatos = [];
  for (const t of titulosPosibles(datos)) {
    const s = slug(t);
    if (s) candidatos.push(s, `${s}-${datos.anio}`);
  }
  for (const s of [...new Set(candidatos)]) {
    const html = conServidores(await texto(ruta(tipo, s, temporada, episodio), { headers: NAVEGADOR }));
    if (html) return html;
  }
  return '';
}


let sesion = null;

function cabecerasApi(referer, sid) {
  const cabeceras = { Accept: '*/*', Referer: referer || `${BASE}/`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
  if (sid) cabeceras['x-session-id'] = sid;
  return cabeceras;
}

function sesionApi(referer) {
  if (!sesion || Date.now() >= sesion.vence) sesion = { vence: Date.now() + 540000, promesa: sincronizar(referer) };
  return sesion.promesa;
}

async function sincronizar(referer) {
  const r = await json(`${BASE}/api/session/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: '*/*', Origin: BASE, Referer: referer || `${BASE}/`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    body: ''
  });
  const valor = r && (r.sid || r.sessionId || r.token);
  anotar(`sesión: ${valor ? 'lista' : 'sin respuesta'}`);
  if (!valor) sesion = null;
  return valor || '';
}

function vuelo(html) {
  const crudo = String(html || '');
  let salida = '';
  for (const m of crudo.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try {
      salida += JSON.parse(`"${m[1]}"`);
    } catch (e) {}
  }
  return salida || crudo;
}

function tipoSitio(tipo) {
  return tipo === 'movie' ? /^movie|pelicula/i : /^serie|^tv|show/i;
}

async function buscar(datos, tipo) {
  const patron = tipoSitio(tipo);
  let mejor = null;
  let puntos = 0;
  for (const t of titulosPosibles(datos)) {
    const r = await json(`${BASE}/api/search?q=${encodeURIComponent(t)}&limit=12`, { headers: cabecerasApi(`${BASE}/search?q=${encodeURIComponent(t)}`) });
    const lista = (r && (r.results || r.data)) || [];
    for (const c of lista) {
      if (!c || !c.slug || (c.type && !patron.test(c.type))) continue;
      let s = 0;
      for (const x of titulosPosibles(datos)) for (const v of [c.title, String(c.title || '').split(/\s*[:|–—-]\s+/)[0]]) s = Math.max(s, parecido(v, x));
      if (c.year && datos.anio) s += Math.abs(Number(c.year) - Number(datos.anio)) <= 1 ? 0.15 : -0.3;
      if (s > puntos) {
        puntos = s;
        mejor = c;
      }
    }
    anotar(`búsqueda "${t}": ${lista.length} resultados${mejor ? ` · mejor: ${mejor.title} (${puntos.toFixed(2)})` : ''}`);
    if (mejor && puntos >= 1) break;
  }
  if (mejor && puntos >= 0.8) return mejor;
  for (const t of titulosPosibles(datos)) {
    const nombre = slug(t);
    if (!nombre) continue;
    const ruta = tipo === 'movie' ? `${BASE}/movies/${nombre}` : `${BASE}/series/${nombre}`;
    const html = await texto(ruta, { headers: { Referer: `${BASE}/` } });
    if (!html) continue;
    const datosPagina = vuelo(html);
    const id = tipo === 'movie' ? (datosPagina.match(/"id":"(c[a-z0-9]{20,})","type":"movie"/) || [])[1] : '';
    anotar(`dirección directa ${rutaCorta(ruta)}${id ? ` · id ${id}` : ''}`);
    if (tipo === 'tv' || id || enlacesPagina(datosPagina).length) return { slug: nombre, id, title: t };
  }
  return null;
}

function arreglo(texto, clave) {
  const inicio = texto.indexOf(`"${clave}":[`);
  if (inicio < 0) return null;
  let i = texto.indexOf('[', inicio);
  const desde = i;
  let nivel = 0;
  let enCadena = false;
  for (; i < texto.length; i++) {
    const c = texto[i];
    if (enCadena) {
      if (c === '\\') i++;
      else if (c === '"') enCadena = false;
      continue;
    }
    if (c === '"') enCadena = true;
    else if (c === '[') nivel++;
    else if (c === ']' && --nivel === 0) {
      try {
        return JSON.parse(texto.slice(desde, i + 1));
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}

function momento(id) {
  return /^c[a-z0-9]{8}/.test(id || '') ? parseInt(id.slice(1, 9), 36) : 0;
}

function idiomaVideo(video, descargas) {
  const t = momento(video.id);
  let cercano = null;
  let distancia = Infinity;
  for (const d of descargas) {
    const x = momento(d.id);
    if (t && x && Math.abs(x - t) < distancia) {
      distancia = Math.abs(x - t);
      cercano = d;
    }
  }
  if (cercano && distancia <= 43200000) return cercano.language || '';
  const idiomas = [...new Set(descargas.map((d) => idiomaPelisGo(d.language)))];
  return idiomas.length === 1 ? idiomas[0] : '';
}

async function episodioSerie(serie, temporada, episodio) {
  const ficha = `${BASE}/series/${serie.slug}`;
  const temporadas = arreglo(vuelo(await texto(ficha, { headers: { Referer: `${BASE}/` } })), 'seasons') || [];
  const t = temporadas.find((x) => x && Number(x.number) === temporada);
  const e = t && (t.episodes || []).find((x) => x && Number(x.number) === episodio);
  anotar(`serie: ${temporadas.length} temporadas · T${temporada}E${episodio}: ${(e && e.id) || 'sin id'}`);
  if (!e || !e.id) return null;
  const todas = (e.downloadLinks || []).filter((d) => d && d.url);
  const videos = (e.videoLinks || []).filter((v) => v && /^https?:/.test(v.url || '')).map((v) => ({ url: v.url, server: '', language: idiomaVideo(v, todas), quality: '' }));
  return { id: e.id, pagina: `${ficha}/temporada/${temporada}/episodio/${episodio}`, videos };
}

async function idEpisodio(serie, temporada, episodio) {
  const pagina = `${BASE}/series/${serie.slug}/temporada/${temporada}/episodio/${episodio}`;
  const datos = vuelo(await texto(pagina, { headers: { Referer: `${BASE}/series/${serie.slug}` } }));
  const id = (datos.match(/"episodeId":"(c[a-z0-9]{20,})"/) || [])[1];
  anotar(`episodio T${temporada}E${episodio}: ${id || 'sin id'}`);
  return id ? { id, pagina } : null;
}

function enlacesPagina(datos) {
  const lista = [];
  for (const m of datos.matchAll(/\{[^{}]*"server":"[^{}]*\}/g)) {
    const valor = (clave) => ((m[0].match(new RegExp(`"${clave}":"([^"]*)"`)) || [])[1] || '').replace(/\\\//g, '/');
    const url = valor('url');
    if (/^https?:/.test(url)) lista.push({ url, server: valor('server'), language: valor('language'), quality: valor('quality') });
  }
  return lista;
}

function idiomaPelisGo(t) {
  const s = normalizar(t);
  if (/castellano|espana|^es$|spain/.test(s)) return 'Castellano';
  if (/subtitulad|vose|ingles|english|original|sub|japon|japan|corean|korean|chino|chinese/.test(s)) return 'Subtitulado';
  return 'Latino';
}

async function unEnlace(e, pagina) {
  const url = String(e.url || '').trim();
  if (!/^https?:\/\//.test(url)) return [];
  return [{ url, audio: idiomaPelisGo(e.language), servidor: e.server || '', referer: pagina, calidad: calidadTexto(e.quality) }];
}

async function lista(enlaces, pagina) {
  anotar(`servidores: ${enlaces.map((e) => `${e.server || dominio(e.url)} ${idiomaPelisGo(e.language)}`).join(' · ').slice(0, 200)}`);
  const grupos = await Promise.all(enlaces.map((e) => unEnlace(e, pagina).catch(() => [])));
  return [].concat(...grupos);
}

async function pedirApi(url, pagina, clave, intento) {
  const sid = await sesionApi(pagina);
  const r = await pedir(url, { headers: cabecerasApi(pagina, sid) });
  if (!r || !r.status) return [];
  const cuerpo = (await conLimite(r.text(), 10000, '')) || '';
  if (!r.ok) {
    anotar(`respuesta de la API: ${cuerpo.replace(/\s+/g, ' ').slice(0, 90) || 'vacía'}`);
    if ((r.status === 401 || r.status === 403) && sid && !intento) {
      sesion = null;
      return pedirApi(url, pagina, clave, true);
    }
    return [];
  }
  try {
    const d = JSON.parse(cuerpo);
    return (d && d[clave || 'links']) || [];
  } catch (e) {
    return [];
  }
}

async function metodoApi(datos, tipo, temporada, episodio) {
  const elegido = await buscar(datos, tipo);
  if (!elegido) return [];
  let pagina = '';
  let api = '';
  let videos = [];
  if (tipo === 'movie') {
    pagina = `${BASE}/movies/${elegido.slug}`;
    if (elegido.id) api = `${BASE}/api/movies/${elegido.id}/stream`;
  } else {
    const ep = (await episodioSerie(elegido, temporada, episodio)) || (await idEpisodio(elegido, temporada, episodio));
    if (!ep) return [];
    pagina = ep.pagina;
    api = `${BASE}/api/series/episode/${ep.id}/stream`;
    videos = ep.videos || [];
  }
  let enlaces = [];
  if (api) {
    enlaces = await pedirApi(api, pagina);
    anotar(`enlaces de la API: ${enlaces.length}`);
  }
  if (!enlaces.length && videos.length) {
    enlaces = videos;
    anotar(`enlaces de la ficha de la serie: ${videos.length}`);
  }
  if (!enlaces.length) {
    const datosPagina = vuelo(await texto(pagina, { headers: { Referer: `${BASE}/` } }));
    enlaces = enlacesPagina(datosPagina);
    paginaVacia = !/"server"\s*:/.test(datosPagina);
    anotar(`enlaces en la página: ${enlaces.length}`);
  }
  const vistos = new Set(enlaces.map((e) => e.url));
  return await lista(enlaces, pagina);
}

async function getStreams(tmdbId, mediaType, season, episode) {
  paginaVacia = false;
  mostrado = false;
  try {
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const datos = await datosTmdb(tmdbId, tipo);
    if (!datos) return [];
    const temporada = Number(season) || 1;
    const episodio = Number(episode) || 1;
    const titulo = encabezado(datos, tipo, temporada, episodio);
    const items = await metodoApi(datos, tipo, temporada, episodio).catch((e) => {
      anotar(`error: ${e.message}`);
      return [];
    });
    if (items.length) {
      const salida = await armar(items, titulo, FUENTE);
      anotar(`tarjetas: ${salida.length} de ${items.length} servidores · ${salida.map((t) => t.name).join(', ').slice(0, 160)}`);
      if (salida.length) return salida;
    }
    if (paginaVacia) return [];
    return await enOrden([
      () => paginaDirecta(datos, tipo, temporada, episodio).then((html) => (html ? servidores(html) : [])),
      () => paginaNavegador(datos, tipo, temporada, episodio).then((html) => (html ? servidores(html) : []))
    ], (grupo) => armar(grupo, titulo, FUENTE, true));
  } catch (e) {
    anotar(`error: ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: limitar(getStreams) };
