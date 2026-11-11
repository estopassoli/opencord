#!/bin/sh
# Compila o oc-live.exe no Windows a partir do WSL (o cargo do Windows não compila direto de \\wsl$).
set -e
here=$(cd "$(dirname "$0")" && pwd)
win=$(cmd.exe /c "echo %LOCALAPPDATA%" 2>/dev/null | tr -d '\r')
stage=$(wslpath -u "$win\\OpenCordTauri\\oc-live")
mkdir -p "$stage"
cp "$here/Cargo.toml" "$stage/" && rm -rf "$stage/src" "$stage/.cargo" && cp -r "$here/src" "$here/.cargo" "$stage/"
cd /mnt/c && cmd.exe /c "cd /d $win\\OpenCordTauri\\oc-live && %USERPROFILE%\\.cargo\\bin\\cargo.exe build --release $*"
