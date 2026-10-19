import { buildCatalog, Cart, UNICO, MAX_CANTIDAD, tamanosDe, nombrePedido, nombreTamano, opcionesDe, precioUnitario } from './cart.js';
import { h } from './dom.js';
import { construirMensaje, enlaceWhatsApp, formatoPrecio, limpiarCliente, validarPedido } from './whatsapp.js';

const CLAVE_GUARDADO = 'amores-cafe:pedido:v1';
const escritorio = matchMedia('(min-width: 1024px)');
const $ = (id) => document.getElementById(id);

// localStorage puede no existir o lanzar error (modo privado, bloqueado): el carrito funciona igual.
const almacen = {
  leer() {
    try {
      return JSON.parse(localStorage.getItem(CLAVE_GUARDADO)) ?? {};
    } catch {
      return {};
    }
  },
  guardar(datos) {
    try {
      localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(datos));
    } catch {
      // Sin almacenamiento: el pedido vive solo mientras la página esté abierta.
    }
  },
};

async function cargarJSON(url) {
  const respuesta = await fetch(url, { cache: 'no-cache' });
  if (!respuesta.ok) throw new Error(`${url}: HTTP ${respuesta.status}`);
  return respuesta.json();
}

// ---------- Menú ----------

// Bebidas y comida se ven por separado, pero comparten un solo carrito y un solo pedido.
const GRUPOS = {
  bebidas: { subtitulo: 'Coffee & drinks' },
  comida: { subtitulo: 'Foodies & more' },
};
const grupoDe = (categoria) => (categoria.grupo === 'comida' ? 'comida' : 'bebidas');

// "1 pieza $70 · 2 piezas $120" si la opción cambia el precio; si no, "Elige proteína y salsa".
function resumenOpciones(producto) {
  const grupos = opcionesDe(producto);
  if (!grupos.length) return '';
  const conPrecio = grupos.filter((g) => g.valores.some((v) => v.precio));
  if (grupos.length === 1 && conPrecio.length === 1 && UNICO in producto.precios) {
    return grupos[0].valores.map((v) => `${v.nombre} ${formatoPrecio(producto.precios[UNICO] + (v.precio ?? 0))}`).join(' · ');
  }
  return `Elige ${grupos.map((g) => g.nombre.toLowerCase()).join(' y ')}`;
}

function columnasDe(catalogo, categoria) {
  const usadas = new Set(categoria.productos.flatMap(tamanosDe));
  return [...Object.keys(catalogo.tamanos), UNICO].filter((t) => usadas.has(t));
}

function descripcionPrecios(catalogo, producto) {
  return tamanosDe(producto)
    .map((t) => (t === UNICO ? '' : `${nombreTamano(catalogo, t)} `) + formatoPrecio(producto.precios[t]))
    .join(', ');
}

function renderCategorias(catalogo, grupo) {
  $('categorias').replaceChildren(
    ...catalogo.categorias.filter((c) => grupoDe(c) === grupo && c.productos.length).map((c) =>
      h('li', {}, h('a', { class: 'chip', href: `#cat-${c.id}`, dataset: { cat: c.id }, text: c.nombre })),
    ),
  );
}

function renderTemporada(catalogo) {
  const categoria = catalogo.categorias.find((c) => c.esTemporada);
  if (!categoria || categoria.productos.length === 0) return;

  const tarjetas = categoria.productos.map((p) =>
    h('li', { class: p.agotado ? 'tarjeta tarjeta--agotada' : 'tarjeta' },
      h('button', {
        class: 'tarjeta__boton',
        type: 'button',
        dataset: { id: p.id },
        disabled: Boolean(p.agotado),
        'aria-label': p.agotado
          ? `${p.nombre}: agotado`
          : `${p.nombre}, ${p.descripcion ?? ''}, ${formatoPrecio(p.precios[UNICO])}. Agregar al pedido`,
      },
        p.imagen && h('img', { class: 'tarjeta__foto', src: p.imagen, alt: '', loading: 'lazy', width: 702, height: 875 }),
        h('span', { class: 'tarjeta__info' },
          h('span', { class: 'tarjeta__nombre', text: p.nombre }),
          p.descripcion && h('span', { class: 'tarjeta__desc', text: p.descripcion }),
          h('span', { class: 'tarjeta__fila' },
            h('span', { class: 'tarjeta__precio', text: formatoPrecio(p.precios[UNICO]) }),
            h('span', { class: 'tarjeta__mas', 'aria-hidden': 'true', text: p.agotado ? 'Agotado' : 'Agregar' }),
          ),
        ),
      ),
    ),
  );

  $('temporada').dataset.grupoContenido = grupoDe(categoria);
  $('temporada').replaceChildren(
    h('section', { class: 'seccion seccion--temporada', id: `cat-${categoria.id}`, 'aria-labelledby': `t-${categoria.id}` },
      h('h2', { class: 'seccion__titulo', id: `t-${categoria.id}` }, h('span', { text: categoria.nombre })),
      categoria.descripcion && h('p', { class: 'seccion__leyenda', text: categoria.descripcion }),
      h('ul', { class: 'temporada' }, tarjetas),
    ),
  );
}

function renderSeccion(catalogo, categoria) {
  const columnas = columnasDe(catalogo, categoria);
  const letras = columnas.filter((t) => t !== UNICO);

  const filas = categoria.productos.map((p) =>
    h('button', {
      class: p.agotado ? 'producto producto--agotado' : 'producto',
      type: 'button',
      dataset: { id: p.id },
      disabled: Boolean(p.agotado),
      'aria-label': [
        `${p.nombre}${p.detalle ? ` ${p.detalle}` : ''}${p.descripcion ? `, ${p.descripcion}` : ''}`,
        p.agotado ? 'agotado' : [descripcionPrecios(catalogo, p), resumenOpciones(p), 'Agregar al pedido'].filter(Boolean).join('. '),
      ].join(': '),
    },
      h('span', { class: 'producto__nombre' },
        p.nombre,
        p.detalle && h('span', { class: 'producto__detalle', text: ` (${p.detalle})` }),
        p.agotado && h('span', { class: 'etiqueta-agotado', text: 'Agotado' }),
        p.descripcion && h('span', { class: 'producto__desc', text: p.descripcion }),
        resumenOpciones(p) && h('span', { class: 'producto__desc', text: resumenOpciones(p) }),
      ),
      columnas.map((t) => h('span', { class: 'producto__precio', text: t in p.precios ? String(p.precios[t]) : '—' })),
      h('span', { class: 'producto__mas', 'aria-hidden': 'true', text: p.agotado ? '' : '+' }),
    ),
  );

  const tabla = h('div', { class: 'tabla' },
    letras.length > 0 && h('div', { class: 'tabla__cabecera', 'aria-hidden': 'true' },
      h('span'),
      columnas.map((t) => h('span', { text: t === UNICO ? '' : t })),
      h('span'),
    ),
    filas,
  );
  tabla.style.setProperty('--cols', columnas.length);

  return h('section', {
    class: 'seccion', id: `cat-${categoria.id}`, 'aria-labelledby': `t-${categoria.id}`,
    dataset: { grupoContenido: grupoDe(categoria) },
  },
    h('h2', { class: 'seccion__titulo', id: `t-${categoria.id}` }, h('span', { text: categoria.nombre })),
    categoria.descripcion && h('p', { class: 'seccion__leyenda', text: categoria.descripcion }),
    letras.length > 0 && h('p', {
      class: 'seccion__leyenda',
      text: letras.map((t) => `${t} ${nombreTamano(catalogo, t).toLowerCase()}`).join(' · '),
    }),
    tabla,
  );
}

function renderSecciones(catalogo) {
  $('secciones').replaceChildren(
    ...catalogo.categorias.filter((c) => !c.esTemporada && c.productos.length).map((c) => renderSeccion(catalogo, c)),
  );
}

// Resalta la categoría visible en la barra de chips.
function observarCategorias(catalogo) {
  const lista = $('categorias');
  const visibles = new Set();
  let activa = null;

  const marcar = (id) => {
    if (id === activa) return;
    activa = id;
    for (const chip of lista.querySelectorAll('.chip')) {
      const es = chip.dataset.cat === id;
      chip.classList.toggle('chip--activo', es);
      if (es) {
        chip.setAttribute('aria-current', 'true');
        lista.scrollTo({ left: chip.offsetLeft - (lista.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
      } else {
        chip.removeAttribute('aria-current');
      }
    }
  };

  const observador = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      const id = e.target.id.slice(4);
      if (e.isIntersecting) visibles.add(id);
      else visibles.delete(id);
    }
    const primera = catalogo.categorias.find((c) => visibles.has(c.id));
    if (primera) marcar(primera.id);
  }, { rootMargin: '-35% 0px -55% 0px' });

  for (const c of catalogo.categorias) {
    const seccion = $(`cat-${c.id}`);
    if (seccion) observador.observe(seccion);
  }
  lista.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) marcar(chip.dataset.cat);
  });

  // Tras cambiar de grupo los chips son otros: se vuelve a marcar el visible.
  return {
    reiniciar() {
      activa = null;
      const primera = catalogo.categorias.find((c) => visibles.has(c.id) && !$(`cat-${c.id}`)?.closest('[hidden]'));
      marcar(primera?.id ?? lista.querySelector('.chip')?.dataset.cat);
    },
  };
}

function crearSelectorGrupos(catalogo, observador) {
  const botones = [...document.querySelectorAll('.grupo')];
  const hayComida = catalogo.categorias.some((c) => grupoDe(c) === 'comida' && c.productos.length);
  $('grupos').hidden = !hayComida;

  function aplicar(grupo, { desplazar = false } = {}) {
    for (const nodo of document.querySelectorAll('[data-grupo-contenido]')) {
      nodo.hidden = nodo.dataset.grupoContenido !== grupo;
    }
    for (const b of botones) b.setAttribute('aria-pressed', String(b.dataset.grupo === grupo));
    $('portada-sub').textContent = GRUPOS[grupo].subtitulo;
    renderCategorias(catalogo, grupo);
    if (desplazar && scrollY > $('menu').offsetTop) $('menu').scrollIntoView();
    requestAnimationFrame(() => observador.reiniciar());
  }

  for (const b of botones) b.addEventListener('click', () => aplicar(b.dataset.grupo, { desplazar: true }));
  return { aplicar };
}

// ---------- Aviso breve ----------

let temporizadorAviso;
function avisar(texto) {
  const aviso = $('aviso');
  aviso.textContent = texto;
  aviso.classList.add('aviso--visible');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => aviso.classList.remove('aviso--visible'), 2400);
}

// ---------- Hoja de producto ----------

function crearHoja(catalogo, carrito) {
  const dialogo = $('hoja');
  const form = $('hoja-form');
  const cuerpo = $('hoja-cuerpo');
  const botonAgregar = $('hoja-agregar');
  const salidaCantidad = $('hoja-cantidad');
  let actual = null; // { productId, cantidad }

  const seleccion = () => {
    const { producto } = catalogo.productos.get(actual.productId);
    const opciones = {};
    for (const g of opcionesDe(producto)) {
      const elegido = form.querySelector(`input[name="opcion-${CSS.escape(g.id)}"]:checked`);
      if (elegido) opciones[g.id] = elegido.value;
    }
    return {
      productId: actual.productId,
      tamano: form.querySelector('input[name="tamano"]:checked')?.value ?? tamanosDe(producto)[0],
      extras: [...form.querySelectorAll('input[name="extra"]:checked')].map((i) => i.value),
      opciones,
      cantidad: actual.cantidad,
    };
  };

  const actualizar = () => {
    const s = seleccion();
    salidaCantidad.textContent = String(s.cantidad);
    $('hoja-menos').disabled = s.cantidad <= 1;
    $('hoja-mas').disabled = s.cantidad >= MAX_CANTIDAD;
    botonAgregar.textContent = `Agregar · ${formatoPrecio(precioUnitario(catalogo, s) * s.cantidad)}`;
  };

  const opcion = (tipo, nombre, valor, etiqueta, precio, marcado) =>
    h('label', { class: 'opcion' },
      h('input', { type: tipo, name: nombre, value: valor, checked: marcado }),
      h('span', { class: 'opcion__nombre', text: etiqueta }),
      h('span', { class: 'opcion__precio', text: precio }),
    );

  function abrir(productId) {
    const { producto, categoria, extrasPermitidos } = catalogo.productos.get(productId);
    actual = { productId, cantidad: 1 };

    $('hoja-titulo').textContent = nombrePedido(catalogo, productId);
    $('hoja-desc').textContent = producto.descripcion ?? categoria.descripcion ?? categoria.nombre;

    const tamanos = tamanosDe(producto);
    const bloques = [];
    if (tamanos.length > 1) {
      bloques.push(h('fieldset', { class: 'opciones' },
        h('legend', { text: 'Tamaño' }),
        tamanos.map((t, i) => opcion('radio', 'tamano', t, nombreTamano(catalogo, t), formatoPrecio(producto.precios[t]), i === 0)),
      ));
    } else if (tamanos[0] !== UNICO) {
      bloques.push(h('p', { class: 'hoja__info', text: `Tamaño: ${nombreTamano(catalogo, tamanos[0])}` }));
    }
    for (const g of opcionesDe(producto)) {
      bloques.push(h('fieldset', { class: 'opciones', 'aria-describedby': `opcion-error-${g.id}` },
        h('legend', { text: `Elige ${g.nombre.toLowerCase()}` }),
        g.valores.map((v) => opcion('radio', `opcion-${g.id}`, v.id, v.nombre, v.precio ? `+${formatoPrecio(v.precio)}` : '', false)),
        h('p', { class: 'campo__error', id: `opcion-error-${g.id}`, 'aria-live': 'polite' }),
      ));
    }
    if (extrasPermitidos.length) {
      bloques.push(h('fieldset', { class: 'opciones' },
        h('legend', { text: 'Extras' }),
        extrasPermitidos.map((id) => {
          const extra = catalogo.extras.get(id);
          return opcion('checkbox', 'extra', id, extra.nombre, `+${formatoPrecio(extra.precio)}`, false);
        }),
      ));
    }
    cuerpo.replaceChildren(...bloques);
    cuerpo.hidden = bloques.length === 0;
    actualizar();
    dialogo.showModal();
  }

  form.addEventListener('change', (e) => {
    if (e.target.name?.startsWith('opcion-')) $(`opcion-error-${e.target.name.slice(7)}`).textContent = '';
    actualizar();
  });
  $('hoja-menos').addEventListener('click', () => {
    actual.cantidad = Math.max(1, actual.cantidad - 1);
    actualizar();
  });
  $('hoja-mas').addEventListener('click', () => {
    actual.cantidad = Math.min(MAX_CANTIDAD, actual.cantidad + 1);
    actualizar();
  });
  $('hoja-cerrar').addEventListener('click', () => dialogo.close());
  // Tocar fuera de la hoja la cierra.
  dialogo.addEventListener('click', (e) => {
    if (e.target === dialogo) dialogo.close();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = seleccion();
    const { producto } = catalogo.productos.get(s.productId);
    const faltan = opcionesDe(producto).filter((g) => !s.opciones[g.id]);
    if (faltan.length) {
      for (const g of faltan) $(`opcion-error-${g.id}`).textContent = `Elige ${g.nombre.toLowerCase()} para continuar.`;
      form.querySelector(`input[name="opcion-${CSS.escape(faltan[0].id)}"]`).focus();
      return;
    }
    carrito.add(s);
    dialogo.close();
    const detalles = [
      nombreTamano(catalogo, s.tamano),
      ...opcionesDe(producto).map((g) => g.valores.find((v) => v.id === s.opciones[g.id]).nombre),
    ].filter(Boolean);
    avisar(`Agregado: ${s.cantidad} × ${nombrePedido(catalogo, s.productId)}${detalles.length ? ` (${detalles.join(', ').toLowerCase()})` : ''}`);
  });

  return { abrir };
}

// ---------- Carrito ----------

function crearPanelCarrito(catalogo, carrito, guardado) {
  const panel = $('carrito');
  const lista = $('lineas');
  const form = $('form-pedido');
  const barra = $('barra');
  const velo = $('velo');
  const fondo = [document.querySelector('.portada'), document.querySelector('.categorias'), $('menu'), document.querySelector('.pie')];
  let abierto = false;
  let ultimoEnlace = '';

  // ----- Datos del cliente -----
  const leerCliente = () => ({
    nombre: form.nombre.value,
    entrega: form.entrega.value,
    direccion: form.direccion.value,
    notas: form.notas.value,
  });

  const guardar = () => almacen.guardar({ lineas: carrito.toJSON(), cliente: leerCliente() });

  const sincronizarEntrega = () => {
    const domicilio = form.entrega.value === 'domicilio';
    $('campo-direccion').hidden = !domicilio;
    $('total-nota').hidden = !domicilio;
  };

  const mostrarError = (campo, mensaje) => {
    const nodo = $(`${campo}-error`);
    if (nodo) nodo.textContent = mensaje ?? '';
    const control = campo === 'entrega' ? null : form.elements[campo];
    if (control instanceof HTMLElement) control.toggleAttribute('aria-invalid', Boolean(mensaje));
  };

  const c = guardado.cliente ?? {};
  form.nombre.value = c.nombre ?? '';
  form.direccion.value = c.direccion ?? '';
  form.notas.value = c.notas ?? '';
  if (c.entrega === 'llevar' || c.entrega === 'domicilio') form.entrega.value = c.entrega;
  sincronizarEntrega();

  form.addEventListener('input', (e) => {
    const campo = e.target.name;
    mostrarError(campo, '');
    if (campo === 'entrega') {
      mostrarError('direccion', '');
      sincronizarEntrega();
    }
    guardar();
  });

  // ----- Líneas -----
  const lineaItem = (l) => {
    const detalle = [l.nombreTamano, ...l.nombresOpciones, ...l.nombresExtras.map((n) => `+ ${n}`)].filter(Boolean).join(' · ');
    return h('li', { class: 'linea' },
      h('div', { class: 'linea__info' },
        h('p', { class: 'linea__nombre', text: l.nombre }),
        h('p', { class: 'linea__detalle', text: [detalle, `${formatoPrecio(l.unitario)} c/u`].filter(Boolean).join(' · ') }),
      ),
      h('div', { class: 'linea__acciones' },
        h('div', { class: 'contador contador--chico', role: 'group', 'aria-label': `Cantidad de ${l.nombre}` },
          h('button', { class: 'contador__boton', type: 'button', dataset: { accion: 'menos', key: l.key }, 'aria-label': l.cantidad === 1 ? `Quitar ${l.nombre}` : `Quitar uno de ${l.nombre}`, text: '−' }),
          h('span', { class: 'contador__valor', text: String(l.cantidad) }),
          h('button', { class: 'contador__boton', type: 'button', dataset: { accion: 'mas', key: l.key }, 'aria-label': `Agregar uno de ${l.nombre}`, disabled: l.cantidad >= MAX_CANTIDAD, text: '+' }),
        ),
        h('span', { class: 'linea__subtotal', text: formatoPrecio(l.subtotal) }),
      ),
    );
  };

  const render = () => {
    // Conserva el foco en el botón que se tocó aunque la lista se vuelva a dibujar.
    const enfocado = document.activeElement?.dataset;
    const foco = enfocado?.key ? { key: enfocado.key, accion: enfocado.accion } : null;

    const lineas = carrito.lineas;
    lista.replaceChildren(...lineas.map(lineaItem));
    $('carrito-vacio').hidden = lineas.length > 0;
    lista.hidden = lineas.length === 0;
    $('total').textContent = formatoPrecio(carrito.total);
    $('barra-cuenta').textContent = String(carrito.cantidad);
    $('barra-total').textContent = formatoPrecio(carrito.total);
    barra.setAttribute('aria-label', `Ver pedido: ${carrito.cantidad} ${carrito.cantidad === 1 ? 'bebida' : 'bebidas'}, ${formatoPrecio(carrito.total)}`);
    barra.hidden = carrito.vacio;
    if (lineas.length) mostrarError('lineas', '');

    if (foco) {
      const mismo = lista.querySelector(`[data-key="${CSS.escape(foco.key)}"][data-accion="${foco.accion}"]:not(:disabled)`)
        ?? lista.querySelector(`[data-key="${CSS.escape(foco.key)}"]`);
      (mismo ?? $('carrito-titulo')).focus();
    }
    guardar();
  };

  lista.addEventListener('click', (e) => {
    const boton = e.target.closest('[data-accion]');
    if (!boton) return;
    const linea = carrito.lineas.find((l) => l.key === boton.dataset.key);
    if (!linea) return;
    carrito.setCantidad(linea.key, linea.cantidad + (boton.dataset.accion === 'mas' ? 1 : -1));
  });

  carrito.onChange(render);
  render();

  // ----- Hoja en celular / panel en escritorio -----
  const sincronizarModo = () => {
    if (escritorio.matches) {
      if (abierto) cerrar({ devolverFoco: false });
      panel.inert = false;
    } else {
      panel.inert = !abierto;
    }
  };

  function abrir() {
    if (escritorio.matches) {
      $('carrito-titulo').focus();
      return;
    }
    abierto = true;
    panel.inert = false;
    panel.classList.add('carrito--abierto');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    velo.hidden = false;
    document.body.classList.add('sin-scroll');
    fondo.forEach((n) => { n.inert = true; });
    barra.setAttribute('aria-expanded', 'true');
    $('carrito-titulo').focus();
  }

  function cerrar({ devolverFoco = true } = {}) {
    abierto = false;
    panel.classList.remove('carrito--abierto');
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    velo.hidden = true;
    document.body.classList.remove('sin-scroll');
    fondo.forEach((n) => { n.inert = false; });
    barra.setAttribute('aria-expanded', 'false');
    panel.inert = !escritorio.matches;
    if (devolverFoco) (barra.hidden ? $('menu') : barra).focus({ preventScroll: true });
  }

  barra.addEventListener('click', abrir);
  $('carrito-cerrar').addEventListener('click', () => cerrar());
  velo.addEventListener('click', () => cerrar());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && abierto && !$('hoja').open) cerrar();
  });
  escritorio.addEventListener('change', sincronizarModo);
  sincronizarModo();

  // ----- Envío -----
  const mostrarEnviado = (si) => {
    $('enviado').hidden = !si;
    form.hidden = si;
    lista.hidden = si || carrito.vacio;
    $('carrito-vacio').hidden = si || !carrito.vacio;
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const cliente = leerCliente();
    const errores = validarPedido(cliente, carrito.lineas.length);
    for (const campo of ['lineas', 'nombre', 'entrega', 'direccion']) mostrarError(campo, errores[campo]);
    const primero = ['nombre', 'entrega', 'direccion'].find((campo) => errores[campo]);
    if (primero) {
      const control = primero === 'entrega' ? form.querySelector('input[name="entrega"]') : form.elements[primero];
      control.focus();
      return;
    }
    if (errores.lineas) return;

    const mensaje = construirMensaje({
      negocio: catalogo.config.negocio,
      lineas: carrito.lineas,
      total: carrito.total,
      cliente: limpiarCliente(cliente),
    });
    ultimoEnlace = enlaceWhatsApp(catalogo.config.whatsapp, mensaje);
    $('enviado-reabrir').href = ultimoEnlace;

    const ventana = window.open(ultimoEnlace, '_blank');
    if (ventana) ventana.opener = null;
    else location.href = ultimoEnlace;

    mostrarEnviado(true);
    document.querySelector('#enviado .enviado__titulo').focus?.();
  });

  $('enviado-vaciar').addEventListener('click', () => {
    form.notas.value = '';
    carrito.clear();
    mostrarEnviado(false);
    cerrar();
    avisar('Listo. Puedes armar otro pedido.');
  });
  $('enviado-volver').addEventListener('click', () => {
    mostrarEnviado(false);
    $('carrito-titulo').focus();
  });

  return { abrir, cerrar };
}

// ---------- Inicio ----------

async function iniciar() {
  const estado = $('estado');
  let menu;
  let temporada = null;

  const [m, t] = await Promise.allSettled([cargarJSON('menu.json'), cargarJSON('menu-temporada.json')]);
  if (m.status === 'rejected') {
    console.error(m.reason);
    estado.textContent = 'No pudimos cargar el menú. Revisa tu conexión y vuelve a cargar la página.';
    estado.classList.add('estado--error');
    return;
  }
  menu = m.value;
  if (t.status === 'fulfilled') temporada = t.value;
  else console.warn('Menú de temporada no disponible:', t.reason);

  const catalogo = buildCatalog(menu, temporada);
  const guardado = almacen.leer();
  const carrito = new Cart(catalogo, Array.isArray(guardado.lineas) ? guardado.lineas : []);

  renderTemporada(catalogo);
  renderSecciones(catalogo);
  estado.hidden = true;

  const hoja = crearHoja(catalogo, carrito);
  crearPanelCarrito(catalogo, carrito, guardado);
  const selector = crearSelectorGrupos(catalogo, observarCategorias(catalogo));

  // Un enlace directo a una categoría (#cat-frios) llega antes de que existan las secciones.
  const destino = location.hash.startsWith('#cat-')
    ? catalogo.categorias.find((c) => `#cat-${c.id}` === location.hash)
    : null;
  selector.aplicar(destino ? grupoDe(destino) : 'bebidas');

  $('menu').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-id]');
    if (boton) hoja.abrir(boton.dataset.id);
  });

  if (destino) $(`cat-${destino.id}`)?.scrollIntoView();

  document.documentElement.classList.add('listo');
}

iniciar();
