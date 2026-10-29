#!/bin/sh
# Garante que a pasta de uploads (volume) é gravável pelo usuário `node` e roda a API sem privilégios.
set -eu
if [ "$(id -u)" = "0" ]; then
  dir="${STORAGE_LOCAL_DIR:-/app/var/uploads}"
  mkdir -p "$dir"
  chown -R node:node "$dir"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
