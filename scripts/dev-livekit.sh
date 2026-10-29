#!/usr/bin/env bash
# Sobe o LiveKit de desenvolvimento no WSL anunciando o IP da VM do WSL como candidato ICE (UDP),
# para que o desktop no Windows envie mídia por UDP direto à VM (o encaminhamento de localhost do WSL só cobre TCP).
# Sinalização continua em ws://localhost:7880 (encaminhada). Uso: scripts/dev-livekit.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${LIVEKIT_BIN:-$ROOT/.tools/livekit/livekit-server}"
WSL_IP="$(ip -4 addr show eth0 | grep -oP 'inet \K[\d.]+')"
CFG="$ROOT/infra/livekit/.livekit.dev.generated.yaml"
sed -e "s/bind_addresses: \[\"127.0.0.1\"\]/bind_addresses: [\"0.0.0.0\"]/" \
    -e "s/node_ip: 127.0.0.1/node_ip: ${WSL_IP}/" \
    "$ROOT/infra/livekit/livekit.dev.yaml" > "$CFG"
echo "LiveKit dev: node_ip=${WSL_IP} (UDP 50000-50100, TCP 7881), sinalização ws://localhost:7880"
exec "$BIN" --config "$CFG"
