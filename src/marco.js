// Fotogramas de QR: montarlos y recogerlos.
//
// Mismo formato exacto que emite el reloj Garmin y que entiende la aplicacion
// Android. Ese es el punto: cualquiera de los tres puede emitir y cualquiera
// puede leer, sin conversiones ni casos especiales.
//
// Cabecera de 18 bytes, todo en orden de red:
//
//   0   1   'V' (0x56)
//   1   1   version de formato (4 bits altos) y variante (4 bits bajos)
//   2   2   indice de este fotograma
//   4   2   total de fotogramas
//   6   4   longitud total del contenido
//   10  4   CRC-32 del contenido completo
//   14  4   CRC-32 de este fotograma
//   18  ..  trozo

export const CABECERA = 18;
export const MAGIA = 0x56;
export const VERSION = 1;

/**
 * Techos de lo que se acepta de un flujo de codigos.
 *
 * Los codigos vienen de fuera: se leen de una pantalla que alguien pone delante
 * de la camara. Sin limites, un flujo preparado a mala fe podia declarar 65.535
 * fotogramas de 2.953 bytes y hacer reservar unos 250 MB, que en un movil es
 * quedarse sin memoria.
 *
 * Son holgados para cualquier uso real: la version 16 lleva 586 bytes utiles
 * por codigo, asi que 2.048 codigos son 1,2 MB de boveda, y eso ya son cuarenta
 * minutos delante de la camara.
 */
export const MAXIMO_FOTOGRAMAS = 2048;
export const MAXIMO_CONTENIDO = 4 * 1024 * 1024;

// ------------------------------------------------------------- CRC-32

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(datos, inicial = 0xffffffff) {
  let c = inicial >>> 0;
  for (let i = 0; i < datos.length; i++) {
    c = (TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------- montar

/**
 * Parte un contenido en fotogramas listos para pintar.
 *
 * `bytesPorFotograma` es la capacidad del simbolo QR elegido, cabecera
 * incluida. La variante va aparte porque cambia en cada vuelta del bucle: es
 * lo que hace que un fotograma que el lector no supo leer tenga otra
 * oportunidad con otro dibujo.
 */
export function trocea(contenido, bytesPorFotograma) {
  const util = bytesPorFotograma - CABECERA;
  if (util <= 0) throw new Error('el fotograma no da ni para la cabecera');
  const total = Math.ceil(contenido.length / util);
  if (total > MAXIMO_FOTOGRAMAS) {
    throw new Error(`harian falta ${total} codigos, el maximo son ${MAXIMO_FOTOGRAMAS}`);
  }
  const crcTotal = crc32(contenido);
  const trozos = [];
  for (let i = 0; i < total; i++) {
    trozos.push({
      indice: i,
      desde: i * util,
      hasta: Math.min((i + 1) * util, contenido.length),
    });
  }
  return { trozos, total, crcTotal, contenido };
}

/** Monta el fotograma `indice` del troceado, con esa variante. */
export function montaTrama(troceado, indice, variante = 0) {
  const t = troceado.trozos[indice];
  const largo = t.hasta - t.desde;
  const trama = new Uint8Array(CABECERA + largo);
  const v = new DataView(trama.buffer);
  trama[0] = MAGIA;
  trama[1] = ((VERSION & 0x0f) << 4) | (variante & 0x0f);
  v.setUint16(2, indice, false);
  v.setUint16(4, troceado.total, false);
  v.setUint32(6, troceado.contenido.length, false);
  v.setUint32(10, troceado.crcTotal, false);
  v.setUint32(14, 0, false);
  trama.set(troceado.contenido.subarray(t.desde, t.hasta), CABECERA);
  v.setUint32(14, crc32(trama), false);
  return trama;
}

// ------------------------------------------------------------ recoger

export const AVISO = {
  DESCARTADO: 'descartado',
  REPETIDO: 'repetido',
  PROGRESO: 'progreso',
  COMPLETO: 'completo',
  OTRA: 'otra',
};

/**
 * Recoge fotogramas segun van llegando.
 *
 * No espera orden ni sincronizacion: quien emite lo hace en bucle y la camara
 * pilla lo que puede. Se le van dando contenidos y avisa cuando ya tiene todo.
 */
export class Recolector {
  constructor() { this.reinicia(); }

  reinicia() {
    this.piezas = new Map();
    this.total = -1;
    this.longitud = -1;
    this.crcContenido = 0;
  }

  get recogidos() { return this.piezas.size; }

  faltan() {
    if (this.total < 0) return [];
    const f = [];
    for (let i = 0; i < this.total; i++) if (!this.piezas.has(i)) f.push(i);
    return f;
  }

  aporta(crudo) {
    const t = this.analiza(crudo);
    if (!t) return { tipo: AVISO.DESCARTADO };

    if (this.total < 0) {
      this.total = t.total;
      this.longitud = t.longitud;
      this.crcContenido = t.crcContenido;
    } else if (t.total !== this.total || t.crcContenido !== this.crcContenido ||
               t.longitud !== this.longitud) {
      // Fotogramas de dos transferencias distintas. Pasa si quien emite
      // reinicia el envio a media captura; juntar trozos de las dos daria una
      // boveda que no abre y sin pista de por que.
      return { tipo: AVISO.OTRA };
    }

    if (this.piezas.has(t.indice)) return { tipo: AVISO.REPETIDO };
    this.piezas.set(t.indice, t.datos);

    if (this.piezas.size < this.total) {
      return { tipo: AVISO.PROGRESO, tengo: this.piezas.size, total: this.total };
    }
    const contenido = this.junta();
    if (!contenido) {
      return { tipo: AVISO.PROGRESO, tengo: this.piezas.size, total: this.total };
    }
    return { tipo: AVISO.COMPLETO, contenido };
  }

  junta() {
    const salida = new Uint8Array(this.longitud);
    let puestos = 0;
    for (let i = 0; i < this.total; i++) {
      const p = this.piezas.get(i);
      if (!p) return null;
      if (puestos + p.length > this.longitud) return null;
      salida.set(p, puestos);
      puestos += p.length;
    }
    if (puestos !== this.longitud) return null;
    // Comprobacion final: los CRC por fotograma ya filtraron los mal leidos,
    // este cubre que dos fotogramas validos se hayan mezclado mal.
    if (crc32(salida) !== this.crcContenido) return null;
    return salida;
  }

  analiza(t) {
    if (!t || t.length < CABECERA) return null;
    if (t[0] !== MAGIA) return null;
    if (((t[1] >> 4) & 0x0f) !== VERSION) return null;

    const v = new DataView(t.buffer, t.byteOffset, t.length);
    const variante = t[1] & 0x0f;
    const indice = v.getUint16(2, false);
    const total = v.getUint16(4, false);
    const longitud = v.getUint32(6, false);
    const crcContenido = v.getUint32(10, false);
    const crcTrama = v.getUint32(14, false);

    if (total <= 0 || indice >= total) return null;
    if (total > MAXIMO_FOTOGRAMAS) return null;
    if (longitud <= 0 || longitud > MAXIMO_CONTENIDO) return null;
    // La suma de los trozos no puede pasar de lo declarado. Sin esto, un flujo
    // con fotogramas mas gordos de lo que toca hincha el mapa de piezas muy por
    // encima de `longitud`.
    if (t.length - CABECERA > longitud) return null;

    // El CRC del fotograma se calcula con sus propios cuatro bytes a cero.
    const limpio = t.slice();
    limpio[14] = 0; limpio[15] = 0; limpio[16] = 0; limpio[17] = 0;
    if (crc32(limpio) !== crcTrama) return null;

    return {
      variante, indice, total, longitud, crcContenido,
      datos: t.slice(CABECERA),
    };
  }
}
