// Arma la carpeta que Netlify publica: solo archivos públicos.
// menu.json y menu-temporada.json NO se copian: los entrega la función "datos" desde Blobs.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'publicar');
const PUBLICOS = ['index.html', 'admin.html', 'manifest.webmanifest', 'css', 'js', 'assets'];

rmSync(destino, { recursive: true, force: true });
for (const nombre of PUBLICOS) {
  const origen = join(raiz, nombre);
  if (!existsSync(origen)) throw new Error(`Falta ${nombre}`);
  cpSync(origen, join(destino, nombre), { recursive: true });
}
console.log(`Carpeta pública lista: ${PUBLICOS.join(', ')}`);
