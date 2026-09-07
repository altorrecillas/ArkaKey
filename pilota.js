// Maneja la PWA en un navegador de verdad y comprueba lo que sale en pantalla.
//
// Se usa Chromium por su protocolo de depuracion, que permite pulsar, escribir
// y leer el DOM sin instalar nada mas. No hace falta ningun marco de pruebas de
// navegador: son unas cuantas llamadas por WebSocket.
//
// Lo que comprueba es lo mismo que se comprobo en el telefono: crear boveda,
// anadir credencial, generar contrasena, ver y ocultar el secreto, TOTP contra
// un calculo independiente, bloquear, reabrir, y que una contrasena equivocada
// se rechace. Mas lo propio de la web: exportar el fichero cifrado y emitir los
// codigos QR.
//
// Vive dentro de `pwa/`, junto al `index.html` que maneja: esta carpeta es
// la PWA entera y autocontenida, pensada para poder subirla a un
// repositorio propio sin arrastrar el resto del proyecto.
//
// Uso:
//     node pilota.js

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';

const AQUI = dirname(fileURLToPath(import.meta.url));
const INDEX = join(AQUI, 'index.html');

const perfil = mkdtempSync(join(tmpdir(), 'pwaperfil'));
const PUERTO = 9333;

let fallos = 0;
function comprueba(condicion, bien, mal) {
  console.log(`  ${condicion ? 'OK  ' : 'MAL '} ${condicion ? bien : mal}`);
  if (!condicion) fallos++;
}
function paso(t) { console.log(`\n== ${t}`); }

// ------------------------------------------------------- protocolo

let ws, siguienteId = 1;
const pendientes = new Map();

async function conecta() {
  const lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json();
  const pagina = lista.find((p) => p.type === 'page');
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((ok, mal) => { ws.onopen = ok; ws.onerror = mal; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pendientes.has(m.id)) {
      const { ok, mal } = pendientes.get(m.id);
      pendientes.delete(m.id);
      if (m.error) mal(new Error(JSON.stringify(m.error)));
      else ok(m.result);
    }
  };
}

function manda(metodo, params = {}) {
  const id = siguienteId++;
  return new Promise((ok, mal) => {
    pendientes.set(id, { ok, mal });
    ws.send(JSON.stringify({ id, method: metodo, params }));
  });
}

/** Evalua JavaScript en la pagina y devuelve el resultado. */
async function evalua(expresion) {
  const r = await manda('Runtime.evaluate', {
    expression: `(async () => { ${expresion} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ||
                    JSON.stringify(r.exceptionDetails));
  }
  return r.result.value;
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Textos visibles de la pagina. */
const textos = () => evalua(`
  return [...document.querySelectorAll('#app *')]
    .filter(n => n.children.length === 0 && n.textContent.trim())
    .map(n => n.textContent.trim());
`);

/** Espera a que aparezca un texto. */
async function esperaTexto(fragmento, segundos = 15) {
  for (let i = 0; i < segundos * 4; i++) {
    const t = await textos();
    if (t.some((x) => x.includes(fragmento))) return true;
    await espera(250);
  }
  return false;
}

const pulsa = (sel) => evalua(`document.querySelector(${JSON.stringify(sel)}).click(); return 1;`);
const escribe = (sel, texto) => evalua(`
  const e = document.querySelector(${JSON.stringify(sel)});
  e.value = ${JSON.stringify(texto)};
  e.dispatchEvent(new Event('input', {bubbles:true}));
  return 1;
`);

// -------------------------------------------------------- el recorrido

const navegador = spawn('chromium', [
  `--remote-debugging-port=${PUERTO}`,
  `--user-data-dir=${perfil}`,
  '--headless=new',
  '--no-first-run',
  '--disable-gpu',
  // Un fichero local no es un origen seguro para todo, pero si para WebCrypto
  // y localStorage, que es lo que hace falta aqui.
  `file://${INDEX}`,
], { stdio: 'ignore' });

process.on('exit', () => { try { navegador.kill(); } catch (e) {} });

await espera(2500);
await conecta();
await espera(1500);

paso('Arranque limpio: primero explica de que va');
// La primera pantalla ya no es la de crear la boveda: es la bienvenida, que
// cuenta que es esto antes de pedir la contrasena que protege todo lo demas.
comprueba(await esperaTexto('Un gestor de contrase'),
  'presenta la aplicacion antes de pedir nada',
  `no sale la bienvenida: ${JSON.stringify(await textos())}`);
comprueba((await textos()).some((t) => t.includes('copia en el reloj')),
  'explica las tres piezas, incluida la del reloj',
  'la bienvenida no menciona el reloj');

paso('La explicacion larga es alcanzable');
await pulsa('#masDetalle');
await espera(400);
comprueba((await textos()).some((t) => t.includes('Las tres piezas')),
  'se llega a la explicacion detallada',
  'no se abre la explicacion');
comprueba((await textos()).some((t) => t.includes('no se puede recuperar')),
  'avisa de que la contrasena maestra no se recupera',
  'no avisa de la irreversibilidad');
await pulsa('[data-ir="bienvenida"]');
await espera(400);

paso('De la bienvenida se pasa a crear la boveda');
await pulsa('#empezar');
await espera(400);
comprueba(await esperaTexto('Crea tu boveda'),
  'pide crear una boveda',
  `no sale la pantalla de creacion: ${JSON.stringify(await textos())}`);
comprueba((await textos()).some((t) => t.includes('Restaurar desde otro dispositivo')),
  'ofrece restaurar desde otro dispositivo sin haber desbloqueado nada',
  'no hay salida hacia la restauracion');

paso('El navegador tiene lo que hace falta');
const capacidades = await evalua(`
  return {
    subtle: !!(window.crypto && window.crypto.subtle),
    compresion: typeof CompressionStream !== 'undefined',
    argon: !!(window.hashwasm && window.hashwasm.argon2id),
    jsqr: typeof jsQR === 'function',
  };
`);
comprueba(capacidades.subtle && capacidades.compresion && capacidades.argon &&
          capacidades.jsqr,
  'WebCrypto, CompressionStream, Argon2id y el lector de QR estan cargados',
  `falta algo: ${JSON.stringify(capacidades)}`);

paso('Avisa de una contrasena maestra debil');
await escribe('#c1', 'password');
await espera(300);
comprueba((await textos()).some((t) => t.includes('Debil')),
  'marca "password" como debil',
  'no avisa de que la contrasena es debil');

paso('Crear la boveda');
// Coste bajo del KDF para que la prueba no tarde: se cambia el valor por
// defecto antes de crear. Que el coste de produccion es el correcto ya se
// comprueba en las pruebas de interoperabilidad.
await evalua(`
  const c = __mods['cripto'];
  Object.defineProperty(c, 'KDF_MEMORIA_KIB', {value: 8192, writable: true});
  return 1;
`);
await escribe('#c1', 'frase-larga-de-prueba-2026');
await escribe('#c2', 'frase-larga-de-prueba-2026');
await pulsa('#entrar');
comprueba(await esperaTexto('lista y vacia', 30),
  'boveda creada y abierta',
  `no ha entrado: ${JSON.stringify(await textos())}`);

paso('Anadir una credencial con contrasena generada');
await pulsa('#nueva');
await espera(400);
await escribe('#t', 'Correo del trabajo');
await escribe('#u', 'jose@ejemplo.es');
await pulsa('#generar');
await espera(300);
const generada = await evalua(`return document.querySelector('#s').value;`);
comprueba(generada.length === 20,
  `genera una contrasena de ${generada.length} caracteres`,
  `la contrasena generada mide ${generada.length}`);
comprueba(!/[lIO01]/.test(generada),
  'sin caracteres que se confundan al leerlos',
  `la contrasena tiene caracteres ambiguos: ${generada}`);
await escribe('#d', 'ejemplo.es');
await escribe('#totp', 'JBSWY3DPEHPK3PXP');
await pulsa('#guardar');
comprueba(await esperaTexto('Correo del trabajo', 20),
  'la credencial aparece en la lista',
  `no aparece: ${JSON.stringify(await textos())}`);

paso('Detalle: secreto tapado y codigo de verificacion');
await evalua(`document.querySelector('[data-abrir]').click(); return 1;`);
await espera(600);
let t = await textos();
comprueba(t.some((x) => x.includes('jose@ejemplo.es')),
  'el detalle ensena el usuario',
  'no ensena el usuario');
comprueba(t.some((x) => x.includes('•')),
  'la contrasena sale tapada por defecto',
  'la contrasena no esta tapada');
await pulsa('#ver');
await espera(300);
t = await textos();
comprueba(t.some((x) => x.includes(generada)),
  'al pulsar Ver se destapa',
  'sigue tapada tras pulsar Ver');

const codigo = (await evalua(`return document.querySelector('#totp').textContent;`))
  .replace(/\s/g, '');
const ahora = Math.floor(Date.now() / 1000);
function totpEsperado(ventana) {
  const secreto = Buffer.from('JBSWY3DPEHPK3PXP'.replace(/=+$/, ''), 'base64')
    ; // se calcula aparte abajo con base32 de verdad
  return null;
}
// base32 a bytes, para calcular el codigo por nuestra cuenta.
function deBase32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let acc = 0, bits = 0; const out = [];
  for (const c of s.toUpperCase().replace(/[\s=-]/g, '')) {
    acc = (acc << 5) | A.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((acc >> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function codigoEn(ventana) {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(ventana / 0x100000000), 0);
  msg.writeUInt32BE(ventana >>> 0, 4);
  const h = createHmac('sha1', deBase32('JBSWY3DPEHPK3PXP')).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1000000).padStart(6, '0');
}
// Se aceptan la ventana actual y las vecinas: entre que se lee el codigo de la
// pantalla y se calcula el esperado pueden cruzarse los treinta segundos, y los
// dos numeros serian correctos y distintos.
const v = Math.floor(ahora / 30);
const validos = [codigoEn(v - 1), codigoEn(v), codigoEn(v + 1)];
comprueba(validos.includes(codigo),
  `el codigo de verificacion coincide con el calculado aparte (${codigo})`,
  `el codigo ${codigo} no esta entre ${validos}`);

paso('Exportar la boveda como fichero cifrado');
await evalua(`history.length; __mods['ui']; return 1;`);
const exportado = await evalua(`
  const b = localStorage.getItem('boveda.pvlt');
  const bin = atob(b);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return { largo: a.length, cabecera: Array.from(a.slice(0, 6)) };
`);
comprueba(exportado.cabecera[0] === 0x50 && exportado.cabecera[1] === 0x56 &&
          exportado.cabecera[2] === 0x4c && exportado.cabecera[3] === 0x54,
  `el fichero guardado empieza por PVLT (${exportado.largo} bytes)`,
  `la cabecera es ${exportado.cabecera}`);
comprueba(exportado.cabecera[4] === 1,
  'con la version de formato 1, la misma que Android',
  `version de formato ${exportado.cabecera[4]}`);

// Se saca a disco para que lo abra Android en la prueba de interoperabilidad.
const rutaExportada = join(perfil, 'de-la-pwa.pvlt');
const bytes = await evalua(`
  const b = localStorage.getItem('boveda.pvlt');
  const bin = atob(b);
  return Array.from(bin, c => c.charCodeAt(0));
`);
writeFileSync(rutaExportada, Buffer.from(bytes));
console.log(`  fichero exportado a ${rutaExportada}`);

paso('Emitir la boveda por codigos QR');
await evalua(`__mods['ui']; return 1;`);
await evalua(`document.querySelector('[data-ir="lista"]')?.click(); return 1;`);
await espera(500);
await evalua(`document.querySelector('[data-ir="emitir"]').click(); return 1;`);
comprueba(await esperaTexto('Apunta el otro dispositivo', 10),
  'la pantalla de emision se abre',
  `no se abre: ${JSON.stringify(await textos())}`);
await espera(1500);
const emision = await evalua(`
  const l = document.querySelector('#qr-lienzo');
  const ctx = l.getContext('2d');
  const d = ctx.getImageData(0, 0, l.width, l.height).data;
  let negros = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 128) negros++;
  return { ancho: l.width, alto: l.height, negros,
           total: d.length / 4,
           cuenta: document.querySelector('#cuenta').textContent };
`);
comprueba(emision.negros > emision.total * 0.15 &&
          emision.negros < emision.total * 0.6,
  `el codigo se pinta (${Math.round(100 * emision.negros / emision.total)}% de modulos oscuros)`,
  `el lienzo no parece un QR: ${JSON.stringify(emision)}`);
console.log(`  ${emision.cuenta}`);

// El contenido del QR se saca del propio modulo, para comprobar que lo que se
// emite es de verdad la boveda y no otra cosa.
const emitido = await evalua(`
  const marco = __mods['marco'];
  const bin = atob(localStorage.getItem('boveda.pvlt'));
  const f = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) f[i] = bin.charCodeAt(i);
  const qr = __mods['qr'];
  const troceado = marco.trocea(f, qr.capacidad(20, qr.NIVEL_L));
  const r = new marco.Recolector();
  let completo = null;
  for (let i = 0; i < troceado.total; i++) {
    const a = r.aporta(marco.montaTrama(troceado, i, 0));
    if (a.tipo === marco.AVISO.COMPLETO) completo = a.contenido;
  }
  return { total: troceado.total,
           reconstruido: completo ? completo.length : -1,
           original: f.length };
`);
comprueba(emitido.reconstruido === emitido.original,
  `los ${emitido.total} fotogramas reconstruyen los ${emitido.original} bytes`,
  `reconstruye ${emitido.reconstruido} de ${emitido.original}`);

paso('Bloquear y volver a abrir');
await evalua(`__mods['ui']; document.querySelector('[data-ir="lista"]').click(); return 1;`);
await espera(400);
await pulsa('#bloquear');
await espera(600);
t = await textos();
comprueba(t.some((x) => x.includes('Desbloquear')),
  'al bloquear pide la contrasena',
  `no pide contrasena: ${JSON.stringify(t)}`);
comprueba(!t.some((x) => x.includes('Correo del trabajo')),
  'no se ve ninguna credencial con la boveda cerrada',
  'se ven credenciales con la boveda cerrada');

paso('Contrasena equivocada');
await escribe('#c1', 'la-que-no-es');
await pulsa('#entrar');
comprueba(await esperaTexto('Contrasena incorrecta', 30),
  'dice que la contrasena es incorrecta',
  `no avisa: ${JSON.stringify(await textos())}`);

paso('Desbloquear y comprobar que la credencial sigue');
await escribe('#c1', 'frase-larga-de-prueba-2026');
await pulsa('#entrar');
comprueba(await esperaTexto('Correo del trabajo', 30),
  'la credencial ha sobrevivido al cierre y la reapertura',
  `se ha perdido: ${JSON.stringify(await textos())}`);

console.log(`\n${fallos === 0 ? 'LA PWA FUNCIONA' : `${fallos} COMPROBACIONES FALLIDAS`}`);
console.log(`fichero exportado para la prueba cruzada: ${rutaExportada}`);
writeFileSync(join(tmpdir(), 'pwa-exportada.pvlt'), Buffer.from(bytes));

navegador.kill();
process.exit(fallos === 0 ? 0 : 1);
