# F0 — Descoberta e viabilidade (relatório)

Data: 2026-10-29 · Executor: agente Claude Code · Máquina única (ver baseline). Todos os números abaixo vêm dos arquivos em `spikes/*/evidence/`. Nada aqui foi validado entre duas máquinas ou redes distintas.

## F0.1 — Baseline do ambiente

| Item | Valor |
|---|---|
| Host | Windows 11 Pro 10.0.26200 (build 26200) |
| CPU / RAM | AMD Ryzen 9 9950X3D2 16 núcleos (32 threads) / 31 GiB visíveis no WSL |
| GPU | NVIDIA GeForce RTX 5090, driver 32.0.16.1692 |
| Monitores | 3 (um em orientação retrato) |
| Áudio | Realtek HD, NVIDIA HD Audio, vários USB, NVIDIA Broadcast, NVIDIA Virtual Audio Device |
| Dev shell | WSL2 Ubuntu 26.04, kernel 6.18.54.1-microsoft-standard-WSL2 |
| Node / npm / pnpm (WSL) | v24.21.0 / 11.19.0 / 12.4.1 (corepack 0.36.0) |
| Node / npm (Windows) | v24.21.0 / 11.19.0 |
| git / gcc / python | 2.53.0 / 15.2.0 / 3.14.4 |
| Docker | **Indisponível** no WSL e Docker Desktop não instalado no Windows |
| Repositório | sem commits; só documentação (SDD pack) antes deste trabalho |

**Impacto:** F1.3 (Docker Compose) não pode ser validado localmente até haver Docker. Para as PoCs, o LiveKit rodou como binário oficial (`.tools/`, fora do Git). O Electron precisa ser executado do lado Windows (`%LOCALAPPDATA%\Temp\opencord-spikes`), porque não roda a partir de `\\wsl$`.

## F0.2 — LiveKit local com dois clientes e áudio bidirecional

- Servidor: `livekit-server` 1.13.10 (linux_amd64, SHA-256 verificado contra `checksums.txt`), `--dev --bind 127.0.0.1`.
- Clientes: `@livekit/rtc-node` 1.1.0 + tokens `livekit-server-sdk` 2.19.1 (grant de sala única, TTL 5 min).
- Teste: `spikes/f0.2-livekit-audio/poc.mjs` (tons sintéticos 440/880 Hz, verificação por Goertzel).

| Execução | Resultado | connect alice / bob (ms) | 1º áudio após connect alice / bob (ms) | energia tom certo / errado |
|---|---|---|---|---|
| poc-result | PASS | 1079 / 119 | 230 / 44 | ~4000 / <1 |
| run1 | PASS (exit 0) | 578 / 117 | 266 / 3 | idem |
| run2 | PASS (exit 0) | 662 / 120 | 228 / 41 | idem |
| run3 | PASS (exit 0) | 526 / 127 | 263 / 44 | idem |

O primeiro connect de cada processo inclui a inicialização do FFI nativo. Log do servidor: nenhuma linha de erro em 1638 linhas (só o trecho de startup foi mantido).

**Status F0.2:** parte local comprovada. **Conectividade de rede (NAT/TURN, redes distintas): BLOQUEADO PARA VALIDAÇÃO** (requer segunda máquina/rede e coturn).

## F0.3 — Seleção/captura de monitor e janela (Electron 44.7.1 / Chromium 152.0.7977.149)

| Verificação | Resultado (execuções 1–9) |
|---|---|
| `desktopCapturer.getSources` | 3 monitores, 6–8 janelas, todas as thumbnails não vazias |
| Monitor 1080p, pedido 60 fps | aquisição 99–670 ms; `settings.frameRate=60`; fps entregue (rVFC, desktop quase estático) 40,8–56,2 |
| Monitor 1080p, pedido 30 fps | fps entregue 15–29,3 (depende de movimento na tela) |
| Stop | `track.stop()` → todas as trilhas `ended`, `stream.active=false`, <2 ms |
| Recaptura após stop | sempre OK (aquisição 177–411 ms) |
| Janela própria (alvo controlado) | OK; **fechar a janela → evento `ended` em 5 ms** (runs 5–9) |
| Janela arbitrária de terceiros | OK em 6 execuções; run4: `NotReadableError: Could not start video source` |

Notas: (1) o fps do rVFC mede quadros *entregues*. Conteúdo estático gera poucos quadros (a janela-alvo estática mediu 0 fps), então o fps sob jogo real precisa de medição manual. (2) A primeira versão do handler não achava IDs de janela ao listar de novo. A correção foi reutilizar o objeto da listagem inicial, o que vale para a implementação final. (3) Janelas de terceiros podem falhar ao iniciar, e a UI precisa tratar `NotReadableError` com feedback acionável.

**Status F0.3:** comprovado nesta máquina. Fullscreen exclusivo, borderless com jogo real e janelas protegidas: **não testados**.

## F0.4 — Áudio do sistema via Electron/Chromium

Mecanismo: `session.setDisplayMediaRequestHandler` → `callback({ video, audio: 'loopback' })` (WASAPI loopback do Chromium). A trilha chega com `sampleRate=48000` e `channelCount=1` informado.

Teste com tom de 1234 Hz em volume baixo (opt-in `--with-tone`):

| Cenário | Detectado | Nível (dB no bin do tom) |
|---|---|---|
| Loopback, tom do **próprio processo** | 7/7 | −25,7 a −47,9 (baseline silêncio/−∞) |
| Loopback, tom de **outro processo** (PowerShell `SoundPlayer`) | 7/7 | −25,7 a −43,1 (baseline −97 dB ou −∞) |
| Loopback + `restrictOwnAudio: true`, tom do próprio processo | 0/4 (suprimido, como esperado) | −95 a −∞ |
| Loopback + `restrictOwnAudio: true`, tom de outro processo | **3/4** | −25,7 a −42,9; run7: −∞ |

Conclusões:
- **Há caminho comprovado para áudio do sistema sem módulo nativo**, via loopback do Chromium.
- O loopback puro captura o mix inteiro do sistema, **incluindo as vozes da chamada tocadas pelo próprio OpenCord**, o que causaria eco para os espectadores. `restrictOwnAudio` (suportado e aplicado, `getSettings().restrictOwnAudio=true`) removeu o áudio do próprio app em 4/4 execuções.
- A falha de 1/4 (run7) com `restrictOwnAudio` + processo externo **não foi explicada**. Pode ser janela de medição (arranque do PowerShell) ou comportamento real. Os testes audíveis foram suspensos a pedido do usuário, e o caso fica **NÃO VERIFICADO**, a reexecutar com consentimento (de preferência num dispositivo de saída virtual).
- Não há áudio *por aplicativo* (só o jogo) via Chromium. Isso exigiria WASAPI process loopback (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`) num módulo nativo, adiado (ver ADR-0003).
- `channelCount=1`: estéreo não confirmado.

**Status F0.4:** caminho técnico comprovado em uma máquina. Gate de mídia (dois Windows, redes distintas, espectador ouvindo): **BLOQUEADO PARA VALIDAÇÃO**.

## F0.5 — Matriz de compatibilidade

Encoder efetivo (`getStats().encoderImplementation`, captura de monitor 1080p60, loopback WebRTC local, run9):

| Codec | Encoder | Hardware | fps | Limitação |
|---|---|---|---|---|
| H.264 | MediaFoundation (NVIDIA H.264 Encoder MFT) | sim | 58 | none |
| H.265 | MediaFoundation (NVIDIA HEVC Encoder MFT) | sim | 57 | none |
| VP8 | libvpx | não | 58 | none |
| VP9 | libvpx | não | 57 | none |
| AV1 | libaom | não (RTX 5090 tem AV1 NVENC, mas o Chromium não o usa em WebRTC) | 57 | none |

`mediaCapabilities.encodingInfo({type:'webrtc'})` respondeu `powerEfficient=false` para todos os codecs, inclusive H.264, enquanto o `getStats` mostra NVENC. **Não usar `encodingInfo` como detector de hardware.** Usar `encoderImplementation`/`powerEfficientEncoder` medidos em sessão.

| Dimensão | Estado |
|---|---|
| Windows 11 26200 + RTX 5090 + Ryzen 9950X3D2 | verificado (esta máquina) |
| Outras GPUs (AMD/Intel/sem GPU), Windows 10 | não verificado |
| Monitor 1080p60 / 30 | verificado (fps depende do conteúdo) |
| 1440p60 | apenas `encodingInfo` (supported/smooth); captura real não testada |
| Multi-monitor com retrato | listado; captura do monitor retrato não testada |
| Janela | verificado; falha intermitente em janela de terceiros (NotReadableError) |
| Jogo borderless / fullscreen exclusivo | não testado (manual) |
| Conteúdo protegido (DRM) | não testado; não contornar |
| Áudio do sistema (mix) | verificado |
| Excluir áudio do próprio app | verificado 4/4; caso externo 3/4 (ver F0.4) |
| Áudio por aplicativo | indisponível sem módulo nativo |
| Rede distinta / TURN / perda | não testado |

**Recomendação para F4:** preferir H.264 (NVENC/QSV/AMF quando houver) para Go Live, com VP8 como fallback. Simulcast/dynacast do LiveKit para espectadores, perfis limitados pela medição real de `encoderImplementation`, `framesPerSecond` e `qualityLimitationReason`.

## Gate F0
- Riscos técnicos documentados: **sim** (este relatório + ADR-0003).
- Áudio do sistema com caminho comprovado: **sim, em uma máquina**. A validação entre duas máquinas Windows em redes distintas permanece **BLOQUEADA PARA VALIDAÇÃO** (gate especial de mídia).
- O F0 não bloqueia o F1: o gate exige "caminho comprovado ou bloqueio explícito", e ambos estão registrados.
