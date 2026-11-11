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

const FUENTE = 'MonosChinos';
const NUEVO = 'https://vww.monoschinos2.net';
const VIEJO = 'https://monoschinos.st';

function esNuevo(url) {
  return dominio(url) === dominio(NUEVO);
}

async function buscarNuevo(consulta) {
  const html = await texto(`${NUEVO}/animes?buscar=${encodeURIComponent(consulta)}`, { headers: { Referer: `${NUEVO}/` } });
  const lista = [];
  const patron = /ficha_efecto["'][^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = patron.exec(html))) {
    const nombre = entidades((m[1].match(/title=["']([^"']*)["']/) || [])[1] || '').replace('Ver Anime', '').replace('Online Gratis', '').trim();
    const href = (m[1].match(/href=["']([^"']*)["']/) || [])[1];
    if (nombre && href) lista.push({ nombre, url: absoluta(href.replace(/^\.\//, '/'), NUEVO) });
  }
  return lista;
}

async function buscarViejo(consulta) {
  const html = await texto(`${VIEJO}/buscar?q=${encodeURIComponent(consulta)}`);
  const lista = [];
  const patron = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>[\s\S]{0,300}?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  let m;
  while ((m = patron.exec(html))) lista.push({ nombre: limpiarHtml(m[2]), url: absoluta(m[1], VIEJO) });
  return lista;
}

async function buscar(consulta) {
  const [a, b] = await Promise.all([buscarNuevo(consulta).catch(() => []), buscarViejo(consulta).catch(() => [])]);
  return a.concat(b);
}

async function paginacion(cuerpo, referer) {
  return texto(`${NUEVO}/ajax_pagination`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Referer: referer },
    body: cuerpo
  });
}

async function episodio(url, numero) {
  if (!esNuevo(url)) return `${url.replace('-sub-espanol', '').replace('/anime/', '/ver/').replace(/\/+$/, '')}-episodio-${numero}`;
  const html = await texto(url, { headers: { Referer: `${NUEVO}/` } });
  const i = (html.match(/data-i=["']([^"']+)["']/) || [])[1];
  const u = (html.match(/data-u=["']([^"']+)["']/) || [])[1];
  if (!i || !u) return null;
  for (let pagina = 1; pagina <= 5; pagina++) {
    const lista = await paginacion(`acc=episodes&i=${encodeURIComponent(i)}&u=${encodeURIComponent(u)}&p=${pagina}`, url);
    const articulos = lista.match(/<article>[\s\S]*?<\/article>/gi) || [];
    if (!articulos.length) break;
    for (const art of articulos) {
      const href = (art.match(/href=["']([^"']+)["']/) || [])[1];
      const n = Number((art.match(/alt=["'][^"']*(?:episodio|capitulo)\s*(\d+)/i) || [])[1]);
      if (href && n === numero) return absoluta(href, NUEVO);
    }
  }
  return null;
}

async function enlaces(pagina) {
  const nuevo = esNuevo(pagina);
  const html = await texto(pagina, { headers: { Referer: `${nuevo ? NUEVO : VIEJO}/` } });
  const urls = [];
  let fuente = html;
  if (nuevo) {
    const directos = /target=["']_blank["']\s+href=["'](https?:\/\/[^"']+)["']/gi;
    let d;
    while ((d = directos.exec(html))) urls.push(d[1]);
    const cifrado = (html.match(/data-encrypt=["']([^"']+)["']/) || [])[1];
    fuente = cifrado ? await paginacion(`acc=opt&i=${encodeURIComponent(cifrado)}`, pagina) : '';
  }
  const patron = /data-player=["']([^"']+)["']/gi;
  let m;
  while ((m = patron.exec(fuente))) {
    const destino = atobSeguro(m[1]).replace(/^https?:\/\/monoschinos2\.com\/reproductor\?url=/, '');
    if (/^https?:/.test(destino)) urls.push(destino);
  }
  return [...new Set(urls)].filter((u) => !/rpmplayer\./.test(u)).map((url) => ({ url }));
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const datos = await datosTmdb(tmdbId, tipo);
    if (!datos) return [];
    
    const temporada = tipo === 'tv' ? Number(season) || 1 : 1;
    const episodio = tipo === 'tv' ? Number(episode) || 1 : 1;
    const titulo = encabezado(datos, tipo, temporada, episodio);
    
    const elegidos = await elegirAnime(buscar, datos, tipo, temporada, episodio);
    const tarjetas = [];
    const vistos = new Set();

    for (const grupo of elegidos) {
      for (const c of grupo) {
        const pagina = await episodio(c.url, c.numero).catch(() => null);
        if (!pagina) continue;
        
        const encontrados = await enlaces(pagina).catch(() => []);
        
        for (const e of encontrados) {
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
            language: `Audio: ${c.audio || 'Latino'}`,
            provider: FUENTE,
            headers: { Referer: pagina }
          });
        }
        if (tarjetas.length > 0) break;
      }
    }

    return tarjetas;
  } catch (e) {
    console.log(`[${FUENTE}] ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: limitar(getStreams) };