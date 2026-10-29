# ADR-0001 — LiveKit SFU
Status: Accepted

## Contexto
Voz, vídeo e múltiplas transmissões exigem baixa latência, NAT traversal e escalabilidade moderada.

## Decisão
LiveKit self-hosted para SFU; coturn para TURN/STUN; Socket.IO apenas para domínio/chat.

## Consequências
Menor risco do que construir SFU própria; exige operação de UDP, métricas e testes de interoperabilidade. Não fornece automaticamente captura de áudio de jogos no Windows.
