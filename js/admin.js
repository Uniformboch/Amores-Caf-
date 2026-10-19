import { h } from './dom.js';
import { formatoPrecio } from './whatsapp.js';

const $ = (id) => document.getElementById(id);
const estado = { menu: null, temporada: null, version: null, sucio: false, vista: 'bebidas' };

// ---------- Servidor ----------

class ErrorApi extends Error {
  constructor(mensaje, codigo, datos = {}) {
    super(mensaje);
    this.codigo = codigo;
    this.datos = datos;
  }
}

async function api(ruta, { metodo = 'GET', json, blob } = {}) {
  const headers = { 'X-Amores': '1' };
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (blob) {
    headers['Content-Type'] = blob.type;
    body = blob;
  }
  let respuesta;
  try {
    respuesta = await fetch(ruta, { method: metodo, headers, body, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ErrorApi('No hay conexión. Revisa tu internet e intenta de nuevo.', 0);
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    if (respuesta.status === 401 && ruta !== '/api/login') {
      mostrarLogin('Tu sesión terminó. Vuelve a entrar; tus cambios siguen aquí.');
    }
    throw new ErrorApi(datos.error ?? `Error ${respuesta.status}`, respuesta.status, datos);
  }
  return datos;
}

// ---------- Utilidades ----------

function slug(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'bebida';
}

function todasLasCategorias() {
  return [...estado.menu.categorias, estado.temporada.categoria];
}

function idsUsados() {
  return new Set(todasLasCategorias().flatMap((c) => c.productos.map((p) => p.id)));
}

function generarId(categoria, nombre) {
  const base = categoria.prefijoPedido ? `${slug(categoria.prefijoPedido)}-${slug(nombre)}` : slug(nombre);
  const usados = idsUsados();
  let id = base;
  for (let n = 2; usados.has(id); n++) id = `${base}-${n}`;
  return id;
}

function resumenPrecios(p) {
  const precios = Object.entries(p.precios)
    .map(([t, v]) => (t === 'unico' ? formatoPrecio(v) : `${t} ${formatoPrecio(v)}`))
    .join(' · ');
  return p.opciones?.length ? `${precios} · elige ${p.opciones.map((g) => g.nombre.toLowerCase()).join(' y ')}` : precios;
}

function idUnico(base, usados) {
  let id = base;
  for (let n = 2; usados.has(id); n++) id = `${base}-${n}`;
  return id;
}

function precioValido(valor) {
  return /^\d{1,4}$/.test(String(valor).trim()) && Number(valor) >= 1;
}

function mismosElementos(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

let temporizadorAviso;
function avisar(texto) {
  const aviso = $('aviso');
  aviso.textContent = texto;
  aviso.classList.add('aviso--visible');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => aviso.classList.remove('aviso--visible'), 3000);
}

function interruptor({ etiqueta, etiquetaAccesible, marcado, alerta = false, alCambiar }) {
  return h('label', { class: alerta ? 'interruptor interruptor--alerta' : 'interruptor' },
    h('input', {
      type: 'checkbox',
      role: 'switch',
      checked: Boolean(marcado),
      'aria-label': etiquetaAccesible ?? etiqueta,
      onchange: (e) => alCambiar(e.target.checked),
    }),
    h('span', { class: 'interruptor__pista', 'aria-hidden': 'true' }),
    h('span', { class: 'interruptor__texto', 'aria-hidden': 'true', text: etiqueta }),
  );
}

// ---------- Pantallas ----------

function mostrar(pantalla) {
  for (const id of ['pantalla-carga', 'pantalla-login', 'pantalla-panel']) $(id).hidden = id !== pantalla;
  $('barra-guardar').hidden = pantalla !== 'pantalla-panel' || !estado.sucio;
}

function mostrarLogin(mensaje = '') {
  if ($('editor').open) $('editor').close();
  mostrar('pantalla-login');
  $('login-error').textContent = mensaje;
  $('contrasena').value = '';
  $('contrasena').focus();
}

function marcarSucio() {
  estado.sucio = true;
  $('barra-guardar').hidden = false;
}

function mostrarErrores(mensaje, lista = [], { recargar = false } = {}) {
  const caja = $('errores');
  caja.replaceChildren(...[
    h('p', { class: 'admin-errores__titulo', text: mensaje }),
    lista.length > 0 && h('ul', {}, lista.map((e) => h('li', { text: e }))),
    recargar && h('p', { text: 'Al recargar se pierden los cambios que no guardaste; tendrás que volver a hacerlos.' }),
    recargar && h('button', { class: 'boton boton--chico', type: 'button', onclick: () => cargar(), text: 'Recargar menú' }),
  ].filter(Boolean));
  caja.hidden = false;
  caja.focus();
  caja.scrollIntoView({ block: 'nearest' });
}

function ocultarErrores() {
  $('errores').hidden = true;
}

async function cargar() {
  const datos = await api('/api/menu');
  estado.menu = datos.menu;
  estado.temporada = datos.temporada;
  estado.version = datos.version;
  estado.sucio = false;
  ocultarErrores();
  mostrar('pantalla-panel');
  render();
}

// ---------- Validación antes de publicar ----------

function validarLocal() {
  const errores = [];
  const tel = estado.menu.config.whatsapp;
  if (!/^52\d{10}$/.test(tel)) errores.push('Ajustes: el número de WhatsApp debe tener 10 dígitos.');
  for (const e of estado.menu.extras) {
    if (!e.nombre?.trim()) errores.push('Extras: hay un extra sin nombre.');
    if (!Number.isInteger(e.precio) || e.precio < 0 || e.precio > 999) {
      errores.push(`Extras › ${e.nombre || 'sin nombre'}: precio inválido.`);
    }
  }
  return errores;
}

async function guardar() {
  const locales = validarLocal();
  if (locales.length) {
    mostrarErrores('Revisa estos datos antes de guardar.', locales);
    return;
  }
  const boton = $('guardar');
  boton.disabled = true;
  boton.textContent = 'Guardando…';
  try {
    const r = await api('/api/menu', {
      metodo: 'PUT',
      json: { menu: estado.menu, temporada: estado.temporada, version: estado.version },
    });
    estado.version = r.version;
    estado.sucio = false;
    $('barra-guardar').hidden = true;
    ocultarErrores();
    avisar('Listo: el menú ya muestra los cambios.');
  } catch (e) {
    if (e.codigo === 401) return;
    mostrarErrores(e.message, e.datos.errores ?? [], { recargar: e.codigo === 409 });
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar';
  }
}

// ---------- Vistas ----------

function filaProducto(categoria, p, esTemporada) {
  const fila = h('li', { class: p.agotado ? 'fila fila--agotada' : 'fila' },
    h('button', {
      class: 'fila__principal',
      type: 'button',
      'aria-label': `Editar ${p.nombre}`,
      onclick: () => abrirEditor(categoria, p, esTemporada),
    },
      p.imagen && h('img', { class: 'fila__foto', src: p.imagen, alt: '', loading: 'lazy' }),
      h('span', { class: 'fila__textos' },
        h('span', { class: 'fila__nombre', text: p.detalle ? `${p.nombre} (${p.detalle})` : p.nombre }),
        h('span', { class: 'fila__precios', text: resumenPrecios(p) }),
      ),
    ),
    interruptor({
      etiqueta: 'Agotado',
      etiquetaAccesible: `${p.nombre} agotado`,
      marcado: p.agotado,
      alerta: true,
      alCambiar: (valor) => {
        if (valor) p.agotado = true;
        else delete p.agotado;
        fila.classList.toggle('fila--agotada', valor);
        marcarSucio();
        avisar(`${p.nombre}: ${valor ? 'agotado' : 'disponible'}. Toca Guardar para publicarlo.`);
      },
    }),
  );
  return fila;
}

function seccionCategoria(categoria, esTemporada) {
  return h('section', { class: 'admin-seccion' },
    h('h2', { class: 'seccion__titulo' }, h('span', { text: categoria.nombre })),
    categoria.productos.length
      ? h('ul', { class: 'filas' }, categoria.productos.map((p) => filaProducto(categoria, p, esTemporada)))
      : h('p', { class: 'admin-vacio', text: 'Todavía no hay productos aquí.' }),
    h('button', {
      class: 'boton boton--agregar',
      type: 'button',
      onclick: () => abrirEditor(categoria, null, esTemporada),
      text: esTemporada ? '+ Agregar bebida de temporada' : `+ Agregar a ${categoria.nombre}`,
    }),
  );
}

const esComida = (categoria) => categoria.grupo === 'comida';

function vistaBebidas() {
  return [
    h('p', { class: 'admin-ayuda', text: 'Toca una bebida para cambiar su nombre o precios. El interruptor la marca como agotada.' }),
    ...estado.menu.categorias.filter((c) => !esComida(c)).map((c) => seccionCategoria(c, false)),
  ];
}

function vistaComida() {
  return [
    h('p', { class: 'admin-ayuda', text: 'Toca un producto para cambiar nombre, descripción, precio u opciones (como la proteína y la salsa de los chilaquiles). El interruptor lo marca como agotado.' }),
    ...estado.menu.categorias.filter(esComida).map((c) => seccionCategoria(c, false)),
  ];
}

function vistaTemporada() {
  return [
    h('div', { class: 'tarjeta-ajuste' },
      h('div', {},
        h('p', { class: 'tarjeta-ajuste__titulo', text: 'Mostrar temporada en el menú' }),
        h('p', { class: 'tarjeta-ajuste__desc', text: 'Apágalo para ocultar toda la sección sin borrar las bebidas.' }),
      ),
      interruptor({
        etiqueta: estado.temporada.activa ? 'Visible' : 'Oculta',
        etiquetaAccesible: 'Mostrar la sección de temporada en el menú',
        marcado: estado.temporada.activa,
        alCambiar: (valor) => {
          estado.temporada.activa = valor;
          marcarSucio();
          render();
        },
      }),
    ),
    seccionCategoria(estado.temporada.categoria, true),
  ];
}

function vistaExtras() {
  const filas = estado.menu.extras.map((extra) => {
    const errorPrecio = h('p', { class: 'campo__error' });
    return h('li', { class: 'extra-fila' },
      h('div', { class: 'campo' },
        h('label', { for: `extra-nombre-${extra.id}`, text: 'Nombre' }),
        h('input', {
          id: `extra-nombre-${extra.id}`, type: 'text', value: extra.nombre, maxlength: 40,
          oninput: (e) => { extra.nombre = e.target.value; marcarSucio(); },
        }),
      ),
      h('div', { class: 'campo' },
        h('label', { for: `extra-precio-${extra.id}`, text: 'Precio' }),
        h('span', { class: 'campo-precio' },
          h('input', {
            id: `extra-precio-${extra.id}`, type: 'text', inputmode: 'numeric', value: String(extra.precio), maxlength: 3,
            oninput: (e) => {
              const ok = /^\d{1,3}$/.test(e.target.value.trim());
              extra.precio = ok ? Number(e.target.value) : NaN;
              e.target.toggleAttribute('aria-invalid', !ok);
              errorPrecio.textContent = ok ? '' : 'Número entero de 0 a 999.';
              marcarSucio();
            },
          }),
        ),
        errorPrecio,
      ),
      h('button', {
        class: 'boton-icono boton-icono--peligro', type: 'button', 'aria-label': `Eliminar extra ${extra.nombre}`,
        onclick: () => eliminarExtra(extra),
      }, iconoBasura()),
      h('fieldset', { class: 'extra-fila__aplica' },
        h('legend', { text: 'Se ofrece en' }),
        h('div', { class: 'chips-check' },
          estado.menu.categorias.map((c) => h('label', { class: 'chip-check' },
            h('input', {
              type: 'checkbox',
              checked: c.extrasPermitidos.includes(extra.id),
              onchange: (e) => {
                c.extrasPermitidos = e.target.checked
                  ? estado.menu.extras.map((x) => x.id).filter((id) => id === extra.id || c.extrasPermitidos.includes(id))
                  : c.extrasPermitidos.filter((id) => id !== extra.id);
                marcarSucio();
              },
            }),
            h('span', { text: c.nombre }),
          )),
        ),
        h('p', { class: 'campo__nota', text: 'Algunas bebidas tienen su propia lista (por ejemplo, el Americano no lleva leche). Ajústalas desde Bebidas.' }),
      ),
    );
  });

  return [
    h('p', { class: 'admin-ayuda', text: 'Los extras se suman al precio de la bebida.' }),
    h('ul', { class: 'filas' }, filas),
    h('button', {
      class: 'boton boton--agregar', type: 'button', text: '+ Agregar extra',
      onclick: () => {
        const id = `extra-${Date.now().toString(36)}`;
        estado.menu.extras.push({ id, nombre: '', precio: 0 });
        marcarSucio();
        render();
        $(`extra-nombre-${id}`)?.focus();
      },
    }),
  ];
}

function iconoBasura() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const trazo = document.createElementNS(ns, 'path');
  trazo.setAttribute('d', 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13');
  svg.append(trazo);
  return svg;
}

function eliminarExtra(extra) {
  if (!confirm(`¿Eliminar el extra «${extra.nombre || 'sin nombre'}»? Se quitará de todas las bebidas.`)) return;
  estado.menu.extras = estado.menu.extras.filter((e) => e !== extra);
  for (const c of todasLasCategorias()) {
    c.extrasPermitidos = (c.extrasPermitidos ?? []).filter((id) => id !== extra.id);
    for (const p of c.productos) {
      if (p.extrasPermitidos) p.extrasPermitidos = p.extrasPermitidos.filter((id) => id !== extra.id);
    }
  }
  marcarSucio();
  render();
}

function vistaAjustes() {
  const config = estado.menu.config;
  const local = config.whatsapp.startsWith('52') ? config.whatsapp.slice(2) : config.whatsapp;
  const errorTel = h('p', { class: 'campo__error', id: 'tel-error' });
  const listaRespaldos = h('ul', { class: 'filas', id: 'respaldos' });

  return [
    h('section', { class: 'admin-seccion' },
      h('h2', { class: 'seccion__titulo' }, h('span', { text: 'WhatsApp' })),
      h('div', { class: 'campo' },
        h('label', { for: 'telefono', text: 'Número que recibe los pedidos' }),
        h('span', { class: 'campo-telefono' },
          h('span', { class: 'campo-telefono__lada', 'aria-hidden': 'true', text: '+52' }),
          h('input', {
            id: 'telefono', type: 'tel', inputmode: 'numeric', autocomplete: 'off', maxlength: 14, value: local,
            'aria-describedby': 'tel-nota tel-error',
            oninput: (e) => {
              const digitos = e.target.value.replace(/\D/g, '');
              const ok = digitos.length === 10;
              config.whatsapp = `52${digitos}`;
              e.target.toggleAttribute('aria-invalid', !ok);
              errorTel.textContent = ok ? '' : 'Deben ser 10 dígitos.';
              marcarSucio();
            },
          }),
        ),
        h('p', { class: 'campo__nota', id: 'tel-nota', text: '10 dígitos, sin espacios. Ejemplo: 4771234567.' }),
        errorTel,
      ),
    ),
    h('section', { class: 'admin-seccion' },
      h('h2', { class: 'seccion__titulo' }, h('span', { text: 'Respaldos' })),
      h('p', { class: 'admin-ayuda', text: 'Cada vez que guardas se hace una copia del menú anterior. Si algo salió mal, regresa a una versión previa.' }),
      h('button', { class: 'boton boton--chico', type: 'button', text: 'Ver respaldos', onclick: () => cargarRespaldos(listaRespaldos) }),
      listaRespaldos,
    ),
    h('section', { class: 'admin-seccion' },
      h('h2', { class: 'seccion__titulo' }, h('span', { text: 'Contraseña' })),
      h('p', { class: 'admin-ayuda' },
        'Para cambiarla, en la computadora ejecuta ',
        h('code', { text: 'npm run crear-hash' }),
        ', copia los dos valores en Netlify (Site configuration → Environment variables) y vuelve a publicar el sitio.',
      ),
    ),
  ];
}

async function cargarRespaldos(lista) {
  lista.replaceChildren(h('li', { class: 'admin-vacio', text: 'Cargando…' }));
  try {
    const { respaldos } = await api('/api/respaldos');
    if (!respaldos.length) {
      lista.replaceChildren(h('li', { class: 'admin-vacio', text: 'Aún no hay respaldos. Se crean al guardar.' }));
      return;
    }
    const formato = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
    lista.replaceChildren(...respaldos.slice(0, 20).map((r) => {
      const fecha = formato.format(new Date(r.fecha));
      return h('li', { class: 'fila fila--respaldo' },
        h('span', { class: 'fila__nombre', text: fecha }),
        h('button', {
          class: 'boton boton--chico', type: 'button', text: 'Restaurar', 'aria-label': `Restaurar el menú del ${fecha}`,
          onclick: () => restaurar(r.id, fecha),
        }),
      );
    }));
  } catch (e) {
    if (e.codigo !== 401) lista.replaceChildren(h('li', { class: 'campo__error', text: e.message }));
  }
}

async function restaurar(id, fecha) {
  const aviso = estado.sucio ? ' Perderás también los cambios que no has guardado.' : '';
  if (!confirm(`¿Regresar el menú a como estaba el ${fecha}?${aviso}`)) return;
  try {
    await api('/api/respaldos/restaurar', { metodo: 'POST', json: { id } });
    await cargar();
    avisar(`Menú restaurado: ${fecha}`);
  } catch (e) {
    if (e.codigo !== 401) mostrarErrores(e.message);
  }
}

const VISTAS = { bebidas: vistaBebidas, comida: vistaComida, temporada: vistaTemporada, extras: vistaExtras, ajustes: vistaAjustes };

function render() {
  for (const boton of document.querySelectorAll('.pestana')) {
    if (boton.dataset.vista === estado.vista) boton.setAttribute('aria-current', 'page');
    else boton.removeAttribute('aria-current');
  }
  $('vista').replaceChildren(...VISTAS[estado.vista]());
}

// ---------- Editor de bebida ----------

async function prepararFoto(archivo) {
  let imagen;
  try {
    imagen = await createImageBitmap(archivo);
  } catch {
    throw new Error('No se pudo leer esa foto. Prueba con una JPG o PNG.');
  }
  const escala = Math.min(1, 1000 / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(imagen.width * escala);
  lienzo.height = Math.round(imagen.height * escala);
  const ctx = lienzo.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  return new Promise((ok, mal) => {
    lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo procesar la foto.'))), 'image/jpeg', 0.85);
  });
}

function abrirEditor(categoria, producto, esTemporada) {
  const dialogo = $('editor');
  const form = $('editor-form');
  const cuerpo = $('editor-cuerpo');
  const nuevo = producto === null;
  const tamanos = Object.keys(estado.menu.tamanos);
  const precios = producto?.precios ?? (esTemporada ? { unico: '' } : {});
  const esUnico = esTemporada || 'unico' in precios;
  const extrasDefecto = categoria.extrasPermitidos ?? [];
  const extrasActuales = producto?.extrasPermitidos ?? extrasDefecto;
  let imagen = producto?.imagen ?? null;
  let subiendo = false;
  const comida = esComida(categoria);

  $('editor-titulo').textContent = nuevo ? (comida ? 'Nuevo producto' : 'Nueva bebida') : producto.nombre;
  $('editor-desc').textContent = categoria.nombre;

  const error = (id) => h('p', { class: 'campo__error', id: `${id}-error`, 'aria-live': 'polite' });
  const bloques = [];

  // Copia de trabajo de las opciones; solo se aplica al tocar «Listo».
  const gruposEdit = (producto?.opciones ?? []).map((g) => ({
    ...g, valores: g.valores.map((v) => ({ ...v, precio: v.precio ? String(v.precio) : '' })),
  }));
  const contenedorOpciones = h('div', { class: 'opciones-editor' });
  const valorVacio = () => ({ nombre: '', precio: '' });
  function pintarOpciones() {
    contenedorOpciones.replaceChildren(
      ...gruposEdit.map((g, gi) => h('div', { class: 'grupo-editor' },
        h('div', { class: 'grupo-editor__cabecera' },
          h('input', {
            type: 'text', maxlength: 40, value: g.nombre ?? '', placeholder: 'Salsa',
            'aria-label': `Nombre de la opción ${gi + 1}`, oninput: (e) => { g.nombre = e.target.value; },
          }),
          h('button', {
            class: 'boton boton--chico boton--texto', type: 'button', text: 'Quitar',
            'aria-label': `Quitar la opción ${g.nombre || gi + 1}`,
            onclick: () => { gruposEdit.splice(gi, 1); pintarOpciones(); },
          }),
        ),
        h('ul', { class: 'valores-editor' }, g.valores.map((v, vi) => h('li', { class: 'valor-editor' },
          h('input', {
            type: 'text', maxlength: 40, value: v.nombre ?? '', placeholder: ['Verde', 'Roja', 'Morita'][vi] ?? '',
            'aria-label': `Valor ${vi + 1} de ${g.nombre || 'la opción'}`, oninput: (e) => { v.nombre = e.target.value; },
          }),
          h('span', { class: 'campo-precio' },
            h('input', {
              type: 'text', inputmode: 'numeric', maxlength: 4, value: v.precio ?? '', placeholder: '0',
              'aria-label': `Precio extra de ${v.nombre || `valor ${vi + 1}`}`, oninput: (e) => { v.precio = e.target.value; },
            }),
          ),
          h('button', {
            class: 'boton-icono boton-icono--peligro', type: 'button', 'aria-label': `Quitar ${v.nombre || `valor ${vi + 1}`}`,
            onclick: () => { g.valores.splice(vi, 1); pintarOpciones(); },
          }, iconoBasura()),
        ))),
        h('button', {
          class: 'boton boton--chico boton--agregar', type: 'button', text: '+ Agregar valor',
          onclick: () => { g.valores.push(valorVacio()); pintarOpciones(); },
        }),
      )),
      h('button', {
        class: 'boton boton--chico boton--agregar', type: 'button', text: '+ Agregar opción a elegir',
        onclick: () => { gruposEdit.push({ nombre: '', valores: [valorVacio(), valorVacio()] }); pintarOpciones(); },
      }),
    );
  }

  bloques.push(h('div', { class: 'campo' },
    h('label', { for: 'ed-nombre', text: 'Nombre' }),
    h('input', { id: 'ed-nombre', name: 'nombre', type: 'text', maxlength: 60, value: producto?.nombre ?? '', required: true, 'aria-describedby': 'ed-nombre-error' }),
    error('ed-nombre'),
  ));

  bloques.push(h('div', { class: 'campo' },
    h('label', { for: 'ed-descripcion' }, 'Descripción ', h('span', { class: 'opcional', text: '(opcional)' })),
    h('textarea', {
      id: 'ed-descripcion', name: 'descripcion', rows: 2, maxlength: 120,
      placeholder: esTemporada ? 'Horchata casera · espresso' : comida ? 'Spread de chipotle, queso fundido, jamón de pavo' : '',
    }),
  ));

  if (esTemporada) {
    const vista = h('img', { class: 'foto-editor__vista', src: imagen ?? '', alt: '', hidden: !imagen });
    const estadoFoto = h('p', { class: 'campo__nota', 'aria-live': 'polite', text: imagen ? '' : 'Sin foto todavía.' });
    const entrada = h('input', {
      id: 'ed-foto', type: 'file', accept: 'image/jpeg,image/png,image/webp,image/*', class: 'foto-editor__entrada',
      onchange: async (e) => {
        const archivo = e.target.files?.[0];
        if (!archivo) return;
        subiendo = true;
        $('editor-listo').disabled = true;
        estadoFoto.textContent = 'Subiendo foto…';
        try {
          const blob = await prepararFoto(archivo);
          const nombre = slug(form.nombre.value || 'temporada');
          const r = await api(`/api/imagen?nombre=${encodeURIComponent(nombre)}`, { metodo: 'POST', blob });
          imagen = r.ruta;
          vista.src = imagen;
          vista.hidden = false;
          estadoFoto.textContent = 'Foto lista.';
        } catch (err) {
          if (err.codigo !== 401) estadoFoto.textContent = err.message;
        } finally {
          subiendo = false;
          $('editor-listo').disabled = false;
          e.target.value = '';
        }
      },
    });
    bloques.push(h('div', { class: 'campo' },
      h('span', { class: 'campo__etiqueta', text: 'Foto' }),
      h('div', { class: 'foto-editor' },
        vista,
        h('label', { class: 'boton boton--chico foto-editor__boton', for: 'ed-foto', text: imagen ? 'Cambiar foto' : 'Elegir foto' }),
        entrada,
      ),
      estadoFoto,
    ));
  } else {
    bloques.push(h('div', { class: 'campo' },
      h('label', { for: 'ed-detalle' }, 'Detalle ', h('span', { class: 'opcional', text: '(opcional)' })),
      h('input', { id: 'ed-detalle', name: 'detalle', type: 'text', maxlength: 40, value: producto?.detalle ?? '', placeholder: '600 ml' }),
    ));
  }

  // Precios
  const campoPrecio = (id, valor, etiqueta) => h('span', { class: 'campo-precio' },
    h('input', { id, name: id, type: 'text', inputmode: 'numeric', maxlength: 4, value: valor === '' || valor == null ? '' : String(valor), 'aria-label': etiqueta }),
  );

  if (esTemporada) {
    bloques.push(h('div', { class: 'campo' },
      h('label', { for: 'ed-precio-unico', text: 'Precio' }),
      campoPrecio('ed-precio-unico', precios.unico, 'Precio'),
      error('ed-precios'),
    ));
  } else {
    const porTamano = h('div', { class: 'precios-tamano', hidden: esUnico },
      tamanos.map((t) => {
        const activo = t in precios;
        return h('div', { class: 'precio-fila' },
          h('label', { class: 'check' },
            h('input', { type: 'checkbox', name: `usa-${t}`, checked: activo }),
            h('span', { text: estado.menu.tamanos[t].nombre }),
          ),
          campoPrecio(`ed-precio-${t}`, precios[t], `Precio ${estado.menu.tamanos[t].nombre}`),
        );
      }),
    );
    const unico = h('div', { class: 'precios-unico', hidden: !esUnico },
      campoPrecio('ed-precio-unico', precios.unico, 'Precio único'),
    );
    bloques.push(h('fieldset', { class: 'campo' },
      h('legend', { text: 'Precio' }),
      h('div', { class: 'segmentos' },
        h('label', { class: 'segmento' }, h('input', { type: 'radio', name: 'tipo-precio', value: 'tamano', checked: !esUnico }), h('span', { text: 'Por tamaño' })),
        h('label', { class: 'segmento' }, h('input', { type: 'radio', name: 'tipo-precio', value: 'unico', checked: esUnico }), h('span', { text: 'Precio único' })),
      ),
      porTamano,
      unico,
      error('ed-precios'),
    ));

    if (estado.menu.extras.length) {
      bloques.push(h('fieldset', { class: 'campo' },
        h('legend', { text: 'Extras que se ofrecen' }),
        h('div', { class: 'chips-check' },
          estado.menu.extras.map((e) => h('label', { class: 'chip-check' },
            h('input', { type: 'checkbox', name: 'extra', value: e.id, checked: extrasActuales.includes(e.id) }),
            h('span', { text: `${e.nombre} +${formatoPrecio(e.precio || 0)}` }),
          )),
        ),
      ));
    }

    bloques.push(h('fieldset', { class: 'campo' },
      h('legend', { text: 'Opciones a elegir' }),
      h('p', { class: 'campo__nota', text: 'El cliente debe elegir un valor de cada opción. Ejemplo: Salsa → Verde, Roja, Morita. El precio extra es opcional.' }),
      contenedorOpciones,
      error('ed-opciones'),
    ));
    pintarOpciones();
  }

  bloques.push(h('div', { class: 'tarjeta-ajuste' },
    h('p', { class: 'tarjeta-ajuste__titulo', text: 'Agotada' }),
    h('label', { class: 'interruptor interruptor--alerta' },
      h('input', { type: 'checkbox', role: 'switch', name: 'agotado', checked: Boolean(producto?.agotado), 'aria-label': 'Agotada' }),
      h('span', { class: 'interruptor__pista', 'aria-hidden': 'true' }),
    ),
  ));

  const total = categoria.productos.length + (nuevo ? 1 : 0);
  const posicionActual = nuevo ? total - 1 : categoria.productos.indexOf(producto);
  if (total > 1) {
    bloques.push(h('div', { class: 'campo' },
      h('label', { for: 'ed-posicion', text: 'Lugar en la lista' }),
      h('select', { id: 'ed-posicion', name: 'posicion' },
        Array.from({ length: total }, (_, i) => h('option', {
          value: i, selected: i === posicionActual,
          text: i === 0 ? '1 (primera)' : i === total - 1 ? `${i + 1} (última)` : String(i + 1),
        })),
      ),
    ));
  }

  if (!nuevo) {
    bloques.push(h('button', {
      class: 'boton boton--peligro boton--ancho', type: 'button', text: comida ? 'Eliminar producto' : 'Eliminar bebida',
      onclick: () => {
        if (!confirm(`¿Eliminar «${producto.nombre}» del menú?`)) return;
        categoria.productos.splice(categoria.productos.indexOf(producto), 1);
        dialogo.close();
        marcarSucio();
        render();
        avisar(`Se eliminó ${producto.nombre}. Toca Guardar para publicarlo.`);
      },
    }));
  }

  cuerpo.replaceChildren(...bloques);
  form.descripcion.value = producto?.descripcion ?? '';

  const sincronizarPrecios = () => {
    if (esTemporada) return;
    const unicoSel = form.querySelector('input[name="tipo-precio"]:checked').value === 'unico';
    cuerpo.querySelector('.precios-tamano').hidden = unicoSel;
    cuerpo.querySelector('.precios-unico').hidden = !unicoSel;
    for (const t of tamanos) form[`ed-precio-${t}`].disabled = !form[`usa-${t}`].checked;
  };
  sincronizarPrecios();
  form.onchange = sincronizarPrecios;

  form.onsubmit = (e) => {
    e.preventDefault();
    if (subiendo) return;
    const nombre = form.nombre.value.replace(/\s+/g, ' ').trim();
    $('ed-nombre-error').textContent = nombre ? '' : 'Escribe el nombre.';
    form.nombre.toggleAttribute('aria-invalid', !nombre);

    const nuevosPrecios = {};
    let errorPrecio = '';
    const unicoSel = esTemporada || form.querySelector('input[name="tipo-precio"]:checked').value === 'unico';
    if (unicoSel) {
      const v = form['ed-precio-unico'].value;
      if (precioValido(v)) nuevosPrecios.unico = Number(v);
      else errorPrecio = 'Escribe el precio en pesos, sin centavos (ej. 85).';
    } else {
      for (const t of tamanos) {
        if (!form[`usa-${t}`].checked) continue;
        const v = form[`ed-precio-${t}`].value;
        if (precioValido(v)) nuevosPrecios[t] = Number(v);
        else errorPrecio = `Revisa el precio de ${estado.menu.tamanos[t].nombre.toLowerCase()} (en pesos, sin centavos).`;
      }
      if (!errorPrecio && !Object.keys(nuevosPrecios).length) errorPrecio = 'Activa al menos un tamaño.';
    }
    $('ed-precios-error').textContent = errorPrecio;

    let errorOpciones = '';
    const opciones = [];
    const idsGrupo = new Set();
    for (const g of gruposEdit) {
      const nombreGrupo = (g.nombre ?? '').replace(/\s+/g, ' ').trim();
      const valores = g.valores.map((v) => ({ ...v, nombre: (v.nombre ?? '').replace(/\s+/g, ' ').trim(), precio: String(v.precio ?? '').trim() }));
      if (!nombreGrupo) { errorOpciones = 'Cada opción necesita un nombre (ej. Salsa).'; break; }
      if (valores.length < 2 || valores.some((v) => !v.nombre)) { errorOpciones = `«${nombreGrupo}» necesita al menos 2 valores con nombre.`; break; }
      if (valores.some((v) => v.precio && !/^\d{1,4}$/.test(v.precio))) { errorOpciones = `Revisa los precios extra de «${nombreGrupo}» (pesos, sin centavos).`; break; }
      const idGrupo = g.id && !idsGrupo.has(g.id) ? g.id : idUnico(slug(nombreGrupo), idsGrupo);
      idsGrupo.add(idGrupo);
      const idsValor = new Set();
      opciones.push({
        id: idGrupo,
        nombre: nombreGrupo,
        valores: valores.map((v) => {
          const id = v.id && !idsValor.has(v.id) ? v.id : idUnico(slug(v.nombre), idsValor);
          idsValor.add(id);
          return Number(v.precio) ? { id, nombre: v.nombre, precio: Number(v.precio) } : { id, nombre: v.nombre };
        }),
      });
    }
    if ($('ed-opciones-error')) $('ed-opciones-error').textContent = errorOpciones;

    if (!nombre || errorPrecio || errorOpciones) {
      (form.querySelector('[aria-invalid]') ?? form.querySelector('.campo__error:not(:empty)'))?.scrollIntoView({ block: 'center' });
      if (!nombre) form.nombre.focus();
      return;
    }

    const resultado = { id: producto?.id ?? generarId(categoria, nombre), nombre };
    const descripcion = form.descripcion.value.replace(/\s+/g, ' ').trim();
    if (descripcion) resultado.descripcion = descripcion;
    if (esTemporada) {
      if (imagen) resultado.imagen = imagen;
    } else {
      const detalle = form.detalle.value.trim();
      if (detalle) resultado.detalle = detalle;
    }
    resultado.precios = nuevosPrecios;
    if (!esTemporada) {
      const elegidos = [...form.querySelectorAll('input[name="extra"]:checked')].map((i) => i.value);
      if (!mismosElementos(elegidos, extrasDefecto)) resultado.extrasPermitidos = elegidos;
    } else if (producto?.extrasPermitidos) {
      resultado.extrasPermitidos = producto.extrasPermitidos;
    }
    if (opciones.length) resultado.opciones = opciones;
    else if (esTemporada && producto?.opciones) resultado.opciones = producto.opciones;
    if (form.agotado.checked) resultado.agotado = true;
    if (producto && 'disponible' in producto) resultado.disponible = producto.disponible;

    const lista = categoria.productos;
    if (!nuevo) lista.splice(lista.indexOf(producto), 1);
    const posicion = form.posicion ? Number(form.posicion.value) : lista.length;
    lista.splice(Math.min(posicion, lista.length), 0, resultado);

    dialogo.close();
    marcarSucio();
    render();
    avisar(`${nombre}: cambios listos. Toca Guardar para publicarlos.`);
  };

  dialogo.showModal();
  if (nuevo) form.nombre.focus();
}

// ---------- Inicio ----------

async function iniciar() {
  $('editor-cerrar').addEventListener('click', () => $('editor').close());
  $('editor-cancelar').addEventListener('click', () => $('editor').close());
  $('guardar').addEventListener('click', guardar);
  $('descartar').addEventListener('click', () => {
    if (confirm('¿Descartar los cambios que no has guardado?')) cargar().catch((e) => mostrarErrores(e.message));
  });
  $('salir').addEventListener('click', async () => {
    if (estado.sucio && !confirm('Tienes cambios sin guardar. ¿Salir de todos modos?')) return;
    await api('/api/logout', { metodo: 'POST', json: {} }).catch(() => {});
    estado.menu = null;
    estado.sucio = false;
    mostrarLogin();
  });
  for (const boton of document.querySelectorAll('.pestana')) {
    boton.addEventListener('click', () => {
      estado.vista = boton.dataset.vista;
      render();
      $('vista').focus({ preventScroll: true });
      scrollTo({ top: 0 });
    });
  }
  window.addEventListener('beforeunload', (e) => {
    if (estado.sucio) e.preventDefault();
  });

  $('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = $('login-entrar');
    const contrasena = $('contrasena').value;
    if (!contrasena) {
      $('login-error').textContent = 'Escribe la contraseña.';
      return;
    }
    boton.disabled = true;
    boton.textContent = 'Entrando…';
    try {
      await api('/api/login', { metodo: 'POST', json: { contrasena } });
      $('contrasena').value = '';
      // Si la sesión venció a media edición, se conservan los cambios.
      if (estado.menu) {
        mostrar('pantalla-panel');
        render();
      } else {
        await cargar();
      }
    } catch (err) {
      $('login-error').textContent = err.message;
    } finally {
      boton.disabled = false;
      boton.textContent = 'Entrar';
    }
  });

  try {
    const sesion = await api('/api/sesion');
    if (sesion.autenticado) await cargar();
    else mostrarLogin(sesion.configurado ? '' : 'El panel aún no está configurado: faltan ADMIN_PASSWORD_HASH y SESSION_SECRET en Netlify.');
  } catch (e) {
    const carga = $('pantalla-carga');
    carga.textContent = e.codigo === 0 || e.codigo === 404 || e.codigo === 501
      ? 'No se pudo conectar con el panel. Revisa tu internet y vuelve a cargar la página.'
      : e.message;
    carga.classList.add('admin-estado--error');
  }
}

iniciar();
