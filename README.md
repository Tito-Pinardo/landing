# titopinardogutierrez.com

Mi web personal: quién soy, qué sé hacer y en qué trabajo, en español e inglés. Te guía **Hermes**, un compañero sin IA (guionizado) que ofrece un tour, un atajo para RR. HH. y comentarios según lo que haces. El **laboratorio** enseña mi servidor por dentro: 17 recorridos animados en cinco categorías (tu visita, un mensaje de contacto, una pregunta a mi asistente de IA, una intrusión frenada, la renovación de certificados, el cambio de IP, la actualización de contenedores, una noche de juegos…) en los que un paquete viaja de pieza en pieza mientras Hermes narra cada paso. Además: árbol de habilidades que filtra los proyectos, terminal, logros y formulario de contacto. Para quien tenga prisa hay una **vista rápida** con lo esencial.

## Cómo está hecha

- **Rust + Axum.** Las páginas se renderizan una vez al arrancar (plantillas `askama` compiladas) y se sirven desde memoria con ETag. Detrás de Cloudflare casi ninguna visita llega al servidor.
- **PostgreSQL + sqlx.** Las consultas se comprueban en compilación (los datos de `.sqlx/` permiten compilar sin base de datos). Los límites de envío del formulario se calculan con una sola consulta indexada, y la IP nunca se guarda: solo un hash con sal.
- **Aviso a Matrix con bandeja de salida.** El mensaje se guarda primero y el aviso se reintenta (`FOR UPDATE SKIP LOCKED`) hasta que Matrix devuelve un `event_id`.
- **Sin dependencias en el navegador.** CSS y JS propios (unos 28 KB en total con brotli). Todo funciona sin JavaScript; el mapa, la terminal y los logros son una mejora encima.
- **Seguridad.** CSP estricta sin nada en línea, cabeceras HSTS/COOP/etc., Turnstile opcional, campo trampa y límites por IP y globales.

## Estructura

| Ruta | Qué hay |
|---|---|
| `content/site.toml` | Datos que no dependen del idioma: tecnologías, proyectos, piezas y grupos del servidor y recorridos |
| `content/es.toml`, `content/en.toml` | Textos, con las mismas claves (el servidor no arranca si falta alguna) |
| `templates/` | Plantillas HTML (y el avatar de Hermes en SVG) |
| `static/` | CSS, JS, imágenes y CV (se compilan dentro del binario) |
| `migrations/` | Esquema de PostgreSQL |
| `src/` | Servidor |
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
