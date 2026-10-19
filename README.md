# Amores Café · Menú digital

Menú público de bebidas y comida con un solo carrito; el pedido se envía por WhatsApp (wa.me). El panel del dueño (`/admin.html`) permite cambiar precios, marcar productos agotados, editar opciones (como la proteína y la salsa de los chilaquiles) y administrar la temporada con fotos, desde cualquier celular.

Publicado en **Netlify**: los archivos públicos se sirven tal cual; el panel usa **Netlify Functions** y guarda el menú, las fotos nuevas y los respaldos en **Netlify Blobs**. Sin frameworks: HTML, CSS y JavaScript.

## Cómo funciona

```
Navegador ──► Netlify
              ├── index.html, admin.html, css/, js/, assets/   (archivos públicos)
              ├── /menu.json, /menu-temporada.json, /fotos/*   → función «datos» (lee de Blobs)
              └── /api/*                                       → función «api» (panel del dueño)
```

- `menu.json` y `menu-temporada.json` del repositorio son **solo el contenido inicial**. En cuanto el dueño guarda desde el panel, manda lo que está en Blobs; editar esos archivos después no cambia el menú publicado.
- Cada guardado hace un respaldo de la versión anterior (se conservan los últimos 60) y se puede restaurar desde **Ajustes → Respaldos**.
- Si dos personas guardan a la vez, la segunda recibe un aviso para recargar en vez de borrar los cambios de la primera.

## Configuración en Netlify (una vez)

1. Genera la contraseña cifrada del panel y la clave de sesión:

   ```bash
   npm run crear-hash
   ```

2. En Netlify → **Site configuration → Environment variables**, crea `ADMIN_PASSWORD_HASH` y `SESSION_SECRET` con los valores que imprimió el comando.
3. Vuelve a publicar el sitio (**Deploys → Trigger deploy**) para que las funciones lean las variables.

Para cambiar la contraseña, repite los tres pasos.

## Cómo se usa el panel

- **Bebidas** y **Comida**: el interruptor rojo marca un producto como **agotado** (en el menú se ve en gris y no se puede pedir). Al tocar un producto se cambian nombre, descripción, precios, extras, opciones a elegir y lugar en la lista, o se elimina.
- **Temporada**: muestra u oculta la sección; cada bebida lleva foto (cámara o galería; el panel la reduce antes de subirla).
- **Extras**: nombre, precio y en qué categorías se ofrecen.
- **Ajustes**: número de WhatsApp que recibe los pedidos y respaldos.

Nada se publica hasta tocar **Guardar**.

### Seguridad

- La contraseña está cifrada (PBKDF2) en una variable de entorno; nunca se guarda en el repositorio.
- La sesión es una cookie firmada, `HttpOnly`, `Secure` y `SameSite=Strict`, que vence en 12 horas.
- Después de 5 contraseñas equivocadas desde una misma conexión, el panel bloquea los intentos por un tiempo que va creciendo.
- Todo lo que se guarda se valida en el servidor (precios enteros, ids únicos, fotos existentes…).
- No subas al repositorio la carpeta `.admin/` del antiguo servidor local (ya está en `.gitignore`).

## Desarrollo

```bash
npm install
```

```bash
npm test
```

Las pruebas revisan precios, carrito, opciones, mensaje de WhatsApp y el panel completo (entrada, bloqueo, guardado, conflictos, fotos y respaldos) con un almacén en memoria que imita Netlify Blobs.

Para ver el menú público en local (sin panel): `python -m http.server 8080` y abre http://localhost:8080. Para probar también el panel en local hace falta Netlify CLI (`netlify dev`).

## Formato de los datos

- **`menu.json`**: bebidas y comida, tamaños, extras y `config.whatsapp` (lada de país sin espacios: `52` + 10 dígitos).
- **`menu-temporada.json`**: bebidas de temporada; `"activa": false` oculta la sección.
- Precios en pesos enteros. Un producto sin tamaños usa `"precios": { "unico": 25 }`.
- `"agotado": true` lo muestra como agotado; `"disponible": false` lo oculta por completo.
- `"grupo": "comida"` en una categoría la muestra en la pestaña Comida del menú (por defecto es bebidas).
- `"opciones"` en un producto: lista de grupos `{ id, nombre, valores: [{ id, nombre, precio? }] }`; el cliente elige un valor de cada grupo.
- `"imagen"`: `assets/temporada/…` (fotos que vienen con el sitio) o `fotos/…` (subidas desde el panel).

## Estructura

```
index.html                 menú público y carrito
admin.html                 panel del dueño
menu.json                  contenido inicial del menú
menu-temporada.json        contenido inicial de temporada
manifest.webmanifest       "Agregar a pantalla de inicio"
css/                       estilos del menú y del panel
js/app.js                  menú público
js/admin.js                panel del dueño
js/cart.js                 catálogo y carrito (sin DOM)
js/whatsapp.js             validación, mensaje y enlace wa.me (sin DOM)
js/dom.js                  ayudante para crear elementos
assets/                    logo, íconos, ilustraciones y fotos de temporada
netlify.toml               configuración de Netlify
netlify/functions/         funciones «api» y «datos»
netlify/lib/               lógica del panel, validación, seguridad y conexión con Blobs
scripts/armar.mjs          arma la carpeta pública que Netlify publica
scripts/crear-hash.mjs     genera ADMIN_PASSWORD_HASH y SESSION_SECRET
tests/                     pruebas (node:test)
```

Las imágenes originales (`Menú/`, `Bebidas de temporada/`, logo, croissants) no se publican.
