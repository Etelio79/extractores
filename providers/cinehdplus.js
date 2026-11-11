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

function limitar(buscador, respaldo) {
  return (...argumentos) => {
    inicio = Date.now();
    const trabajo = conLimite(Promise.resolve().then(() => buscador(...argumentos)), CIERRE, null);
    return respaldo ? trabajo.then((salida) => (salida && salida.length ? salida : respaldo(salida === null))) : trabajo.then((salida) => salida || []);
  };
}

const DESCARTAR_JUGADORES = /fembed|streamsb|plustream|waaw|netu|hqq|jetload|1fichier|uptobox|powvideo|streamplay/i;

function propsSiguiente(html) {
  const m = String(html || '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    return (d.props && d.props.pageProps) || null;
  } catch (e) {
    return null;
  }
}

function audioJugador(idioma) {
  const c = normalizar(idioma);
  if (/latino|lat\b|mx/.test(c)) return 'Latino';
  if (/spanish|espanol|castellano|esp\b|cas\b/.test(c)) return 'Castellano';
  if (/english|ingles|sub|vose|original/.test(c)) return 'Subtitulado';
  return '';
}

function campoJugador(objeto, clave) {
  const m = objeto.match(new RegExp(`"${clave}"\\s*:\\s*"([^"]*)"`));
  return m ? m[1].replace(/\\\//g, '/') : '';
}

function jugadoresSiguiente(html) {
  const props = propsSiguiente(html);
  const fuente = props && ((props.episode && props.episode.players) || (props.post && props.post.players) || props.players);
  const lista = [];
  if (fuente && typeof fuente === 'object') {
    for (const idioma of Object.keys(fuente)) {
      if (!Array.isArray(fuente[idioma])) continue;
      for (const e of fuente[idioma]) if (e && e.result) lista.push({ idioma, servidor: String(e.cyberlocker || ''), url: String(e.result), calidad: String(e.quality || '') });
    }
    if (lista.length) return lista;
  }
  let crudo = String(html || '');
  if (crudo.includes('\\"players\\"')) crudo = crudo.replace(/\\"/g, '"');
  const inicio = crudo.indexOf('"players"');
  if (inicio < 0) return lista;
  const zona = crudo.slice(inicio, inicio + 60000);
  for (const idioma of ['latino', 'spanish', 'english']) {
    const bloque = (zona.match(new RegExp(`"${idioma}"\\s*:\\s*\\[([\\s\\S]*?)\\]`)) || [])[1];
    if (!bloque) continue;
    for (const objeto of bloque.match(/\{[^{}]*\}/g) || []) {
      const url = campoJugador(objeto, 'result');
      if (url) lista.push({ idioma, servidor: campoJugador(objeto, 'cyberlocker'), url, calidad: campoJugador(objeto, 'quality') });
    }
  }
  return lista;
}

async function destinoJugador(url, referer) {
  const u = absoluta(url, referer);
  if (!/^https?:\/\//.test(u)) return '';
  if (dominio(u) !== dominio(referer) && SERVIDORES.some(([patron]) => patron.test(dominio(u)))) return u;
  const html = await texto(u, { headers: { Referer: referer } });
  const m = html.match(/(?:var|let|const)\s+url\s*=\s*['"]([^'"]+)['"]/) || html.match(/\burl\s*=\s*'([^']+)'/);
  if (m) return absoluta(m[1], u);
  const marco = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  return marco ? absoluta(entidades(marco[1]), u) : '';
}

function resultadosSiguiente(html, sitio) {
  const corte = String(html || '').search(/Top de la semana/i);
  const zona = corte > 0 ? html.slice(0, corte) : String(html || '');
  const lista = [];
  for (const art of zona.split(/<article\b/i).slice(1)) {
    const href = (art.match(/<a[^>]+href=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const nombre = entidades((art.match(/\balt=["']([^"']+)["']/i) || [])[1] || '') || limpiarHtml((art.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i) || [])[1]);
    const anio = (art.match(/<span[^>]*>\s*((?:19|20)\d{2})\s*<\/span>/) || [])[1] || '';
    const url = absoluta(entidades(href), sitio.base);
    if (nombre) lista.push({ nombre, anio, url });
  }
  return lista;
}

async function buscarSiguiente(sitio, datos, tipo) {
  const titulos = titulosPosibles(datos);
  const ruta = tipo === 'movie' ? sitio.peli : sitio.serie;
  for (const t of titulos) {
    const html = await texto(`${sitio.base}/search?q=${encodeURIComponent(t)}`, { headers: { Referer: `${sitio.base}/` } });
    if (!html) return null;
    let mejor = null;
    let puntos = 0;
    for (const c of resultadosSiguiente(html, sitio)) {
      if (!ruta.test(c.url)) continue;
      let s = 0;
      for (const x of titulos) for (const v of [c.nombre, c.nombre.split(/\s*[:|–—-]\s+/)[0]]) s = Math.max(s, parecido(v, x));
      if (c.anio && datos.anio) s += Math.abs(Number(c.anio) - Number(datos.anio)) <= 1 ? 0.15 : -0.3;
      if (s > puntos) {
        puntos = s;
        mejor = c.url;
      }
    }
    if (mejor && puntos >= 0.8) return mejor;
  }
  return null;
}

function episodioSiguiente(sitio, html, pagina, temporada, episodio) {
  const props = propsSiguiente(html);
  const serie = props && (props.post || props.serie || props.thisSerie);
  const t = serie && (serie.seasons || []).find((s) => Number(s.number) === temporada);
  const e = t && (t.episodes || []).find((x) => Number(x.number) === episodio);
  const nombre = (e && e.slug && e.slug.name) || pagina.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop();
  const numero = (e && e.slug && e.slug.episode) || episodio;
  return sitio.episodio(sitio.base, nombre, (e && e.slug && e.slug.season) || temporada, numero);
}

async function metodoSiguiente(sitio, datos, tipo, temporada, episodio) {
  let pagina = await buscarSiguiente(sitio, datos, tipo);
  if (!pagina) return [];
  if (tipo === 'tv') pagina = episodioSiguiente(sitio, await texto(pagina, { headers: { Referer: `${sitio.base}/` } }), pagina, temporada, episodio);
  const html = await texto(pagina, { headers: { Referer: `${sitio.base}/` } });
  const jugadores = jugadoresSiguiente(html).filter((j) => !DESCARTAR_JUGADORES.test(`${j.servidor} ${j.url}`));
  const lista = await Promise.all(jugadores.map(async (j) => {
    const url = await destinoJugador(j.url, pagina).catch(() => '');
    return url && !DESCARTAR_JUGADORES.test(url) ? { url, audio: audioJugador(j.idioma), calidad: calidadTexto(j.calidad), referer: `${sitio.base}/` } : null;
  }));
  const vistos = new Set();
  return lista.filter((x) => x && !vistos.has(x.url) && vistos.add(x.url));
}

async function metodoEspejos(sitios, datos, tipo, temporada, episodio) {
  for (const sitio of sitios) {
    const lista = await metodoSiguiente(sitio, datos, tipo, temporada, episodio).catch(() => []);
    if (lista.length) return lista;
  }
  return [];
}

const FUENTE = 'Cuevana';
const BASE = 'https://wv3.cuevana3.eu';
const EVITAR = /netu|waaw|hqq|jetload/i;

function datosNext(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    return d.props && d.props.pageProps;
  } catch (e) {
    return null;
  }
}

function rutaEpisodio(base, slug) {
  return `${base}/${slug.replace(/^\//, '').replace('series/', 'serie/').replace('seasons/', 'temporada/').replace('episodes/', 'episodio/')}`;
}

async function buscarEn(base, titulos, tipo) {
  for (const titulo of titulos) {
    const html = await texto(`${base}/search?q=${encodeURIComponent(titulo)}`);
    let mejor = null;
    let puntos = 0;
    for (const item of conClases(html, ['TPostMv'])) {
      const href = (item.match(/<a[^>]+href=["']([^"']+)["']/) || [])[1];
      const nombre = limpiarHtml((item.match(/<span[^>]*class=["'][^"']*\bTitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/) || [])[1]);
      if (!href || !nombre) continue;
      const esSerie = /\/serie\//.test(href);
      if ((tipo === 'tv') !== esSerie) continue;
      const s = parecido(nombre, titulo);
      if (s > puntos) {
        puntos = s;
        mejor = absoluta(href, base);
      }
    }
    if (mejor && puntos >= 0.8) return mejor;
  }
  return null;
}

async function paginaEpisodio(base, pagina, temporada, episodio) {
  const props = datosNext(await texto(pagina));
  const serie = props && (props.thisSerie || props.post);
  const t = serie && (serie.seasons || []).find((s) => Number(s.number) === temporada);
  const e = t && (t.episodes || []).find((x) => Number(x.number) === episodio);
  if (e && e.url && e.url.slug) return rutaEpisodio(base, e.url.slug);
  const nombre = pagina.replace(/\/+$/, '').split('/').pop();
  return `${base}/episodio/${nombre}-temporada-${temporada}-episodio-${episodio}`;
}

async function metodoSubmenu(titulos, tipo, temporada, episodio) {
  let pagina = await buscarEn(BASE, titulos, tipo);
  if (!pagina) return [];
  if (tipo === 'tv') pagina = await paginaEpisodio(BASE, pagina, temporada, episodio);
  if (!pagina) return [];
  const html = await texto(pagina);
  const tareas = [];
  for (const bloque of conClases(html, ['open_submenu'])) {
    const audio = audioDe(limpiarHtml(bloque.slice(0, 300)).split(' ').slice(0, 3).join(' '));
    const patron = /<li\b[^>]*>/gi;
    let m;
    while ((m = patron.exec(bloque))) {
      const etiqueta = m[0];
      if (!/class=["'][^"']*\bclili\b/.test(etiqueta)) continue;
      const tr = (etiqueta.match(/data-tr=["']([^"']+)["']/) || [])[1];
      if (!tr) continue;
      const marco = absoluta(entidades(tr), BASE);
      tareas.push(texto(marco, { headers: { Referer: pagina } }).then((h) => {
        const u = (h.match(/var url = '([^']+)'/) || [])[1];
        return u && !EVITAR.test(u) ? { url: u, audio, referer: `${BASE}/` } : null;
      }));
    }
  }
  return (await Promise.all(tareas)).filter(Boolean);
}

async function metodoApi(datos, tipo, temporada, episodio) {
  let url = `https://cuevana.unbuendato.com/?id=${datos.id}`;
  if (tipo === 'tv') url += `&season=${temporada}&episode=${episodio}`;
  const r = await json(url);
  if (!r || !r.success || !r.languages) return [];
  const lista = [];
  for (const [idioma, servidores] of Object.entries(r.languages)) {
    const audio = audioDe(idioma);
    if (!audio || audio === 'Subtitulado') continue;
    for (const [servidor, enlaceSitio] of Object.entries(servidores || {})) {
      if (enlaceSitio && !EVITAR.test(`${servidor} ${enlaceSitio}`) && !/mixdrop/i.test(servidor)) {
        lista.push({ url: enlaceSitio, audio, referer: 'https://cuevana.unbuendato.com/' });
      }
    }
  }
  return lista;
}

const ESPEJO_MX = 'https://www.cuevana-3.mx';
const CUEVANA2 = ['https://www.cuevana2.lat', 'https://www.cuevana2.run'].map((base) => ({
  base,
  peli: /\/pelicula\//,
  serie: /\/serie\//,
  episodio: (b, nombre, t, e) => `${b}/episodio/${nombre}-${t}x${e}`
}));

function audioRotulo(t) {
  const s = normalizar(t);
  if (/latino/.test(s)) return 'Latino';
  if (/castellano|^espanol$|espana/.test(s)) return 'Castellano';
  if (/subtitulado|ingles|vose/.test(s)) return 'Subtitulado';
  return '';
}

function opcionesClili(html) {
  const marcas = [];
  const pm = />\s*((?:Espa\S*ol\s+)?Latino|Espa\S*ol|Castellano|Subtitulado|Ingl\S*s)\s*</gi;
  let m;
  while ((m = pm.exec(html))) marcas.push({ pos: m.index, audio: audioRotulo(m[1]) });
  const salida = [];
  const pl = /<li\b[^>]*\bdata-tr=["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/gi;
  while ((m = pl.exec(html))) {
    let audio = '';
    for (const marca of marcas) {
      if (marca.pos > m.index) break;
      if (marca.audio) audio = marca.audio;
    }
    salida.push({ tr: entidades(m[1]), audio, servidor: limpiarHtml(m[2]) });
  }
  return salida;
}

async function metodoMx(datos, tipo, temporada, episodio) {
  const nombre = slug(datos.ingles || datos.titulo) || 'ver';
  const pagina = tipo === 'movie' ? `${ESPEJO_MX}/pelicula/${datos.id}/${nombre}` : `${ESPEJO_MX}/serie/${datos.id}/${nombre}/temporada/${temporada}/episodio/${episodio}`;
  const html = await texto(pagina, { headers: { Referer: `${ESPEJO_MX}/` } });
  if (!html) return [];
  const opciones = opcionesClili(html).filter((o) => !EVITAR.test(`${o.servidor} ${o.tr}`));
  const lista = await Promise.all(opciones.map(async (o) => {
    const marco = absoluta(o.tr, ESPEJO_MX);
    const h = await texto(marco, { headers: { Referer: pagina } });
    const u = (h.match(/(?:var|let)\s+url\s*=\s*['"]([^'"]+)['"]/) || [])[1];
    return u && !EVITAR.test(u) ? { url: absoluta(u, marco), audio: o.audio || 'Latino', referer: `${ESPEJO_MX}/` } : null;
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
    const titulos = titulosPosibles(datos);
    const titulo = encabezado(datos, tipo, temporada, episodio);

    const tareas = [
      () => metodoSubmenu(titulos, tipo, temporada, episodio),
      () => metodoApi(datos, tipo, temporada, episodio),
      () => metodoMx(datos, tipo, temporada, episodio),
      () => metodoEspejos(CUEVANA2, datos, tipo, temporada, episodio)
    ];

    for (const tarea of tareas) {
      const lista = await tarea();
      if (lista && lista.length) {
        const tarjetas = [];
        const vistos = new Set();
        for (const e of lista) {
          if (!e.url || vistos.has(e.url)) continue;
          vistos.add(e.url);
          let hostName = 'Servidor';
          try { hostName = new URL(e.url).hostname.replace('www.', '').split('.')[0]; } catch(_) {}
          hostName = hostName.charAt(0).toUpperCase() + hostName.slice(1);
          
          tarjetas.push({
            name: hostName,
            title: titulo,
            url: e.url,
            quality: `Calidad: Auto`,
            language: `Audio: ${e.audio || 'Latino'}`,
            provider: FUENTE,
            headers: { Referer: e.referer }
          });
        }
        if (tarjetas.length) return tarjetas;
      }
    }
    return [];
  } catch (e) {
    console.log(`[${FUENTE}] ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: limitar(getStreams) };