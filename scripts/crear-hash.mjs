// Genera los dos valores que van en Netlify → Site configuration → Environment variables:
//   ADMIN_PASSWORD_HASH  (la contraseña del panel, cifrada)
//   SESSION_SECRET       (clave para firmar las sesiones)
// La contraseña se escribe sin que se vea en pantalla y nunca se guarda en ningún archivo.
import { randomBytes } from 'node:crypto';
import { cifrarContrasena } from '../netlify/lib/seguridad.mjs';

function preguntarOculto(pregunta) {
  return new Promise((resolver) => {
    const entrada = process.stdin;
    process.stdout.write(pregunta);
    if (!entrada.isTTY) {
      // Sin terminal interactiva (p. ej. tubería): se lee una línea normal.
      let texto = '';
      entrada.setEncoding('utf8');
      entrada.on('data', (d) => { texto += d; });
      entrada.on('end', () => resolver(texto.split(/\r?\n/)[0]));
      return;
    }
    let texto = '';
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    const alEscribir = (tecla) => {
      if (tecla === '\r' || tecla === '\n') {
        entrada.setRawMode(false);
        entrada.pause();
        entrada.off('data', alEscribir);
        process.stdout.write('\n');
        resolver(texto);
      } else if (tecla === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      } else if (tecla === '\u0008' || tecla === '\u007f') {
        texto = texto.slice(0, -1);
      } else {
        texto += tecla;
      }
    };
    entrada.on('data', alEscribir);
  });
}

console.log('Contraseña del panel del dueño (mínimo 8 caracteres). No se verá mientras escribes.');
let contrasena;
for (;;) {
  contrasena = await preguntarOculto('Contraseña: ');
  if (contrasena.length < 8) {
    console.log('Muy corta. Usa al menos 8 caracteres.');
    continue;
  }
  if (!process.stdin.isTTY) break;
  if (contrasena !== (await preguntarOculto('Repítela: '))) {
    console.log('No coinciden. Intenta de nuevo.');
    continue;
  }
  break;
}

console.log('\nCopia estos dos valores en Netlify (Site configuration → Environment variables):\n');
console.log(`ADMIN_PASSWORD_HASH = ${await cifrarContrasena(contrasena)}`);
console.log(`SESSION_SECRET      = ${randomBytes(32).toString('base64url')}`);
console.log('\nNo los compartas. Si cambias la contraseña, genera ambos de nuevo.');
