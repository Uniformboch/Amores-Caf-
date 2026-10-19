// Lógica del panel y de los datos públicos. Recibe los almacenes desde fuera:
// en Netlify son Blobs; en las pruebas, almacenes en memoria.
import { randomBytes } from 'node:crypto';
import {
  cookieSesion, crearSesion, leerCookie, resumenIp, sesionValida, verificarContrasena, versionDe,
} from './seguridad.mjs';
import { RE_FOTO, validar } from './validar.mjs';

const MAX_JSON = 1024 * 1024;
const MAX_IMAGEN = 4 * 1024 * 1024;
const MAX_RESPALDOS = 60;
const INTENTOS_ANTES_DE_BLOQUEO = 5;
const RE_RESPALDO = /^\d{8}-\d{6}(?:-\d+)?$/;
const RE_LLAVE_FOTO = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpg|png|webp)$/;
const FIRMAS = {
  'image/jpeg': { firma: [0xff, 0xd8, 0xff], ext: 'jpg' },
  'image/png': { firma: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ext: 'png' },
  'image/webp': { firma: [0x52, 0x49, 0x46, 0x46], ext: 'webp' },
};

const SESION_TERMINO = 'Tu sesión terminó. Vuelve a entrar.';

function json(estado, datos, cookie) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(JSON.stringify(datos), { status: estado, headers });
}

function slug(texto) {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'foto';
}

function sello(fecha) {
  const d = (n) => String(n).padStart(2, '0');
  return `${fecha.getUTCFullYear()}${d(fecha.getUTCMonth() + 1)}${d(fecha.getUTCDate())}-${d(fecha.getUTCHours())}${d(fecha.getUTCMinutes())}${d(fecha.getUTCSeconds())}`;
}

const fechaDeSello = (id) =>
  `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}Z`;

async function leerCuerpo(req, maximo) {
  const largo = Number(req.headers.get('content-length') ?? 0);
  if (largo > maximo) return { error: 'El archivo es demasiado grande.' };
  const datos = new Uint8Array(await req.arrayBuffer());
  if (datos.byteLength > maximo) return { error: 'El archivo es demasiado grande.' };
  return { datos };
}

async function leerJson(req) {
  const { datos, error } = await leerCuerpo(req, MAX_JSON);
  if (error) return { error };
  try {
    return { valor: JSON.parse(new TextDecoder().decode(datos)) };
  } catch {
    return { error: 'JSON inválido.' };
  }
}

export function crearApi({ tiendas, entorno, menuInicial, temporadaInicial, ahora = () => new Date() }) {
  const { datos, fotos, respaldos, intentos } = tiendas;
  const hash = entorno.ADMIN_PASSWORD_HASH;
  const secreto = entorno.SESSION_SECRET;
  const configurado = Boolean(hash && secreto && secreto.length >= 32);

  // Menú y temporada viven juntos en un solo registro ("estado") para guardarlos de un golpe.
  // etag es null mientras el dueño no haya guardado nada: se usa el menú del repositorio.
  async function leerEstado() {
    const guardado = await datos.getWithMetadata('estado', { type: 'json' });
    const menu = guardado?.data?.menu ?? menuInicial;
    const temporada = guardado?.data?.temporada ?? temporadaInicial;
    return { menu, temporada, version: versionDe(menu, temporada), etag: guardado?.etag ?? null };
  }

  async function leerMenu() {
    const { menu, temporada, version } = await leerEstado();
    return { menu, temporada, version };
  }

  // Escribe solo si nadie más guardó desde que se leyó (etag). Devuelve false si hubo choque.
  async function escribirEstado(menu, temporada, etag) {
    const condicion = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const r = await datos.setJSON('estado', { menu, temporada }, condicion);
    return r?.modified !== false;
  }

  async function respaldar(menu, temporada) {
    const { blobs } = await respaldos.list();
    const existentes = new Set(blobs.map((b) => b.key));
    const base = sello(ahora());
    let id = base;
    for (let n = 2; existentes.has(id); n++) id = `${base}-${n}`;
    await respaldos.setJSON(id, { menu, temporada });
    const todas = [...existentes, id].filter((k) => RE_RESPALDO.test(k)).sort();
    await Promise.all(todas.slice(0, Math.max(0, todas.length - MAX_RESPALDOS)).map((k) => respaldos.delete(k)));
  }

  async function fotosExistentes() {
    const { blobs } = await fotos.list();
    return new Set(blobs.map((b) => `fotos/${b.key}`));
  }

  // ----- intentos de entrada por IP
  async function espera(ip) {
    const r = await intentos.get(resumenIp(ip), { type: 'json' });
    return r ? Math.max(0, Math.ceil((r.hasta - ahora().getTime()) / 1000)) : 0;
  }
  async function fallo(ip) {
    const llave = resumenIp(ip);
    const r = (await intentos.get(llave, { type: 'json' })) ?? { n: 0 };
    const n = r.n + 1;
    const bloqueo = n < INTENTOS_ANTES_DE_BLOQUEO ? 0 : Math.min(900, 30 * 2 ** (n - INTENTOS_ANTES_DE_BLOQUEO));
    await intentos.setJSON(llave, { n, hasta: ahora().getTime() + bloqueo * 1000 });
  }

  // ----- rutas
  async function login(req, ip, seguro) {
    const segundos = await espera(ip);
    if (segundos) return json(429, { error: `Demasiados intentos. Espera ${segundos} segundos.` });
    if (!configurado) return json(503, { error: 'El panel no está configurado en Netlify. Revisa ADMIN_PASSWORD_HASH y SESSION_SECRET.' });
    const { valor } = await leerJson(req);
    const contrasena = valor?.contrasena;
    if (typeof contrasena !== 'string' || !(await verificarContrasena(contrasena, hash))) {
      await fallo(ip);
      return json(401, { error: 'Contraseña incorrecta.' });
    }
    await intentos.delete(resumenIp(ip));
    return json(200, { ok: true }, cookieSesion(crearSesion(secreto, ahora().getTime()), seguro));
  }

  async function guardarMenu(req) {
    const { valor, error } = await leerJson(req);
    if (error || valor === null || typeof valor !== 'object') return json(400, { error: error ?? 'Formato inválido.' });
    const { menu, temporada } = valor;
    const existentes = await fotosExistentes();
    const errores = validar(menu, temporada, (ruta) => ruta.startsWith('assets/') || existentes.has(ruta));
    if (errores.length) return json(422, { error: 'Revisa estos datos antes de guardar.', errores: errores.slice(0, 20) });
    const conflicto = () => json(409, { error: 'El menú se cambió desde otro dispositivo. Recarga para ver la versión más reciente.' });
    const actual = await leerEstado();
    if (valor.version !== actual.version) return conflicto();
    if (!(await escribirEstado(menu, temporada, actual.etag))) return conflicto();
    await respaldar(actual.menu, actual.temporada);
    return json(200, { version: versionDe(menu, temporada) });
  }

  async function subirImagen(req, url) {
    const tipo = (req.headers.get('content-type') ?? '').split(';')[0].trim();
    const formato = FIRMAS[tipo];
    if (!formato) return json(415, { error: 'Usa una foto JPG, PNG o WebP.' });
    const { datos: bytes, error } = await leerCuerpo(req, MAX_IMAGEN);
    if (error) return json(413, { error });
    const valida = formato.firma.every((b, i) => bytes[i] === b)
      && (tipo !== 'image/webp' || new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP');
    if (!valida) return json(415, { error: 'El archivo no parece una imagen válida.' });
    const llave = `${slug(url.searchParams.get('nombre') ?? 'foto')}-${randomBytes(3).toString('hex')}.${formato.ext}`;
    await fotos.set(llave, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { metadata: { tipo } });
    return json(201, { ruta: `fotos/${llave}` });
  }

  async function listarRespaldos() {
    const { blobs } = await respaldos.list();
    const ids = blobs.map((b) => b.key).filter((k) => RE_RESPALDO.test(k)).sort().reverse();
    return json(200, { respaldos: ids.map((id) => ({ id, fecha: fechaDeSello(id) })) });
  }

  async function restaurar(req) {
    const { valor, error } = await leerJson(req);
    if (error) return json(400, { error });
    const id = String(valor?.id ?? '');
    const copia = RE_RESPALDO.test(id) ? await respaldos.get(id, { type: 'json' }) : null;
    if (!copia) return json(404, { error: 'Ese respaldo no existe.' });
    const actual = await leerEstado();
    if (!(await escribirEstado(copia.menu, copia.temporada, actual.etag))) {
      return json(409, { error: 'El menú se cambió desde otro dispositivo. Recarga e intenta de nuevo.' });
    }
    await respaldar(actual.menu, actual.temporada);
    return json(200, { version: versionDe(copia.menu, copia.temporada) });
  }

  // ----- /api/*
  async function panel(req, context = {}) {
    const url = new URL(req.url);
    const ruta = url.pathname;
    const metodo = req.method;
    const seguro = url.protocol === 'https:';
    const autenticado = configurado && sesionValida(leerCookie(req), secreto, ahora().getTime());

    if (metodo === 'GET') {
      if (ruta === '/api/sesion') return json(200, { autenticado, configurado });
      if (!autenticado) return json(401, { error: SESION_TERMINO });
      if (ruta === '/api/menu') return json(200, await leerMenu());
      if (ruta === '/api/respaldos') return listarRespaldos();
      return json(404, { error: 'No existe.' });
    }
    if (metodo !== 'POST' && metodo !== 'PUT') return json(405, { error: 'Método no permitido.' });

    // Defensa CSRF: encabezado propio (otro sitio no puede mandarlo sin CORS) y mismo origen.
    const origen = req.headers.get('origin');
    if (req.headers.get('x-amores') !== '1' || (origen && origen !== url.origin)) {
      return json(403, { error: 'Solicitud rechazada.' });
    }
    if (metodo === 'POST' && ruta === '/api/login') return login(req, context.ip, seguro);
    if (metodo === 'POST' && ruta === '/api/logout') return json(200, { ok: true }, cookieSesion(null, seguro));
    if (!autenticado) return json(401, { error: SESION_TERMINO });
    if (metodo === 'PUT' && ruta === '/api/menu') return guardarMenu(req);
    if (metodo === 'POST' && ruta === '/api/imagen') return subirImagen(req, url);
    if (metodo === 'POST' && ruta === '/api/respaldos/restaurar') return restaurar(req);
    return json(404, { error: 'No existe.' });
  }

  // ----- /menu.json, /menu-temporada.json y /fotos/* (públicos)
  async function publico(req) {
    const ruta = new URL(req.url).pathname;
    const sinCache = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' };
    if (ruta === '/menu.json' || ruta === '/menu-temporada.json') {
      const { menu, temporada } = await leerMenu();
      return new Response(JSON.stringify(ruta === '/menu.json' ? menu : temporada), { headers: sinCache });
    }
    const llave = decodeURIComponent(ruta.replace(/^\/fotos\//, ''));
    if (RE_LLAVE_FOTO.test(llave) && RE_FOTO.test(`fotos/${llave}`)) {
      const foto = await fotos.getWithMetadata(llave, { type: 'arrayBuffer' });
      if (foto) {
        return new Response(foto.data, {
          headers: { 'Content-Type': foto.metadata?.tipo ?? 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' },
        });
      }
    }
    return new Response('No existe.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  return { panel, publico };
}
