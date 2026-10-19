// Catálogo y carrito. Sin acceso al DOM: se puede probar con Node.

export const UNICO = 'unico';
const MAX_CANTIDAD = 20;

// Une menu.json y menu-temporada.json en un índice por id de producto.
export function buildCatalog(menu, temporada) {
  const fuentes = [];
  if (temporada && temporada.activa !== false && temporada.categoria) {
    fuentes.push({ ...temporada.categoria, esTemporada: true });
  }
  fuentes.push(...menu.categorias);

  // Copias: no se modifica el JSON recibido.
  const categorias = fuentes.map((c) => ({
    ...c,
    productos: c.productos.filter((p) => p.disponible !== false),
  }));

  const extras = new Map(menu.extras.map((e) => [e.id, e]));
  const productos = new Map();

  for (const categoria of categorias) {
    for (const producto of categoria.productos) {
      if (productos.has(producto.id)) {
        console.warn(`Producto duplicado en el menú: ${producto.id}`);
        continue;
      }
      const permitidos = (producto.extrasPermitidos ?? categoria.extrasPermitidos ?? [])
        .filter((id) => extras.has(id));
      productos.set(producto.id, { producto, categoria, extrasPermitidos: permitidos });
    }
  }

  return { config: menu.config, tamanos: menu.tamanos, extras, categorias, productos };
}

export function tamanosDe(producto) {
  return Object.keys(producto.precios);
}

// Nombre como se escribe en el pedido: "Frappé moka", "Agua natural 600 ml".
export function nombrePedido(catalogo, productId) {
  const { producto, categoria } = catalogo.productos.get(productId);
  let nombre = categoria.prefijoPedido
    ? `${categoria.prefijoPedido} ${producto.nombre.toLowerCase()}`
    : producto.nombre;
  if (producto.detalle) nombre += ` ${producto.detalle}`;
  return nombre;
}

export function nombreTamano(catalogo, tamano) {
  if (tamano === UNICO) return '';
  return catalogo.tamanos[tamano]?.nombre ?? tamano;
}

// Grupos de opciones obligatorias del producto (ej. proteína y salsa de los chilaquiles).
export function opcionesDe(producto) {
  return producto.opciones ?? [];
}

export function precioUnitario(catalogo, { productId, tamano, extras, opciones = {} }) {
  const { producto } = catalogo.productos.get(productId);
  const base = producto.precios[tamano];
  const conOpciones = opcionesDe(producto).reduce(
    (suma, g) => suma + (g.valores.find((v) => v.id === opciones[g.id])?.precio ?? 0),
    base,
  );
  return extras.reduce((suma, id) => suma + catalogo.extras.get(id).precio, conOpciones);
}

export function claveLinea(productId, tamano, extras, opciones = {}) {
  const elegidas = Object.keys(opciones).sort().map((g) => `${g}=${opciones[g]}`).join(',');
  return [productId, tamano, [...extras].sort().join('+'), elegidas].join('|');
}

// Devuelve la línea normalizada, o null si ya no es válida con el menú actual
// (producto retirado o agotado, tamaño que ya no existe, extra no permitido
// u opción obligatoria sin elegir).
export function normalizarLinea(catalogo, linea) {
  const entrada = catalogo.productos.get(linea?.productId);
  if (!entrada || entrada.producto.agotado) return null;
  if (!(linea.tamano in entrada.producto.precios)) return null;
  const extras = [...new Set(linea.extras ?? [])].sort();
  if (!extras.every((id) => entrada.extrasPermitidos.includes(id))) return null;
  const opciones = {};
  for (const grupo of opcionesDe(entrada.producto)) {
    const elegido = linea.opciones?.[grupo.id];
    if (!grupo.valores.some((v) => v.id === elegido)) return null;
    opciones[grupo.id] = elegido;
  }
  const cantidad = Math.min(MAX_CANTIDAD, Math.max(1, Math.floor(Number(linea.cantidad) || 1)));
  return {
    key: claveLinea(linea.productId, linea.tamano, extras, opciones),
    productId: linea.productId,
    tamano: linea.tamano,
    extras,
    opciones,
    cantidad,
  };
}

export class Cart {
  #lineas = [];
  #oyentes = new Set();

  constructor(catalogo, guardadas = []) {
    this.catalogo = catalogo;
    for (const linea of guardadas) {
      const ok = normalizarLinea(catalogo, linea);
      if (ok) this.#sumar(ok);
    }
  }

  onChange(fn) {
    this.#oyentes.add(fn);
    return () => this.#oyentes.delete(fn);
  }

  #avisar() {
    for (const fn of this.#oyentes) fn(this);
  }

  #sumar(linea) {
    const existente = this.#lineas.find((l) => l.key === linea.key);
    if (existente) {
      existente.cantidad = Math.min(MAX_CANTIDAD, existente.cantidad + linea.cantidad);
    } else {
      this.#lineas.push(linea);
    }
  }

  add(linea) {
    const ok = normalizarLinea(this.catalogo, linea);
    if (!ok) throw new Error(`Línea inválida: ${JSON.stringify(linea)}`);
    this.#sumar(ok);
    this.#avisar();
    return ok.key;
  }

  setCantidad(key, cantidad) {
    const linea = this.#lineas.find((l) => l.key === key);
    if (!linea) return;
    if (cantidad <= 0) {
      this.remove(key);
      return;
    }
    linea.cantidad = Math.min(MAX_CANTIDAD, Math.floor(cantidad));
    this.#avisar();
  }

  remove(key) {
    this.#lineas = this.#lineas.filter((l) => l.key !== key);
    this.#avisar();
  }

  clear() {
    this.#lineas = [];
    this.#avisar();
  }

  // Líneas con nombres y precios calculados desde el menú, no guardados.
  get lineas() {
    return this.#lineas.map((l) => {
      const unitario = precioUnitario(this.catalogo, l);
      const { producto } = this.catalogo.productos.get(l.productId);
      return {
        ...l,
        nombre: nombrePedido(this.catalogo, l.productId),
        nombreTamano: nombreTamano(this.catalogo, l.tamano),
        nombresOpciones: opcionesDe(producto).map((g) => g.valores.find((v) => v.id === l.opciones[g.id]).nombre),
        nombresExtras: l.extras.map((id) => this.catalogo.extras.get(id).nombre),
        unitario,
        subtotal: unitario * l.cantidad,
      };
    });
  }

  get cantidad() {
    return this.#lineas.reduce((n, l) => n + l.cantidad, 0);
  }

  get total() {
    return this.lineas.reduce((suma, l) => suma + l.subtotal, 0);
  }

  get vacio() {
    return this.#lineas.length === 0;
  }

  toJSON() {
    return this.#lineas.map(({ productId, tamano, extras, opciones, cantidad }) => ({ productId, tamano, extras, opciones, cantidad }));
  }
}

export { MAX_CANTIDAD };
