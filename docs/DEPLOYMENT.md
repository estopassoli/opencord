# Infraestrutura e deploy

## Ambiente local
Docker Compose com PostgreSQL, Redis, LiveKit, coturn, MinIO opcional e API. Electron roda localmente em dev. Não incluir credenciais reais no Git; criar `.env.example` quando scaffold existir.

## Produção V1
Instância privada, DNS e TLS; backup PostgreSQL diário com restauração testada; bucket S3 com permissões mínimas; Redis persistência apenas se necessária; logs rotacionados. LiveKit precisa de portas de mídia UDP/TCP e endereços públicos corretos; TURN precisa ser acessível de fora. Proxy HTTP não substitui roteamento de mídia.

## Dimensionamento
Planejar para 5–15 amigos, testar 10 em voz e 2–4 streams simultâneas. Não fixar tamanho de VPS antes de medir bitrate agregado, CPU e tráfego de saída. Preparar separação SFU/API em máquinas distintas.

## Runbook
- Verificar saúde API, PostgreSQL, Redis, LiveKit e coturn.
- Testar conexão externa com NAT diferente.
- Diagnosticar ICE/TURN, DNS, TLS, firewall, UDP e port mapping.
- Procedimento de backup/restore e rotação de segredos.
- Deploy/rollback com versão imutável e smoke tests.

## Restrições
Não executar deploy em produção sem aprovação. Não habilitar auto-update de origem não assinada ou não confiável.

## Instância pública (opencord.pro)
A instância mantida pelo autor roda as mesmas imagens deste repositório, num cluster Docker Swarm:
| Peça | Como |
|---|---|
| `opencord.pro` (landing) e `app.opencord.pro` (interface no navegador) | `infra/docker/web.Dockerfile` (nginx; escolhe pelo Host) |
| `api.opencord.pro` (API + Socket.IO) | `infra/docker/api.Dockerfile`; arquivos em volume local ou num bucket S3 compatível (`STORAGE_DRIVER=s3`, ADR-0010) |
| `rtc.opencord.pro` (sinalização WSS) | LiveKit em rede do host; a mídia vai direto ao IP do nó, com mux numa porta TCP e numa UDP (em vez da faixa 50000-50100) |
| PostgreSQL / Redis | instâncias gerenciadas à parte, com réplica e backup periódico |

- TLS no proxy de borda; a mídia WebRTC não passa pelo proxy.
- **Migrações não rodam na subida da API**: a cada deploy com migração nova, aplicar antes com
  `prisma migrate deploy --schema /app/prisma/schema.prisma` (CLI incluída na imagem).
- Atrás de um proxy/CDN que reescreve o `X-Forwarded-For`, defina `CLIENT_IP_HEADER` com o cabeçalho do IP real (ex.: `cf-connecting-ip`) e **aceite na origem só conexões vindas desse proxy**; sem isso, os limites por IP ficam divididos entre todos ou podem ser forjados.
- **App desktop**: o workflow *Desktop (instaladores)* (`.github/workflows/desktop.yml`, manual ou tag `v*`) gera `.exe`, `.dmg` (arm64 e x64), `.AppImage` e `.deb` já apontando para `https://api.opencord.pro`. Para publicar, copie os arquivos do run para o volume `opencord-downloads` (montado em `/data/downloads`, `DOWNLOADS_DIR`); a API passa a servir a versão mais recente de cada plataforma, sem redeploy. A landing lê a lista de `GET /downloads/desktop` (por isso `https://opencord.pro` está em `CORS_ORIGINS`).
- **Atualizações do desktop**: o app instalado consulta `GET /downloads/desktop` 15 s após abrir, a cada 20 min e ao voltar para a janela (se a última verificação tiver mais de 5 min); também há "Verificar atualizações" em Configurações → Sobre; se a versão publicada for maior que a dele, baixa (Windows) e mostra "Atualização pronta" na barra de título.
- **Lançamento automático** (`.github/workflows/desktop.yml`): todo push no `main` que mexe em `apps/desktop/**`, `packages/**` ou no lockfile gera a versão `<major>.<minor>.<nº do run>` (base no `package.json`; tag `vX.Y.Z` usa a versão exata), empacota as três plataformas e, se os secrets abaixo existirem, entrega os arquivos no volume `opencord-downloads`. Sem os secrets, os instaladores ficam só como artefatos do run (copiar à mão). Em repositório público os minutos do Actions são gratuitos; em fork privado, cada lançamento gasta ~60–70 min da cota (macOS conta 10×).

### Entrega automática por SSH restrito (configurar uma vez, no nó onde roda a API)
A chave só consegue **gravar** na pasta do volume (`rrsync -wo`): não abre shell, não lê arquivos, não sai da pasta.
```sh
# no nó da API (onde o volume opencord-downloads está montado)
# shell /bin/sh, não nologin: o sshd roda o command= forçado pelo shell do usuário (o rrsync continua barrando terminal)
sudo useradd --system --create-home --shell /bin/sh opencord-dl && sudo passwd -l opencord-dl
VOL=$(docker volume inspect opencord-downloads -f '{{ .Mountpoint }}')   # ex.: /var/lib/docker/volumes/opencord-downloads/_data
sudo setfacl -m u:opencord-dl:x /var/lib/docker  # só atravessar (é 710 root; pacote acl)
sudo setfacl -m u:opencord-dl:rwx "$VOL"           # escrever na pasta; a API continua lendo (arquivos 644)
ssh-keygen -t ed25519 -N '' -C 'github-actions opencord-downloads' -f opencord-dl   # gera opencord-dl e opencord-dl.pub
sudo install -d -m 700 -o opencord-dl ~opencord-dl/.ssh
echo "command=\"/usr/bin/rrsync -wo $VOL\",restrict $(cat opencord-dl.pub)" | sudo tee ~opencord-dl/.ssh/authorized_keys
sudo chown opencord-dl ~opencord-dl/.ssh/authorized_keys && sudo chmod 600 ~opencord-dl/.ssh/authorized_keys
ssh-keyscan -t ed25519 <IP-ou-host-do-nó>           # saída = DOWNLOADS_SSH_KNOWN_HOSTS
```
Secrets no GitHub (Settings → Secrets → Actions): `DOWNLOADS_SSH_KEY` (conteúdo de `opencord-dl`, a chave privada; depois apague o arquivo), `DOWNLOADS_SSH_HOST` (IP/host do nó, porta 22 liberada para o GitHub Actions), `DOWNLOADS_SSH_USER` (`opencord-dl`) e `DOWNLOADS_SSH_KNOWN_HOSTS`. `rrsync` vem no pacote `rsync` (≥ 3.2.4; em versões antigas fica em `/usr/share/doc/rsync/scripts/rrsync`). Revogar = apagar a linha do `authorized_keys`. Versões antigas acumulam no volume; a API sempre serve a mais recente de cada plataforma (pode apagar as velhas).
- **Assistir juntos (YouTube)**: funciona sem configuração (por link). Para a **pesquisa**, crie uma chave da YouTube Data API v3 no Google Cloud (restrinja à API do YouTube) e defina `YOUTUBE_API_KEY` na API; a cota grátis dá ~100 pesquisas/dia. Sem a chave, o app mostra só o campo de link.
- Na instância pública não há coturn/TURN por enquanto: o fallback quando UDP é bloqueado é ICE/TCP. Redes que só liberam 443 não conectam a mídia.
- A configuração específica do cluster (stacks, rotas, firewall) fica fora deste repositório.
