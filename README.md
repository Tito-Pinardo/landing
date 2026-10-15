# titopinardogutierrez.com

Mi web personal: quién soy, qué sé hacer y en qué trabajo, en español e inglés. Te guía **Hermes**, un compañero sin IA (guionizado) que ofrece un tour, un atajo para RR. HH. y comentarios según lo que haces. El **laboratorio** enseña mi servidor por dentro: 27 recorridos animados en seis categorías (tu visita, un mensaje de contacto, cómo esta web se publica sola desde mi Forgejo, una versión nueva que llega por PR, un despliegue que pide sus llaves a OpenBao, una pregunta a mi asistente de IA, una intrusión frenada, la renovación de certificados, el cambio de IP, la actualización de contenedores, una noche de juegos…) en los que un paquete viaja de pieza en pieza mientras Hermes narra cada paso. El mapa muestra el estado real de cada pieza (LEDs) y, si algo cae de verdad, el **modo incidente** lo enseña nada más entrar: la unidad parpadea en rojo con su hora de caída, sale un aviso arriba y Hermes lo comenta (`?averia=plex` lo simula en tu navegador) y se pueden **comparar dos recorridos** a la vez. En **Rompe el servidor** el visitante provoca una avería (muere un disco del pool, se va la luz, Let's Encrypt no responde, se cae la base de datos de la web, se cae el runner del CI, OpenBao arranca sellado), ve la pieza rota en rojo y cómo reacciona el resto, y al final un veredicto: cuánto se cayó y qué se perdió. En el **modo detective** el visitante investiga averías reales del homelab buscando pistas en el mapa hasta dar con la causa. Además: árbol de habilidades que crece y filtra los proyectos, un deslizador de antes/después (a mano frente a como código), una terminal (`neofetch`, `top` con el estado real del rack, `ls /rack`, `uptime`…) con **cuatro retos de bandera** sacados de averías reales (una ruta olvidada en Traefik, una instantánea de ZFS, una copia de 0 bytes por el PATH de cron y un log indiscreto). Se comprueban por SHA-256 y `/api/flags` cuenta cuántos visitantes resuelven cada uno, sin nombres, logros y formulario de contacto. Para quien tenga prisa hay una **vista rápida** con lo esencial y un **tour de un minuto**: ocho paradas en las que la página se mueve sola mientras Hermes narra (se pausa si el visitante toca la página). Un **panel de vista** en la barra elige tema claro u oscuro, quita las animaciones y los enanitos, y de 23:00 a 7:00 (hora de casa) los enanitos duermen. Al **entrar en una unidad** del rack, su frontal 1U se convierte en el de la página y la unidad sale como un cajón (View Transitions entre páginas); al volver, al revés, y entre unidades vecinas las bandejas se deslizan.

Cada pieza del servidor tiene su propia **unidad del rack**: una página a la que se entra como si sacaras un servidor de 1U (`/es/<pieza>/`, 25 en total, del router a los discos). Cada una enseña su mapa por dentro con recorridos animados, qué uso de cada habilidad, sus averías reales como adivinanza, cómo se construyó y por qué. La de **XPIFY** (mi proyecto final) trae además el cálculo de XP real para jugar con él, y la de **Hermes** un simulador de VRAM con las medidas reales y el turno de chat fase a fase. Se llega desde su pieza del laboratorio, desde la lista «El rack, unidad a unidad» de la portada (que se enciende al filtrar por habilidad), desde su misión, pasando de una unidad a la de arriba o la de abajo, o con `ssh <pieza>` en la terminal. Todo suena a sala de servidores (Web Audio sintetizado, sin ficheros), con un botón para silenciarlo y `sound on|off` en la terminal.

Los postmortems más útiles del homelab están además como **artículos** (`/es/blog/`): síntoma, diagnóstico paso a paso, causa, arreglo y lección, cada uno con su fecha, datos estructurados (TechArticle) y enlace a la unidad donde pasó. La portada enseña los tres últimos y cada unidad enlaza los suyos. Cada artículo tiene un **tipo** (avería, casi, mejora medida, montaje, resumen semanal o cambios del mes) y los postmortems llevan una **ficha** con impacto, cómo se detectó, tiempo caído y lección. El índice se filtra por tipo, tecnología y unidad, y se busca en el texto entero con `/{lang}/blog/index.json`, que se pide al empezar a escribir. Los filtros viajan en la URL. Cada lunes sale un **resumen semanal** con las versiones, vulnerabilidades y noticias de fuera que afectan al homelab, escrito por `tools/digest` y publicado solo si lo apruebo en Matrix (ver [docs/digest.md](docs/digest.md)).

## Cómo está hecha

- **Rust + Axum.** Las páginas se renderizan una vez al arrancar (plantillas `askama` compiladas) y se sirven desde memoria con ETag. Detrás de Cloudflare casi ninguna visita llega al servidor.
- **PostgreSQL + sqlx.** Las consultas se comprueban en compilación (los datos de `.sqlx/` permiten compilar sin base de datos). Los límites de envío del formulario se calculan con una sola consulta indexada, y la IP nunca se guarda: solo un hash con sal. El formulario pide el **motivo** (oferta de trabajo, proyecto, homelab u otro) y las ofertas llegan a Matrix destacadas en la primera línea del aviso.
- **Aviso a Matrix con bandeja de salida.** El mensaje se guarda primero y el aviso se reintenta (`FOR UPDATE SKIP LOCKED`) hasta que Matrix devuelve un `event_id`.
- **Sin dependencias en el navegador.** CSS y JS propios (unos 28 KB en total con brotli). Todo funciona sin JavaScript; el mapa, la terminal y los logros son una mejora encima.
- **Seguridad.** CSP estricta sin nada en línea, cabeceras HSTS/COOP/etc., Turnstile opcional, campo trampa y límites por IP y globales.
- **CI/CD en mi propio Forgejo.** El origen del repositorio está en casa. Cada push pasa el CI ([`.forgejo/workflows/ci.yml`](.forgejo/workflows/ci.yml)): formato, clippy, pruebas contra PostgreSQL, compilación, contenido válido, JS minificado válido y gitleaks sobre todo el historial. Lo hace en un runner sin secretos. Con `main` en verde, otro runner pasa un control de fugas a lo que aún no es público, despliega con Ansible y empuja ese commit aquí: este repositorio de GitHub es la copia pública y solo recibe lo que ya está desplegado. Cada resultado llega a Element. El CI de GitHub ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) repite las comprobaciones sobre la copia.

## Estructura

| Ruta | Qué hay |
|---|---|
| `content/site.toml` | Datos que no dependen del idioma: tecnologías, proyectos, piezas y grupos del servidor y recorridos |
| `content/es.toml`, `content/en.toml` | Textos, con las mismas claves (el servidor no arranca si falta alguna) |
| `content/articles/*.toml` | Artículos: fecha, unidad, tecnologías, `kind` y textos ES/EN por secciones (con `impact`/`detected`/`downtime` en los postmortems y `links` a fuentes de fuera); se descubren solos (basta con añadir el fichero, con el slug como nombre) y se ordenan por fecha |
| `content/units/*.toml` | Unidades del rack (una por pieza del servidor): mapa, recorridos, averías y textos ES/EN; se validan contra `site.toml` y el orden del rack está en `src/unit.rs` |
| `templates/` | Plantillas HTML (y el avatar de Hermes en SVG) |
| `static/` | CSS (`app.css` común; `home.css`, `unit.css` y `blog.css`, solo en sus páginas; se minifica al arrancar), JS (`app.js` para la portada, `unit.js` para las unidades, `sound.js` para el sonido, `prefs.js` para el panel de vista: tema, animaciones, enanitos y la noche en casa), imágenes y CV (se compilan dentro del binario) |
| `migrations/` | Esquema de PostgreSQL |
| `src/` | Servidor |
| `.forgejo/workflows/` | CI/CD en Forgejo (comprobar y desplegar); `.github/workflows/`, el CI de la copia pública |
| `docs/PLAN.md` | Plan, decisiones y fases |

## Desarrollo

```sh
# PostgreSQL local y esquema para las macros de sqlx
export DATABASE_URL=postgres://postgres@127.0.0.1:5432/landing
cargo sqlx migrate run

cargo test                       # pruebas unitarias y de extremo a extremo (PostgreSQL real)
cargo clippy --all-targets -- -D warnings
cargo fmt --check

IP_HASH_SALT=una-sal-larga-de-desarrollo cargo run   # http://127.0.0.1:8080
cargo sqlx prepare -- --all-targets   # al cambiar alguna consulta
```

## Configuración (variables de entorno)

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DATABASE_URL` | sí | Conexión a PostgreSQL |
| `IP_HASH_SALT` | sí | Sal secreta (16+ caracteres) del hash de IP |
| `BIND_ADDR` | no | Por defecto `127.0.0.1:8080` |
| `PUBLIC_URL` | no | URL canónica (por defecto `https://titopinardogutierrez.com`) |
| `TRUST_PROXY_HEADERS` | no | `true` solo si el tráfico llega únicamente por Traefik y Cloudflare |
| `DB_MAX_CONNECTIONS` | no | Tamaño del pool (8) |
| `MATRIX_HOMESERVER`, `MATRIX_ACCESS_TOKEN`, `MATRIX_ROOM_ID` | no (juntas) | Aviso de mensajes nuevos |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | no (juntas) | Captcha de Cloudflare |
| `GITHUB_USER` | no | Actividad pública reciente en "Ahora mismo" |
| `HOMELAB_STATUS_FILE` | no | JSON con `services_up`, `services_total`, `uptime_30d`, `updated_at` |

`landing check` valida el contenido sin arrancar el servidor.
