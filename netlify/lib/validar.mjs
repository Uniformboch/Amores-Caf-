// Valida el menú antes de guardarlo. Devuelve la lista de errores; vacía si se puede publicar.

const RE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_TAMANO = /^[A-Z]{1,3}$/;
// Fotos que vienen con el sitio (assets/temporada) o subidas desde el panel (fotos/).
export const RE_FOTO = /^(?:assets\/temporada|fotos)\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpg|jpeg|png|webp)$/;

const CAMPOS_PRODUCTO = new Set(['id', 'nombre', 'detalle', 'descripcion', 'precios', 'extrasPermitidos', 'opciones', 'agotado', 'disponible', 'imagen']);
const CAMPOS_CATEGORIA = new Set(['id', 'nombre', 'grupo', 'descripcion', 'prefijoPedido', 'extrasPermitidos', 'productos']);
const GRUPOS = new Set(['bebidas', 'comida']);
const MAX_GRUPOS_OPCIONES = 5;
const MAX_VALORES_OPCION = 15;

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const esEntero = (v) => Number.isInteger(v);
const desconocidos = (obj, permitidos) => Object.keys(obj).filter((k) => !permitidos.has(k));

function texto(errores, valor, donde, maximo, requerido = true) {
  if (valor === undefined && !requerido) return;
  if (typeof valor !== 'string' || (requerido && !valor.trim())) errores.push(`${donde}: falta el texto.`);
  else if (valor.length > maximo) errores.push(`${donde}: máximo ${maximo} caracteres.`);
}

function validarOpciones(errores, opciones, lugar) {
  if (!Array.isArray(opciones) || opciones.length > MAX_GRUPOS_OPCIONES) {
    errores.push(`${lugar}: opciones inválidas (máximo ${MAX_GRUPOS_OPCIONES}).`);
    return;
  }
  const idsGrupo = new Set();
  for (const g of opciones) {
    if (!esObjeto(g) || desconocidos(g, new Set(['id', 'nombre', 'valores'])).length) {
      errores.push(`${lugar}: una opción tiene formato inválido.`);
      continue;
    }
    const nombre = typeof g.nombre === 'string' ? g.nombre : '?';
    if (typeof g.id !== 'string' || !RE_ID.test(g.id) || idsGrupo.has(g.id)) {
      errores.push(`${lugar} › ${nombre}: id de opción inválido o repetido.`);
    } else {
      idsGrupo.add(g.id);
    }
    texto(errores, g.nombre, `${lugar} › nombre de la opción`, 40);
    if (!Array.isArray(g.valores) || g.valores.length < 2 || g.valores.length > MAX_VALORES_OPCION) {
      errores.push(`${lugar} › ${nombre}: necesita entre 2 y ${MAX_VALORES_OPCION} valores para elegir.`);
      continue;
    }
    const idsValor = new Set();
    for (const v of g.valores) {
      if (!esObjeto(v) || desconocidos(v, new Set(['id', 'nombre', 'precio'])).length) {
        errores.push(`${lugar} › ${nombre}: un valor tiene formato inválido.`);
        continue;
      }
      if (typeof v.id !== 'string' || !RE_ID.test(v.id) || idsValor.has(v.id)) {
        errores.push(`${lugar} › ${nombre}: id de valor inválido o repetido.`);
      } else {
        idsValor.add(v.id);
      }
      texto(errores, v.nombre, `${lugar} › ${nombre} › valor`, 40);
      if ('precio' in v && (!esEntero(v.precio) || v.precio < 0 || v.precio > 9999)) {
        errores.push(`${lugar} › ${nombre}: el precio extra debe ser un número entero entre 0 y 9999.`);
      }
    }
  }
}

function validarCategoria(errores, cat, donde, tamanos, extras, ids, fotoExiste) {
  if (!esObjeto(cat)) {
    errores.push(`${donde}: formato inválido.`);
    return;
  }
  for (const campo of desconocidos(cat, CAMPOS_CATEGORIA)) errores.push(`${donde}: campo desconocido «${campo}».`);
  if (typeof cat.id !== 'string' || !RE_ID.test(cat.id)) errores.push(`${donde}: id inválido.`);
  texto(errores, cat.nombre, `${donde} › nombre`, 40);
  texto(errores, cat.descripcion, `${donde} › descripción`, 80, false);
  texto(errores, cat.prefijoPedido, `${donde} › prefijo`, 20, false);
  if ('grupo' in cat && !GRUPOS.has(cat.grupo)) errores.push(`${donde}: el grupo debe ser «bebidas» o «comida».`);
  const permitidos = cat.extrasPermitidos ?? [];
  if (!Array.isArray(permitidos) || permitidos.some((e) => !extras.has(e))) {
    errores.push(`${donde}: extras permitidos inválidos.`);
  }

  if (!Array.isArray(cat.productos)) {
    errores.push(`${donde}: falta la lista de productos.`);
    return;
  }
  cat.productos.forEach((p, i) => {
    if (!esObjeto(p)) {
      errores.push(`${donde} › ${i + 1}: formato inválido.`);
      return;
    }
    const lugar = `${cat.nombre ?? donde} › ${p.nombre || `producto ${i + 1}`}`;
    for (const campo of desconocidos(p, CAMPOS_PRODUCTO)) errores.push(`${lugar}: campo desconocido «${campo}».`);
    if (typeof p.id !== 'string' || !RE_ID.test(p.id) || p.id.length > 60) errores.push(`${lugar}: id inválido.`);
    else if (ids.has(p.id)) errores.push(`${lugar}: id repetido «${p.id}».`);
    else ids.add(p.id);
    texto(errores, p.nombre, `${lugar} › nombre`, 60);
    texto(errores, p.detalle, `${lugar} › detalle`, 40, false);
    texto(errores, p.descripcion, `${lugar} › descripción`, 120, false);

    if (!esObjeto(p.precios) || !Object.keys(p.precios).length) {
      errores.push(`${lugar}: necesita al menos un precio.`);
    } else {
      if ('unico' in p.precios && Object.keys(p.precios).length > 1) {
        errores.push(`${lugar}: precio único no se combina con tamaños.`);
      }
      for (const [tam, precio] of Object.entries(p.precios)) {
        if (tam !== 'unico' && !(tam in tamanos)) errores.push(`${lugar}: tamaño desconocido «${tam}».`);
        if (!esEntero(precio) || precio < 1 || precio > 9999) {
          errores.push(`${lugar}: el precio debe ser un número entero entre 1 y 9999.`);
        }
      }
    }

    if ('extrasPermitidos' in p && (!Array.isArray(p.extrasPermitidos) || p.extrasPermitidos.some((e) => !extras.has(e)))) {
      errores.push(`${lugar}: extras inválidos.`);
    }
    if ('opciones' in p) validarOpciones(errores, p.opciones, lugar);
    for (const bandera of ['agotado', 'disponible']) {
      if (bandera in p && typeof p[bandera] !== 'boolean') errores.push(`${lugar}: «${bandera}» debe ser sí/no.`);
    }
    if ('imagen' in p) {
      if (typeof p.imagen !== 'string' || !RE_FOTO.test(p.imagen)) errores.push(`${lugar}: ruta de foto inválida.`);
      else if (!fotoExiste(p.imagen)) errores.push(`${lugar}: la foto ${p.imagen} no existe.`);
    }
  });
}

// fotoExiste(ruta) → boolean: el llamador decide cómo comprobarlo (Blobs, disco…).
export function validar(menu, temporada, fotoExiste = () => true) {
  const errores = [];
  if (!esObjeto(menu)) return ['El menú no tiene un formato válido.'];

  if (!esObjeto(menu.config)) {
    errores.push('Falta la configuración.');
  } else {
    texto(errores, menu.config.negocio, 'Nombre del negocio', 60);
    if (typeof menu.config.whatsapp !== 'string' || !/^\d{10,15}$/.test(menu.config.whatsapp)) {
      errores.push('WhatsApp: escribe el número con lada de país, solo dígitos (ej. 524771234567).');
    }
  }

  let tamanos = menu.tamanos;
  if (!esObjeto(tamanos) || !Object.entries(tamanos).every(([k, v]) => RE_TAMANO.test(k) && esObjeto(v) && typeof v.nombre === 'string')) {
    errores.push('Los tamaños no tienen un formato válido.');
    tamanos = {};
  }

  const extras = new Set();
  if (!Array.isArray(menu.extras)) {
    errores.push('Falta la lista de extras.');
  } else {
    menu.extras.forEach((e, i) => {
      const lugar = `Extra ${(esObjeto(e) && e.nombre) || i + 1}`;
      if (!esObjeto(e) || desconocidos(e, new Set(['id', 'nombre', 'precio'])).length) {
        errores.push(`${lugar}: formato inválido.`);
        return;
      }
      if (typeof e.id !== 'string' || !RE_ID.test(e.id) || extras.has(e.id)) errores.push(`${lugar}: id inválido o repetido.`);
      else extras.add(e.id);
      texto(errores, e.nombre, `${lugar} › nombre`, 40);
      if (!esEntero(e.precio) || e.precio < 0 || e.precio > 999) {
        errores.push(`${lugar}: el precio debe ser un número entero entre 0 y 999.`);
      }
    });
  }

  const ids = new Set();
  const idsCategoria = new Set();
  if (!Array.isArray(menu.categorias) || !menu.categorias.length) {
    errores.push('Faltan las categorías.');
  } else {
    menu.categorias.forEach((cat, i) => {
      validarCategoria(errores, cat, `Categoría ${i + 1}`, tamanos, extras, ids, fotoExiste);
      if (esObjeto(cat)) {
        if (idsCategoria.has(cat.id)) errores.push(`Categoría ${cat.nombre}: id repetido.`);
        idsCategoria.add(cat.id);
      }
    });
  }

  if (!esObjeto(temporada)) {
    errores.push('El menú de temporada no tiene un formato válido.');
  } else {
    if (desconocidos(temporada, new Set(['version', 'activa', 'categoria'])).length) errores.push('Temporada: campos desconocidos.');
    if (typeof temporada.activa !== 'boolean') errores.push('Temporada: falta indicar si está activa.');
    validarCategoria(errores, temporada.categoria, 'Temporada', tamanos, extras, ids, fotoExiste);
    for (const p of temporada.categoria?.productos ?? []) {
      if (esObjeto(p) && esObjeto(p.precios) && (Object.keys(p.precios).length !== 1 || !('unico' in p.precios))) {
        errores.push(`Temporada › ${p.nombre}: las bebidas de temporada llevan precio único.`);
      }
    }
  }
  return errores;
}
