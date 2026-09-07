// TOTP, generador de contrasenas y centro de seguridad.
//
// Mismas reglas y mismos valores que el modulo `nucleo` de Android, para que
// una boveda se comporte igual en los dos sitios: los mismos avisos, las mismas
// contrasenas consideradas debiles y los mismos codigos de verificacion.

// ------------------------------------------------------------------ TOTP

const ALFABETO_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Descodifica base32. Tolera minusculas, espacios, guiones y relleno, porque
 * asi es como los servicios ensenan los secretos y como el usuario los pega.
 */
export function deBase32(texto) {
  const limpio = (texto || '').toUpperCase()
    .replace(/[\s\-=]/g, '');
  if (!limpio) return null;
  let acumulado = 0, bits = 0;
  const salida = [];
  for (const c of limpio) {
    const v = ALFABETO_B32.indexOf(c);
    if (v < 0) return null;
    acumulado = (acumulado << 5) | v;
    bits += 5;
    if (bits >= 8) {
      salida.push((acumulado >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(salida);
}

export function aBase32(datos) {
  let s = '', acumulado = 0, bits = 0;
  for (const b of datos) {
    acumulado = (acumulado << 8) | b;
    bits += 8;
    while (bits >= 5) {
      s += ALFABETO_B32[(acumulado >> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) s += ALFABETO_B32[(acumulado << (5 - bits)) & 0x1f];
  return s;
}

/** Codigo TOTP (RFC 6238). El algoritmo por defecto es SHA-1, como todos. */
export async function codigoTotp(secreto, segundos, periodo = 30, digitos = 6,
                                 algoritmo = 'SHA-1') {
  const contador = Math.floor(segundos / periodo);
  const mensaje = new Uint8Array(8);
  // El contador va como entero de 64 bits. En JavaScript los enteros de mas de
  // 32 bits no sobreviven a los desplazamientos, asi que la parte alta se
  // calcula dividiendo en vez de desplazando.
  const alta = Math.floor(contador / 0x100000000);
  const baja = contador >>> 0;
  new DataView(mensaje.buffer).setUint32(0, alta, false);
  new DataView(mensaje.buffer).setUint32(4, baja, false);

  const clave = await crypto.subtle.importKey(
    'raw', secreto, { name: 'HMAC', hash: algoritmo }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', clave, mensaje));

  // Truncado dinamico del RFC 4226: los cuatro bits bajos del ultimo byte
  // dicen por donde cortar.
  const d = mac[mac.length - 1] & 0x0f;
  const binario = ((mac[d] & 0x7f) << 24) | ((mac[d + 1] & 0xff) << 16) |
                  ((mac[d + 2] & 0xff) << 8) | (mac[d + 3] & 0xff);
  let modulo = 1;
  for (let i = 0; i < digitos; i++) modulo *= 10;
  // Con ceros a la izquierda: un codigo que empiece por cero se escribe con el
  // cero, o no lo acepta nadie.
  return String(binario % modulo).padStart(digitos, '0');
}

export function segundosRestantes(segundos, periodo = 30) {
  return periodo - (segundos % periodo);
}

/** Lee una URI `otpauth://`, que es lo que trae el QR de los servicios. */
export function deUriOtp(uri) {
  if (!/^otpauth:\/\/totp\//i.test(uri)) return null;
  const sinEsquema = uri.slice('otpauth://totp/'.length);
  const corte = sinEsquema.indexOf('?');
  if (corte < 0) return null;
  const etiqueta = decodeURIComponent(sinEsquema.slice(0, corte));
  const parametros = new URLSearchParams(sinEsquema.slice(corte + 1));
  const secreto = deBase32(parametros.get('secret') || '');
  if (!secreto) return null;

  // La etiqueta suele venir como "Emisor:cuenta".
  const dosPuntos = etiqueta.indexOf(':');
  const emisor = parametros.get('issuer') ||
    (dosPuntos > 0 ? etiqueta.slice(0, dosPuntos) : '');
  const cuenta = dosPuntos > 0 ? etiqueta.slice(dosPuntos + 1) : etiqueta;

  const digitos = Number(parametros.get('digits'));
  const periodo = Number(parametros.get('period'));
  return {
    titulo: emisor || cuenta,
    usuario: cuenta,
    secretoTotp: secreto,
    digitosTotp: digitos >= 6 && digitos <= 8 ? digitos : 6,
    periodoTotp: periodo > 0 ? periodo : 30,
  };
}

// ------------------------------------------------------------- generador

export const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';      // sin la ele
export const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';       // sin I ni O
export const DIGITOS = '23456789';                          // sin 0 ni 1
export const SIMBOLOS = '!@#$%&*+-=?_';
export const MINUSCULAS_TODAS = 'abcdefghijklmnopqrstuvwxyz';
export const MAYUSCULAS_TODAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const DIGITOS_TODOS = '0123456789';

/**
 * Entero al azar sin sesgo, de 0 a n-1.
 *
 * `getRandomValues() % n` hace que los primeros valores salgan un poco mas que
 * los ultimos. Aqui se rechaza y se repite, que es la forma correcta y cuesta
 * lo mismo.
 */
function alAzar(n) {
  const limite = Math.floor(0x100000000 / n) * n;
  const b = new Uint32Array(1);
  let v;
  do { crypto.getRandomValues(b); v = b[0]; } while (v >= limite);
  return v % n;
}

export function generaContrasena(o = {}) {
  const longitud = o.longitud ?? 20;
  const sinAmbiguos = o.sinAmbiguos ?? true;
  const grupos = [];
  if (o.minusculas ?? true) grupos.push(sinAmbiguos ? MINUSCULAS : MINUSCULAS_TODAS);
  if (o.mayusculas ?? true) grupos.push(sinAmbiguos ? MAYUSCULAS : MAYUSCULAS_TODAS);
  if (o.digitos ?? true) grupos.push(sinAmbiguos ? DIGITOS : DIGITOS_TODOS);
  if (o.simbolos ?? true) grupos.push(SIMBOLOS);
  if (!grupos.length) throw new Error('hay que dejar al menos un tipo');
  if (longitud < grupos.length) {
    throw new Error('no cabe uno de cada tipo pedido');
  }

  const alfabeto = grupos.join('');
  const salida = new Array(longitud);
  // Uno de cada grupo primero: sin esto, una contrasena de doce caracteres
  // puede salir sin ningun digito y el sitio donde va a usarse la rechaza.
  for (let i = 0; i < grupos.length; i++) {
    salida[i] = grupos[i][alAzar(grupos[i].length)];
  }
  for (let i = grupos.length; i < longitud; i++) {
    salida[i] = alfabeto[alAzar(alfabeto.length)];
  }
  // Barajado de Fisher-Yates, para que los obligatorios no queden siempre al
  // principio.
  for (let i = salida.length - 1; i > 0; i--) {
    const j = alAzar(i + 1);
    [salida[i], salida[j]] = [salida[j], salida[i]];
  }
  return salida.join('');
}

/**
 * Bits de entropia del **generador**, no de la cadena resultante.
 *
 * La distincion importa: los medidores que puntuan la cadena dan resultados
 * absurdos, como decir que "P@ssw0rd!" es fuerte.
 */
export function bitsDeEntropia(o = {}) {
  const sinAmbiguos = o.sinAmbiguos ?? true;
  let tam = 0;
  if (o.minusculas ?? true) tam += (sinAmbiguos ? MINUSCULAS : MINUSCULAS_TODAS).length;
  if (o.mayusculas ?? true) tam += (sinAmbiguos ? MAYUSCULAS : MAYUSCULAS_TODAS).length;
  if (o.digitos ?? true) tam += (sinAmbiguos ? DIGITOS : DIGITOS_TODOS).length;
  if (o.simbolos ?? true) tam += SIMBOLOS.length;
  if (!tam) return 0;
  return (o.longitud ?? 20) * Math.log2(tam);
}

export function generaFrase(palabras, lista, separador = '-') {
  if (palabras < 3) throw new Error('menos de tres no es una frase de paso');
  const s = [];
  for (let i = 0; i < palabras; i++) s.push(lista[alAzar(lista.length)]);
  return s.join(separador);
}

// ------------------------------------------------------ centro de seguridad

export const GRAVEDAD = { ALTA: 0, MEDIA: 1, BAJA: 2 };
export const DIAS_ANTIGUA = 365;

const COMUNES = [
  'password', '123456', '123456789', 'qwerty', '12345678', '111111',
  '1234567890', '1234567', 'password1', 'abc123', 'contrasena',
  'iloveyou', 'admin', 'welcome', 'monkey', 'letmein', 'dragon',
  'sunshine', 'princess', 'football', '123123', '000000', 'qwerty123',
];

function esSecuencia(s) {
  if (s.length < 4) return false;
  let subiendo = true, bajando = true;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (d !== 1) subiendo = false;
    if (d !== -1) bajando = false;
  }
  return subiendo || bajando;
}

/**
 * Si una contrasena es debil.
 *
 * No puntua fortaleza, que es un problema mal planteado: caza las que estan
 * claramente mal. Nada de barras de colores que dan por buena una contrasena
 * mala solo porque lleva un simbolo al final.
 */
export function esDebil(secreto) {
  if (!secreto || secreto.length < 12) return true;
  if (COMUNES.some((c) => secreto.toLowerCase() === c)) return true;

  let clases = 0;
  if (/[a-z]/.test(secreto)) clases++;
  if (/[A-Z]/.test(secreto)) clases++;
  if (/[0-9]/.test(secreto)) clases++;
  if (/[^a-zA-Z0-9]/.test(secreto)) clases++;
  if (clases <= 1 && secreto.length < 20) return true;

  if (new Set(secreto).size <= 2) return true;
  if (esSecuencia(secreto)) return true;
  return false;
}

export function normalizaDominio(dominio) {
  let d = (dominio || '').trim().toLowerCase();
  for (const p of ['https://', 'http://']) {
    if (d.startsWith(p)) d = d.slice(p.length);
  }
  d = d.split('/')[0].split(':')[0];
  if (d.startsWith('www.')) d = d.slice(4);
  return d;
}

export function revisaSeguridad(entradas, ahoraSegundos) {
  const avisos = [];
  const TIPO_LOGIN = 1;

  // 1. Repetidas: el peor problema real de casi todas las bovedas, porque una
  // filtracion en un sitio abre todos los demas.
  const porSecreto = new Map();
  entradas.forEach((e, i) => {
    if (e.tipo === TIPO_LOGIN && e.secreto) {
      if (!porSecreto.has(e.secreto)) porSecreto.set(e.secreto, []);
      porSecreto.get(e.secreto).push(i);
    }
  });
  for (const indices of porSecreto.values()) {
    if (indices.length > 1) {
      avisos.push({
        gravedad: GRAVEDAD.ALTA, clase: 'reutilizada',
        titulo: `Contrasena repetida en ${indices.length} sitios`,
        detalle: 'Si se filtra uno de ellos, quedan expuestos todos los demas.',
        entradas: indices,
      });
    }
  }

  const debiles = [];
  entradas.forEach((e, i) => {
    if (e.tipo === TIPO_LOGIN && e.secreto && esDebil(e.secreto)) debiles.push(i);
  });
  if (debiles.length) {
    avisos.push({
      gravedad: GRAVEDAD.ALTA, clase: 'debil',
      titulo: `${debiles.length} contrasenas debiles`,
      detalle: 'Cortas, con poca variedad o de las que salen en cualquier lista.',
      entradas: debiles,
    });
  }

  const limite = ahoraSegundos - DIAS_ANTIGUA * 24 * 3600;
  const antiguas = [];
  entradas.forEach((e, i) => {
    if (e.tipo === TIPO_LOGIN && e.modificado > 0 && e.modificado < limite) {
      antiguas.push(i);
    }
  });
  if (antiguas.length) {
    avisos.push({
      gravedad: GRAVEDAD.BAJA, clase: 'antigua',
      titulo: `${antiguas.length} sin cambiar en un ano`,
      detalle: 'No es urgente por si solo, pero conviene repasarlas.',
      entradas: antiguas,
    });
  }

  const sinDominio = [];
  entradas.forEach((e, i) => {
    if (e.tipo === TIPO_LOGIN && !(e.dominio || '').trim()) sinDominio.push(i);
  });
  if (sinDominio.length) {
    avisos.push({
      gravedad: GRAVEDAD.MEDIA, clase: 'sin-dominio',
      titulo: `${sinDominio.length} sin sitio asociado`,
      detalle: 'Sin el sitio no se pueden ofrecer al rellenar.',
      entradas: sinDominio,
    });
  }

  const porPar = new Map();
  entradas.forEach((e, i) => {
    if ((e.dominio || '').trim() && (e.usuario || '').trim()) {
      const k = `${normalizaDominio(e.dominio)}|${e.usuario.toLowerCase()}`;
      if (!porPar.has(k)) porPar.set(k, []);
      porPar.get(k).push(i);
    }
  });
  const duplicados = [];
  for (const v of porPar.values()) if (v.length > 1) duplicados.push(...v);
  if (duplicados.length) {
    avisos.push({
      gravedad: GRAVEDAD.BAJA, clase: 'duplicada',
      titulo: 'Entradas duplicadas',
      detalle: 'Mismo sitio y mismo usuario en mas de una entrada.',
      entradas: duplicados,
    });
  }

  return avisos.sort((a, b) => a.gravedad - b.gravedad);
}
