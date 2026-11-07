# Banco de pruebas de experiencia

Recorre la portada como lo harían visitas típicas y saca capturas y cifras
para mejorarla vuelta a vuelta (el registro de vueltas está en
[docs/UX.md](../../docs/UX.md)).

| Visita | Qué mira |
|---|---|
| `rrhh` | 1440×900: cuánto tarda la sala, cuántas cosas reaccionan al ratón, la misión |
| `portatil` | 1280×720: la sala y la hoja del laboratorio abierta |
| `movil` | 390×844: sin 3D ni descarga del 3D, scroll lateral, botones pequeños |
| `teclado` | 45 tabulaciones: si se ve el foco y cuánto cuesta llegar al CV, al contacto y al 3D |
| `recorrido` | «Tu visita a esta web»: si el texto del paso tapa el centro de la escena |
| `detective` | un caso abierto con un aviso de logro encima |

En cada paso comprueba: paneles que se pisan, textos cortados, scroll
horizontal de verdad, mandos en más de 2 filas, si el CV y «Contactar» se
pueden pulsar, accesibilidad con axe-core y errores de JavaScript.

## Uso

```sh
cd tools/ux && npm ci
./sitio.sh &          # genera la portada sin base de datos y la sirve en :8099 con la CSP de producción
node banco.mjs --out informes/1 --antes informes/0/informe.json
```

- `--solo rrhh,movil` pasa solo esas visitas; `--browser firefox` usa Firefox y `--browser webkit`, WebKit.
- Deja en `informes/<nombre>/` `informe.md`, `informe.json` y las capturas
  (`informes/` no va al repositorio).
- Sin GPU, Chromium dibuja el 3D por software (SwiftShader) a ~1 fotograma por
  segundo: el banco espera 30 s y pide «menos movimiento» para que las
  capturas sean estables. Con GPU, `--slow no` lo acelera.
- La portada se genera con `landing dump-site <dir>` (sin Postgres): los
  formularios no funcionan ahí.

## Con GPU de verdad

En una máquina con gráfica (aquí no hay: WebGL va por software a ~1 fps):

- **Chrome del sistema**: `node banco.mjs --gpu /usr/bin/google-chrome-stable --url <web>`
  usa la GPU por Vulkan (ANGLE), quita las esperas largas y mide los
  fotogramas del recorrido (`fps`, `frame_p95_ms`).
- **Firefox del sistema**: `firefox-gpu.mjs` lo maneja por WebDriver BiDi.
  En headless Firefox no tiene GL; dentro de un `kwin_wayland --virtual` sí
  (instrucciones en la cabecera del script), sin abrir nada en el escritorio.
- **WebKit (Safari)**: `--browser webkit` usa el WebKit de Playwright
  (`npx playwright install webkit`), lo más cerca de un iPhone o un Mac sin
  tenerlos. Sin root y sin sus librerías del sistema, se sacan los `.deb` de
  Debian a una carpeta y se le pasa un envoltorio con `--webkit <script>`
  que copia el de `minibrowser-wpe/MiniBrowser` añadiendo esa carpeta a
  `LD_LIBRARY_PATH` y, para el 3D por software, Mesa (`libegl-mesa0`,
  `mesa-libgallium`) con `__EGL_VENDOR_LIBRARY_DIRS`. Así no tiene TLS: se
  prueba el sitio local. En WebKit, Playwright mete un `<style>` en cada
  captura y la CSP lo rechaza; el banco ignora ese aviso.

Los navegadores automatizados no cuentan en la medida anónima de visitas
(`navigator.webdriver`).

## Idioma y tema

`--lang en` hace las visitas en inglés (textos más largos) y `--tema light`
con el sistema en tema claro (otros contrastes). La visita `tableta` va en
vertical (820×1180) y en horizontal, táctil.

## Unidades y blog

`dump-site` escribe también cada unidad, el blog (con `index.json`) y cada
artículo. Las visitas `unidades`, `unidades_movil`, `blog` y `blog_movil`
recorren todas esas páginas (la primera con capturas, el resto solo con
cifras) y pasan axe en cada una; la del blog busca «disco» y filtra por
averías.

## En el CI

Cada push pasa una versión rápida y sin 3D (no hay GPU en el runner), unos 6
minutos: `--chromium /usr/bin/chromium` (el de Debian, sin descargar
navegadores), `--sin-webgl`, `--slow no` y `--fallar`, que termina con error
si alguna cifra pasa de 0. Visitas: `movil`, `tableta`, `sin3d`, `unidades`,
`unidades_movil`, `blog` y `blog_movil`. Si falla, el registro del CI enseña
el informe entero. La sala 3D, Firefox y el teclado siguen siendo a mano.
