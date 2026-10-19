// Contraseña cifrada (PBKDF2) y sesión firmada (HMAC) en una cookie. Sin estado en el servidor.
import { createHash, createHmac, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);
const ITERACIONES = 600_000;
export const DURACION_SESION = 12 * 3600; // segundos
export const NOMBRE_COOKIE = 'amores_sesion';

const iguales = (a, b) => a.length === b.length && timingSafeEqual(a, b);

// Formato: pbkdf2_sha256$iteraciones$sal_hex$hash_hex
export async function cifrarContrasena(contrasena, sal = randomBytes(16)) {
  const hash = await pbkdf2Async(contrasena, sal, ITERACIONES, 32, 'sha256');
  return `pbkdf2_sha256$${ITERACIONES}$${sal.toString('hex')}$${hash.toString('hex')}`;
}

export async function verificarContrasena(contrasena, guardado) {
  const partes = String(guardado ?? '').split('$');
  if (partes.length !== 4 || partes[0] !== 'pbkdf2_sha256') return false;
  const [, iteraciones, sal, esperado] = partes;
  const hash = await pbkdf2Async(String(contrasena), Buffer.from(sal, 'hex'), Number(iteraciones), 32, 'sha256');
  return iguales(hash, Buffer.from(esperado, 'hex'));
}

const firmar = (datos, secreto) => createHmac('sha256', secreto).update(datos).digest('base64url');

export function crearSesion(secreto, ahora = Date.now()) {
  const datos = Buffer.from(JSON.stringify({ v: Math.floor(ahora / 1000) + DURACION_SESION, n: randomBytes(8).toString('hex') })).toString('base64url');
  return `${datos}.${firmar(datos, secreto)}`;
}

export function sesionValida(token, secreto, ahora = Date.now()) {
  if (!token || !secreto) return false;
  const [datos, firma] = String(token).split('.');
  if (!datos || !firma || !iguales(Buffer.from(firma), Buffer.from(firmar(datos, secreto)))) return false;
  try {
    return JSON.parse(Buffer.from(datos, 'base64url').toString()).v > ahora / 1000;
  } catch {
    return false;
  }
}

export function leerCookie(req, nombre = NOMBRE_COOKIE) {
  for (const parte of (req.headers.get('cookie') ?? '').split(';')) {
    const [clave, ...resto] = parte.trim().split('=');
    if (clave === nombre) return resto.join('=');
  }
  return null;
}

export function cookieSesion(token, seguro) {
  const s = seguro ? '; Secure' : '';
  return token
    ? `${NOMBRE_COOKIE}=${token}; Path=/; Max-Age=${DURACION_SESION}; HttpOnly; SameSite=Strict${s}`
    : `${NOMBRE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${s}`;
}

// Se guarda un resumen de la IP, no la IP completa.
export const resumenIp = (ip) => createHash('sha256').update(String(ip ?? 'desconocida')).digest('hex').slice(0, 16);

export const versionDe = (menu, temporada) =>
  createHash('sha256').update(`${JSON.stringify(menu)}\0${JSON.stringify(temporada)}`).digest('hex').slice(0, 16);
