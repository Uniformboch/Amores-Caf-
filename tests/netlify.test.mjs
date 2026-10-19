// Pruebas del panel en Netlify (functions + Blobs) con un almacén en memoria.
// Ejecutar con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crearApi } from '../netlify/lib/api.mjs';
import { cifrarContrasena, crearSesion, sesionValida, verificarContrasena } from '../netlify/lib/seguridad.mjs';
import { validar } from '../netlify/lib/validar.mjs';

const leer = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const MENU = leer('menu.json');
const TEMPORADA = leer('menu-temporada.json');
const copia = (x) => structuredClone(x);

// Imita la API de @netlify/blobs que usamos, con etags y escrituras condicionales.
class AlmacenMemoria {
  #datos = new Map();
  antesDeEscribir = null;
  #cambiar(key, data, { onlyIfMatch, onlyIfNew, metadata } = {}) {
    if (this.antesDeEscribir) {
      const fn = this.antesDeEscribir;
      this.antesDeEscribir = null;
      fn();
    }
    const actual = this.#datos.get(key);
    if (onlyIfNew && actual) return { modified: false };
    if (onlyIfMatch && actual?.etag !== onlyIfMatch) return { modified: false };
    const etag = randomBytes(4).toString('hex');
    this.#datos.set(key, { data, metadata: metadata ?? {}, etag });
    return { modified: true, etag };
  }
  #convertir(data, type) {
    if (type === 'json') return JSON.parse(data);
    if (type === 'arrayBuffer') return data;
    return data;
  }
  async get(key, { type } = {}) {
    const e = this.#datos.get(key);
    return e ? this.#convertir(e.data, type) : null;
  }
  async getWithMetadata(key, { type } = {}) {
    const e = this.#datos.get(key);
    return e ? { data: this.#convertir(e.data, type), metadata: e.metadata, etag: e.etag } : null;
  }
  async setJSON(key, valor, opciones) { return this.#cambiar(key, JSON.stringify(valor), opciones); }
  async set(key, valor, opciones) { return this.#cambiar(key, valor, opciones); }
  async delete(key) { this.#datos.delete(key); }
  async list() { return { blobs: [...this.#datos].map(([key, e]) => ({ key, etag: e.etag })), directories: [] }; }
  // Para simular que otro dispositivo escribe "por fuera".
  tocar(key) { const e = this.#datos.get(key); if (e) e.etag = 'otro'; }
}

const CONTRASENA = `prueba-${randomBytes(6).toString('hex')}`;
const HASH = await cifrarContrasena(CONTRASENA);
const SECRETO = randomBytes(32).toString('base64url');
const ORIGEN = 'https://amores.test';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(0), 0xff, 0xd9]);

function montar({ entorno = { ADMIN_PASSWORD_HASH: HASH, SESSION_SECRET: SECRETO } } = {}) {
  const tiendas = { datos: new AlmacenMemoria(), fotos: new AlmacenMemoria(), respaldos: new AlmacenMemoria(), intentos: new AlmacenMemoria() };
  let reloj = Date.parse('2026-10-19T18:00:00Z');
  const api = crearApi({ tiendas, entorno, menuInicial: copia(MENU), temporadaInicial: copia(TEMPORADA), ahora: () => new Date(reloj) });
  let cookie = null;
  const cliente = {
    tiendas,
    avanzar(segundos) { reloj += segundos * 1000; },
    async pedir(metodo, ruta, { cuerpo, tipo = 'application/json', encabezados = {}, conX = true, ip = '10.0.0.1' } = {}) {
      const headers = new Headers(encabezados);
      if (conX) headers.set('x-amores', '1');
      if (cookie) headers.set('cookie', cookie);
      let body;
      if (cuerpo !== undefined) {
        body = cuerpo instanceof Uint8Array ? cuerpo : JSON.stringify(cuerpo);
        headers.set('content-type', tipo);
      }
      const req = new Request(`${ORIGEN}${ruta}`, { method: metodo, headers, body });
      const r = ruta.startsWith('/api/') ? await api.panel(req, { ip }) : await api.publico(req);
      const galleta = r.headers.get('set-cookie');
      if (galleta) cookie = galleta.includes('Max-Age=0') ? null : galleta.split(';')[0];
      const texto = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer();
      return { estado: r.status, datos: texto, r };
    },
    async entrar() {
      const { estado } = await cliente.pedir('POST', '/api/login', { cuerpo: { contrasena: CONTRASENA } });
      assert.equal(estado, 200);
    },
  };
  return cliente;
}

// ---------- validación ----------

test('el menú actual pasa la validación', () => {
  assert.deepEqual(validar(MENU, TEMPORADA), []);
});

test('la validación detecta errores comunes', () => {
  const menu = copia(MENU);
  const temporada = copia(TEMPORADA);
  menu.categorias[0].productos[2].precios.G = '60';
  menu.categorias[0].productos[3].id = menu.categorias[0].productos[2].id;
  temporada.categoria.productos[0].imagen = '../servidor.py';
  menu.config.whatsapp = '477 135';
  const chilaquiles = menu.categorias.find((c) => c.id === 'chilaquiles');
  chilaquiles.grupo = 'postres';
  const opciones = chilaquiles.productos[0].opciones;
  opciones[0].valores = opciones[0].valores.slice(0, 1);
  opciones[1].valores[0].precio = 1.5;
  opciones[1].valores[1].id = opciones[1].valores[2].id;
  const errores = validar(menu, temporada).join(' | ');
  for (const esperado of ['número entero', 'id repetido', 'ruta de foto', 'WhatsApp', 'grupo debe ser', 'entre 2 y', 'precio extra', 'id de valor']) {
    assert.ok(errores.includes(esperado), `falta: ${esperado}`);
  }
});

test('contraseña cifrada y sesión firmada', async () => {
  assert.ok(await verificarContrasena(CONTRASENA, HASH));
  assert.equal(await verificarContrasena('otra', HASH), false);
  assert.equal(await verificarContrasena(CONTRASENA, 'basura'), false);
  const token = crearSesion(SECRETO, 0);
  assert.ok(sesionValida(token, SECRETO, 1000));
  assert.equal(sesionValida(token, SECRETO, 13 * 3600 * 1000), false, 'vence a las 12 horas');
  assert.equal(sesionValida(token, 'otro-secreto-de-al-menos-treinta-y-dos', 1000), false);
  assert.equal(sesionValida(`${token.split('.')[0]}.firmafalsa`, SECRETO, 1000), false);
});

// ---------- panel ----------

test('la API pide sesión', async () => {
  const c = montar();
  const sesion = await c.pedir('GET', '/api/sesion');
  assert.deepEqual(sesion.datos, { autenticado: false, configurado: true });
  assert.equal((await c.pedir('GET', '/api/menu')).estado, 401);
  assert.equal((await c.pedir('PUT', '/api/menu', { cuerpo: {} })).estado, 401);
  assert.equal((await c.pedir('POST', '/api/imagen', { cuerpo: JPEG, tipo: 'image/jpeg' })).estado, 401);
});

test('sin variables de entorno el panel avisa que falta configurarlo', async () => {
  const c = montar({ entorno: {} });
  assert.equal((await c.pedir('GET', '/api/sesion')).datos.configurado, false);
  const r = await c.pedir('POST', '/api/login', { cuerpo: { contrasena: CONTRASENA } });
  assert.equal(r.estado, 503);
});

test('rechaza solicitudes de otros sitios', async () => {
  const c = montar();
  assert.equal((await c.pedir('POST', '/api/login', { cuerpo: { contrasena: CONTRASENA }, conX: false })).estado, 403);
  const r = await c.pedir('POST', '/api/login', { cuerpo: { contrasena: CONTRASENA }, encabezados: { origin: 'https://sitio-malo.example' } });
  assert.equal(r.estado, 403);
});

test('entrada, cookie segura y salida', async () => {
  const c = montar();
  assert.equal((await c.pedir('POST', '/api/login', { cuerpo: { contrasena: 'mala' } })).estado, 401);
  const r = await c.pedir('POST', '/api/login', { cuerpo: { contrasena: CONTRASENA } });
  assert.equal(r.estado, 200);
  const galleta = r.r.headers.get('set-cookie');
  for (const parte of ['HttpOnly', 'SameSite=Strict', 'Secure']) assert.ok(galleta.includes(parte), parte);
  assert.equal((await c.pedir('GET', '/api/sesion')).datos.autenticado, true);
  await c.pedir('POST', '/api/logout', { cuerpo: {} });
  assert.equal((await c.pedir('GET', '/api/menu')).estado, 401);
});

test('bloqueo tras varios intentos fallidos, por IP', async () => {
  const c = montar();
  for (let i = 0; i < 5; i++) await c.pedir('POST', '/api/login', { cuerpo: { contrasena: 'mala' } });
  const bloqueado = await c.pedir('POST', '/api/login', { cuerpo: { contrasena: CONTRASENA } });
  assert.equal(bloqueado.estado, 429);
  assert.match(bloqueado.datos.error, /Espera \d+ segundos/);
  assert.equal((await c.pedir('POST', '/api/login', { cuerpo: { contrasena: CONTRASENA }, ip: '10.0.0.2' })).estado, 200, 'otra IP no está bloqueada');
  c.avanzar(31);
  assert.equal((await c.pedir('POST', '/api/login', { cuerpo: { contrasena: CONTRASENA } })).estado, 200, 'el bloqueo vence');
});

test('guardar: marcar agotado, cambiar precio, respaldo y menú público', async () => {
  const c = montar();
  assert.equal((await c.pedir('GET', '/menu.json')).datos.categorias.length, MENU.categorias.length, 'antes de guardar se ve el menú del repositorio');
  await c.entrar();
  const { datos } = await c.pedir('GET', '/api/menu');
  const latte = datos.menu.categorias[0].productos.find((p) => p.id === 'latte');
  latte.agotado = true;
  latte.precios.M = 57;
  const r = await c.pedir('PUT', '/api/menu', { cuerpo: datos });
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  const publico = await c.pedir('GET', '/menu.json');
  const enMenu = publico.datos.categorias[0].productos.find((p) => p.id === 'latte');
  assert.deepEqual([enMenu.agotado, enMenu.precios.M], [true, 57]);
  assert.equal(publico.r.headers.get('cache-control'), 'no-cache');
  assert.equal((await c.pedir('GET', '/api/respaldos')).datos.respaldos.length, 1);
  // La versión vieja ya no sirve: otro dispositivo (este mismo) ya guardó.
  assert.equal((await c.pedir('PUT', '/api/menu', { cuerpo: datos })).estado, 409);
});

test('dos guardados al mismo tiempo: el segundo recibe conflicto', async () => {
  const c = montar();
  await c.entrar();
  const { datos } = await c.pedir('GET', '/api/menu');
  assert.equal((await c.pedir('PUT', '/api/menu', { cuerpo: datos })).estado, 200);
  const { datos: nuevo } = await c.pedir('GET', '/api/menu');
  // Otro dispositivo escribe justo entre la lectura y la escritura de este guardado.
  c.tiendas.datos.antesDeEscribir = () => c.tiendas.datos.tocar('estado');
  nuevo.menu.categorias[0].productos[0].precios.M = 41;
  assert.equal((await c.pedir('PUT', '/api/menu', { cuerpo: nuevo })).estado, 409);
});

test('rechaza un menú inválido sin crear respaldo', async () => {
  const c = montar();
  await c.entrar();
  const { datos } = await c.pedir('GET', '/api/menu');
  datos.menu.categorias[0].productos[0].precios.M = -5;
  const r = await c.pedir('PUT', '/api/menu', { cuerpo: datos });
  assert.equal(r.estado, 422);
  assert.ok(r.datos.errores.length);
  assert.equal((await c.pedir('GET', '/api/respaldos')).datos.respaldos.length, 0);
});

test('subir foto, usarla en temporada y servirla', async () => {
  const c = montar();
  await c.entrar();
  const r = await c.pedir('POST', '/api/imagen?nombre=Caf%C3%A9%20de%20olla', { cuerpo: JPEG, tipo: 'image/jpeg' });
  assert.equal(r.estado, 201);
  assert.match(r.datos.ruta, /^fotos\/cafe-de-olla-[0-9a-f]{6}\.jpg$/);
  const foto = await c.pedir('GET', `/${r.datos.ruta}`);
  assert.equal(foto.estado, 200);
  assert.equal(foto.r.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(foto.datos), JPEG);

  const { datos } = await c.pedir('GET', '/api/menu');
  datos.temporada.categoria.productos.push({ id: 'cafe-de-olla', nombre: 'Café de olla', imagen: r.datos.ruta, precios: { unico: 70 } });
  assert.equal((await c.pedir('PUT', '/api/menu', { cuerpo: datos })).estado, 200);

  const { datos: otra } = await c.pedir('GET', '/api/menu');
  otra.temporada.categoria.productos.at(-1).imagen = 'fotos/no-existe-abc123.jpg';
  const mala = await c.pedir('PUT', '/api/menu', { cuerpo: otra });
  assert.equal(mala.estado, 422);
  assert.ok(mala.datos.errores.some((e) => e.includes('no existe')));

  assert.equal((await c.pedir('POST', '/api/imagen', { cuerpo: new TextEncoder().encode('<svg/>'), tipo: 'image/svg+xml' })).estado, 415);
  assert.equal((await c.pedir('POST', '/api/imagen', { cuerpo: new TextEncoder().encode('GIF89a....'), tipo: 'image/jpeg' })).estado, 415);
  assert.equal((await c.pedir('GET', '/fotos/..%2F..%2Fsecreto.jpg')).estado, 404);
});

test('restaurar un respaldo', async () => {
  const c = montar();
  await c.entrar();
  const { datos } = await c.pedir('GET', '/api/menu');
  const original = datos.menu.categorias[0].productos[0].nombre;
  datos.menu.categorias[0].productos[0].nombre = 'Americano cambiado';
  assert.equal((await c.pedir('PUT', '/api/menu', { cuerpo: datos })).estado, 200);
  const { datos: lista } = await c.pedir('GET', '/api/respaldos');
  assert.match(lista.respaldos[0].fecha, /^2026-10-19T18:00:00Z$/);
  c.avanzar(5);
  assert.equal((await c.pedir('POST', '/api/respaldos/restaurar', { cuerpo: { id: lista.respaldos[0].id } })).estado, 200);
  const { datos: despues } = await c.pedir('GET', '/api/menu');
  assert.equal(despues.menu.categorias[0].productos[0].nombre, original);
  assert.equal((await c.pedir('POST', '/api/respaldos/restaurar', { cuerpo: { id: '../../etc' } })).estado, 404);
});

test('conserva solo los últimos 60 respaldos', async () => {
  const c = montar();
  await c.entrar();
  for (let i = 0; i < 62; i++) {
    const { datos } = await c.pedir('GET', '/api/menu');
    datos.menu.categorias[0].productos[0].precios.M = 40 + (i % 2);
    assert.equal((await c.pedir('PUT', '/api/menu', { cuerpo: datos })).estado, 200);
    c.avanzar(1);
  }
  assert.equal((await c.pedir('GET', '/api/respaldos')).datos.respaldos.length, 60);
});
