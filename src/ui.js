// Interfaz de ArcaKey en el navegador.
//
// Sin marco de trabajo y a proposito. La aplicacion tiene siete pantallas y
// ningun estado compartido complicado; meter una libreria de interfaz
// significaria descargarla, empaquetarla y auditarla, y este producto promete
// que no habla con ningun servidor y que su superficie de codigo es pequena.
// Todo lo que hay aqui se puede leer de arriba abajo.

import * as cripto from './cripto.js';
import * as bov from './boveda.js';
import * as marco from './marco.js';
import * as qr from './qr.js';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const app = () => document.getElementById('app');

// El mismo numero que llevan la app Android y el reloj -- ver "Version" en
// el README del proyecto para la norma completa (se sube a la vez en las
// tres, no cada una por su lado).
const VERSION = '0.8.6';

// ------------------------------------------------------------- estado

const estado = {
  entradas: [],
  claveMaestra: null,      // clave derivada; la contrasena se olvida al abrir
  cabecera: null,          // sal y parametros del KDF del fichero abierto
  busqueda: '',
  pantalla: 'bloqueo',
  seleccion: -1,
  ultimoUso: 0,
  minutosBloqueo: 2,
};

const CLAVE_ALMACEN = 'boveda.pvlt';
const CLAVE_AJUSTES = 'ajustes';

function guardaAjustes() {
  localStorage.setItem(CLAVE_AJUSTES,
    JSON.stringify({ minutosBloqueo: estado.minutosBloqueo }));
}
function cargaAjustes() {
  try {
    const a = JSON.parse(localStorage.getItem(CLAVE_AJUSTES) || '{}');
    if (typeof a.minutosBloqueo === 'number') {
      estado.minutosBloqueo = a.minutosBloqueo;
    }
  } catch (e) { /* ajustes ilegibles: se usan los de por defecto */ }
}

// El fichero cifrado vive en localStorage en base64. Es el mismo `.pvlt` que
// se exporta y que entiende Android: no hay una segunda representacion, por lo
// mismo que en el telefono. Un solo formato, un solo camino de codigo.
function leeFichero() {
  const s = localStorage.getItem(CLAVE_ALMACEN);
  if (!s) return null;
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
function escribeFichero(datos) {
  let s = '';
  for (let i = 0; i < datos.length; i += 8192) {
    s += String.fromCharCode.apply(null, datos.subarray(i, i + 8192));
  }
  localStorage.setItem(CLAVE_ALMACEN, btoa(s));
}
function hayBoveda() { return localStorage.getItem(CLAVE_ALMACEN) !== null; }

/** Vuelve a cifrar y guardar. Reutiliza la sal: no hay que derivar otra vez. */
async function guardaBoveda() {
  toca();
  const contenido = cripto.codificaBoveda(estado.entradas);
  const fichero = await cripto.creaFichero(contenido, null, {
    claveMaestra: estado.claveMaestra,
    sal: estado.cabecera.sal,
    memoriaKib: estado.cabecera.memoriaKib,
    iteraciones: estado.cabecera.iteraciones,
    paralelismo: estado.cabecera.paralelismo,
  });
  escribeFichero(fichero);
}

// El reloj de pared (`Date.now()`) lo puede mover el usuario o el sistema;
// `performance.now()` es monotono y no retrocede aunque se cambie la hora.
// Es el mismo fallo que ya se corrigio en Android usando `elapsedRealtime`
// en vez del reloj de pared: atrasar la hora del equipo evitaba el bloqueo
// automatico. Aqui pasaba lo mismo y no estaba corregido.
function toca() { estado.ultimoUso = performance.now(); }

function cierra() {
  if (estado.claveMaestra) estado.claveMaestra.fill(0);
  estado.claveMaestra = null;
  estado.cabecera = null;
  estado.entradas = [];
  estado.seleccion = -1;
  estado.busqueda = '';
  paraEmision();
  paraCamara();
  ve('bloqueo');
}

// El bloqueo por inactividad se comprueba en un latido, no solo al volver a la
// pestana: si la aplicacion se queda abierta a la vista, tiene que cerrarse
// sola igual.
setInterval(() => {
  if (!estado.claveMaestra || estado.minutosBloqueo <= 0) return;
  if (performance.now() - estado.ultimoUso > estado.minutosBloqueo * 60000) cierra();
}, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && estado.claveMaestra &&
      estado.minutosBloqueo > 0 &&
      performance.now() - estado.ultimoUso > estado.minutosBloqueo * 60000) {
    cierra();
  }
});

// ------------------------------------------------------------ utilidades

const ICONOS = {
  buscar: '<path d="M11 3a8 8 0 105.3 14l4.4 4.4 1.4-1.4-4.4-4.4A8 8 0 0011 3zm0 2a6 6 0 110 12 6 6 0 010-12z"/>',
  copiar: '<path d="M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z"/>',
  ojo: '<path d="M12 5C6.5 5 2.3 8.6 1 12c1.3 3.4 5.5 7 11 7s9.7-3.6 11-7c-1.3-3.4-5.5-7-11-7zm0 12a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z"/>',
  ojoNo: '<path d="M12 7a5 5 0 014.6 7l2.9 2.9C21 15.6 22.2 13.9 23 12c-1.3-3.4-5.5-7-11-7-1.5 0-3 .3-4.3.8l2.2 2.2A5 5 0 0112 7zM2.7 3.3L1.3 4.7l3 3C2.5 9 1.3 10.5 1 12c1.3 3.4 5.5 7 11 7 1.8 0 3.4-.4 4.9-1l3.4 3.4 1.4-1.4L2.7 3.3z"/>',
  candado: '<path d="M12 1a5 5 0 00-5 5v3H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V11a2 2 0 00-2-2h-1V6a5 5 0 00-5-5zm0 2a3 3 0 013 3v3H9V6a3 3 0 013-3zm0 11a2 2 0 011 3.7V20a1 1 0 11-2 0v-2.3A2 2 0 0112 14z"/>',
  qr: '<path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h3v3h-3v-3zm5 0h3v3h-3v-3zm-5 5h3v3h-3v-3zm5 0h3v3h-3v-3z"/>',
  camara: '<path d="M9 3l-2 2H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V7a2 2 0 00-2-2h-3l-2-2H9zm3 5a6 6 0 110 12 6 6 0 010-12zm0 2a4 4 0 100 8 4 4 0 000-8z"/>',
  ajustes: '<path d="M12 8a4 4 0 100 8 4 4 0 000-8zm9 4c0-.6-.1-1.2-.2-1.8l2-1.5-2-3.4-2.3 1a8 8 0 00-3-1.7L15 2H9l-.5 2.6a8 8 0 00-3 1.7l-2.3-1-2 3.4 2 1.5a8.3 8.3 0 000 3.6l-2 1.5 2 3.4 2.3-1a8 8 0 003 1.7L9 22h6l.5-2.6a8 8 0 003-1.7l2.3 1 2-3.4-2-1.5c.1-.6.2-1.2.2-1.8z"/>',
  escudo: '<path d="M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm0 2.2l7 3.1V11c0 4.4-2.9 8.6-7 9.9-4.1-1.3-7-5.5-7-9.9V6.3l7-3.1z"/>',
  atras: '<path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2z"/>',
  mas: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>',
  fichero: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm0 2.5L18.5 9H14V4.5zM8 13h8v2H8v-2zm0 4h8v2H8v-2z"/>',
};

function icono(nombre) {
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONOS[nombre] || ''}</svg>`;
}

/**
 * Campo de contrasena con un ojo para comprobar lo escrito.
 *
 * Teclear a ciegas una contrasena maestra larga es la forma mas facil de
 * fallarla sin darse cuenta, y el unico sintoma es un error generico despues
 * de escribirla entera. Empieza siempre oculto: el ojo es para comprobar
 * antes de enviar, no un modo por defecto. `enganchaOjos()` tiene que
 * llamarse despues de meter esto en el DOM.
 */
function campoContrasena(id, atributos = 'autocomplete="off"') {
  return `<div class="contrasena">
    <input type="password" id="${id}" ${atributos}>
    <button type="button" class="icono" data-ojo="${id}" title="Mostrar contrasena">${icono('ojo')}</button>
  </div>`;
}

/** Engancha el ojo de todos los `campoContrasena` que haya en la pantalla actual. */
function enganchaOjos() {
  for (const b of document.querySelectorAll('[data-ojo]')) {
    b.onclick = () => {
      const campo = document.getElementById(b.dataset.ojo);
      const visible = campo.type === 'text';
      campo.type = visible ? 'password' : 'text';
      b.innerHTML = icono(visible ? 'ojo' : 'ojoNo');
      b.title = visible ? 'Mostrar contrasena' : 'Ocultar contrasena';
    };
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Color estable a partir del nombre, para la inicial de cada entrada. */
function colorDe(texto) {
  let h = 0;
  for (const c of texto || '?') h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return `hsl(${h % 360} 62% 68%)`;
}

let temporizadorAviso = null;
function avisa(texto, clase = '') {
  const caja = $('#aviso');
  if (!caja) return;
  caja.textContent = texto;
  caja.className = clase;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { caja.textContent = ''; }, 4000);
}

// -------------------------------------------------------- portapapeles

const SEGUNDOS_PORTAPAPELES = 45;
let limpiezaPortapapeles = null;

/**
 * Copia y programa el borrado.
 *
 * El portapapeles es un tablon de anuncios: cualquier pagina con el foco puede
 * leerlo. Dejar ahi una contrasena hasta que el usuario copie otra cosa es de
 * las fugas mas faciles que tiene un gestor.
 *
 * El borrado automatico **no es una garantia** en la web: si la pestana pierde
 * el foco o se cierra antes de que salte, no se ejecuta, y el navegador no deja
 * escribir en el portapapeles sin foco. Se hace lo que se puede y se le dice al
 * usuario lo que hay.
 */
async function copia(texto, queEs) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch (e) {
    avisa('El navegador no ha dejado copiar', 'error');
    return;
  }
  avisa(`${queEs} copiado. Se borra en ${SEGUNDOS_PORTAPAPELES} s`, 'exito');
  clearTimeout(limpiezaPortapapeles);
  limpiezaPortapapeles = setTimeout(async () => {
    try {
      const actual = await navigator.clipboard.readText();
      // Solo se borra si sigue siendo lo nuestro: si el usuario ha copiado otra
      // cosa entre medias, pisarle el portapapeles seria molesto y ademas
      // nuestra contrasena ya no esta.
      if (actual === texto) await navigator.clipboard.writeText('');
    } catch (e) { /* sin foco o sin permiso: no se puede hacer nada */ }
  }, SEGUNDOS_PORTAPAPELES * 1000);
}

// ---------------------------------------------------------- navegacion

function ve(pantalla, datos) {
  paraEmision();
  if (pantalla !== 'leer') paraCamara();
  estado.pantalla = pantalla;
  pinta(datos);
}

function pinta(datos) {
  const p = estado.pantalla;
  if (p === 'bienvenida') return pintaBienvenida();
  if (p === 'comofunciona') return pintaComoFunciona(datos);
  if (p === 'bloqueo') return pintaBloqueo();
  if (p === 'lista') return pintaLista();
  if (p === 'detalle') return pintaDetalle();
  if (p === 'editor') return pintaEditor(datos);
  if (p === 'seguridad') return pintaSeguridad();
  if (p === 'emitir') return pintaEmitir();
  if (p === 'leer') return pintaLeer();
  if (p === 'ajustes') return pintaAjustes();
}

function cabecera(titulo, opciones = {}) {
  const atras = opciones.atras
    ? `<button class="icono" data-ir="${opciones.atras}" title="Atras">${icono('atras')}</button>`
    : '';
  // La franja de fondo del `header` ocupa todo el ancho de la ventana, pero
  // su contenido va en esta fila interior, con el mismo ancho maximo y
  // centrado que `main` (ver `.cabeceraFila` en estilos.css) -- si no, en un
  // monitor ancho el titulo y los botones quedarian pegados al borde
  // izquierdo mientras la lista de debajo aparece centrada en medio de la
  // pantalla, descuadrados entre si.
  return `<header><div class="cabeceraFila">${atras}<div class="crece"><h1>${esc(titulo)}</h1></div>${opciones.acciones || ''}</div></header>`;
}

// ------------------------------------------------------------- bloqueo

/**
 * Lo primero que ve alguien que abre esto sin tener bóveda.
 *
 * Existe porque la pantalla de crear la bóveda pedía una contraseña maestra sin
 * haber explicado nunca qué es esto, cuántas piezas tiene ni por qué esa
 * contraseña es tan seria. Pedirle a alguien la contraseña que protege toda su
 * vida digital como primera interacción, sin contexto, es pedirle un acto de fe.
 *
 * Tres pantallas y no una: quien tiene prisa se las salta con "Empezar", y quien
 * quiere entender las lee. La regla es que nada de lo que hay aquí sea
 * decorativo — cada punto responde a una pregunta que alguien se hace de verdad:
 * dónde están mis datos, qué pasa si pierdo el teléfono, y qué pasa si olvido la
 * contraseña.
 */
function pintaBienvenida() {
  app().innerHTML = `
    <main class="centrado bienvenida">
      <div class="marca">
        <div class="marcaIcono">${icono('candado')}</div>
        <h1>ArcaKey</h1>
        <p class="tenue">Un gestor de contraseñas que no tiene servidor.</p>
      </div>

      <ul class="puntos">
        <li>
          <span class="puntoIcono">${icono('candado')}</span>
          <div>
            <strong>Todo se queda aquí</strong>
            <p class="tenue">Tus contraseñas se cifran en este aparato y no salen
            de él. No hay cuenta, no hay nube y no hay nada que registrar.</p>
          </div>
        </li>
        <li>
          <span class="puntoIcono">${icono('qr')}</span>
          <div>
            <strong>Se pasan entre tus aparatos por códigos QR</strong>
            <p class="tenue">Una pantalla enseña los códigos y la otra los lee con
            la cámara. Sin cables, sin cuentas y sin que los datos pasen por
            internet.</p>
          </div>
        </li>
        <li>
          <span class="puntoIcono">${icono('escudo')}</span>
          <div>
            <strong>Y una copia en el reloj, por si acaso</strong>
            <p class="tenue">Un reloj Garmin puede guardar una copia cifrada que
            no puede abrir. Si pierdes el móvil, te la devuelve por la
            pantalla.</p>
          </div>
        </li>
      </ul>

      <button class="principal" id="empezar">Empezar</button>
      <button class="plano" id="masDetalle">Cómo funciona, con detalle</button>
    </main>`;

  $('#empezar').onclick = () => ve('bloqueo');
  $('#masDetalle').onclick = () => ve('comofunciona', 'bienvenida');
}

/**
 * La explicación larga, en un sitio al que se puede volver.
 *
 * Va aparte de la bienvenida porque hace falta en dos momentos distintos: antes
 * de empezar, y meses después cuando alguien se pregunta "¿esto cómo era?". Se
 * llega desde la bienvenida y desde los ajustes.
 *
 * `vuelveA` dice a dónde regresa el botón de atrás, porque se entra desde dos
 * sitios y volver siempre al mismo dejaba al usuario en una pantalla que no
 * había pedido.
 */
function pintaComoFunciona(vuelveA) {
  const destino = vuelveA || 'ajustes';
  app().innerHTML = `
    ${cabecera('Cómo funciona', { atras: destino })}
    <main class="documento">
      <h2>Las tres piezas</h2>
      <p>Puedes usar solo una. Las otras dos suman.</p>
      <dl class="piezas">
        <dt>Esta página</dt>
        <dd>Funciona sin instalar nada y sin conexión. Puedes guardarla en el
        disco y abrirla con doble clic; seguirá funcionando igual.</dd>
        <dt>La aplicación de Android</dt>
        <dd>Lo mismo, más el relleno automático de contraseñas en otras
        aplicaciones y el desbloqueo con huella.</dd>
        <dt>El reloj Garmin</dt>
        <dd>Enseña los códigos de verificación en dos pasos sin sacar el móvil, y
        guarda una copia de seguridad cifrada de la bóveda.</dd>
      </dl>

      <h2>La contraseña maestra</h2>
      <p>Es la única que tienes que recordar, y de ella se deriva la clave que
      cifra todo lo demás. <strong>No se guarda en ninguna parte</strong>: ni
      aquí, ni en el reloj, ni en ningún servidor.</p>
      <p class="subrayado">Si la olvidas, la bóveda no se puede recuperar. Ni tú
      ni nadie.</p>
      <p>Por eso conviene que sea una frase larga y fácil de recordar antes que
      una palabra corta y retorcida.</p>

      <h2>Pasar datos entre aparatos</h2>
      <p>De dos formas, y las dos van cifradas:</p>
      <ul>
        <li><strong>Por códigos QR.</strong> Un aparato los enseña en pantalla y
        el otro los lee con la cámara. La bóveda se parte en varios códigos que
        se emiten en bucle; no hay que sincronizar nada, se apunta y se espera.</li>
        <li><strong>Por fichero.</strong> Se exporta un fichero cifrado y se pasa
        como se quiera. Sigue haciendo falta la contraseña maestra para abrirlo.</li>
      </ul>

      <h2>El reloj</h2>
      <p>El reloj recibe dos cosas distintas, y no son lo mismo:</p>
      <ul>
        <li>Las <strong>credenciales que tú marques</strong>, una a una. Por
        defecto no va ninguna. Esas sí las puede leer el reloj, y son las que te
        enseña.</li>
        <li>Una <strong>copia cifrada de la bóveda entera</strong>, que el reloj
        <em>no</em> puede abrir: le falta tu contraseña maestra y le falta hasta
        la función que haría falta para derivarla. Solo sabe devolvértela por la
        pantalla.</li>
      </ul>
      <p>Para entrar al reloj hace falta un PIN. A los cinco intentos fallidos el
      reloj se borra solo.</p>

      <h2>Si pierdes el teléfono</h2>
      <p>En el móvil nuevo: instalar, abrir, y <em>Restaurar desde otro
      dispositivo</em>. En el reloj: <em>Caja fuerte</em> y el PIN. El reloj
      empieza a mostrar códigos y el móvil los va leyendo hasta tenerlos todos.
      Después te pedirá la contraseña maestra, que el reloj nunca tuvo.</p>

      <h2>Qué no hace</h2>
      <ul>
        <li>No sincroniza por internet. No hay servidor que pueda caerse ni al
        que puedan entrar.</li>
        <li>No hay recuperación de la contraseña maestra.</li>
        <li>Nadie ha auditado esta criptografía de forma independiente. Está
        escrita siguiendo las normas y comprobada contra sus vectores de prueba,
        pero eso no es lo mismo.</li>
      </ul>
    </main>`;
  engancha();
}

function pintaBloqueo() {
  const creando = !hayBoveda();
  app().innerHTML = `
    <main class="centrado">
      <div style="text-align:center;margin-bottom:1.5rem">
        <div style="color:var(--acento);display:inline-flex">${icono('candado')}</div>
        <h1 style="margin-top:.5rem">${creando ? 'Crea tu boveda' : 'ArcaKey'}</h1>
        <p class="tenue" style="margin-top:.4rem">${creando
          ? 'La contrasena maestra no se guarda en ninguna parte. Si la pierdes, no hay forma de recuperar la boveda: nadie puede.'
          : 'Todo se queda en este dispositivo.'}</p>
      </div>
      <div class="campo">
        <label for="c1">Contrasena maestra</label>
        ${campoContrasena('c1', 'autocomplete="off" autocapitalize="off" spellcheck="false"')}
        <div id="fuerza"></div>
      </div>
      ${creando ? `<div class="campo">
        <label for="c2">Repitela</label>
        ${campoContrasena('c2')}
      </div>` : ''}
      <div id="aviso" style="min-height:1.4rem"></div>
      <button class="principal" id="entrar">${creando ? 'Crear boveda' : 'Desbloquear'}</button>
      <div class="botones" style="margin-top:1.2rem;justify-content:center">
        <button class="plano" id="restaurar">Restaurar desde otro dispositivo</button>
      </div>
      <p class="tenue" style="text-align:center;margin-top:.4rem">
        Lee los codigos QR del movil o del reloj, o abre un fichero de copia.
      </p>
      ${creando ? `<div class="botones" style="margin-top:.8rem;justify-content:center">
        <button class="plano" id="comoVa">¿Como funciona esto?</button>
      </div>` : ''}
    </main>`;

  const c1 = $('#c1');
  c1.focus();
  enganchaOjos();
  if (creando) {
    c1.addEventListener('input', () => {
      const v = c1.value;
      const debil = bov.esDebil(v);
      $('#fuerza').innerHTML = !v ? '' :
        `<div class="medidor ${debil ? 'malo' : ''}">${
          [0, 1, 2, 3].map((i) => `<i class="${
            (debil ? i < 1 : i < 4) ? 'on' : ''}"></i>`).join('')
        }</div><div class="${debil ? 'error' : 'exito'}" style="margin-top:.3rem">${
          debil
            ? 'Debil. Es la unica que protege todo lo demas: usa una frase larga.'
            : 'Buena longitud.'}</div>`;
    });
  }
  $('#entrar').onclick = () => (creando ? crea() : desbloquea());
  $('#restaurar').onclick = () => ve('leer');
  if (creando) $('#comoVa').onclick = () => ve('comofunciona', 'bloqueo');
  app().addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (creando ? crea() : desbloquea());
  });
}

async function trabajando(boton, texto, tarea) {
  const antes = boton.innerHTML;
  boton.disabled = true;
  boton.innerHTML = `<span class="cargando"></span> ${texto}`;
  try { return await tarea(); } finally {
    boton.disabled = false;
    boton.innerHTML = antes;
  }
}

async function crea() {
  const c1 = $('#c1').value, c2 = $('#c2').value;
  // Cualquier contrasena no vacia vale: la longitud y los caracteres son
  // cosa del usuario, y el medidor de arriba ya avisa si es debil sin
  // impedir seguir. Un minimo aqui ademas rompia el desbloqueo de una
  // boveda creada con una contrasena corta desde Android o el reloj, donde
  // nunca hubo ese minimo.
  if (!c1) return avisa('Escribe una contrasena', 'error');
  if (c1 !== c2) return avisa('Las dos contrasenas no coinciden', 'error');

  await trabajando($('#entrar'), 'Derivando...', async () => {
    // Los parametros se fijan **una vez** y se usan para las dos cosas: para
    // derivar la clave y para escribir la cabecera. Antes se derivaba con los
    // valores por defecto y se apuntaba en la cabecera lo que dijera otra
    // variable; mientras coincidieran no pasaba nada, y el dia que dejaran de
    // coincidir la boveda quedaria inabrible con su propia contrasena, sin
    // ningun aviso. Un solo sitio de donde salen.
    const cabecera = {
      sal: cripto.aleatorio(cripto.TAM_SAL),
      memoriaKib: cripto.KDF_MEMORIA_KIB,
      iteraciones: cripto.KDF_ITERACIONES,
      paralelismo: cripto.KDF_PARALELISMO,
    };
    estado.cabecera = cabecera;
    estado.claveMaestra = await cripto.derivaClaveMaestra(
      c1, cabecera.sal, cabecera.memoriaKib, cabecera.iteraciones,
      cabecera.paralelismo);
    estado.entradas = [];
    await guardaBoveda();
    toca();
    ve('lista');
  });
}

async function desbloquea() {
  const c = $('#c1').value;
  if (!c) return;
  await trabajando($('#entrar'), 'Derivando...', async () => {
    const r = await cripto.abreFichero(leeFichero(), c);
    if (r.tipo === cripto.RESULTADO.CONTRASENA) {
      return avisa('Contrasena incorrecta', 'error');
    }
    if (r.tipo === cripto.RESULTADO.CORRUPTO) {
      return avisa(`La boveda esta danada: ${r.motivo}`, 'error');
    }
    estado.entradas = cripto.descodificaBoveda(r.contenido);
    estado.claveMaestra = r.claveMaestra;
    estado.cabecera = r.cabecera;
    toca();
    ve('lista');
  });
}

// --------------------------------------------------------------- lista

function visibles() {
  const q = estado.busqueda.trim().toLowerCase();
  const con = estado.entradas.map((e, i) => ({ e, i }));
  if (!q) {
    return con.sort((a, b) =>
      (b.e.favorito - a.e.favorito) ||
      (a.e.titulo || '').localeCompare(b.e.titulo || '', 'es'));
  }
  return con.filter(({ e }) =>
    (e.titulo || '').toLowerCase().includes(q) ||
    (e.usuario || '').toLowerCase().includes(q) ||
    (e.dominio || '').toLowerCase().includes(q));
}

/**
 * Cuantas filas se pintan como mucho.
 *
 * Medido: repintar la lista entera cuesta 25 ms por tecla con mil credenciales
 * en un ordenador de sobremesa, y en un movil eso se multiplica. Como la lista
 * se repinta en cada pulsacion de la busqueda, escribir se volvia pastoso justo
 * en las bovedas grandes, que son las que mas necesitan buscar.
 *
 * Con un tope el coste deja de depender del tamano de la boveda. Cien filas son
 * mas de las que nadie recorre con la vista antes de afinar la busqueda.
 */
const MAXIMO_FILAS = 100;

function pintaLista() {
  const avisos = bov.revisaSeguridad(estado.entradas, Date.now() / 1000);
  const graves = avisos.filter((a) => a.gravedad === bov.GRAVEDAD.ALTA).length;
  const todas = visibles();
  const lista = todas.slice(0, MAXIMO_FILAS);
  const ocultas = todas.length - lista.length;

  app().innerHTML = `
    ${cabecera('Boveda', { acciones: `
      <button class="icono" data-ir="seguridad" title="Seguridad">${icono('escudo')}</button>
      <button class="icono" data-ir="emitir" title="Enviar por QR">${icono('qr')}</button>
      <button class="icono" data-ir="ajustes" title="Ajustes">${icono('ajustes')}</button>
      <button class="icono" id="bloquear" title="Bloquear">${icono('candado')}</button>` })}
    <main>
      <div class="fila" style="margin-bottom:.9rem">
        <div style="position:relative;flex:1">
          <input type="text" id="buscar" placeholder="Buscar" value="${esc(estado.busqueda)}"
                 autocomplete="off" style="padding-left:2.4rem">
          <span style="position:absolute;left:.7rem;top:50%;transform:translateY(-50%);color:var(--texto-tenue);display:flex">${icono('buscar')}</span>
        </div>
        <button class="principal" id="nueva" title="Anadir" style="min-width:44px;padding:.6rem">${icono('mas')}</button>
      </div>
      ${graves ? `<div class="tarjeta aviso" style="margin-bottom:.9rem;cursor:pointer" data-ir="seguridad">
        <strong>${graves} ${graves === 1 ? 'asunto grave' : 'asuntos graves'} de seguridad</strong>
        <div class="suave">Contrasenas repetidas o debiles. Toca para verlas.</div>
      </div>` : ''}
      <div id="aviso" style="min-height:1.4rem"></div>
      <div id="filas">${lista.length ? lista.map(({ e, i }) => filaHtml(e, i)).join('') +
        (ocultas > 0 ? `<div class="tenue" style="text-align:center;padding:.8rem">
          y ${ocultas} mas. Afina la busqueda para verlas.</div>` : '')
        : vacioHtml()}</div>
    </main>`;

  $('#buscar').oninput = (e) => {
    estado.busqueda = e.target.value;
    toca();
    // Solo se repintan las filas, no la pantalla entera: asi no hay que
    // recolocar el cursor ni volver a enganchar la busqueda, y no se pierde el
    // foco a mitad de una palabra.
    repintaFilas();
  };
  $('#nueva').onclick = () => ve('editor', null);
  $('#bloquear').onclick = cierra;
  engancha();
}

/**
 * Repinta solo las filas de la lista.
 *
 * Antes se rehacia la pantalla entera en cada pulsacion, lo que obligaba a
 * devolver el foco al campo de busqueda y a recolocar el cursor a mano. Ademas
 * volvia a pasar el centro de seguridad por toda la boveda en cada tecla, y eso
 * no depende de lo que se escriba.
 */
function repintaFilas() {
  const caja = $('#filas');
  if (!caja) return;
  const todas = visibles();
  const lista = todas.slice(0, MAXIMO_FILAS);
  const ocultas = todas.length - lista.length;
  caja.innerHTML = lista.length ? lista.map(({ e, i }) => filaHtml(e, i)).join('') +
    (ocultas > 0 ? `<div class="tenue" style="text-align:center;padding:.8rem">
      y ${ocultas} mas. Afina la busqueda para verlas.</div>` : '')
    : vacioHtml();
  engancha();
}

/**
 * Lo que se ve cuando no hay nada que ensenar.
 *
 * Una bóveda recién creada está vacía **siempre**, así que esta es la segunda
 * pantalla que ve todo el mundo. Antes decía "La bóveda está vacía", que es
 * cierto y no sirve de nada: el usuario ya lo ve. Ahora dice qué hacer, y las
 * dos cosas que puede hacer son distintas —empezar de cero o traerse lo que ya
 * tiene— así que se ofrecen las dos.
 *
 * El caso de "no coincide la búsqueda" es otro problema y lleva otro texto:
 * mezclarlos hacía que buscar algo inexistente pareciera que la bóveda se había
 * vaciado.
 */
function vacioHtml() {
  if (estado.busqueda) {
    return `<div class="vacio">${icono('buscar')}
      <div>Nada coincide con «${esc(estado.busqueda)}»</div>
      <p class="tenue">Se busca en el titulo, el usuario y el sitio.</p></div>`;
  }
  return `<div class="vacio">${icono('candado')}
    <div>Tu boveda esta lista y vacia</div>
    <p class="tenue">Puedes anadir credenciales a mano, o traerte las que ya
    tengas en otro aparato.</p>
    <div class="botones" style="justify-content:center;margin-top:1rem">
      <button class="principal" data-nueva="1">${icono('mas')} Anadir la primera</button>
      <button data-ir="leer">${icono('camara')} Traer de otro aparato</button>
    </div></div>`;
}

/** Una fila de la lista. */
function filaHtml(e, i) {
  return `<button class="entrada" data-abrir="${i}">
    <span class="avatar" style="background:${colorDe(e.titulo)}">${
      esc((e.titulo || '?').trim()[0] || '?').toUpperCase()}</span>
    <span class="info">
      <span class="titulo">${esc(e.titulo || '(sin titulo)')}</span>
      <span class="sub">${esc(e.usuario || e.dominio || '')}</span>
    </span>
    ${e.secretoTotp ? '<span class="chip">2FA</span>' : ''}
    ${e.favorito ? '<span style="color:var(--acento)">&#9733;</span>' : ''}
  </button>`;
}

function engancha() {
  for (const b of document.querySelectorAll('[data-ir]')) {
    b.onclick = () => { toca(); ve(b.dataset.ir); };
  }
  for (const b of document.querySelectorAll('[data-abrir]')) {
    b.onclick = () => {
      toca();
      estado.seleccion = Number(b.dataset.abrir);
      ve('detalle');
    };
  }
  // Crear una credencial nueva desde donde sea. `data-ir` no vale: el editor
  // necesita saber que no hay indice, y `ve('editor')` sin datos abriria el
  // editor de la entrada cero.
  for (const b of document.querySelectorAll('[data-nueva]')) {
    b.onclick = () => { toca(); ve('editor', null); };
  }
}

// ------------------------------------------------------------- detalle

let temporizadorTotp = null;

function pintaDetalle() {
  const e = estado.entradas[estado.seleccion];
  if (!e) return ve('lista');

  app().innerHTML = `
    ${cabecera(e.titulo || '(sin titulo)', { atras: 'lista', acciones:
      `<button class="plano" id="editar">Editar</button>` })}
    <main>
      <div id="aviso" style="min-height:1.4rem"></div>
      ${e.usuario ? `<div class="campo">
        <label>Usuario</label>
        <div class="fila crece">
          <div class="secreto">${esc(e.usuario)}</div>
          <button class="icono" id="copiaUsuario" title="Copiar usuario">${icono('copiar')}</button>
        </div>
      </div>` : ''}
      ${e.secreto ? `<div class="campo">
        <label>Contrasena</label>
        <div class="fila crece">
          <div class="secreto" id="cajaSecreto">${'•'.repeat(Math.min(e.secreto.length, 20))}</div>
          <button class="icono" id="ver" title="Ver">${icono('ojo')}</button>
          <button class="icono" id="copiaSecreto" title="Copiar contrasena">${icono('copiar')}</button>
        </div>
        <div class="tenue" style="margin-top:.3rem">Al copiar, se borra del portapapeles en ${SEGUNDOS_PORTAPAPELES} s.</div>
      </div>` : ''}
      ${e.secretoTotp ? `<div class="tarjeta acento campo">
        <label>Codigo de verificacion</label>
        <div class="fila crece">
          <div class="totp" id="totp">------</div>
          <button class="icono" id="copiaTotp" title="Copiar codigo">${icono('copiar')}</button>
        </div>
        <div class="barra" id="barra"><i style="width:100%"></i></div>
        <div class="tenue" id="restan" style="margin-top:.3rem"></div>
      </div>` : ''}
      ${e.dominio ? `<div class="campo"><label>Sitio</label><div>${esc(e.dominio)}</div></div>` : ''}
      ${e.notas ? `<div class="campo"><label>Notas</label><div class="suave">${esc(e.notas)}</div></div>` : ''}
      <div class="botones" style="margin-top:1.4rem">
        <button class="peligro" id="borrar">Borrar entrada</button>
      </div>
    </main>`;

  let visible = false;
  if (e.secreto) {
    $('#ver').onclick = () => {
      visible = !visible;
      toca();
      $('#cajaSecreto').textContent = visible ? e.secreto
        : '•'.repeat(Math.min(e.secreto.length, 20));
      $('#ver').innerHTML = icono(visible ? 'ojoNo' : 'ojo');
    };
    $('#copiaSecreto').onclick = () => { toca(); copia(e.secreto, 'Contrasena'); };
  }
  if (e.usuario) $('#copiaUsuario').onclick = () => { toca(); copia(e.usuario, 'Usuario'); };
  $('#editar').onclick = () => ve('editor', estado.seleccion);
  $('#borrar').onclick = async () => {
    if (!confirm('Borrar esta entrada. No se puede deshacer.')) return;
    estado.entradas.splice(estado.seleccion, 1);
    await guardaBoveda();
    ve('lista');
  };
  engancha();

  clearInterval(temporizadorTotp);
  if (e.secretoTotp) {
    const refresca = async () => {
      const ahora = Math.floor(Date.now() / 1000);
      const codigo = await bov.codigoTotp(e.secretoTotp, ahora,
                                          e.periodoTotp, e.digitosTotp);
      const quedan = bov.segundosRestantes(ahora, e.periodoTotp);
      const t = $('#totp');
      if (!t) { clearInterval(temporizadorTotp); return; }
      // Un hueco en medio: seis digitos seguidos se leen mal y se teclean peor.
      t.textContent = codigo.length === 6
        ? `${codigo.slice(0, 3)} ${codigo.slice(3)}` : codigo;
      // Tres tramos de color, y los mismos umbrales que el reloj y Android. El
      // salto seco a rojo a los cinco segundos no avisa: cuando cambia ya es
      // tarde para empezar a teclear. Que los tres usen los mismos umbrales
      // importa: quien mira el reloj y luego el navegador no tiene que
      // reaprender que significa cada color.
      const tramo = quedan <= 5 ? ' poco' : (quedan <= 10 ? ' medio' : '');
      $('#barra').className = `barra${tramo}`;
      $('#barra').firstElementChild.style.width =
        `${(quedan / e.periodoTotp) * 100}%`;
      const r = $('#restan');
      r.textContent = `${quedan} s`;
      r.className = `restan${tramo}`;
      $('#copiaTotp').onclick = () => { toca(); copia(codigo, 'Codigo'); };
    };
    refresca();
    temporizadorTotp = setInterval(refresca, 1000);
  }
}

// -------------------------------------------------------------- editor

function pintaEditor(indice) {
  const nueva = indice === null || indice === undefined;
  const e = nueva ? {
    tipo: cripto.TIPO.LOGIN, titulo: '', usuario: '', secreto: '',
    dominio: '', carpeta: '', notas: '', favorito: false,
    permitidoEnReloj: false, secretoTotp: null, digitosTotp: 6,
    periodoTotp: 30, creado: 0, modificado: 0,
  } : { ...estado.entradas[indice] };

  app().innerHTML = `
    ${cabecera(nueva ? 'Nueva entrada' : 'Editar', {
      atras: nueva ? 'lista' : 'detalle',
      acciones: '<button class="plano" id="guardar">Guardar</button>' })}
    <main>
      <div id="aviso" style="min-height:1.4rem"></div>
      <div class="campo"><label for="t">Titulo</label>
        <input type="text" id="t" value="${esc(e.titulo)}" autocomplete="off"></div>
      <div class="campo"><label for="u">Usuario</label>
        <input type="text" id="u" value="${esc(e.usuario)}" autocomplete="off"></div>
      <div class="campo"><label for="s">Contrasena</label>
        <input type="text" id="s" value="${esc(e.secreto)}" class="mono" autocomplete="off">
        <div class="fila" style="margin-top:.5rem">
          <button id="generar">Generar</button>
          <span class="tenue" id="entropia"></span>
        </div>
        <input type="range" id="largo" min="8" max="64" value="20" style="margin-top:.4rem">
      </div>
      <div class="campo"><label for="d">Sitio o aplicacion</label>
        <input type="text" id="d" value="${esc(e.dominio)}" autocomplete="off"></div>
      <div class="campo"><label for="n">Notas</label>
        <textarea id="n">${esc(e.notas)}</textarea></div>
      <div class="campo"><label for="totp">Secreto de verificacion en dos pasos</label>
        <input type="text" id="totp" class="mono" autocomplete="off"
               value="${e.secretoTotp ? esc(bov.aBase32(e.secretoTotp)) : ''}">
        <div class="fila" style="margin-top:.5rem">
          <button id="escanearTotp">Escanear el QR de la web</button>
        </div>
        <div class="tenue" id="pistaTotp">Escanea el QR, o pega la URI otpauth:// entera</div></div>
      <div class="fila" style="margin:1rem 0">
        <input type="checkbox" id="fav" ${e.favorito ? 'checked' : ''} style="width:auto;min-height:auto">
        <label for="fav" style="margin:0">Favorito</label>
      </div>
    </main>`;

  const largo = $('#largo');
  const pintaEntropia = () => {
    const bits = bov.bitsDeEntropia({ longitud: Number(largo.value) });
    $('#entropia').textContent = `${Number(largo.value)} caracteres, ${Math.round(bits)} bits`;
  };
  pintaEntropia();
  largo.oninput = pintaEntropia;
  $('#generar').onclick = () => {
    toca();
    $('#s').value = bov.generaContrasena({ longitud: Number(largo.value) });
  };

  // Se acepta pegar la URI entera `otpauth://...` que sale del QR de los
  // servicios, no solo el secreto suelto: es como llega de verdad.
  $('#totp').oninput = (ev) => {
    const leida = bov.deUriOtp(ev.target.value.trim());
    if (leida) {
      ev.target.value = bov.aBase32(leida.secretoTotp);
      if (!$('#t').value) $('#t').value = leida.titulo;
      if (!$('#u').value) $('#u').value = leida.usuario;
      e.digitosTotp = leida.digitosTotp;
      e.periodoTotp = leida.periodoTotp;
      $('#pistaTotp').textContent =
        `Leido de la URI: ${leida.digitosTotp} digitos cada ${leida.periodoTotp} s`;
    }
  };

  // Apuntar la camara al QR de la web, que es el gesto que hace la gente.
  // Pegar la URI a mano obliga a buscar el enlace de "no puedo escanearlo".
  $('#escanearTotp').onclick = () => {
    escaneaOtp((leida) => {
      $('#totp').value = bov.aBase32(leida.secretoTotp);
      if (!$('#t').value) $('#t').value = leida.titulo;
      if (!$('#u').value) $('#u').value = leida.usuario;
      e.digitosTotp = leida.digitosTotp;
      e.periodoTotp = leida.periodoTotp;
      $('#pistaTotp').className = 'tenue';
      $('#pistaTotp').textContent =
        `Leido del codigo: ${leida.digitosTotp} digitos cada ${leida.periodoTotp} s`;
    });
  };

  $('#guardar').onclick = async () => {
    const textoTotp = $('#totp').value.trim();
    let secretoTotp = null;
    if (textoTotp) {
      secretoTotp = bov.deBase32(textoTotp);
      if (!secretoTotp) {
        // No se guarda un secreto que no se puede descodificar: produciria
        // codigos que ningun sitio acepta y el usuario no sabria por que.
        $('#pistaTotp').className = 'error';
        $('#pistaTotp').textContent = 'Ese secreto no es base32 valido';
        return;
      }
    }
    const ahora = Math.floor(Date.now() / 1000);
    const nueva2 = {
      ...e,
      titulo: $('#t').value, usuario: $('#u').value, secreto: $('#s').value,
      dominio: $('#d').value, notas: $('#n').value,
      favorito: $('#fav').checked,
      secretoTotp,
      creado: e.creado || ahora, modificado: ahora,
    };
    if (nueva) estado.entradas.push(nueva2);
    else estado.entradas[indice] = nueva2;
    await guardaBoveda();
    ve(nueva ? 'lista' : 'detalle');
  };
  engancha();
}

// ----------------------------------------------------------- seguridad

function pintaSeguridad() {
  const avisos = bov.revisaSeguridad(estado.entradas, Date.now() / 1000);
  app().innerHTML = `
    ${cabecera('Seguridad', { atras: 'lista' })}
    <main>
      ${avisos.length ? `<div class="pila">${avisos.map((a) => `
        <div class="tarjeta ${a.gravedad === bov.GRAVEDAD.ALTA ? 'aviso' : ''}">
          <h2>${esc(a.titulo)}</h2>
          <p class="suave" style="margin:0">${esc(a.detalle)}</p>
          <div class="tenue" style="margin-top:.4rem">${a.entradas.length} ${
            a.entradas.length === 1 ? 'entrada afectada' : 'entradas afectadas'}</div>
        </div>`).join('')}</div>`
      : `<div class="vacio">${icono('escudo')}<div>No hay nada que arreglar.</div></div>`}
    </main>`;
  engancha();
}

// ------------------------------------------------------------- emitir

let emision = null;

function paraEmision() {
  if (emision) { clearInterval(emision.temporizador); emision = null; }
}

/** Milisegundos que se ensena cada fotograma. */
const MS_POR_FOTOGRAMA = 1200;

function pintaEmitir() {
  const fichero = leeFichero();
  if (!fichero) return ve('lista');

  // Version 16, y no la mas alta que cabria. Medido sobre 150 simbolos por
  // version, con imagen perfecta y ZXing como lector: v13 falla el 1,3 %, v16
  // el 2,7 %, v18 el 4,7 % y v20 el 4,7 %. La 18 no aporta nada y entre la 16
  // y la 20 la 16 casi divide por dos los ilegibles a cambio de un fotograma
  // mas cada 2 KB; ademas tiene 81 modulos en vez de 97, o sea modulos mas
  // grandes en pantalla para la camara del otro aparato.
  const VERSION = 16;
  const capacidad = qr.capacidad(VERSION, qr.NIVEL_L);
  const troceado = marco.trocea(fichero, capacidad);

  app().innerHTML = `
    ${cabecera('Enviar la boveda', { atras: 'lista' })}
    <main>
      <div class="tarjeta" style="margin-bottom:1rem">
        <p style="margin:0">Apunta el otro dispositivo a la pantalla. Los codigos
        van en bucle: no hace falta cogerlos en orden ni darse prisa.</p>
        <div class="tenue" style="margin-top:.4rem">
          ${fichero.length} bytes en ${troceado.total}
          ${troceado.total === 1 ? 'codigo' : 'codigos'}.
          Va cifrado con tu contrasena maestra: quien lo fotografie sin ella no
          saca nada.
        </div>
      </div>
      <div class="qr-caja">
        <canvas id="qr-lienzo" width="680" height="680"></canvas>
        <div class="puntos" id="puntos">${
          troceado.trozos.map(() => '<i></i>').join('')}</div>
        <div class="qr-pie">
          <span class="tenue" id="cuenta"></span>
          <button class="plano" id="lento">Mas despacio</button>
        </div>
      </div>
    </main>`;

  const lienzo = $('#qr-lienzo');
  // El lienzo se dimensiona en pixeles reales de la pantalla: si se deja el
  // tamano CSS, en una pantalla de alta densidad el navegador escala el dibujo
  // y los modulos salen con bordes grises que le quitan margen al lector.
  const lado = Math.round(lienzo.getBoundingClientRect().width *
                          (window.devicePixelRatio || 1));
  lienzo.width = lienzo.height = lado;

  let indice = 0, variante = 0, ms = MS_POR_FOTOGRAMA;
  const puntos = $('#puntos').children;

  const emite = () => {
    const trama = marco.montaTrama(troceado, indice, variante);
    qr.dibuja(lienzo, qr.matriz(trama, qr.NIVEL_L, VERSION, variante),
              { borde: 4 });
    for (let i = 0; i < puntos.length; i++) {
      puntos[i].className = i === indice ? 'actual' : '';
    }
    $('#cuenta').textContent =
      `${indice + 1} de ${troceado.total} vuelta ${variante + 1}`;
    indice++;
    if (indice >= troceado.total) {
      indice = 0;
      // Cada vuelta cambia la variante, y con ella el dibujo entero. Es lo que
      // rescata un fotograma que el lector no supo leer: los mismos bytes dan
      // siempre el mismo simbolo, asi que sin esto un codigo atascado no se
      // leeria nunca.
      variante = (variante + 1) & 0x0f;
    }
  };

  const arranca = () => {
    paraEmision();
    emite();
    emision = { temporizador: setInterval(emite, ms) };
  };
  arranca();

  $('#lento').onclick = () => {
    ms = ms >= 2400 ? MS_POR_FOTOGRAMA : ms + 600;
    $('#lento').textContent = ms >= 2400 ? 'Volver al ritmo normal'
                                         : `Mas despacio (${(ms / 1000).toFixed(1)} s)`;
    arranca();
  };
  engancha();
}

// ------------------------------------------------- escanear un otpauth

/**
 * Abre la camara sobre la pantalla actual para leer un QR `otpauth://`.
 *
 * Tiene su propia camara y su propia capa, y no reutiliza la de restaurar, por
 * dos motivos: aquella vive dentro de la pantalla "leer" y depende de su
 * maquetado, y ademas alli el contenido son **bytes** (`binaryData`) mientras
 * que aqui es **texto**. Mezclarlas obligaria a llevar un modo por dentro y a
 * que un fallo en una rompiera la otra.
 *
 * La capa se quita sola en cuanto lee algo valido, y la camara se apaga en
 * todos los caminos de salida: dejar el flujo abierto deja el piloto de la
 * camara encendido, que en un gestor de contrasenas asusta con razon.
 */
function escaneaOtp(alLeer) {
  const capa = document.createElement('div');
  capa.className = 'capaCamara';
  capa.innerHTML = `
    <video id="camaraOtp" playsinline muted></video>
    <div class="capaCamaraPie">
      <span id="avisoOtp">Apunta al codigo QR que ensena la web.</span>
      <button class="plano" id="cerrarOtp">Cancelar</button>
    </div>`;
  document.body.appendChild(capa);

  let flujo = null;
  let temporizador = null;
  const cierra = () => {
    if (temporizador) clearInterval(temporizador);
    if (flujo) for (const p of flujo.getTracks()) p.stop();
    capa.remove();
  };
  capa.querySelector('#cerrarOtp').onclick = cierra;

  const video = capa.querySelector('#camaraOtp');
  const lienzo = document.createElement('canvas');
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });

  navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'environment',
      width: { ideal: 1280 }, height: { ideal: 960 },
    },
    audio: false,
  }).then(async (f) => {
    flujo = f;
    video.srcObject = f;
    await video.play();
    temporizador = setInterval(() => {
      if (!video.videoWidth) return;
      lienzo.width = video.videoWidth;
      lienzo.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imagen = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
      const leido = self.jsQR(imagen.data, imagen.width, imagen.height, {
        inversionAttempts: 'dontInvert',
      });
      if (!leido || !leido.data) return;
      const entrada = bov.deUriOtp(leido.data.trim());
      if (!entrada) {
        // Que el codigo no sea un `otpauth://` es lo mas probable cuando
        // alguien apunta a cualquier otro QR. Hay que decirlo, no quedarse
        // callado como si no se hubiera leido nada.
        capa.querySelector('#avisoOtp').textContent =
          'Ese codigo no es de verificacion en dos pasos.';
        return;
      }
      cierra();
      alLeer(entrada);
    }, 125);
  }).catch(() => {
    capa.querySelector('#avisoOtp').textContent =
      'No se ha podido abrir la camara. Puedes pegar la URI otpauth:// a mano.';
  });
}

// --------------------------------------------------------------- leer

let camara = null;

function paraCamara() {
  if (!camara) return;
  clearInterval(camara.temporizador);
  if (camara.flujo) for (const p of camara.flujo.getTracks()) p.stop();
  camara = null;
}

function pintaLeer() {
  const recolector = new marco.Recolector();

  app().innerHTML = `
    ${cabecera('Recibir la boveda', { atras: hayBoveda() && estado.claveMaestra ? 'lista' : 'bloqueo' })}
    <main>
      <div id="estadoLectura" class="tarjeta" style="margin-bottom:1rem">
        <p style="margin:0">Apunta la camara a los codigos del otro dispositivo o del reloj.</p>
        <div class="tenue" id="progresoTexto" style="margin-top:.4rem"></div>
        <div class="barra" style="margin-top:.5rem"><i id="barraLectura" style="width:0"></i></div>
      </div>
      <video id="camara" playsinline muted></video>
      <div class="botones" style="margin-top:1rem">
        <button id="abrirFichero">${icono('fichero')} Abrir un fichero de copia</button>
      </div>
      <input type="file" id="ficheroEntrada" accept=".pvlt,application/octet-stream" hidden>
      <div id="aviso" style="min-height:1.4rem;margin-top:.6rem"></div>
      <div id="tras" style="margin-top:1rem"></div>
    </main>`;

  $('#abrirFichero').onclick = () => $('#ficheroEntrada').click();
  $('#ficheroEntrada').onchange = async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const datos = new Uint8Array(await f.arrayBuffer());
    paraCamara();
    pideContrasenaYRestaura(datos);
  };
  engancha();
  arrancaCamara(recolector);
}

async function arrancaCamara(recolector) {
  const video = $('#camara');
  let flujo;
  try {
    flujo = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        // Resolucion alta a mano. Con la de por defecto un codigo de version
        // 20 (97 modulos) no llega ni a dos pixeles por modulo y no se lee
        // nunca; desde fuera es indistinguible de "el usuario apunta mal".
        width: { ideal: 1280 }, height: { ideal: 960 },
      },
      audio: false,
    });
  } catch (e) {
    avisa('No se ha podido abrir la camara. Puedes abrir un fichero de copia.',
          'error');
    return;
  }
  video.srcObject = flujo;
  await video.play();

  const lienzo = document.createElement('canvas');
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });

  const mira = () => {
    if (!video.videoWidth) return;
    lienzo.width = video.videoWidth;
    lienzo.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imagen = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
    const leido = self.jsQR(imagen.data, imagen.width, imagen.height, {
      inversionAttempts: 'dontInvert',
    });
    if (!leido || !leido.binaryData || !leido.binaryData.length) return;

    const aviso = recolector.aporta(Uint8Array.from(leido.binaryData));
    if (aviso.tipo === marco.AVISO.OTRA) {
      recolector.reinicia();
      $('#progresoTexto').textContent =
        'Estos codigos son de otro envio. Se ha empezado de nuevo.';
      return;
    }
    if (aviso.tipo === marco.AVISO.PROGRESO ||
        aviso.tipo === marco.AVISO.COMPLETO) {
      const total = recolector.total;
      const tengo = recolector.recogidos;
      $('#progresoTexto').textContent = `${tengo} de ${total} codigos`;
      $('#barraLectura').style.width = `${(tengo / total) * 100}%`;
      const faltan = recolector.faltan();
      if (faltan.length && faltan.length <= 6) {
        $('#progresoTexto').textContent +=
          ` faltan ${faltan.map((x) => x + 1).join(', ')}`;
      }
    }
    if (aviso.tipo === marco.AVISO.COMPLETO) {
      paraCamara();
      pideContrasenaYRestaura(aviso.contenido);
    }
  };

  // Ocho veces por segundo: mas no aporta, porque quien emite mantiene cada
  // codigo mas de un segundo, y descodificar en el hilo principal a treinta por
  // segundo deja la interfaz pegajosa.
  camara = { flujo, temporizador: setInterval(mira, 125) };
}

function pideContrasenaYRestaura(fichero) {
  $('#tras').innerHTML = `
    <div class="tarjeta acento">
      <h2>Copia recibida: ${(fichero.length / 1024).toFixed(1)} KB</h2>
      <p class="suave">Va cifrada. Escribe la contrasena maestra con la que se creo.</p>
      <div class="campo">${campoContrasena('cr')}</div>
      <div class="botones">
        <button class="principal" id="restaurarYa">Restaurar</button>
        <button class="plano" id="otraVez">Volver a leer</button>
      </div>
      <div id="errorRestaurar" class="error" style="margin-top:.5rem"></div>
    </div>`;
  $('#cr').focus();
  enganchaOjos();
  $('#otraVez').onclick = () => ve('leer');
  $('#restaurarYa').onclick = async () => {
    await trabajando($('#restaurarYa'), 'Derivando...', async () => {
      const r = await cripto.abreFichero(fichero, $('#cr').value);
      if (r.tipo === cripto.RESULTADO.CONTRASENA) {
        // Los CRC ya cuadraron, asi que si falla aqui es la contrasena.
        // Decirlo evita que el usuario piense que ha perdido la boveda.
        $('#errorRestaurar').textContent =
          'Esa no es la contrasena de esta copia. Los codigos se leyeron bien.';
        return;
      }
      if (r.tipo === cripto.RESULTADO.CORRUPTO) {
        $('#errorRestaurar').textContent = `La copia esta danada: ${r.motivo}`;
        return;
      }
      escribeFichero(fichero);
      estado.entradas = cripto.descodificaBoveda(r.contenido);
      estado.claveMaestra = r.claveMaestra;
      estado.cabecera = r.cabecera;
      toca();
      pintaRestaurada(estado.entradas.length);
    });
  };
}

/**
 * Lo que se ve justo despues de restaurar, antes de ir a la lista.
 *
 * Un aviso que desaparece solo (`avisa()`) no basta aqui: esto solo hace
 * falta leerlo una vez, justo cuando restauras desde el reloj, y si se
 * pierde entre las novedades de la lista nadie vuelve a buscarlo. Ademas
 * el navegador no puede emparejar el reloj el mismo -eso es Bluetooth, y
 * solo la aplicacion Android lo tiene- asi que aqui hace falta decir a
 * donde ir, no solo que ha pasado.
 */
function pintaRestaurada(cuantas) {
  app().innerHTML = `
    ${cabecera('Boveda restaurada')}
    <main>
      <div class="tarjeta acento">
        <h2>Boveda restaurada: ${cuantas} ${cuantas === 1 ? 'cuenta' : 'cuentas'}</h2>
        <p class="suave">Ya estan aqui, en este navegador.</p>
      </div>
      <div class="tarjeta" style="margin-top:1rem">
        <h2>Si usas el reloj</h2>
        <p class="suave">Desde aqui no se puede emparejar: la conexion con el
        reloj es por Bluetooth, y eso solo lo tiene la aplicacion Android, no
        el navegador.</p>
        <p class="suave">Para que vuelva a funcionar -ensenar los codigos de
        doble factor, guardar una copia nueva-, abre la aplicacion Android en
        un telefono, entra en "Reloj Garmin" y empareja: el reloj ensenara
        seis digitos, acepta solo si coinciden con los del telefono, y
        despues pedira un PIN nuevo. El PIN de antes ya no sirve: emparejar
        genera una clave distinta, y es esa clave la que el PIN protege.</p>
      </div>
      <div class="botones" style="margin-top:1rem">
        <button class="principal" id="continuar">Entendido</button>
      </div>
    </main>`;
  $('#continuar').onclick = () => ve('lista');
}

// ------------------------------------------------------------- ajustes

function pintaAjustes() {
  app().innerHTML = `
    ${cabecera('Ajustes', { atras: 'lista' })}
    <main>
      <div class="pila">
        <div class="tarjeta">
          <h2>Copia de seguridad</h2>
          <p class="suave">El fichero sale ya cifrado con tu contrasena maestra.
          Puedes dejarlo donde quieras: sin esa contrasena no se abre.</p>
          <div class="botones">
            <button id="exportar">${icono('fichero')} Exportar</button>
            <button data-ir="emitir">${icono('qr')} Enviar por QR</button>
            <button data-ir="leer">${icono('camara')} Recibir</button>
          </div>
        </div>

        <div class="tarjeta">
          <h2>Bloqueo automatico</h2>
          <p class="suave">Tras este tiempo sin usarla, la boveda se cierra sola.</p>
          <div class="botones" id="tiempos">
            ${[1, 2, 5, 15, 60, 0].map((m) => `
              <button data-min="${m}" class="${m === estado.minutosBloqueo ? 'principal' : ''}">
                ${m === 0 ? 'Nunca' : m === 60 ? '1 hora' : `${m} min`}
              </button>`).join('')}
          </div>
        </div>

        <div class="tarjeta">
          <h2>Portapapeles</h2>
          <p class="suave">Lo que copias se intenta borrar a los
          ${SEGUNDOS_PORTAPAPELES} segundos. En un navegador eso solo funciona
          si la pestana sigue abierta y con el foco: no es una garantia.</p>
        </div>

        <div class="tarjeta">
          <h2>Como funciona</h2>
          <p class="suave">Que hace cada pieza, que pasa si pierdes el telefono
          y por que no hay forma de recuperar la contrasena maestra.</p>
          <div class="botones">
            <button data-ir="comofunciona">Leer la explicacion</button>
          </div>
        </div>

        <div class="tarjeta aviso">
          <h2>Borrar esta boveda</h2>
          <p class="suave">Borra la copia guardada en este navegador. Si no
          tienes otra copia, no hay vuelta atras.</p>
          <button class="peligro" id="borrarTodo">Borrar del navegador</button>
        </div>
      </div>
      <div class="tenue" style="text-align:center;margin-top:1rem">Version ${VERSION}</div>
      <div id="aviso" style="min-height:1.4rem;margin-top:.8rem"></div>
    </main>`;

  $('#exportar').onclick = () => {
    const datos = leeFichero();
    const fecha = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([datos],
      { type: 'application/octet-stream' }));
    a.download = `boveda-${fecha}.pvlt`;
    a.click();
    URL.revokeObjectURL(a.href);
    avisa('Copia exportada, ya cifrada', 'exito');
  };
  for (const b of document.querySelectorAll('#tiempos [data-min]')) {
    b.onclick = () => {
      estado.minutosBloqueo = Number(b.dataset.min);
      guardaAjustes();
      toca();
      pintaAjustes();
    };
  }
  $('#borrarTodo').onclick = () => {
    if (!confirm('Se borra la boveda de este navegador. Sin otra copia, no hay vuelta atras.')) return;
    localStorage.removeItem(CLAVE_ALMACEN);
    cierra();
  };
  engancha();
}

// ------------------------------------------------------------ arranque

export function arranca(argon2) {
  cripto.usaArgon2(argon2);
  cargaAjustes();

  // La bienvenida solo la ve quien todavia no tiene boveda. Quien ya la tiene
  // quiere desbloquear y punto: ensenarle una presentacion cada vez que abre la
  // aplicacion seria un estorbo diario.
  ve(hayBoveda() ? 'bloqueo' : 'bienvenida');

  if ('serviceWorker' in navigator) {
    // El service worker solo sirve para que la aplicacion funcione sin
    // conexion: no manda nada a ningun sitio ni guarda datos de la boveda.
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
