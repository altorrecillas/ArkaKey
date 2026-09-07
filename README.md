# ArcaKey — versión web

Gestor de contraseñas local, sin cuenta, sin servidor y sin publicidad. Todo
lo que hace falta para usarlo está en `index.html`: un solo fichero
autocontenido, sin descargar nada al abrirlo (ni tipografías, ni
bibliotecas, ni analítica).

Cifra la bóveda con tu contraseña maestra usando Argon2id (WebAssembly) y
AES-GCM, y la guarda en este mismo navegador. Genera contraseñas, guarda
códigos de verificación en dos pasos (TOTP), y puede intercambiar la bóveda
con otro dispositivo por código QR o por fichero cifrado — sin que nada pase
por internet en ningún momento.

## Usarlo

Doble clic en `index.html`. Funciona sin conexión y sin instalar nada; si lo
abres desde el navegador de un móvil, puedes "Añadir a la pantalla de
inicio" para que se comporte como una aplicación instalada (PWA).

## Desarrollo

El código fuente vive en `src/*.js`, como módulos de JavaScript normales y
corrientes — se pueden leer, editar y probar con Node sin ningún paso
intermedio. `index.html` es un fichero **generado**: no se edita a mano.

Para reconstruirlo después de tocar algo en `src/`:

```bash
python3 construir.py
```

Junta los módulos, la hoja de estilos y las dependencias (Argon2id, el lector
de códigos QR) en un único `index.html`, sin minificar ni ofuscar nada — el
fichero que se reparte se puede leer entero, de arriba abajo.

## Comprobarlo

```bash
node --experimental-websocket pilota.js
```

Abre la aplicación en un Chromium de verdad (por el protocolo de depuración,
sin necesitar Playwright ni Selenium) y recorre lo esencial: crear una
bóveda, añadir una credencial, generar una contraseña, ver y ocultar el
secreto, comprobar un código de doble factor contra un cálculo
independiente, exportar el fichero cifrado, emitirlo por QR, bloquear,
reabrir, y rechazar una contraseña equivocada.

Necesita Node 22 o más nuevo por el `WebSocket` global (o Node 20/21 con el
propio flag `--experimental-websocket`, como en el ejemplo de arriba).

## Por qué un único fichero

Un gestor de contraseñas que promete no hablar con ningún servidor tiene que
poder inspeccionarse de un vistazo. Nada de empaquetado con minificación ni
módulos repartidos en un CDN: lo que se ejecuta es exactamente lo que se lee
en `src/`.

## Parte de ArcaKey

Esta PWA es uno de los tres clientes de **ArcaKey**, un gestor de
contraseñas con app Android y cliente para relojes Garmin además de esta
versión web — las tres leen y escriben el mismo fichero de bóveda, y se lo
pasan entre sí por QR o por fichero cifrado. Esta carpeta es autocontenida a
propósito y no depende de las otras dos para nada, pero si quieres el
proyecto completo (con las otras dos aplicaciones y las pruebas cruzadas
entre las tres), esa es otra historia y otro repositorio.
