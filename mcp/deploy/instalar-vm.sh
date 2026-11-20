#!/bin/sh
# Instalación inicial en una VM Ubuntu (24.04) con systemd + Caddy, sin Docker.
# Uso (como root):  DOMINIO=tu-dominio.cloudapp.azure.com sh instalar-vm.sh
# Si /opt/fbmcp/.env ya existe, no lo toca (conserva el secreto y el token).
set -eu

: "${DOMINIO:?Definí DOMINIO, por ejemplo DOMINIO=multiplanet-mcp.northcentralus.cloudapp.azure.com}"
repo_raw="${FBMCP_RAW:-https://raw.githubusercontent.com/devmushidev-svg/publicaciones2/main/mcp}"
base=/opt/fbmcp

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3-venv caddy curl >/dev/null

mkdir -p "$base/data"
cd "$base"
curl -fsSL "$repo_raw/server.py" -o server.py
curl -fsSL "$repo_raw/catalogo.py" -o catalogo.py
curl -fsSL "$repo_raw/catalogo_bridge.py" -o catalogo_bridge.py
curl -fsSL "$repo_raw/requirements.txt" -o requirements.txt
[ -d venv ] || python3 -m venv venv
venv/bin/pip install -q -r requirements.txt

if [ ! -f .env ]; then
    secreto=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
    cat > .env <<EOF
MCP_SECRET=$secreto
PUBLIC_HOST=$DOMINIO
HOST=127.0.0.1
PORT=8000
DATA_DIR=$base/data
ZONA_HORARIA=America/Tegucigalpa
FB_GRAPH_VERSION=v27.0
FB_DRY_RUN=1
EOF
    echo "Creé $base/.env en modo prueba. Agregá FB_PAGE_ID y FB_PAGE_TOKEN y borrá FB_DRY_RUN."
fi
chmod 600 .env

cat > /etc/systemd/system/fbmcp.service <<'EOF'
[Unit]
Description=MCP de Facebook Multiplanet
After=network-online.target

[Service]
WorkingDirectory=/opt/fbmcp
EnvironmentFile=/opt/fbmcp/.env
ExecStart=/opt/fbmcp/venv/bin/python server.py
Restart=always
RestartSec=5
MemoryMax=250M

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
$DOMINIO {
	encode gzip
	request_body {
		max_size 100MB
	}
	reverse_proxy 127.0.0.1:8000
}
EOF

systemctl daemon-reload
systemctl enable -q --now fbmcp
systemctl restart fbmcp caddy
sleep 5
systemctl is-active fbmcp caddy
curl -fsS http://127.0.0.1:8000/salud && echo
