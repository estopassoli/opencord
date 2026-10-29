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

## Produção atual — opencord.pro (cluster Dokploy/Swarm)
| Peça | Onde |
|---|---|
| `opencord.pro` (landing) e `app.opencord.pro` (interface no navegador) | app Dokploy `opencord-web` — `infra/docker/web.Dockerfile` (nginx; escolhe pelo Host) |
| `api.opencord.pro` (API + Socket.IO) | app Dokploy `opencord-api` — `infra/docker/api.Dockerfile`; anexos no volume `opencord-uploads`, réplica única presa a um nó |
| `rtc.opencord.pro` (sinalização WSS) | LiveKit 1.13.10 em dois nós (stack `livekit-opencord`, rede do host, Redis db 4); mídia direto no IP do nó: **TCP 7901** e **UDP 7902** (mux numa porta só, em vez de 50000-50100) |
| PostgreSQL / Redis | instâncias compartilhadas do cluster (banco `opencord`, Redis db 5), com réplica e backup a cada 5 h |

- TLS na Cloudflare (zona em SSL Full); a mídia WebRTC não passa pela Cloudflare.
- **Migrações não rodam na subida da API**: a cada deploy com migração nova, aplicar antes com
  `prisma migrate deploy --schema /app/prisma/schema.prisma` (CLI 6.19.3 incluída na imagem).
- Sem coturn/TURN por enquanto: o fallback quando UDP é bloqueado é ICE/TCP 7901. Redes que só liberam 443 não conectam a mídia.
- Configuração da infraestrutura (stack do LiveKit, rotas do Traefik, ufw) fica fora deste repositório, no repositório de infraestrutura do cluster.
