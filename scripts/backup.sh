#!/usr/bin/env bash
# Backup do OpenCord: dump do PostgreSQL (formato custom, comprimido) + arquivo dos anexos, com SHA-256.
# Uso: DATABASE_URL=... UPLOADS_DIR=... BACKUP_DIR=... scripts/backup.sh
# Redis não é copiado: guarda só estado efêmero (presença, voz, rate limit) e é reconstruído.
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
UPLOADS_DIR="${UPLOADS_DIR:-}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/opencord-$STAMP"
mkdir -p "$OUT"
umask 077
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$OUT/db.dump"
if [[ -n "$UPLOADS_DIR" && -d "$UPLOADS_DIR" ]]; then
  tar -C "$UPLOADS_DIR" -czf "$OUT/uploads.tar.gz" .
fi
(cd "$OUT" && sha256sum ./* > SHA256SUMS)
echo "backup criado em $OUT"
# Criptografe antes de enviar para fora do host, ex.: age -r <chave-publica> -o "$OUT.tar.age" <(tar -C "$OUT" -c .)
