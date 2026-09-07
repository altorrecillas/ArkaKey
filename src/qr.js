// Codificador de QR en modo binario, versiones 1 a 20, niveles L y M.
//
// Es la **tercera** implementacion del mismo codificador: ya existe en Python
// (`tools/qr.py`) y en Monkey C (el reloj). Se porta otra vez en vez de traer
// una libreria por dos razones:
//
//  1. Las tres tienen que producir **el mismo simbolo bit a bit**, porque las
//     tres alimentan al mismo lector. Una libreria de fuera podria elegir otra
//     mascara o codificar en otro modo y seguir siendo correcta, y entonces la
//     comparacion cruzada dejaria de detectar errores.
//  2. `tools/comparar_js.js` comprueba exactamente eso: matriz contra matriz
//     con el gemelo de Python, las ocho mascaras, versiones 1 a 20. Es la misma
//     prueba que valido el port a Monkey C.
//
// Referencia: ISO/IEC 18004.

export const NIVEL_L = 0;
export const NIVEL_M = 1;

// Bytes de correccion por bloque y reparto de bloques, por version.
// [bytes_correccion, repeticiones, datos, repeticiones, datos...]
const BLOQUES = [
  // nivel L
  [
    [7, 1, 19], [10, 1, 34], [15, 1, 55], [20, 1, 80], [26, 1, 108],
    [18, 2, 68], [20, 2, 78], [24, 2, 97], [30, 2, 116],
    [18, 2, 68, 2, 69], [20, 4, 81], [24, 2, 92, 2, 93], [26, 4, 107],
    [30, 3, 115, 1, 116], [22, 5, 87, 1, 88], [24, 5, 98, 1, 99],
    [28, 1, 107, 5, 108], [30, 5, 120, 1, 121], [28, 3, 113, 4, 114],
    [28, 3, 107, 5, 108],
  ],
  // nivel M
  [
    [10, 1, 16], [16, 1, 28], [26, 1, 44], [18, 2, 32], [24, 2, 43],
    [16, 4, 27], [18, 4, 31], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44], [30, 1, 50, 4, 51], [22, 6, 36, 2, 37],
    [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42],
    [28, 7, 45, 3, 46], [28, 10, 46, 1, 47], [26, 9, 43, 4, 44],
    [26, 3, 44, 11, 45], [26, 3, 41, 13, 42],
  ],
];

// Centros de los patrones de alineacion. La version 1 no lleva ninguno.
const ALINEACION = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38],
  [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58],
  [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
  [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
];

// Los dos bits que identifican el nivel dentro de la informacion de formato.
// No siguen el orden L,M,Q,H.
const BITS_NIVEL = [1, 0];
const MODO_BINARIO = 4;
const LIBRE = 2;

// ------------------------------------------------------- campo de Galois

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function iniciaGalois() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;      // polinomio primitivo que fija la norma
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// Cache por grado. Solo hay veinte grados posibles y el mismo generador sirve
// para todos los bloques del simbolo: reconstruirlo por bloque tira entre el
// 50 % y el 87 % del trabajo, segun la version.
const GENERADORES = new Map();

// (x - a^0)(x - a^1)... de mayor a menor grado. El orden importa: al reves,
// los bytes de correccion salen con pinta valida y no corrigen nada.
function polinomioGenerador(grado) {
  const guardado = GENERADORES.get(grado);
  if (guardado) return guardado;
  let g = [1];
  for (let i = 0; i < grado; i++) {
    const nuevo = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      nuevo[j] ^= g[j];                          // por x
      nuevo[j + 1] ^= gfMul(g[j], GF_EXP[i]);    // por a^i
    }
    g = nuevo;
  }
  GENERADORES.set(grado, g);
  return g;
}

function correccion(datos, nEcc) {
  const gen = polinomioGenerador(nEcc);
  const resto = new Uint8Array(nEcc);
  for (const b of datos) {
    const factor = b ^ resto[0];
    for (let i = 0; i < nEcc - 1; i++) {
      resto[i] = resto[i + 1] ^ gfMul(gen[i + 1], factor);
    }
    resto[nEcc - 1] = gfMul(gen[nEcc], factor);
  }
  return resto;
}

// ------------------------------------------------------------ capacidad

function bloques(version, nivel) { return BLOQUES[nivel][version - 1]; }

function palabrasDatos(version, nivel) {
  const b = bloques(version, nivel);
  let total = 0;
  for (let i = 1; i < b.length; i += 2) total += b[i] * b[i + 1];
  return total;
}

export function capacidad(version, nivel = NIVEL_L) {
  const bitsLongitud = version < 10 ? 8 : 16;
  return palabrasDatos(version, nivel) - 1 - bitsLongitud / 8;
}

export function versionMinima(nBytes, nivel = NIVEL_L, tope = 20) {
  for (let v = 1; v <= tope; v++) if (capacidad(v, nivel) >= nBytes) return v;
  return -1;
}

export function lado(version) { return 17 + 4 * version; }

// ------------------------------------------------------------- mascaras

function mascara(patron, fila, col) {
  switch (patron) {
    case 0: return (fila + col) % 2 === 0;
    case 1: return fila % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (fila + col) % 3 === 0;
    case 4: return (Math.floor(fila / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((fila * col) % 2) + ((fila * col) % 3) === 0;
    case 6: return (((fila * col) % 2) + ((fila * col) % 3)) % 2 === 0;
    default: return (((fila + col) % 2) + ((fila * col) % 3)) % 2 === 0;
  }
}

// 15 bits de informacion de formato, con BCH(15,5) y la mascara final.
function bitsFormato(nivel, patron) {
  const datos = (BITS_NIVEL[nivel] << 3) | patron;
  let v = datos << 10;
  for (let i = 4; i >= 0; i--) {
    if (v & (1 << (i + 10))) v ^= 0x537 << i;
  }
  return ((datos << 10) | v) ^ 0x5412;
}

// 18 bits de informacion de version, con BCH(18,6). Solo de la 7 en adelante.
function bitsVersion(version) {
  let v = version << 12;
  for (let i = 5; i >= 0; i--) {
    if (v & (1 << (i + 12))) v ^= 0x1f25 << i;
  }
  return (version << 12) | v;
}

// ------------------------------------------------------------ datos

function codificaDatos(carga, version, nivel) {
  const nDatos = palabrasDatos(version, nivel);
  const bitsLongitud = version < 10 ? 8 : 16;
  const datos = new Uint8Array(nDatos);

  let acum = 0, nBits = 0, pos = 0;
  acum = (acum << 4) | MODO_BINARIO;
  nBits += 4;
  for (let i = bitsLongitud - 1; i >= 0; i--) {
    acum = (acum << 1) | ((carga.length >> i) & 1);
    nBits++;
    if (nBits >= 8) {
      datos[pos++] = (acum >> (nBits - 8)) & 0xff;
      nBits -= 8;
      acum &= (1 << nBits) - 1;
    }
  }
  for (const b of carga) {
    acum = (acum << 8) | b;
    nBits += 8;
    datos[pos++] = (acum >> (nBits - 8)) & 0xff;
    nBits -= 8;
    acum &= (1 << nBits) - 1;
  }
  // Terminador de hasta cuatro ceros y cuadrar a byte: como los ceros a la
  // derecha no cambian el acumulador, basta con volcar lo que quede.
  if (nBits > 0) datos[pos++] = (acum << (8 - nBits)) & 0xff;

  // Relleno alterno 0xEC / 0x11 que exige la norma.
  let alterna = 0;
  while (pos < nDatos) {
    datos[pos++] = alterna === 0 ? 0xec : 0x11;
    alterna = 1 - alterna;
  }

  // Reparto en bloques y correccion.
  const b = bloques(version, nivel);
  const nEcc = b[0];
  const bloquesDatos = [], bloquesEcc = [];
  let p = 0;
  for (let i = 1; i < b.length; i += 2) {
    for (let k = 0; k < b[i]; k++) {
      const trozo = datos.subarray(p, p + b[i + 1]);
      p += b[i + 1];
      bloquesDatos.push(trozo);
      bloquesEcc.push(correccion(trozo, nEcc));
    }
  }

  // Intercalado: un byte de cada bloque de datos y luego lo mismo con los de
  // correccion. Es lo que reparte una rafaga de suciedad entre varios bloques
  // en vez de cargarse uno entero.
  const salida = [];
  let mayor = 0;
  for (const bl of bloquesDatos) mayor = Math.max(mayor, bl.length);
  for (let i = 0; i < mayor; i++) {
    for (const bl of bloquesDatos) if (i < bl.length) salida.push(bl[i]);
  }
  for (let i = 0; i < nEcc; i++) {
    for (const bl of bloquesEcc) salida.push(bl[i]);
  }
  return Uint8Array.from(salida);
}

// -------------------------------------------------------------- matriz

function patrones(version) {
  const n = lado(version);
  const m = new Int8Array(n * n).fill(LIBRE);
  const pon = (y, x, v) => { m[y * n + x] = v; };
  const lee = (y, x) => m[y * n + x];

  const buscador = (fila, col) => {
    for (let i = -1; i < 8; i++) {
      for (let j = -1; j < 8; j++) {
        const y = fila + i, x = col + j;
        if (y < 0 || y >= n || x < 0 || x >= n) continue;
        const borde = ((i === 0 || i === 6) && j >= 0 && j <= 6) ||
                      ((j === 0 || j === 6) && i >= 0 && i <= 6);
        const centro = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        pon(y, x, borde || centro ? 1 : 0);
      }
    }
  };
  buscador(0, 0); buscador(0, n - 7); buscador(n - 7, 0);

  for (let i = 8; i < n - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    pon(6, i, v); pon(i, 6, v);
  }

  const centros = ALINEACION[version - 1];
  for (const a of centros) {
    for (const c of centros) {
      if ((a === 6 && c === 6) || (a === 6 && c === n - 7) ||
          (a === n - 7 && c === 6)) continue;
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const borde = i === -2 || i === 2 || j === -2 || j === 2;
          const centro = i === 0 && j === 0;
          pon(a + i, c + j, borde || centro ? 1 : 0);
        }
      }
    }
  }

  pon(n - 8, 8, 1);      // modulo que siempre va negro

  for (let i = 0; i < 9; i++) {
    if (lee(8, i) === LIBRE) pon(8, i, 0);
    if (lee(i, 8) === LIBRE) pon(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (lee(8, n - 1 - i) === LIBRE) pon(8, n - 1 - i, 0);
    if (lee(n - 1 - i, 8) === LIBRE) pon(n - 1 - i, 8, 0);
  }
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        pon(n - 11 + j, i, 0);
        pon(i, n - 11 + j, 0);
      }
    }
  }
  return m;
}

/**
 * Devuelve la matriz de modulos como Int8Array de lado*lado.
 *
 * La mascara **no se busca**: se pasa como argumento. Es la misma decision que
 * en el reloj, y por la misma razon medida: buscar la mejor de las ocho
 * multiplica por ocho el trabajo y la diferencia en simbolos que el lector no
 * lee es de medio punto porcentual. La variante del fotograma decide la
 * mascara, y como la variante cambia en cada vuelta, cambia tambien el dibujo.
 */
export function matriz(carga, nivel = NIVEL_L, version = null, patron = 0) {
  if (typeof carga === 'string') {
    const b = new Uint8Array(carga.length);
    for (let i = 0; i < carga.length; i++) b[i] = carga.charCodeAt(i) & 0xff;
    carga = b;
  }
  if (version == null) {
    version = versionMinima(carga.length, nivel);
    if (version < 0) throw new Error('no cabe en las versiones 1 a 20');
  }
  if (carga.length > capacidad(version, nivel)) {
    throw new Error(
      `carga de ${carga.length} bytes, caben ${capacidad(version, nivel)}`);
  }

  const finales = codificaDatos(carga, version, nivel);
  const n = lado(version);
  const base = patrones(version);
  const m = Int8Array.from(base);

  // Zigzag de abajo a la derecha hacia arriba, en columnas de dos, saltando la
  // columna de sincronismo. La mascara se aplica al vuelo.
  let bit = 0;
  let col = n - 1;
  let arriba = true;
  while (col > 0) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const fila = arriba ? n - 1 - i : i;
      for (let d = 0; d < 2; d++) {
        const x = col - d;
        if (base[fila * n + x] !== LIBRE) continue;
        const indice = bit >> 3;
        let v = indice < finales.length
          ? (finales[indice] >> (7 - (bit & 7))) & 1
          : 0;
        bit++;
        if (mascara(patron & 7, fila, x)) v ^= 1;
        m[fila * n + x] = v;
      }
    }
    arriba = !arriba;
    col -= 2;
  }

  // Informacion de formato: los 15 bits van dos veces, una bajando por la
  // izquierda del buscador de arriba a la izquierda y otra repartida entre las
  // otras dos esquinas. Los saltos de indice esquivan la banda de sincronismo.
  const bf = bitsFormato(nivel, patron & 7);
  for (let i = 0; i < 15; i++) {
    const b = (bf >> i) & 1;
    if (i < 6) m[i * n + 8] = b;
    else if (i < 8) m[(i + 1) * n + 8] = b;
    else m[(n - 15 + i) * n + 8] = b;

    if (i < 8) m[8 * n + (n - 1 - i)] = b;
    else if (i < 9) m[8 * n + (15 - i)] = b;
    else m[8 * n + (14 - i)] = b;
  }

  if (version >= 7) {
    const bv = bitsVersion(version);
    for (let i = 0; i < 18; i++) {
      const b = (bv >> i) & 1;
      m[Math.floor(i / 3) * n + (n - 11 + (i % 3))] = b;
      m[(n - 11 + (i % 3)) * n + Math.floor(i / 3)] = b;
    }
  }

  return { modulos: m, lado: n, version };
}

/** Pinta la matriz en un canvas, con la zona de silencio que exige la norma. */
export function dibuja(canvas, simbolo, opciones = {}) {
  const borde = opciones.borde ?? 4;
  const claro = opciones.claro ?? '#ffffff';
  const oscuro = opciones.oscuro ?? '#000000';
  const n = simbolo.lado;
  const total = n + 2 * borde;
  // Se calcula el modulo en pixeles enteros: con modulos fraccionarios el
  // navegador reparte medio pixel entre dos modulos y el lector ve bordes
  // grises donde deberia haber un salto limpio.
  const disponible = Math.min(canvas.width, canvas.height);
  const modulo = Math.max(1, Math.floor(disponible / total));
  const ladoPintado = modulo * total;
  const x0 = Math.floor((canvas.width - ladoPintado) / 2);
  const y0 = Math.floor((canvas.height - ladoPintado) / 2);

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = claro;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = oscuro;
  for (let y = 0; y < n; y++) {
    // Se juntan los modulos encendidos seguidos en un solo rectangulo: en una
    // version 20 hay 9.409 modulos y pintarlos de uno en uno cuesta cuatro
    // veces mas que pintarlos por tramos.
    let inicio = -1;
    for (let x = 0; x <= n; x++) {
      const on = x < n && simbolo.modulos[y * n + x] === 1;
      if (on && inicio < 0) inicio = x;
      else if (!on && inicio >= 0) {
        ctx.fillRect(
          x0 + (borde + inicio) * modulo, y0 + (borde + y) * modulo,
          (x - inicio) * modulo, modulo,
        );
        inicio = -1;
      }
    }
  }
  return modulo;
}
