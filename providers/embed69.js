const CryptoJS = require('crypto-js');
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

function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, ' ').trim();
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

function limitar(buscador, respaldo) {
  return (...argumentos) => {
    inicio = Date.now();
    const trabajo = conLimite(Promise.resolve().then(() => buscador(...argumentos)), CIERRE, null);
    return respaldo ? trabajo.then((salida) => (salida && salida.length ? salida : respaldo(salida === null))) : trabajo.then((salida) => salida || []);
  };
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
    imdb: (a.external_ids && a.external_ids.imdb_id) || a.imdb_id || b.imdb_id || ''
  };
}

function encabezado(datos, tipo, temporada, episodio) {
  if (tipo === 'tv') return `${datos.titulo} - T${temporada} E${episodio}`;
  return datos.anio ? `${datos.titulo} (${datos.anio})` : datos.titulo;
}

const SHA_K = Int32Array.from([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

const SHA_M = new Int32Array(64);

function sha256Palabras(texto) {
  const largo = texto.length;
  const bloques = ((largo + 9 + 63) >> 6) << 4;
  const w = new Int32Array(bloques);
  for (let i = 0; i < largo; i++) w[i >> 2] |= (texto.charCodeAt(i) & 255) << (24 - (i & 3) * 8);
  w[largo >> 2] |= 0x80 << (24 - (largo & 3) * 8);
  w[bloques - 1] = largo * 8;
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const m = SHA_M;
  for (let b = 0; b < bloques; b += 16) {
    for (let i = 0; i < 16; i++) m[i] = w[b + i] | 0;
    for (let i = 16; i < 64; i++) {
      const x = m[i - 15];
      const y = m[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      m[i] = (m[i - 16] + s0 + m[i - 7] + s1) | 0;
    }
    let a = h0, bb = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + SHA_K[i] + m[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7];
}

function nonceTrabajo(reto, dificultad) {
  for (let n = 0; n < 20000000; n++) {
    const p = sha256Palabras(reto + n);
    let ok = true;
    for (let i = 0; i < dificultad && ok; i++) {
      if (((p[i >> 3] >>> (28 - (i & 7) * 4)) & 15) !== 0) ok = false;
    }
    if (ok) return n;
  }
  return -1;
}

function audioCodigo(codigo) {
  return { LAT: 'Latino', ESP: 'Castellano', CAS: 'Castellano', SUB: 'Subtitulado', '0': 'Latino', '1': 'Castellano', '2': 'Subtitulado' }[String(codigo).toUpperCase()] || '';
}

async function abrirEmbed69(url, referer) {
  return leerEmbed69(await texto(url, { headers: { Referer: referer || 'https://sololatino.net/' } }));
}

function leerEmbed69(html) {
  const bloque = html.match(/dataLink\s*=\s*(\[[\s\S]*?\]);/);
  if (!bloque) return [];
  let grupos = [];
  try {
    grupos = JSON.parse(bloque[1]);
  } catch (e) {
    return [];
  }
  const reto = (html.match(/POW_CHALLENGE\s*=\s*'([^']+)'/) || [])[1];
  const sal = (html.match(/POW_SALT\s*=\s*'([^']+)'/) || [])[1];
  const dificultad = parseInt((html.match(/POW_DIFFICULTY\s*=\s*(\d+)/) || [])[1], 10);
  let clave = null;
  if (reto && sal && dificultad) {
    const n = nonceTrabajo(reto, dificultad);
    if (n < 0) return [];
    clave = CryptoJS.SHA256(reto + n + sal);
  }
  const salida = [];
  for (const g of grupos) {
    const audio = audioCodigo(g.video_language);
    for (const e of g.sortedEmbeds || []) {
      if (!e.link || e.servername === 'download') continue;
      let destino = e.link;
      if (clave) {
        try {
          const crudo = CryptoJS.enc.Base64.parse(e.link);
          const vector = CryptoJS.lib.WordArray.create(crudo.words.slice(0, 4), 16);
          const cuerpo = CryptoJS.lib.WordArray.create(crudo.words.slice(4), crudo.sigBytes - 16);
          destino = CryptoJS.AES.decrypt({ ciphertext: cuerpo }, clave, { iv: vector, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString(CryptoJS.enc.Utf8);
        } catch (err) {
          destino = '';
        }
      }
      if (/^https?:\/\//.test(destino)) salida.push({ url: destino, audio });
    }
  }
  return salida;
}

function dominio(url) {
  const m = String(url || '').match(/^(?:https?:)?\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase() : '';
}

const NOMBRES = [
  [/voe/i, 'Voe'], [/filemoon|moonplayer|byse|kerapoxy|f16px/i, 'Filemoon'],
  [/streamwish|hglink|vibuxer|hlswish|wishembed|awish|swdyu|strwish|streamhg|dhcplay/i, 'StreamWish'],
  [/vidhide|vidhidepro|filelions|dhtpre|minochinos|ryderjet/i, 'VidHide'],
  [/vimeos|vimeus/i, 'Vimeos'], [/morencius/i, 'Morencius'],
  [/dood|d000d|ds2play/i, 'DoodStream'], [/mixdrop/i, 'MixDrop'], [/streamtape/i, 'StreamTape'], [/uqload/i, 'Uqload']
];
function nombreServidor(url) {
  const h = dominio(url).replace(/^www\./, '');
  for (const [p, n] of NOMBRES) if (p.test(h)) return n;
  const partes = h.split('.');
  const n = partes.length > 1 ? partes[partes.length - 2] : h;
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'Servidor';
}

const FUENTE = 'Embed69';

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const tipo = mediaType === 'movie' ? 'movie' : 'tv';
    const datos = await datosTmdb(tmdbId, tipo);
    if (!datos || !datos.imdb) return [];
    
    const temporada = Number(season) || 1;
    const episodio = Number(episode) || 1;
    
    const url = tipo === 'movie' 
      ? `https://embed69.org/f/${datos.imdb}` 
      : `https://embed69.org/f/${datos.imdb}-${temporada}x${String(episodio).padStart(2, '0')}`;

    const titulo = encabezado(datos, tipo, temporada, episodio);

    const html = await texto(url, { headers: { Referer: 'https://sololatino.net/' } });
    const internos = leerEmbed69(html);
    const vistos = new Set();
    const peso = (a) => ({ Latino: 3, 'Español': 2, Castellano: 1 }[a] || 0);
    return internos
      .filter((x) => x.url && !vistos.has(x.url) && vistos.add(x.url))
      .sort((x, y) => peso(y.audio) - peso(x.audio))
      .map((x) => ({
        name: `${FUENTE} (${nombreServidor(x.url)})`,
        title: titulo,
        url: x.url,
        quality: 'Calidad: Auto',
        language: x.audio ? `Audio: ${x.audio}` : '',
        provider: FUENTE,
        headers: { Referer: 'https://embed69.org/' }
      }));
  } catch (e) {
    console.log(`[${FUENTE}] ${e.message}`);
    return [];
  }
}

module.exports = { getStreams: limitar(getStreams) };