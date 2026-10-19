// Conecta la lógica con Netlify Blobs y las variables de entorno del sitio.
import { getStore } from '@netlify/blobs';
// El menú del repositorio es solo el contenido inicial: en cuanto el dueño guarda desde el panel,
// manda lo que está en Blobs.
import menuInicial from '../../menu.json' with { type: 'json' };
import temporadaInicial from '../../menu-temporada.json' with { type: 'json' };

const tienda = (name) => getStore({ name, consistency: 'strong' });

export function apiConBlobs(crearApi) {
  return crearApi({
    tiendas: {
      datos: tienda('menu'),
      fotos: tienda('fotos'),
      respaldos: tienda('respaldos'),
      intentos: tienda('intentos'),
    },
    entorno: {
      ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
      SESSION_SECRET: process.env.SESSION_SECRET,
    },
    menuInicial,
    temporadaInicial,
  });
}
