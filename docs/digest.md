# Resumen semanal de los lunes

`tools/digest/digest.py` escribe cada semana un artículo del blog (`kind =
"digest"`) con lo que ha salido y afecta a mi homelab: vulnerabilidades,
versiones nuevas y noticias de fuera, cada una con qué es, qué significa para
esa pieza, una idea de qué probar y el enlace al original.

Nada se publica sin que yo lo apruebe.

## Cómo funciona

Un temporizador lanza `digest.py tick` cada 15 minutos:

| Cuándo | Qué hace |
|---|---|
| Domingo 20:00 → lunes 8:00 | Si aún no hay borrador, recoge, escribe y lo manda a Matrix |
| Siempre | Lee mis respuestas al borrador |
| Lunes ≥ 8:00, aprobado | Publica: commit, `landing check`, gitleaks y push al origen; el CI/CD lo despliega y el script espera a ver el artículo en la web (hasta 40 min) |
| Martes ≥ 20:00 sin respuesta | Caduca y no se publica |

Órdenes en Matrix (solo las del dueño, `DIGEST_OWNER`): **publicar**,
**descartar** y **quitar 2** o **quitar 2,4**, que rehace el borrador sin esas
novedades.

## De dónde sale

Las fuentes están en `tools/digest/sources.toml`, cada una con su unidad del
rack y sus tecnologías:

- **Versiones**: feeds Atom de GitHub y RSS de los proyectos. Se quedan fuera
  las previas (rc, beta…) y, de cada proyecto, entra solo la última de la
  semana.
- **Vulnerabilidades**: NVD por frase exacta, la base de avisos de GitHub por
  paquete y el catálogo KEV de CISA (las que ya se están explotando, que van
  primero).
- **Noticias**: blogs y boletines de fuera. El modelo decide si alguna merece
  entrar.

Se ordenan por importancia, con un cupo por tipo (4 de seguridad, 4 versiones
y 2 noticias) y como mucho 2 por unidad, y se quedan las 6 mejores.

## Quién lo escribe

Gemini si hay clave; si falla o no la hay, el modelo local (Ollama). Una
llamada por novedad, con respuesta en JSON con esquema, y una más para la
entradilla. El modelo solo recibe lo que dice la fuente y qué es esa pieza
(el lema de su unidad del rack).

Una regla que el código vigila: **nunca afirma el estado de mi servidor**
(«ya está parcheado», «no me afecta», «es vulnerable»). No lo sabe, y lo
segundo sería publicar un punto débil. Si lo hace, se le pide que lo
reescriba, y si insiste, esa novedad se cae.

## Probar sin tocar nada

```bash
python3 tools/digest/digest.py collect               # lo recogido esta semana
python3 tools/digest/digest.py draft --dry-run       # el artículo, sin mandar nada
python3 -m unittest tools/digest/test_digest.py      # pruebas sin red (también en CI)
landing check-article borrador.toml                  # valida un borrador con las reglas de la web
```

## Configuración

Por entorno (el despliegue lo deja en un fichero `0600`): `DIGEST_REMOTE` (el origen
del repositorio, en Forgejo), `MATRIX_HOMESERVER`,
`MATRIX_ACCESS_TOKEN`, `MATRIX_ROOM_ID`, `DIGEST_OWNER`, `OLLAMA_URL`,
`OLLAMA_MODEL` y `GEMINI_MODEL` (lista separada por comas: si un modelo está saturado, se pasa al siguiente). La clave de Gemini se lee de
`~/.config/landing-digest/gemini.key` y no pasa por ningún entorno.

El script trabaja sobre un clon propio del repositorio
(`~/.local/share/landing-digest/repo`), que deja igual que `origin/main` antes
de cada uso. Así nunca pisa una copia de trabajo. No despliega nada él mismo:
el artículo sigue el mismo camino que cualquier otro commit (CI, control de
fugas, despliegue y copia en GitHub).
