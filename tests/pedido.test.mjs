// Ejecutar con: node --test tests/pedido.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalog, Cart, nombrePedido } from '../js/cart.js';
import { construirMensaje, enlaceWhatsApp, validarPedido } from '../js/whatsapp.js';

const leer = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
// "Agotado" lo cambia el dueño a diario desde el panel; las pruebas revisan la estructura, no la disponibilidad.
const sinAgotados = (datos) => JSON.parse(JSON.stringify(datos, (k, v) => (k === 'agotado' ? undefined : v)));
const menu = sinAgotados(leer('menu.json'));
const temporada = sinAgotados(leer('menu-temporada.json'));
const catalogo = () => buildCatalog(menu, temporada);

// Precios tal como los dio el café.
const ESPERADO = {
  americano: { M: 40, G: 45 }, cappuccino: { M: 55, G: 60 }, latte: { M: 55, G: 60 },
  moka: { M: 60, G: 65 }, 'latte-caramel': { M: 60, G: 65 },
  matcha: { M: 60, G: 65, H: 70 }, chai: { M: 60, G: 65, H: 70 }, taro: { M: 60, G: 65, H: 70 },
  chocolate: { M: 55, G: 60, H: 65 },
  'iced-americano': { G: 55 }, 'iced-latte': { G: 65 }, 'iced-latte-caramel': { G: 70 }, 'iced-moka': { G: 70 },
  'cold-brew': { G: 60 }, 'cold-brew-vainilla': { G: 65 }, 'brew-tonic': { G: 80 }, 'espresso-tonic': { G: 75 },
  'sunrise-brew': { G: 70 },
  'frappe-cappuccino': { G: 70 }, 'frappe-moka': { G: 70 }, 'frappe-oreo': { G: 70 }, 'frappe-taro': { G: 70 },
  'frappe-matcha': { G: 70 }, 'frappe-chai': { G: 70 },
  'smoothie-mango': { G: 75 }, 'smoothie-fresa': { G: 75 }, 'smoothie-frutos-rojos': { G: 75 },
  'agua-natural': { unico: 25 }, 'coca-cola': { unico: 35 }, 'agua-mineral': { unico: 30 },
  'mazapan-latte': { unico: 80 }, 'mango-matcha': { unico: 85 }, 'cold-brew-jamaica': { unico: 75 },
  'horchata-latte': { unico: 85 }, 'cacao-mexicano': { unico: 85 },
  // Comida
  'basic-croissant': { unico: 65 }, 'serrano-honey-croissant': { unico: 75 }, 'pizza-melt-croissant': { unico: 75 },
  'sweet-strawberry-croissant': { unico: 60 }, 'pistachio-cream-croissant': { unico: 70 }, 'nutella-croissant': { unico: 65 },
  'baguette-pollo': { unico: 75 }, 'baguette-pavo': { unico: 75 }, 'baguette-arrachera': { unico: 85 },
  'baguette-jamon-serrano': { unico: 85 }, 'bagel-roast-beef': { unico: 120 }, chilaquiles: { unico: 95 },
  'torta-de-la-casa': { unico: 60 }, 'ensalada-de-la-casa': { unico: 95 }, 'sandwich-montecristo': { unico: 85 },
  'avocado-toast': { unico: 70 }, 'pan-de-elote': { unico: 40 }, chocolatin: { unico: 40 }, concha: { unico: 35 },
};

test('el menú tiene exactamente las bebidas y precios acordados', () => {
  const c = catalogo();
  assert.deepEqual([...c.productos.keys()].sort(), Object.keys(ESPERADO).sort());
  for (const [id, precios] of Object.entries(ESPERADO)) {
    assert.deepEqual(c.productos.get(id).producto.precios, precios, id);
  }
  assert.equal(c.extras.get('shot-extra').precio, 10);
  assert.equal(c.extras.get('leche-almendra').precio, 15);
  assert.deepEqual(['proteina-extra', 'aguacate', 'bolillo', 'mascarpone'].map((id) => c.extras.get(id).precio), [15, 10, 10, 20]);
  assert.equal(c.categorias[0].id, 'temporada', 'temporada va primero');
  const comida = c.categorias.filter((cat) => cat.grupo === 'comida').map((cat) => cat.id);
  assert.deepEqual(comida, ['croissants-salados', 'croissants-dulces', 'baguettes', 'bagels', 'chilaquiles', 'varios', 'algo-dulcito']);
});

test('extras: shot en bebidas con café, almendra solo donde hay leche', () => {
  const c = catalogo();
  const ex = (id) => c.productos.get(id).extrasPermitidos;
  assert.deepEqual(ex('americano'), ['shot-extra']);
  assert.deepEqual(ex('latte'), ['shot-extra', 'leche-almendra']);
  assert.deepEqual(ex('matcha'), ['leche-almendra']);
  assert.deepEqual(ex('cold-brew'), ['shot-extra']);
  assert.deepEqual(ex('iced-latte'), ['shot-extra', 'leche-almendra']);
  assert.deepEqual(ex('frappe-moka'), ['shot-extra', 'leche-almendra']);
  assert.deepEqual(ex('frappe-oreo'), ['leche-almendra']);
  assert.deepEqual(ex('smoothie-mango'), []);
  assert.deepEqual(ex('coca-cola'), []);
  assert.deepEqual(ex('mazapan-latte'), []);
});

test('nombres en el pedido distinguen frappés y smoothies', () => {
  const c = catalogo();
  assert.equal(nombrePedido(c, 'frappe-moka'), 'Frappé moka');
  assert.equal(nombrePedido(c, 'smoothie-frutos-rojos'), 'Smoothie frutos rojos');
  assert.equal(nombrePedido(c, 'agua-natural'), 'Agua natural 600 ml');
  assert.equal(nombrePedido(c, 'moka'), 'Moka');
});

test('el carrito suma líneas iguales y separa combinaciones distintas', () => {
  const cart = new Cart(catalogo());
  cart.add({ productId: 'latte', tamano: 'G', extras: ['shot-extra'], cantidad: 1 });
  cart.add({ productId: 'latte', tamano: 'G', extras: ['shot-extra'], cantidad: 1 });
  cart.add({ productId: 'latte', tamano: 'G', extras: [], cantidad: 1 });
  cart.add({ productId: 'latte', tamano: 'G', extras: ['leche-almendra', 'shot-extra'], cantidad: 1 });
  cart.add({ productId: 'latte', tamano: 'G', extras: ['shot-extra', 'leche-almendra'], cantidad: 1 });
  assert.equal(cart.lineas.length, 3);
  assert.equal(cart.cantidad, 5);
  // 2×(60+10) + 1×60 + 2×(60+10+15)
  assert.equal(cart.total, 140 + 60 + 170);
});

test('cantidades: bajar a cero quita la línea; tope de 20', () => {
  const cart = new Cart(catalogo());
  const key = cart.add({ productId: 'americano', tamano: 'M', extras: [], cantidad: 1 });
  cart.setCantidad(key, 99);
  assert.equal(cart.cantidad, 20);
  cart.setCantidad(key, 0);
  assert.equal(cart.vacio, true);
});

test('rechaza tamaños o extras que no corresponden', () => {
  const cart = new Cart(catalogo());
  assert.throws(() => cart.add({ productId: 'iced-latte', tamano: 'M', extras: [], cantidad: 1 }));
  assert.throws(() => cart.add({ productId: 'americano', tamano: 'M', extras: ['leche-almendra'], cantidad: 1 }));
  assert.throws(() => cart.add({ productId: 'no-existe', tamano: 'G', extras: [], cantidad: 1 }));
});

test('un carrito guardado se limpia si el menú cambió', () => {
  const guardadas = [
    { productId: 'latte', tamano: 'G', extras: [], cantidad: 2 },
    { productId: 'producto-retirado', tamano: 'G', extras: [], cantidad: 1 },
    { productId: 'matcha', tamano: 'X', extras: [], cantidad: 1 },
    { productId: 'chai', tamano: 'H', extras: [], cantidad: -4 },
  ];
  const cart = new Cart(catalogo(), guardadas);
  assert.deepEqual(cart.toJSON(), [
    { productId: 'latte', tamano: 'G', extras: [], opciones: {}, cantidad: 2 },
    { productId: 'chai', tamano: 'H', extras: [], opciones: {}, cantidad: 1 },
  ]);
});

test('el mensaje de WhatsApp lleva líneas, total y datos de entrega', () => {
  const cart = new Cart(catalogo());
  cart.add({ productId: 'latte', tamano: 'G', extras: ['shot-extra'], cantidad: 2 });
  cart.add({ productId: 'matcha', tamano: 'H', extras: [], cantidad: 1 });
  cart.add({ productId: 'agua-natural', tamano: 'unico', extras: [], cantidad: 1 });
  cart.add({ productId: 'frappe-oreo', tamano: 'G', extras: [], cantidad: 1 });
  const mensaje = construirMensaje({
    negocio: 'Amores Café',
    lineas: cart.lineas,
    total: cart.total,
    cliente: { nombre: '  Ana  ', entrega: 'domicilio', direccion: 'Calle Madero 123, Centro', notas: 'sin azúcar' },
  });
  assert.equal(mensaje, [
    'Hola, Amores Café. Quiero hacer un pedido:',
    '',
    '• 2 × Latte (Grande) + Shot extra — $140',
    '• 1 × Matcha (Helado) — $70',
    '• 1 × Agua natural 600 ml — $25',
    '• 1 × Frappé oreo (Grande) — $70',
    '',
    '*Total: $305*',
    '',
    'Nombre: Ana',
    'Entrega: A domicilio',
    'Dirección: Calle Madero 123, Centro',
    'Envío: por confirmar',
    'Notas: sin azúcar',
  ].join('\n'));
});

test('para llevar no incluye dirección ni envío', () => {
  const cart = new Cart(catalogo());
  cart.add({ productId: 'americano', tamano: 'M', extras: [], cantidad: 1 });
  const mensaje = construirMensaje({
    negocio: 'Amores Café', lineas: cart.lineas, total: cart.total,
    cliente: { nombre: 'Luis', entrega: 'llevar', direccion: 'no debería salir', notas: '' },
  });
  assert.doesNotMatch(mensaje, /Dirección|Envío|Notas/);
  assert.match(mensaje, /Entrega: Para llevar$/);
});

test('el enlace usa wa.me con el número de prueba y el texto codificado', () => {
  assert.equal(menu.config.whatsapp, '524771358745');
  const url = enlaceWhatsApp(menu.config.whatsapp, 'Hola & adiós\n*Total: $10*');
  assert.equal(url, 'https://wa.me/524771358745?text=Hola%20%26%20adi%C3%B3s%0A*Total%3A%20%2410*');
  assert.equal(new URL(url).searchParams.get('text'), 'Hola & adiós\n*Total: $10*');
});

test('validación del pedido', () => {
  assert.deepEqual(Object.keys(validarPedido({}, 0)).sort(), ['entrega', 'lineas', 'nombre']);
  assert.deepEqual(validarPedido({ nombre: 'Ana', entrega: 'llevar' }, 1), {});
  assert.ok(validarPedido({ nombre: 'Ana', entrega: 'domicilio', direccion: '' }, 1).direccion);
  assert.deepEqual(validarPedido({ nombre: 'Ana', entrega: 'domicilio', direccion: 'Calle Madero 123' }, 1), {});
  assert.ok(validarPedido({ nombre: ' ', entrega: 'llevar' }, 1).nombre);
  assert.ok(validarPedido({ nombre: 'Ana', entrega: 'mesa' }, 1).entrega, 'no hay mesas');
});

test('una bebida agotada no se puede pedir y sale de un carrito guardado', () => {
  const menuAgotado = structuredClone(menu);
  menuAgotado.categorias[0].productos.find((p) => p.id === 'latte').agotado = true;
  const c = buildCatalog(menuAgotado, temporada);
  assert.ok(c.productos.has('latte'), 'sigue en el catálogo para mostrarse como agotada');
  const cart = new Cart(c, [
    { productId: 'latte', tamano: 'G', extras: [], cantidad: 1 },
    { productId: 'moka', tamano: 'G', extras: [], cantidad: 1 },
  ]);
  assert.deepEqual(cart.toJSON().map((l) => l.productId), ['moka']);
  assert.throws(() => cart.add({ productId: 'latte', tamano: 'M', extras: [], cantidad: 1 }));
});

test('extras de comida: proteína y aguacate en platillos, bolillo solo en chilaquiles, mascarpone solo en concha', () => {
  const c = catalogo();
  const ex = (id) => c.productos.get(id).extrasPermitidos;
  assert.deepEqual(ex('chilaquiles'), ['proteina-extra', 'aguacate', 'bolillo']);
  for (const id of ['baguette-pollo', 'bagel-roast-beef', 'torta-de-la-casa', 'ensalada-de-la-casa']) {
    assert.deepEqual(ex(id), ['proteina-extra', 'aguacate'], id);
  }
  for (const id of ['basic-croissant', 'nutella-croissant', 'sandwich-montecristo', 'avocado-toast', 'pan-de-elote']) {
    assert.deepEqual(ex(id), [], id);
  }
  assert.deepEqual(ex('concha'), ['mascarpone']);
});

test('opciones obligatorias: sin elegir no entra al carrito', () => {
  const cart = new Cart(catalogo());
  assert.throws(() => cart.add({ productId: 'chilaquiles', tamano: 'unico', extras: [], cantidad: 1 }));
  assert.throws(() => cart.add({ productId: 'chilaquiles', tamano: 'unico', extras: [], opciones: { proteina: 'pollo' }, cantidad: 1 }));
  assert.throws(() => cart.add({ productId: 'chilaquiles', tamano: 'unico', extras: [], opciones: { proteina: 'res', salsa: 'verde' }, cantidad: 1 }));
  cart.add({ productId: 'chilaquiles', tamano: 'unico', extras: [], opciones: { proteina: 'pollo', salsa: 'verde' }, cantidad: 1 });
  cart.add({ productId: 'chilaquiles', tamano: 'unico', extras: [], opciones: { salsa: 'verde', proteina: 'pollo' }, cantidad: 1 });
  cart.add({ productId: 'chilaquiles', tamano: 'unico', extras: [], opciones: { proteina: 'huevo', salsa: 'verde' }, cantidad: 1 });
  assert.equal(cart.lineas.length, 2, 'misma elección se suma; otra elección es otra línea');
  assert.equal(cart.lineas[0].cantidad, 2);
});

test('opciones con precio: avocado toast de 1 y 2 piezas', () => {
  const cart = new Cart(catalogo());
  cart.add({ productId: 'avocado-toast', tamano: 'unico', extras: [], opciones: { piezas: 'una' }, cantidad: 1 });
  cart.add({ productId: 'avocado-toast', tamano: 'unico', extras: [], opciones: { piezas: 'dos' }, cantidad: 1 });
  assert.deepEqual(cart.lineas.map((l) => l.unitario), [70, 120]);
});

test('bebidas y comida van en el mismo pedido y mensaje', () => {
  const cart = new Cart(catalogo());
  cart.add({ productId: 'latte', tamano: 'G', extras: [], cantidad: 1 });
  cart.add({ productId: 'chilaquiles', tamano: 'unico', extras: ['aguacate'], opciones: { proteina: 'arrachera', salsa: 'morita' }, cantidad: 1 });
  cart.add({ productId: 'concha', tamano: 'unico', extras: ['mascarpone'], cantidad: 2 });
  cart.add({ productId: 'baguette-pavo', tamano: 'unico', extras: [], cantidad: 1 });
  const mensaje = construirMensaje({
    negocio: 'Amores Café', lineas: cart.lineas, total: cart.total,
    cliente: { nombre: 'Ana', entrega: 'llevar' },
  });
  assert.match(mensaje, /^• 1 × Latte \(Grande\) — \$60$/m);
  assert.match(mensaje, /^• 1 × Chilaquiles \(Arrachera, Salsa morita\) \+ Aguacate — \$105$/m);
  assert.match(mensaje, /^• 2 × Concha \+ Queso mascarpone — \$110$/m);
  assert.match(mensaje, /^• 1 × Baguette pavo — \$75$/m);
  assert.match(mensaje, /\*Total: \$350\*/);
});

test('un carrito guardado con chilaquiles sin opciones se descarta', () => {
  const cart = new Cart(catalogo(), [
    { productId: 'chilaquiles', tamano: 'unico', extras: [], cantidad: 1 },
    { productId: 'chilaquiles', tamano: 'unico', extras: [], opciones: { proteina: 'huevo', salsa: 'roja' }, cantidad: 1 },
  ]);
  assert.deepEqual(cart.toJSON(), [
    { productId: 'chilaquiles', tamano: 'unico', extras: [], opciones: { proteina: 'huevo', salsa: 'roja' }, cantidad: 1 },
  ]);
});
