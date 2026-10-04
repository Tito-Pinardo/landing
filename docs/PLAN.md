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
3b. **Más interactividad** ✅ (04-10): Hermes como guía guionizado (tour, modo RR. HH., consejos por zona, reacciones), laboratorio con el servidor por dentro (30 piezas en 7 grupos) y 7 recorridos animados con narración; apariciones al hacer scroll y contadores.
4. **Datos en vivo**: actividad pública de GitHub y estado agregado del homelab.
5. **Lanzamiento**: reglas de caché de Cloudflare, SEO (Open Graph, JSON-LD `Person`, sitemap) y enlazarla desde LinkedIn y GitHub.

## Fuentes de contenido

- CV: `static/cv/` (ES y EN).
- Proyectos: mi documentación en Obsidian y mi repositorio de infraestructura (copia pública en `homelab-infra`).
