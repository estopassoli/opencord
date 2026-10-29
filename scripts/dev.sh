#!/usr/bin/env bash
# Sobe o ambiente de desenvolvimento no WSL: LiveKit + API (watch) + Vite (HMR).
# Pré-requisitos: Postgres e Redis rodando no WSL, .env na raiz, banco migrado (pnpm db:migrate).
# Depois, em outro terminal: pnpm --filter @opencord/desktop dev:win   (abre o app no Windows)
# Ctrl+C encerra tudo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

for port in 3000 5173 7880; do
  if ss -ltn | grep -q ":$port "; then echo "Porta $port já em uso (algo já está rodando). Pare o processo antes."; exit 1; fi
done

pnpm --filter @opencord/contracts build >/dev/null
pnpm --filter @opencord/db build >/dev/null

echo "▶ LiveKit"; scripts/dev-livekit.sh > /tmp/opencord-livekit.log 2>&1 & pids+=($!)
echo "▶ API (watch) em http://localhost:3000"; (cd apps/api && pnpm run dev:watch) & pids+=($!)
echo "▶ Vite em http://localhost:5173"; (cd apps/desktop && pnpm exec vite --host 127.0.0.1) & pids+=($!)
echo "Logs do LiveKit: /tmp/opencord-livekit.log"
wait
