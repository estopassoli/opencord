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
