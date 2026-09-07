// Criptografia y formatos de la boveda, en el navegador.
//
// Todo lo de aqui tiene que producir **exactamente los mismos bytes** que el
// modulo `nucleo` de Android. No es un formato parecido: es el mismo, para que
// una boveda creada en el navegador se abra en el telefono y al reves. Cada
// vez que se toque algo aqui hay que volver a pasar `tools/interoperar.js`,
// que compara las dos implementaciones con ficheros de verdad.
//
// Reparto de responsabilidades:
//   - AES-256-GCM y HMAC: WebCrypto, que va nativo.
//   - Argon2id: hash-wasm, comprobado que da la misma clave que Bouncy Castle
//     en Android para los mismos parametros.
//   - DEFLATE: `CompressionStream`, que produce el mismo formato zlib que el
//     `Deflater` de Java.

export const TAM_CLAVE = 32;      // AES-256
export const TAM_SAL = 16;
export const TAM_NONCE = 12;      // el que recomienda la norma para GCM
export const TAM_ETIQUETA = 16;

export const KDF_MEMORIA_KIB = 65536;   // 64 MiB
export const KDF_ITERACIONES = 3;
export const KDF_PARALELISMO = 4;

export const CABECERA = 120;
export const VERSION_FORMATO = 1;
export const KDF_ARGON2ID = 1;

const MAGIA_PVLT = [0x50, 0x56, 0x4c, 0x54];    // "PVLT"
const MAGIA_PVDB = [0x50, 0x56, 0x44, 0x42];    // "PVDB"

/**
 * Techo de memoria del KDF al abrir un fichero.
 *
 * No es teorico: volteando un bit del campo de memoria de la cabecera, un
 * fichero de 1 MiB de coste pasa a pedir 16 GiB, y el KDF intenta reservarlos
 * **antes** de que nadie pueda comprobar si el fichero es autentico. En Android
 * eso tumbaba el proceso; aqui colgaria la pestana. La etiqueta GCM no salva de
 * esto porque solo se comprueba despues de derivar.
 *
 * **Eran 1 GiB, y era demasiado.** El fuzzer de Android encontro que con un
 * solo bit cambiado se llega a pedir mas memoria de la que el sistema le da a
 * una aplicacion, o sea que el limite de 1 GiB no protegia de nada: bastaba con
 * quedarse justo por debajo. 256 MiB son cuatro veces el coste actual (64 MiB),
 * margen de sobra para subirlo en el futuro, y no son una forma fiable de tumbar
 * nada.
 *
 * El valor tiene que ser **el mismo que en Android**: un fichero que una acepte
 * y la otra rechace es peor que un limite mal puesto, porque el usuario ve que
 * su copia "funciona en el movil pero no en el navegador" sin ninguna pista.
 */
export const MAXIMO_MEMORIA_KDF_KIB = 256 * 1024;

export function aleatorio(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function une(...trozos) {
  let total = 0;
  for (const t of trozos) total += t.length;
  const salida = new Uint8Array(total);
  let pos = 0;
  for (const t of trozos) { salida.set(t, pos); pos += t.length; }
  return salida;
}

export function aHex(b) {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function deHex(s) {
  const b = new Uint8Array(s.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(s.substr(i * 2, 2), 16);
  return b;
}

const TEXTO = new TextEncoder();
const DESTEXTO = new TextDecoder();

// ------------------------------------------------------------- Argon2id

let argon2 = null;

/** Carga el modulo de Argon2id. Se llama una vez al arrancar. */
export function usaArgon2(modulo) { argon2 = modulo; }

export async function derivaClaveMaestra(
  contrasena, sal,
  memoriaKib = KDF_MEMORIA_KIB,
  iteraciones = KDF_ITERACIONES,
  paralelismo = KDF_PARALELISMO,
) {
  if (!argon2) throw new Error('Argon2id no esta cargado');
  const hex = await argon2.argon2id({
    password: typeof contrasena === 'string' ? contrasena : contrasena,
    salt: sal,
    parallelism: paralelismo,
    memorySize: memoriaKib,
    iterations: iteraciones,
    hashLength: TAM_CLAVE,
    outputType: 'hex',
  });
  return deHex(hex);
}

// --------------------------------------------------------------- AES-GCM

async function claveAes(bytes, usos = ['encrypt', 'decrypt']) {
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, usos);
}

export async function cifra(clave, claro, datosAsociados = null,
                            nonce = aleatorio(TAM_NONCE)) {
  const k = await claveAes(clave, ['encrypt']);
  const parametros = { name: 'AES-GCM', iv: nonce, tagLength: TAM_ETIQUETA * 8 };
  if (datosAsociados) parametros.additionalData = datosAsociados;
  const salida = await crypto.subtle.encrypt(parametros, k, claro);
  return { nonce, cifrado: new Uint8Array(salida) };
}

/**
 * Descifra y **verifica**. Devuelve null si la etiqueta no cuadra.
 *
 * Devuelve null en vez de lanzar a proposito: quien llama tiene que decidir, y
 * en este producto la diferencia entre "contrasena mal" y "fichero roto" es lo
 * unico util que se le puede decir al usuario.
 */
export async function descifra(clave, nonce, cifradoConEtiqueta,
                               datosAsociados = null) {
  try {
    const k = await claveAes(clave, ['decrypt']);
    const parametros = {
      name: 'AES-GCM', iv: nonce, tagLength: TAM_ETIQUETA * 8,
    };
    if (datosAsociados) parametros.additionalData = datosAsociados;
    const salida = await crypto.subtle.decrypt(parametros, k,
                                               cifradoConEtiqueta);
    return new Uint8Array(salida);
  } catch (e) {
    return null;
  }
}

// ------------------------------------------------------------ compresion

/**
 * Comprime con DEFLATE y antepone la longitud original en cuatro bytes.
 *
 * El formato tiene que coincidir con el `Deflater` de Java, que por defecto
 * produce zlib (con cabecera), no deflate crudo. `CompressionStream('deflate')`
 * produce zlib tambien; el crudo seria `'deflate-raw'`, que no vale aqui.
 */
export async function comprime(datos) {
  const flujo = new Blob([datos]).stream()
    .pipeThrough(new CompressionStream('deflate'));
  const comprimido = new Uint8Array(await new Response(flujo).arrayBuffer());
  const cabecera = new Uint8Array(4);
  new DataView(cabecera.buffer).setUint32(0, datos.length, false);
  return une(cabecera, comprimido);
}

export async function descomprime(datos) {
  if (datos.length < 4) throw new Error('no hay ni cabecera');
  const esperado = new DataView(datos.buffer, datos.byteOffset).getUint32(0, false);
  if (esperado < 0 || esperado > 64 * 1024 * 1024) {
    throw new Error('la longitud original declarada es absurda');
  }
  const flujo = new Blob([datos.subarray(4)]).stream()
    .pipeThrough(new DecompressionStream('deflate'));
  const salida = new Uint8Array(await new Response(flujo).arrayBuffer());
  if (salida.length !== esperado) {
    throw new Error(`salieron ${salida.length} bytes y se esperaban ${esperado}`);
  }
  return salida;
}

// --------------------------------------------------- fichero de boveda

/**
 * Disposicion del fichero `.pvlt`, toda en orden de red:
 *
 *   0    4   "PVLT"
 *   4    1   version de formato = 1
 *   5    1   identificador de KDF: 1 = Argon2id
 *   6    4   memoria del KDF en KiB
 *   10   1   iteraciones
 *   11   1   paralelismo
 *   12   16  sal del KDF
 *   28   12  nonce del envoltorio de la clave de boveda
 *   40   32  clave de boveda cifrada
 *   72   16  etiqueta del envoltorio
 *   88   12  nonce del contenido
 *   100  4   longitud del contenido cifrado
 *   104  n   contenido cifrado
 *   ...  16  etiqueta del contenido
 *
 * Los bytes 0 a 27 van como datos asociados de las dos operaciones GCM: asi
 * los parametros del KDF quedan autenticados y nadie puede rebajarlos a un
 * Argon2id de coste ridiculo sin que salte la etiqueta.
 */
export async function creaFichero(contenido, contrasena, opciones = {}) {
  const memoriaKib = opciones.memoriaKib ?? KDF_MEMORIA_KIB;
  const iteraciones = opciones.iteraciones ?? KDF_ITERACIONES;
  const paralelismo = opciones.paralelismo ?? KDF_PARALELISMO;
  const sal = opciones.sal ?? aleatorio(TAM_SAL);
  const claveBoveda = opciones.claveBoveda ?? aleatorio(TAM_CLAVE);
  const claveMaestra = opciones.claveMaestra ??
    await derivaClaveMaestra(contrasena, sal, memoriaKib, iteraciones,
                             paralelismo);

  // Se comprime **antes** de cifrar: despues no habria nada que comprimir, y
  // cada byte ahorrado es un fotograma menos delante de la camara.
  const comprimido = await comprime(contenido);

  const aad = new Uint8Array(28);
  const vista = new DataView(aad.buffer);
  aad.set(MAGIA_PVLT, 0);
  aad[4] = VERSION_FORMATO;
  aad[5] = KDF_ARGON2ID;
  vista.setUint32(6, memoriaKib, false);
  aad[10] = iteraciones;
  aad[11] = paralelismo;
  aad.set(sal, 12);

  const envuelta = await cifra(claveMaestra, claveBoveda, aad);
  const cuerpo = await cifra(claveBoveda, comprimido, aad);

  const largo = new Uint8Array(4);
  new DataView(largo.buffer).setUint32(0, cuerpo.cifrado.length, false);

  return une(aad, envuelta.nonce, envuelta.cifrado, cuerpo.nonce, largo,
             cuerpo.cifrado);
}

export const RESULTADO = {
  BIEN: 'bien',
  CONTRASENA: 'contrasena',
  CORRUPTO: 'corrupto',
};

export function cabeceraDe(fichero) {
  if (fichero.length < CABECERA) return null;
  for (let i = 0; i < 4; i++) if (fichero[i] !== MAGIA_PVLT[i]) return null;
  const v = new DataView(fichero.buffer, fichero.byteOffset);
  return {
    sal: fichero.slice(12, 28),
    memoriaKib: v.getUint32(6, false),
    iteraciones: fichero[10],
    paralelismo: fichero[11],
  };
}

/** Abre una boveda. No lanza por contrasena mala: lo dice en el resultado. */
export async function abreFichero(fichero, contrasena, claveDirecta = null) {
  if (fichero.length < CABECERA) {
    return {
      tipo: RESULTADO.CORRUPTO,
      motivo: `el fichero mide ${fichero.length} bytes, y solo la cabecera ` +
              `son ${CABECERA}`,
    };
  }
  for (let i = 0; i < 4; i++) {
    if (fichero[i] !== MAGIA_PVLT[i]) {
      return { tipo: RESULTADO.CORRUPTO, motivo: 'no empieza por PVLT' };
    }
  }
  const version = fichero[4];
  if (version > VERSION_FORMATO) {
    // No se intenta adivinar: un lector viejo que se invente como leer un
    // formato nuevo puede devolver una boveda a medias sin decir nada.
    return {
      tipo: RESULTADO.CORRUPTO,
      motivo: `el fichero es de la version ${version} y esta app entiende ` +
              `hasta la ${VERSION_FORMATO}`,
    };
  }
  if (fichero[5] !== KDF_ARGON2ID) {
    return { tipo: RESULTADO.CORRUPTO, motivo: 'usa un KDF que no conozco' };
  }

  const v = new DataView(fichero.buffer, fichero.byteOffset);
  const memoriaKib = v.getUint32(6, false);
  const iteraciones = fichero[10];
  const paralelismo = fichero[11];
  if (memoriaKib <= 0 || iteraciones <= 0 || paralelismo <= 0) {
    return {
      tipo: RESULTADO.CORRUPTO,
      motivo: 'los parametros del KDF no tienen sentido',
    };
  }
  if (memoriaKib > MAXIMO_MEMORIA_KDF_KIB) {
    return {
      tipo: RESULTADO.CORRUPTO,
      motivo: `el fichero pide ${Math.round(memoriaKib / 1024)} MiB para el ` +
              `KDF, mas del maximo admitido`,
    };
  }
  if (iteraciones > 64 || paralelismo > 64) {
    return {
      tipo: RESULTADO.CORRUPTO,
      motivo: 'los parametros del KDF son desproporcionados',
    };
  }

  const aad = fichero.slice(0, 28);
  const sal = fichero.slice(12, 28);
  const nonceClave = fichero.slice(28, 40);
  const claveEnvuelta = fichero.slice(40, 88);
  const nonceContenido = fichero.slice(88, 100);
  const largo = v.getUint32(100, false);
  if (largo < 0 || 104 + largo > fichero.length) {
    return {
      tipo: RESULTADO.CORRUPTO,
      motivo: 'la longitud declarada no cabe en el fichero',
    };
  }
  const contenidoCifrado = fichero.slice(104, 104 + largo);

  const claveMaestra = claveDirecta ?? await derivaClaveMaestra(
    contrasena, sal, memoriaKib, iteraciones, paralelismo);

  const claveBoveda = await descifra(claveMaestra, nonceClave, claveEnvuelta,
                                     aad);
  if (!claveBoveda) return { tipo: RESULTADO.CONTRASENA };

  // A partir de aqui la contrasena era buena: si algo falla ahora, el fichero
  // esta danado, y eso es otra conversacion con el usuario.
  const comprimido = await descifra(claveBoveda, nonceContenido,
                                    contenidoCifrado, aad);
  if (!comprimido) {
    return {
      tipo: RESULTADO.CORRUPTO,
      motivo: 'la contrasena es correcta pero el contenido no supera su ' +
              'comprobacion de integridad',
    };
  }
  try {
    return {
      tipo: RESULTADO.BIEN,
      contenido: await descomprime(comprimido),
      claveMaestra,
      cabecera: { sal, memoriaKib, iteraciones, paralelismo },
    };
  } catch (e) {
    return {
      tipo: RESULTADO.CORRUPTO,
      motivo: 'el contenido no se puede descomprimir',
    };
  }
}

// -------------------------------------------------- serializacion PVDB

export const TIPO = {
  LOGIN: 1, NOTA: 2, TARJETA: 3, IDENTIDAD: 4, WIFI: 5, LICENCIA: 6,
};

class Escritor {
  constructor() { this.trozos = []; }
  byte(v) { this.trozos.push(new Uint8Array([v & 0xff])); }
  u16(v) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, false);
    this.trozos.push(b);
  }
  u32(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, false);
    this.trozos.push(b);
  }
  bytes(b) { this.trozos.push(b); }
  textoCorto(s) {
    let b = TEXTO.encode(s ?? '');
    if (b.length > 255) b = b.subarray(0, 255);
    this.byte(b.length); this.bytes(b);
  }
  textoLargo(s) {
    let b = TEXTO.encode(s ?? '');
    if (b.length > 65535) b = b.subarray(0, 65535);
    this.u16(b.length); this.bytes(b);
  }
  final() { return une(...this.trozos); }
}

class Lector {
  constructor(datos) { this.d = datos; this.pos = 0; }
  exige(n) {
    if (this.pos + n > this.d.length) {
      throw new Error(`se acaban los datos en el byte ${this.pos}`);
    }
  }
  byte() { this.exige(1); return this.d[this.pos++]; }
  u16() { const a = this.byte(), b = this.byte(); return (a << 8) | b; }
  u32() {
    this.exige(4);
    const v = new DataView(this.d.buffer, this.d.byteOffset).getUint32(this.pos, false);
    this.pos += 4;
    return v;
  }
  bytes(n) { this.exige(n); const v = this.d.slice(this.pos, this.pos + n); this.pos += n; return v; }
  textoCorto() { return DESTEXTO.decode(this.bytes(this.byte())); }
  textoLargo() { return DESTEXTO.decode(this.bytes(this.u16())); }
}

export function codificaBoveda(entradas) {
  const e = new Escritor();
  e.bytes(Uint8Array.from(MAGIA_PVDB));
  e.byte(1);
  e.u32(entradas.length);
  for (const x of entradas) {
    e.byte(x.tipo ?? TIPO.LOGIN);
    let banderas = 0;
    if (x.favorito) banderas |= 1;
    if (x.permitidoEnReloj) banderas |= 2;
    if (x.secretoTotp && x.secretoTotp.length) banderas |= 4;
    e.byte(banderas);
    e.u32(x.creado ?? 0);
    e.u32(x.modificado ?? 0);
    e.textoCorto(x.titulo);
    e.textoCorto(x.usuario);
    e.textoLargo(x.secreto);
    e.textoCorto(x.dominio);
    e.textoCorto(x.carpeta);
    e.textoCorto(x.notas);
    const totp = x.secretoTotp ?? new Uint8Array(0);
    e.byte(totp.length);
    e.bytes(totp);
    e.byte(x.digitosTotp ?? 6);
    e.byte(Math.floor((x.periodoTotp ?? 30) / 5));
  }
  return e.final();
}

export function descodificaBoveda(datos) {
  const l = new Lector(datos);
  for (let i = 0; i < 4; i++) {
    if (l.byte() !== MAGIA_PVDB[i]) throw new Error('no empieza por PVDB');
  }
  const version = l.byte();
  if (version > 1) throw new Error(`boveda de version ${version}`);
  const n = l.u32();
  if (n < 0 || n > 100000) throw new Error(`numero de entradas absurdo: ${n}`);

  const salida = [];
  for (let i = 0; i < n; i++) {
    const tipo = l.byte();
    const banderas = l.byte();
    const creado = l.u32();
    const modificado = l.u32();
    const titulo = l.textoCorto();
    const usuario = l.textoCorto();
    const secreto = l.textoLargo();
    const dominio = l.textoCorto();
    const carpeta = l.textoCorto();
    const notas = l.textoCorto();
    const largoTotp = l.byte();
    const secretoTotp = largoTotp > 0 ? l.bytes(largoTotp) : null;
    const digitos = l.byte();
    const periodo = l.byte() * 5;
    salida.push({
      tipo, titulo, usuario, secreto, dominio, carpeta, notas,
      favorito: (banderas & 1) !== 0,
      permitidoEnReloj: (banderas & 2) !== 0,
      secretoTotp,
      digitosTotp: digitos >= 6 && digitos <= 8 ? digitos : 6,
      periodoTotp: periodo > 0 ? periodo : 30,
      creado, modificado,
    });
  }
  return salida;
}
