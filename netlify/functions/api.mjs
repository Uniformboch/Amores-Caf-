// Panel del dueño: /api/* (entrar, guardar el menú, subir fotos, respaldos).
import { crearApi } from '../lib/api.mjs';
import { apiConBlobs } from '../lib/blobs.mjs';

export default async (req, context) => apiConBlobs(crearApi).panel(req, context);

export const config = { path: '/api/*' };
