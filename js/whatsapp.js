// Validación del cliente, mensaje de WhatsApp y enlace wa.me. Sin acceso al DOM.

export const ENTREGAS = {
  llevar: 'Para llevar',
  domicilio: 'A domicilio',
};

export function formatoPrecio(n) {
  return `$${n.toLocaleString('es-MX')}`;
}

export function limpiarCliente(cliente = {}) {
  const texto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  return {
    nombre: texto(cliente.nombre),
    entrega: cliente.entrega in ENTREGAS ? cliente.entrega : '',
    direccion: texto(cliente.direccion),
    notas: texto(cliente.notas),
  };
}

// Devuelve { campo: mensaje } solo con los campos que tienen error.
export function validarPedido(cliente, cantidadLineas) {
  const c = limpiarCliente(cliente);
  const errores = {};
  if (cantidadLineas === 0) errores.lineas = 'Agrega al menos una bebida.';
  if (c.nombre.length < 2) errores.nombre = 'Escribe tu nombre para saber de quién es el pedido.';
  if (!c.entrega) errores.entrega = 'Elige si es para llevar o a domicilio.';
  if (c.entrega === 'domicilio' && c.direccion.length < 8) {
    errores.direccion = 'Escribe la dirección completa para la entrega.';
  }
  return errores;
}

export function lineaMensaje(l) {
  let texto = `• ${l.cantidad} × ${l.nombre}`;
  const detalles = [l.nombreTamano, ...(l.nombresOpciones ?? [])].filter(Boolean);
  if (detalles.length) texto += ` (${detalles.join(', ')})`;
  if (l.nombresExtras.length) texto += ` + ${l.nombresExtras.join(', ')}`;
  return `${texto} — ${formatoPrecio(l.subtotal)}`;
}

export function construirMensaje({ negocio, lineas, total, cliente }) {
  const c = limpiarCliente(cliente);
  const partes = [
    `Hola, ${negocio}. Quiero hacer un pedido:`,
    '',
    ...lineas.map(lineaMensaje),
    '',
    `*Total: ${formatoPrecio(total)}*`,
    '',
    `Nombre: ${c.nombre}`,
    `Entrega: ${ENTREGAS[c.entrega]}`,
  ];
  if (c.entrega === 'domicilio') {
    partes.push(`Dirección: ${c.direccion}`, 'Envío: por confirmar');
  }
  if (c.notas) partes.push(`Notas: ${c.notas}`);
  return partes.join('\n');
}

export function enlaceWhatsApp(telefono, mensaje) {
  const numero = String(telefono).replace(/\D/g, '');
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
}
