#!/bin/sh
set -eu

base=/opt/fbmcp
repo_raw="${FBMCP_RAW:-https://raw.githubusercontent.com/devmushidev-svg/publicaciones2/main/mcp}"
python="$base/venv/bin/python"
candidate=$(mktemp -d "$base/.release.XXXXXX")
sandbox=$(mktemp -d)
trap 'rm -rf "$candidate" "$sandbox"' EXIT
files="server.py catalogo.py catalogo_bridge.py"

for file in $files; do
    curl -fsSL --max-time 60 "$repo_raw/$file" -o "$candidate/$file"
    [ -s "$candidate/$file" ] || { echo "Descarga vacía: $file" >&2; exit 1; }
done

# Validar todos los módulos y recursos con el venv real y datos aislados.
if ! env -i PATH=/usr/bin:/bin PYTHONDONTWRITEBYTECODE=1 \
    FB_DRY_RUN=1 MCP_SECRET=secreto-local-para-preflight \
    DATA_DIR="$sandbox" "$python" - "$candidate" <<'PY'
import asyncio
import importlib.metadata
import pathlib
import sys

sys.path.insert(0, sys.argv[1])
import server

print("SDK MCP", importlib.metadata.version("mcp"))
tools = {tool.name: tool for tool in asyncio.run(server.mcp.list_tools())}
for name in ("programar_post_con_imagenes", "verificar_imagenes_chat"):
    tool = tools[name]
    assert tool.meta["openai/fileParams"] == ["imagenes"]
    assert tool.inputSchema["properties"]["imagenes"]["maxItems"] == 10
assert tools["verificar_imagenes_chat"].annotations.readOnlyHint
assert "preparar_lote_catalogo" in tools
assert "confirmar_plan_catalogo" in tools
assert server.catalogo.categorias()
assert server.crear_app()
PY
then
    echo "Falló la comprobación. No se cambió la versión instalada." >&2
    exit 1
fi

backup=$(mktemp -d "$base/respaldo.XXXXXX")

for file in $files; do
    if [ -f "$base/$file" ]; then
        cp -p "$base/$file" "$backup/$file"
    fi
    chmod 644 "$candidate/$file"
    chown --reference="$base/server.py" "$candidate/$file"
done
for file in $files; do
    mv -f "$candidate/$file" "$base/$file"
done

salud() {
    for intento in 1 2 3 4 5 6 7 8 9 10; do
        if systemctl is-active --quiet fbmcp &&
           curl --max-time 2 -fsS -H 'Host: multiplanet-mcp.northcentralus.cloudapp.azure.com' \
                http://127.0.0.1:8000/salud; then
            printf '\n'
            return 0
        fi
        sleep 1
    done
    return 1
}

if systemctl restart fbmcp && salud; then
    echo "fbmcp activo con catálogo. Respaldo: $backup"
else
    echo "Falló el arranque. Restaurando la versión anterior desde $backup." >&2
    for file in $files; do
        if [ -f "$backup/$file" ]; then
            cp -p "$backup/$file" "$base/$file"
        else
            rm -f "$base/$file"
        fi
    done
    systemctl restart fbmcp
    salud
    exit 1
fi
