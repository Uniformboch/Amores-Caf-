// Datos públicos del menú y fotos subidas desde el panel.
import { crearApi } from '../lib/api.mjs';
import { apiConBlobs } from '../lib/blobs.mjs';

export default async (req) => apiConBlobs(crearApi).publico(req);

export const config = { path: ['/menu.json', '/menu-temporada.json', '/fotos/*'] };
