# Plano de testes e evidências

## Pirâmide
Unit: permissões, token, estado de conexão, reducers, schemas. Integração: auth, mensagens, canais, Redis, Prisma, Socket.IO, LiveKit sandbox. E2E: Electron login/chat/navegação e estados. Manual: captura e áudio do sistema Windows.

## Gates por fase
- G1: monorepo instala, typecheck, lint, testes unitários e desktop abre.
- G2: dois usuários trocam mensagens, permissão negada é respeitada, paginação consistente.
- G3: duas máquinas em voz, mute/deafen/PTT, troca de dispositivo e reconexão.
- G4: Go Live de monitor e janela, vídeo/áudio do sistema em outro PC, stream stop, 2 streams simultâneas.
- G5: tray, hotkeys, notificações, instalador, atualizações seguras.
- G6: testes de carga, segurança, backup/restore e docs de instalação.

## Evidência padrão
Para cada tarefa registrar: comando, resultado, data, ambiente, artefato/log, responsável, bloqueios. Nunca usar 'passou' sem executar.

## Matriz manual mídia
| Caso | Ambiente | Esperado |
|---|---|---|
| Voz bidirecional | 2 PCs, redes distintas | áudio sem cortes anormais |
| Screen + system audio | Windows 11 | espectador recebe vídeo e áudio |
| Janela/jogo | borderless/fullscreen | captura suportada ou limitação explícita |
| PTT com jogo em foco | Windows 11 | hotkey funciona sem travar jogo |
| Reconexão | alternar rede | recupera ou mostra erro claro |
| Revogação | admin remove usuário | acesso à SFU encerra |
| Multi-stream | 2 publishers | espectadores selecionam streams |
| Minimizado | tray | voz continua, stream respeita estado |

## Metas não garantidas
Conectar em voz p95 <2s e entrega de mensagens p95 <300ms em ambiente favorável; latência, FPS e bitrate devem ser medidos e registrados.

## Execução registrada (2026-10-29)
- Unitários: contracts 18, media 16, ui 4, api 11, desktop 13.
- Integração API (Postgres/Redis/LiveKit reais): 64/64.
- E2E Electron no Windows: smoke 5/5 (também no app empacotado), voz 6/6, Go Live real 1/1.
- Manual em hardware real: **não executado** (matriz acima continua pendente).
