# Guia de self-hosting e runbook

> Estado: a stack Docker Compose (`infra/docker/`) foi escrita, mas **não validada nesta máquina (sem Docker)**. O caminho validado é o de desenvolvimento nativo descrito abaixo. Não faça deploy em produção sem antes rodar o checklist do fim deste guia.

## Requisitos
- Linux com Docker e Docker Compose (produção) ou Node 24 + pnpm 12 + PostgreSQL 18 + Redis 8 (dev nativo).
- DNS para a API (`chat.exemplo.com`) e para o LiveKit (`rtc.exemplo.com`), com TLS (proxy reverso para HTTP/WSS).
- Portas expostas na internet: 443/TCP (proxy → API 3000 e LiveKit 7880), **7881/TCP e 50000-50100/UDP direto para o LiveKit** (mídia não passa pelo proxy HTTP), 3478/UDP+TCP e 5349/TCP (coturn).

## Produção com Docker Compose
1. `cp infra/docker/.env.example infra/docker/.env` e preencha. Gere segredos com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. A API recusa segredos `dev-only*` e o secret `secret` do LiveKit em produção.
2. Em `infra/docker/livekit.yaml`, troque a chave e o segredo (≥ 32 caracteres, os mesmos de `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`).
3. Em `infra/coturn/turnserver.conf`, troque `static-auth-secret`, `realm` e os certificados TLS.
4. `docker compose -f infra/docker/docker-compose.yml up -d --build` (o serviço `migrate` aplica `prisma migrate deploy`).
5. Primeiro proprietário: `docker compose -f infra/docker/docker-compose.yml run --rm -e OWNER_EMAIL=... -e OWNER_USERNAME=... -e OWNER_PASSWORD=... api node node_modules/@opencord/db/dist/create-owner.js`. Ele cria a conta do dono e o primeiro servidor (aberto a todos).
6. Proxy reverso: `https://chat.exemplo.com` → `127.0.0.1:3000` (incluindo WebSocket em `/realtime`); `wss://rtc.exemplo.com` → `livekit:7880`. Defina `TRUST_PROXY=true` só atrás do proxy.

## Distribuir o app aos amigos (só apelido)
1. No servidor: `GUEST_JOIN_ENABLED=true` (padrão). Se a instância estiver na internet, defina `INSTANCE_ACCESS_CODE` e passe o código aos amigos.
2. Gere o instalador apontando para o seu servidor: `VITE_OPENCORD_SERVER_URL=https://chat.exemplo.com pnpm --filter @opencord/desktop build`, depois `stage:win` e `npm run dist` no Windows.
3. Os amigos instalam, abrem, digitam o apelido e entram em todos os servidores (abertos, sem convite). Criar conta é opcional.
4. Para quem abrir pelo navegador aparecer o botão de baixar o app: defina `DOWNLOADS_DIR` (pasta com os instaladores gerados pelo workflow `desktop.yml`: `.exe`, `.dmg`, `.AppImage`, `.deb`; a API serve o mais recente de cada plataforma em `/downloads/files/…` e sugere o do sistema de quem visita) e/ou `DESKTOP_DOWNLOAD_URL` (link externo só do instalador Windows). Sem nenhum dos dois, o botão não aparece.

## Desenvolvimento nativo (validado)
Primeira vez (WSL):
```sh
pnpm install
cp .env.example .env                       # valores de dev
pnpm --filter @opencord/db migrate:dev     # banco opencord_dev
pnpm --filter @opencord/db seed            # conta do dono: owner@opencord.local / dev-only-owner-password
pnpm --filter @opencord/desktop build && pnpm --filter @opencord/desktop stage:win
# no Windows (uma vez): cd %LOCALAPPDATA%\OpenCordDev\app && npm install && node node_modules\electron\install.js
```
Dia a dia (dois terminais no WSL):
```sh
scripts/dev.sh                             # LiveKit + API (watch) + Vite (recarga automática da interface)
pnpm --filter @opencord/desktop dev:win    # abre o app no Windows apontando para o Vite
```
- Salvar arquivos em `apps/desktop/src` recarrega a interface na hora. Mudanças na API recompilam e reiniciam sozinhas.
- Mudanças em `apps/desktop/electron` (main/preload) exigem fechar o app e rodar `dev:win` de novo.
- O modo dev usa um perfil separado (`%LOCALAPPDATA%\OpenCordDev\dev-profile`), sem misturar com o app "normal".

## Runbook
| Verificação | Como |
|---|---|
| Saúde | `curl https://chat.exemplo.com/health` → `database`, `redis`, `livekit` = `ok` (503 se banco ou Redis falharem) |
| LiveKit | `curl http://livekit:7880` → 200; logs `docker compose logs livekit` |
| ICE/TURN | no cliente, conectar de uma rede externa (4G); se falhar, conferir 7881/TCP, 50000-50100/UDP e coturn 3478 |
| Webhooks | logs do LiveKit com `sent webhook ... status 200`; assinatura inválida → 403 na API |
| Backup | `DATABASE_URL=... UPLOADS_DIR=... BACKUP_DIR=... scripts/backup.sh` (diário, via cron/systemd timer); criptografe antes de enviar para fora do host |
| Restore | em banco **vazio**: `DATABASE_URL=... scripts/restore.sh <pasta>`. Ensaiado em 2026-10-29: contagens idênticas, recusa banco não vazio |
| Rotação de segredos | trocar `JWT_ACCESS_SECRET` invalida todas as sessões (os usuários fazem login de novo); trocar o segredo do LiveKit exige reiniciar LiveKit e API juntos |
| Deploy / rollback | imagens com tag imutável (`opencord-api:<git-sha>`); rollback = subir a tag anterior. Migrações são só para frente: restaure o backup se uma migração precisar ser revertida (ver `packages/db/prisma/migrations/*/down.sql`) |
| Remover membro | o kick remove da SFU na hora (`RoomService.RemoveParticipant`) e das rooms realtime; ver o audit log do servidor |

## Checklist antes de produção
- [ ] Segredos fortes e únicos; `.env` fora do Git.
- [ ] TLS na API e no LiveKit (WSS).
- [ ] Teste externo de voz e Go Live com dois PCs em redes distintas (gate de mídia).
- [ ] Backup diário com restauração testada no ambiente real.
- [ ] Política de retenção e limites de upload definidos pelo mantenedor (DECISIONS.md).
