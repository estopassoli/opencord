#!/usr/bin/env bash
# Restaura um backup gerado por scripts/backup.sh em um banco VAZIO (nunca sobrescreve um banco com dados).
# Uso: DATABASE_URL=<banco vazio> UPLOADS_DIR=... scripts/restore.sh <pasta-do-backup>
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL}"
SRC="${1:?informe a pasta do backup}"
(cd "$SRC" && sha256sum -c SHA256SUMS)
TABLES="$(psql "$DATABASE_URL" -Atc "select count(*) from pg_tables where schemaname='public'")"
if [[ "$TABLES" != "0" ]]; then
  echo "o banco de destino não está vazio ($TABLES tabelas); restaure em um banco novo" >&2
  exit 1
fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$DATABASE_URL" "$SRC/db.dump"
if [[ -f "$SRC/uploads.tar.gz" && -n "${UPLOADS_DIR:-}" ]]; then
  mkdir -p "$UPLOADS_DIR"
  tar -C "$UPLOADS_DIR" -xzf "$SRC/uploads.tar.gz"
fi
echo "restauração concluída"
