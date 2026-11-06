#!/usr/bin/env bash
# Medida anónima de visitas: embudo de los últimos N días (30 por defecto).
# La llave se lee de ~/.config/landing/visitas.token (no está en el repo; en
# site.toml solo va su SHA-256).
set -euo pipefail
dias="${1:-30}"
url="${LANDING_URL:-https://titopinardogutierrez.com}"
llave_f="${VISITAS_TOKEN_FILE:-$HOME/.config/landing/visitas.token}"
curl -fsS -H @<(printf 'Authorization: Bearer %s\n' "$(tr -d '\n' < "$llave_f")") \
  "$url/api/visitas?dias=$dias" | python3 -c '
import json, sys
d = json.load(sys.stdin)
modos = ["sala", "pagina", "movil"]
tot = {p: {m: 0 for m in modos} for p in d["pasos"]}
dias = set()
for dia, paso, modo, n in d["filas"]:
    dias.add(dia)
    tot.setdefault(paso, {m: 0 for m in modos})[modo] += n
ent = {m: tot["entrada"][m] or 0 for m in modos}
print(f"{len(dias)} días con visitas\n")
print("%-16s" % "paso" + "".join("%14s" % m for m in modos))
for p in d["pasos"]:
    celdas = []
    for m in modos:
        n = tot[p][m]
        pct = f" ({100*n/ent[m]:.0f} %)" if ent[m] and p != "entrada" else ""
        celdas.append(f"{str(n)+pct:>14}")
    print(f"{p:16}" + "".join(celdas))
'
