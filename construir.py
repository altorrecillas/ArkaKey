#!/usr/bin/env python3
"""Monta el `index.html` de la PWA, autocontenido en un solo fichero.

Por que un solo fichero y no una carpeta de modulos: asi la aplicacion se puede
copiar a un pendrive, mandar por correo o abrir desde el disco sin servidor.
Para un gestor de contrasenas que promete no hablar con ningun servidor, poder
inspeccionar de un vistazo **todo** lo que se ejecuta es parte del trato.

Durante el desarrollo el codigo vive en `src/*.js` como modulos normales, que
es lo que permite probarlos con node. Aqui se juntan.

El empaquetado es a proposito tonto: no minifica, no reordena y no toca los
comentarios. El fichero que se publica se puede leer.

Vive dentro de `pwa/` y no en `tools/` a proposito: esta carpeta es la PWA
entera, autocontenida, para poder subirla a un repositorio propio sin
arrastrar el resto del proyecto (Android, el reloj) ni sus herramientas.
Las pruebas de interoperabilidad entre las tres aplicaciones -que si
necesitan el arbol completo- se quedan en `tools/`, un nivel por encima.

Uso:
    python3 construir.py
"""
import base64
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
PWA = AQUI

# Orden de dependencias. No se calcula solo: son cinco ficheros y una lista
# explicita se lee mejor que un resolvedor.
MODULOS = ["qr", "cripto", "marco", "boveda", "ui"]


def exportados(fuente):
    """Nombres que exporta un modulo."""
    nombres = []
    for m in re.finditer(r"^export\s+(?:async\s+)?function\s+(\w+)", fuente, re.M):
        nombres.append(m.group(1))
    for m in re.finditer(r"^export\s+(?:const|let|var|class)\s+(\w+)", fuente, re.M):
        nombres.append(m.group(1))
    return nombres


def convierte(nombre, fuente):
    """Convierte un modulo ES en una funcion que se registra en `__mods`.

    Se sustituyen los `import` por lecturas del registro y los `export` por
    declaraciones normales, y al final se devuelve un objeto con lo exportado.
    Funciona porque los modulos son propios y usan solo las dos formas de
    importacion que aparecen abajo; no pretende ser un empaquetador general.
    """
    nombres = exportados(fuente)

    # import * as x from './y.js'
    fuente = re.sub(
        r"^import\s+\*\s+as\s+(\w+)\s+from\s+['\"]\./(\w+)\.js['\"];?$",
        r"const \1 = __mods['\2'];", fuente, flags=re.M)
    # import { a, b } from './y.js'
    fuente = re.sub(
        r"^import\s+\{([^}]+)\}\s+from\s+['\"]\./(\w+)\.js['\"];?$",
        r"const {\1} = __mods['\2'];", fuente, flags=re.M)

    fuente = re.sub(r"^export\s+(?=(?:async\s+)?function|const|let|var|class)",
                    "", fuente, flags=re.M)

    devuelve = ", ".join(nombres)
    return (
        f"__mods['{nombre}'] = (function () {{\n"
        f"{fuente}\n"
        f"return {{ {devuelve} }};\n"
        f"}})();\n"
    )


def icono_png(tam, margen=0.0):
    """El icono de la aplicacion, desde `tools/marca.py` -si esta a mano.

    Aqui habia una copia del dibujo hecha a mano. Tener el icono en dos
    sitios garantiza que un dia se cambie uno y no el otro, y que la web
    acabe con un icono distinto del reloj sin que nadie se entere hasta
    verlos juntos -asi que el dibujo sigue viviendo en `tools/`, compartido
    con Android y el reloj, un nivel por encima de esta carpeta.

    Pero esta carpeta tambien tiene que poder construirse sola -clonada
    aparte, sin `tools/`, que es justo el punto de que la PWA viva en su
    propia carpeta-. Si `marca.py` no esta a mano, se devuelve `None` y
    quien llama se queda con el PNG que ya hay en `iconos/`, de la ultima
    vez que si se pudo regenerar.
    """
    sys.path.insert(0, os.path.join(PWA, os.pardir, "tools"))
    try:
        import marca
    except ImportError:
        return None
    return marca.dibuja(tam, margen=margen)

def main():
    partes = []
    for nombre in MODULOS:
        ruta = os.path.join(PWA, "src", f"{nombre}.js")
        partes.append(convierte(nombre, open(ruta, encoding="utf-8").read()))

    estilos = open(os.path.join(PWA, "src", "estilos.css"),
                   encoding="utf-8").read()
    argon2 = open(os.path.join(PWA, "vendor", "argon2.js"),
                  encoding="utf-8").read()
    jsqr = open(os.path.join(PWA, "vendor", "jsQR.js"),
                encoding="utf-8").read()

    # Iconos: se generan aqui y se meten como datos, para que el fichero no
    # dependa de nada externo.
    os.makedirs(os.path.join(PWA, "iconos"), exist_ok=True)
    iconos = {}
    # El de 512 se declara "maskable" mas abajo, o sea que el sistema puede
    # recortarlo a un circulo o a una gota: lleva margen para que no se coma la
    # cerradura. El de 192 se usa tal cual y va a sangre.
    for tam, margen in ((192, 0.0), (512, 0.10)):
        ruta = os.path.join(PWA, "iconos", f"icono-{tam}.png")
        imagen = icono_png(tam, margen)
        if imagen is not None:
            imagen.save(ruta)
        elif not os.path.isfile(ruta):
            raise SystemExit(
                f"Falta {ruta} y no se puede dibujar sin tools/marca.py "
                "(hace falta el proyecto entero para regenerar iconos; "
                "clonada suelta, esta carpeta solo reusa los que ya tiene)."
            )
        with open(ruta, "rb") as f:
            iconos[tam] = base64.b64encode(f.read()).decode()

    manifiesto = {
        "name": "ArcaKey",
        "short_name": "Vault",
        "description": "Gestor de contrasenas local, sin cuenta y sin servidor",
        "start_url": ".",
        "scope": ".",
        "display": "standalone",
        "background_color": "#0a1020",
        "theme_color": "#0a1020",
        "orientation": "portrait",
        "icons": [
            {"src": f"data:image/png;base64,{iconos[192]}",
             "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": f"data:image/png;base64,{iconos[512]}",
             "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
    }
    import json
    manifiesto_json = json.dumps(manifiesto, ensure_ascii=False)
    manifiesto_datos = ("data:application/manifest+json;base64," +
                        base64.b64encode(manifiesto_json.encode()).decode())

    html = f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a1020">
<meta name="color-scheme" content="dark">
<meta name="description" content="Gestor de contrasenas local. Sin cuenta, sin servidor y sin publicidad.">
<title>ArcaKey</title>

<!--
  Politica de seguridad de contenido.

  Lo importante de esta linea es `default-src 'none'` con `connect-src 'none'`:
  **el navegador bloquea cualquier salida a la red**. Deja de ser una promesa
  del codigo y pasa a ser algo que impone el navegador. Si alguien lograra
  colar codigo en esta pagina, no podria mandar la boveda a ninguna parte.

  Lo que se permite y por que:
    - `script-src 'unsafe-inline' 'wasm-unsafe-eval'`: todo el codigo va dentro
      del fichero, y Argon2id es WebAssembly. `unsafe-inline` suena mal y aqui
      no anade riesgo: no hay ninguna forma de inyectar codigo desde fuera,
      porque no se carga nada de fuera.
    - `img-src data: blob:`: los iconos van como datos y la camara entrega
      fotogramas como blob.
    - `media-src blob: mediastream:`: la vista previa de la camara.
    - `form-action 'none'` y `base-uri 'none'`: no hay formularios que enviar ni
      base que reescribir.
    - `frame-ancestors 'none'`: nadie puede meter esta pagina en un marco para
      espiar los clics.
-->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'unsafe-inline' 'wasm-unsafe-eval';
  style-src 'unsafe-inline';
  img-src data: blob:;
  media-src blob: mediastream:;
  connect-src 'none';
  form-action 'none';
  base-uri 'none';
  frame-ancestors 'none';
  manifest-src data:;
">
<meta name="referrer" content="no-referrer">

<!--
  ArcaKey, version web.
  =========================================================================

  Todo lo que se ejecuta esta en este fichero. No se descarga nada de ningun
  sitio: ni tipografias, ni bibliotecas, ni analitica. Se puede abrir desde el
  disco, copiar a un pendrive o servir desde donde sea.

  Lo que hace y lo que no:

    - La boveda se guarda **cifrada** en el almacenamiento local del navegador,
      con el mismo formato `.pvlt` que la aplicacion de Android. La contrasena
      maestra no se guarda en ninguna parte.
    - Argon2id (WebAssembly) para derivar la clave, AES-256-GCM (WebCrypto)
      para cifrar. Comprobado que dan exactamente lo mismo que la version de
      Android: una boveda creada aqui se abre alli y al reves.
    - El intercambio va por codigos QR o por fichero cifrado. En los dos casos
      lo que viaja ya esta cifrado con la contrasena maestra.

  Lo que NO protege, y conviene saberlo:

    - Un navegador o un dispositivo comprometidos. Si algo puede leer la
      memoria de esta pestana mientras la boveda esta abierta, se acabo.
    - El borrado del portapapeles es de mejor esfuerzo: un navegador no deja
      escribir en el portapapeles sin foco, asi que si se cierra la pestana
      antes de tiempo, lo copiado se queda.
    - Nadie ha auditado esta criptografia.
-->

<link rel="manifest" href="{manifiesto_datos}">
<link rel="icon" href="data:image/png;base64,{iconos[192]}">
<link rel="apple-touch-icon" href="data:image/png;base64,{iconos[192]}">

<style>
{estilos}
</style>
</head>
<body>
<div id="app"></div>

<noscript>
  <div style="padding:2rem;text-align:center">
    Esta aplicacion necesita JavaScript: toda la criptografia se ejecuta aqui,
    en tu dispositivo.
  </div>
</noscript>

<!-- Argon2id compilado a WebAssembly (hash-wasm). -->
<script>
{argon2}
</script>

<!-- Lector de codigos QR (jsQR). -->
<script>
{jsqr}
</script>

<script>
// Los modulos de la aplicacion, juntados por `construir.py` desde `src/*.js`.
// El codigo es el mismo, sin minificar: se puede leer.
const __mods = {{}};
{''.join(partes)}

(function () {{
  const faltan = [];
  if (!window.crypto || !window.crypto.subtle) faltan.push('WebCrypto');
  if (typeof CompressionStream === 'undefined') faltan.push('CompressionStream');
  if (!window.hashwasm && !window.argon2id) faltan.push('Argon2id');
  if (faltan.length) {{
    // Se avisa en vez de fallar a medias: una aplicacion de contrasenas que se
    // rompe por la mitad es peor que una que dice claramente que no puede.
    document.getElementById('app').innerHTML =
      '<main class="centrado"><div class="tarjeta aviso">' +
      '<h2>Este navegador no vale</h2><p>Falta: ' + faltan.join(', ') +
      '.</p><p class="tenue">Hace falta un navegador reciente: la boveda se ' +
      'cifra aqui, en tu dispositivo, y sin estas piezas no se puede hacer ' +
      'de forma segura.</p></div></main>';
    return;
  }}
  // hash-wasm se registra como `hashwasm` en la ventana.
  __mods['ui'].arranca(window.hashwasm || window);
}})();
</script>
</body>
</html>
"""

    salida = os.path.join(PWA, "index.html")
    with open(salida, "w", encoding="utf-8") as f:
        f.write(html)

    # El service worker, aparte porque un service worker tiene que ser un
    # fichero propio: el navegador no registra uno que este dentro del HTML.
    sw = """// Service worker de ArcaKey.
//
// Solo hace una cosa: guardar el propio `index.html` para que la aplicacion
// abra sin conexion. **No toca la boveda**, no cachea datos y no habla con
// ningun servidor.
const CACHE = 'vault-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((claves) => Promise.all(
    claves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Primero la red y si no hay, lo guardado: asi una version nueva se coge en
  // cuanto esta, sin que el usuario tenga que borrar nada.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
"""
    with open(os.path.join(PWA, "sw.js"), "w", encoding="utf-8") as f:
        f.write(sw)

    with open(os.path.join(PWA, "manifest.webmanifest"), "w",
              encoding="utf-8") as f:
        f.write(manifiesto_json)

    tam = os.path.getsize(salida)
    print(f"index.html: {tam / 1024:.0f} KB, autocontenido")
    print(f"  modulos: {', '.join(MODULOS)}")
    print(f"  sw.js y manifest.webmanifest tambien escritos")


if __name__ == "__main__":
    main()
