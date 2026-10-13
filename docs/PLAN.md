# titopinardogutierrez.com — plan

Landing personal bilingüe (ES/EN) para presentarme y buscar trabajo: interactiva, con estética de juego moderna, que RR. HH. entienda en 30 segundos y que a un perfil técnico no le parezca infantil.

## Decisiones (04-10-2026)

| Tema | Decisión |
|---|---|
| Backend | Rust + Axum (tokio), un solo binario |
| Base de datos | PostgreSQL 17 + `sqlx` (consultas comprobadas en compilación, pool, migraciones versionadas) |
| Plantillas | `askama` (compiladas, sin coste en tiempo de ejecución) |
| Contacto | Formulario → API en Rust → guardado en PostgreSQL + aviso a Matrix/Hermes |
| Datos públicos | Solo formulario, LinkedIn y GitHub; email y teléfono solo dentro del CV descargable |
| Idiomas | `/es/` y `/en/`, la raíz elige por `Accept-Language`, `hreflang`, selector visible |
| Interactivo | Mapa del homelab, estado en vivo, modo terminal, filtro de tecnologías |
| Estilo | Estética de juego actual: mapa de zonas, árbol de habilidades, registro de misiones y logros. Siempre hay una "vista rápida" clásica para RR. HH. |

## Arquitectura

```
Visitante ─▶ Cloudflare (caché en el borde, Turnstile) ─▶ Traefik (CT 109, TLS, rate limit)
          ─▶ CT landing: binario Rust/Axum ─▶ PostgreSQL (mismo CT, solo localhost)
                                           └─▶ Matrix (aviso de contacto)
```

- Páginas pre-renderizadas y cacheables: casi ninguna visita llega al servidor.
- Lo dinámico (contacto, estado en vivo) va por la API, con caché en memoria (`moka`) para no consultar la BD en cada petición.
- Buenas prácticas de BD: consultas parametrizadas y comprobadas por `sqlx`, índices en lo que se filtra, transacciones cortas, pool acotado, límites de tamaño en la entrada y migraciones en el repo.
- Objetivos: menos de 50 KB en la primera carga, sin framework de JS, funciona sin JS (mejora progresiva), Lighthouse 100, accesibilidad AA.

## Seguridad

- La web se publicó y se retiró de internet el 26-09; vuelve con la mínima superficie expuesta: CT sin privilegios, hardening, agentes Zabbix/Wazuh, PostgreSQL sin red externa.
- Contacto: Turnstile, campo trampa, límite por IP, validación y tamaño máximo en el servidor.
- Cabeceras: CSP estricta, HSTS, sin cookies de terceros ni analítica invasiva.
- El estado en vivo solo muestra agregados (servicios en marcha, uptime), nunca IPs ni nombres internos.
- Contenido de Obsidian saneado con las reglas de `homelab-infra` (sin IPs, secretos ni nada con exposición legal).

## Fases

0. **Contenido** ✅ (04-10): `content/site.toml` (datos neutros), `content/es.toml` y `content/en.toml` (mismas claves), CV en `static/cv/`. 
1. **Diseño y frontend** ✅ (04-10): HUD sobrio, tarjeta de jugador, mapa de zonas, árbol de habilidades que filtra misiones, mapa del homelab, terminal, logros y vista rápida. Unos 28 KB con brotli, sin errores de JS ni scroll horizontal en móvil (comprobado con Playwright).
2. **Servidor en Rust** ✅ (04-10): 35 pruebas (unitarias y de extremo a extremo contra PostgreSQL y un Matrix simulado), clippy sin avisos, CI en `.github/workflows/ci.yml`.
3. **Infraestructura** (en mi repositorio de infraestructura): ✅ un contenedor LXC propio con Terraform, rol `landing`, hardening, Zabbix y Wazuh, desplegado y sano. ⏳ Falta la ruta pública en Traefik.
   - Certificado: el token de Cloudflare en uso llega a los 3 dominios. Comprobarlo en el primer despliegue.
3b. **Más interactividad** ✅ (04-10): Hermes como guía guionizado (tour, modo RR. HH., consejos por zona, reacciones), laboratorio con el servidor por dentro (32 piezas en 7 grupos) y 17 recorridos animados en 5 categorías con narración; apariciones al hacer scroll y contadores.
4. **Datos en vivo** ✅ (04-10): actividad pública de GitHub y estado agregado del homelab (servicios en marcha y disponibilidad a 30 días, publicado desde el host cada 5 min; solo agregados).
4b. **Unidades del rack** ✅ (13-10): páginas propias para los proyectos con más miga, como si sacaras un servidor de 1U del rack. La primera es XPIFY (`/es/xpify/`): su VM de K3s por dentro (23 piezas, 6 recorridos animados), qué usé de cada habilidad, el cálculo de XP real para jugar con él, la bitácora de incidencias como adivinanza, cómo se construyó y las decisiones. Se entra desde su pieza del laboratorio, desde su misión (al filtrar por una habilidad, la misión cuenta para qué la usé y el botón abre la unidad con esas piezas encendidas) o con `ssh xpify` en la terminal. Contenido en `content/units/xpify.toml`, sacado de la memoria del TFG y de su documentación técnica, sin direcciones ni dominios.
4c. **Todo el rack por dentro y sonido de servidor** ✅ (13-10): cada pieza del servidor tiene ya su unidad (23 en total, del router a los discos), en el orden de un armario de verdad: red arriba, discos abajo. Cada una con su mapa interno, sus recorridos animados, lo que uso de cada habilidad, sus averías reales como adivinanza, cómo se construyó y las decisiones. Hermes añade un simulador de VRAM con las medidas reales (qué parte del modelo cabe en 8 GB según caché KV y programas abiertos, y lo que eso supone en velocidad y tiempo) y el turno de chat fase a fase. La portada tiene una lista «El rack, unidad a unidad» que se enciende al filtrar por habilidad, y cada unidad enlaza con la de arriba y la de abajo. Sonido de sala de servidores sintetizado con Web Audio (ventiladores, relés, pitido de arranque, discos), con botón para silenciarlo y `sound on|off` en la terminal; las bahías se encienden al llegar a ellas y los LEDs parpadean con la actividad. Contenido sacado de Obsidian y saneado; lo que se describe en genérico a propósito (biblioteca y automatizaciones) sigue sin fuentes ni descargas.
4d. **Artículos con los postmortems** ✅ (13-10): `/es/blog/` y `/en/blog/<slug>/`, 11 artículos sacados de los postmortems de Obsidian y saneados (LVM-thin tras un corte de luz, cortafuegos de CT de Proxmox, ForceNew de Terraform, OKD en discos lentos, qwen3 en 8 GB de VRAM, razonamiento adaptativo, caché de escritura de discos, falsas alertas de carga en LXC, Chrome huérfanos con Puppeteer, copias vacías por el PATH de cron y NAT del 443 sin interfaz). Cada uno con TechArticle y BreadcrumbList en JSON-LD, `lastmod` en el sitemap y enlace a su unidad; las unidades también llevan ya sus datos estructurados. El rack y el frontal de las unidades enseñan el estado real de /api/status.
