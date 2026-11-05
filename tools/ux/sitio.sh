#!/bin/bash
# Genera la portada estática (sin base de datos) y la sirve en 127.0.0.1:8099
# con la misma CSP que producción, para pasarle el banco: ./sitio.sh [dir]
set -e
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(dirname "$0")/../.."
DIR=${1:-tools/ux/informes/sitio}
(cd tools/rack3d && npm run build >/dev/null)
SQLX_OFFLINE=true cargo run -q -- dump-site "$DIR" >/dev/null
exec python3 tools/ux/servir.py "$DIR"
