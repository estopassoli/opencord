# Contratos realtime — Socket.IO e LiveKit

## Regra de transporte
Socket.IO para eventos de domínio, mensagens, presença e sinalização de UI; LiveKit para mídia WebRTC. Todos os eventos recebidos devem ter schema Zod, autenticação, autorização e limites de payload.

## Envelope
```ts
type EventEnvelope<T> = { eventId: string; schemaVersion: 1; occurredAt: string; payload: T };
```
Comandos de cliente usam `requestId` para idempotência e ACK explícito. Eventos do servidor possuem sequência/cursor quando replays forem necessários.

## Namespaces e eventos iniciais
- `chat:message:create` → ACK `{messageId,createdAt}`; broadcast `chat:message:created`.
- `chat:message:edit`, `chat:message:delete`, `chat:reaction:set`.
- `chat:typing:start` e `chat:typing:stop` (TTL; sem persistência).
- `presence:heartbeat`, `presence:changed` (não revelar invisível como online).
- `voice:state:changed`, `voice:member:joined`, `voice:member:left` (espelho do estado autorizado, não transporte de mídia).
- `channel:unread:changed`, `notification:created`.

## Sequência de entrada em voz
1. Cliente chama `POST /voice/channels/:id/join` com sessão autenticada.
2. Backend valida `CONNECT` e `SPEAK`, verifica capacidade e políticas, retorna URL LiveKit + token curto + roomName opaco.
3. Cliente conecta ao LiveKit, publica mic se permitido, recebe eventos de participantes.
4. API atualiza presença a partir de eventos confiáveis do servidor/SFU e reconcile periódico.
5. Ao sair, `POST /voice/leave`, desconecta e limpa estados; timeout resolve quedas abruptas.

## Segurança e resiliência
Não aceitar `userId` arbitrário no payload como identidade. Rate limits por usuário e IP; rooms Socket.IO autorizadas. Reconnect deve ressincronizar mensagens por cursor e presença; eventos podem chegar duplicados ou fora de ordem. Validar assinaturas de webhook LiveKit.
