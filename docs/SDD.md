# SDD — OpenCord v2.0

## 1. Escopo e rastreabilidade
Documento principal. Requisitos em `PRD.md`; decisões em `ARCHITECTURE.md`, `MEDIA_ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, `DATABASE.md`, `REALTIME_PROTOCOL.md`, `SECURITY.md`; execução em `IMPLEMENTATION_PLAN.md`.

## 2. Requisitos funcionais
| ID | Descrição | Aceite |
|---|---|---|
| RF-01 | Autenticação por convite | token expirável/uso limitado, sessão revogável, cadastro público fechado |
| RF-02 | Servidores/categorias/canais | listar, criar, ordenar e controlar acesso |
| RF-03 | Mensagens | persistência, cursor, edição, resposta, reação, anexos, não lidas |
| RF-04 | DMs e amigos | convite de amizade, aceitar, remover, bloquear, conversa privada |
| RF-05 | Voz | entrar com clique, PTT, VAD, mute, deafen, volume individual, reconexão |
| RF-06 | Vídeo | webcam, grid, destaque, ocultar, adaptar qualidade |
| RF-07 | Go Live | monitor/janela, preview, áudio sistema Windows, assistir streams |
| RF-08 | Presença | online/ausente/ocupado/invisível; sincronização e TTL |
| RF-09 | Desktop | tray, notificações, atalhos, instalador, atualização segura |
| RF-10 | Administração | roles, overrides, kick, convite, auditoria |

## 3. Requisitos não funcionais
- NFR-01: TLS para controle, SRTP/DTLS para mídia; proteção de tokens.
- NFR-02: entrada em voz p95 alvo <2s em ambiente favorável; medir, não prometer.
- NFR-03: mensagem online p95 alvo <300ms no ambiente de testes; medir.
- NFR-04: áudio prioritário sobre qualidade da tela sob congestionamento.
- NFR-05: nenhuma gravação por padrão.
- NFR-06: atualização e build Windows assinados quando houver certificados.
- NFR-07: telemetria operacional sem conteúdo de mensagens/voz.
- NFR-08: observabilidade de RTT, jitter, packet loss, banda e falhas de ICE.

## 4. Fluxos críticos
**Entrada em voz:** clique → API valida permissão → garante exclusividade de sessão → emite token LiveKit de escopo mínimo → desktop conecta → presença confirma estado → dock persistente.

**Go Live:** selecionar fonte → preview local → validar permissão e capacidades → iniciar captura Windows → publicar trilhas `screen_video` e `screen_audio` quando disponíveis → espectadores assinam trilhas → encerrar e liberar dispositivos.

**Revogação:** admin remove membro → API invalida autorização → encerra sessão de mídia / retira participante → atualiza UI e audit log.

## 5. Modelo de estados
Voz: `disconnected → authorizing → connecting → connected → reconnecting → disconnected` ou `failed`. Stream: `idle → selecting → starting → live → stopping → idle` ou `error`. Nunca mostrar `live` antes de confirmação do publisher.

## 6. Falhas e recuperação
Token expirado: renovar via backend. ICE failure: retry limitado + TURN. Permissão negada: feedback acionável. Fonte removida: parar publicação. Offline: manter rascunho local, enfileirar apenas ações idempotentes. Erros não devem deixar microfone ou tela transmitindo ocultamente.

## 7. Critério de conclusão
Checklist em `TEST_PLAN.md` + testes automatizados + validação manual real para mídia. Sem validação em hardware, fase de mídia não pode receber status `DONE`.
