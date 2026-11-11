# ADR-0062: App desktop em Tauri, com Go Live nativo em Rust

Status: Proposed (pedido do mantenedor, 2026-11-10)

## Contexto
Em 07/11 foi feito um protótipo do app desktop em Tauri 2 (`apps/desktop-tauri`, commit `cc3aa20`): a mesma interface
React do `apps/desktop`, carregada no WebView2, com o processo principal em Rust. Ele foi desfeito em 08/11
(`1294b12`) por um mal-entendido e, em 10/11, o mantenedor pediu para retomá-lo, com uma ressalva: **a live não pode
depender do WebView**. O objetivo do Tauri é o app ser mais leve (RAM, CPU e disco) e a live ficar mais estável.

O protótipo transmitia como o Electron: `getDisplayMedia` dentro do WebView2 e `livekit-client` publicando a trilha.
No WebView2 isso tem dois problemas: o app não escolhe a fonte (quem escolhe é o seletor do próprio WebView2) e a
captura, a conversão e a codificação acontecem no processo do navegador, com o mesmo custo do Chromium do Electron.

Medição de 07/11 (tela de login, mesmo PC): instalador de 121 MB → 3,6 MB, instalado de 372 MB → 7,3 MB, memória
privada de 198 MB → 230 MB. A interface no WebView2 também é um Chromium: **o ganho de RAM da interface é pequeno**.
O ganho de recursos da live vem de tirá-la do navegador.

## Decisão

### O app
- `apps/desktop-tauri` volta ao repositório, ao lado do `apps/desktop` (Electron). O Electron continua sendo o app
  oficial até o Tauri ter tudo o que ele tem (lista em "Fases"); depois disso, a troca é uma decisão à parte.
- A ponte `window.opencord` continua com o mesmo contrato do Electron (`apps/desktop/electron/shared/ipc.ts`).
- A API aceita a origem `http://tauri.localhost` e libera o cabeçalho `x-hardware-id` no CORS (bloqueio de aparelho,
  ADR-0036, também no Tauri).

### Go Live nativo
Tudo fora do WebView, num módulo Rust do próprio processo do app:
1. **Captura:** Windows Graphics Capture (janela ou monitor; textura D3D11 na GPU, sem cópia para a CPU quando der),
   com o cursor e sem a borda amarela. Lista de janelas e monitores com miniaturas feita pelo Rust (seletor do próprio
   OpenCord, não o do WebView2).
2. **Áudio:** o mesmo process loopback do `oc-audio` (ADR-0025, "tudo menos o OpenCord"), lido direto no Rust (WASAPI),
   sem passar pelo worklet do navegador.
3. **Codificação:** H.264 pelo encoder da placa via Media Foundation (o MFT de hardware do Windows: NVENC, AMF ou
   Quick Sync, o mesmo caminho do Chromium), alimentado com a textura D3D11 da captura (sem cópia para a CPU), modo
   de baixa latência, CBR, quadro-chave sob pedido. Sem encoder de hardware, a live cai para o perfil seguro
   (1080p60), como no Electron (`checkEncoderFallback`).
   O SDK do LiveKit em Rust (`livekit` 0.10, `libwebrtc` 0.4) **não tem encoder por hardware no Windows** (o NVENC
   do `webrtc-sys` 0.3.53 só compila no Linux; o VAAPI do Windows está comentado): pelo caminho normal, 1440p60
   seria codificado por software. Por isso o vídeo entra **pré-codificado** (`NativeVideoSource::new_encoded`,
   `capture_encoded_frame`): o libwebrtc só empacota e envia, e repassa os pedidos de quadro-chave
   (`take_keyframe_request`) e de bitrate/fps da estimativa de banda (`take_rate_control_request`) para o encoder.
   Trilhas `screen_share` e `screen_share_audio` como hoje; o áudio vai pelo `NativeAudioSource` (Opus do libwebrtc).
4. **Processo próprio (`oc-live.exe`):** captura, codificação e envio rodam num processo à parte, como o `oc-audio`.
   Se o libwebrtc ou o driver da placa travar, cai só a live; o app avisa e pode reabrir. O app conversa com ele por
   stdin/stdout (JSON por linha).
5. **Participante próprio da live:** a SFU não aceita duas conexões com a mesma identidade, então a live entra como
   `<userId>:live`. A API emite esse token só para quem está na chamada e pode transmitir naquele canal (mesmas regras
   do token de voz), com `canPublish` apenas de tela e `canSubscribe: false`; o webhook da voz reconhece essa
   identidade (não a remove como "fora da chamada") e a derruba quando o dono sai da chamada.
6. **Quem assiste:** o `engine.ts` (comum aos dois apps) trata as trilhas de tela do participante `<userId>:live` como a
   live de `<userId>` e não o mostra como uma pessoa a mais na chamada. Quem assiste não muda de app nem de versão da
   SFU.

### O que fica no WebView
A voz da chamada, a câmera, quem assiste às lives e toda a interface. Mover a voz para o Rust não está nesta decisão.

## Fases
1. Protótipo de volta, com o que mudou no Electron desde 08/11 (atalho que volta sozinho; prender o mouse no Espaço 3D).
2. Spike da live nativa: captura de uma janela → H.264 da placa (Media Foundation) → LiveKit em Rust (pré-codificado)
   numa sala de teste; medir CPU, GPU, RAM, fps e
   latência contra o Go Live do Electron na mesma máquina, com e sem jogo aberto. Critério para seguir: 1080p60
   estável com uso de CPU menor que o do Electron.
3. Token e participante da live na API, `engine.ts` mostrando a live do `:live` no lugar certo.
4. Seletor nativo, áudio do `oc-audio` no Rust, prévia da live (ADR-0012), cenas (ADR-0015), controle remoto no monitor
   certo (ADR-0026), clipes sem o gesto do Chromium.
5. Atualização automática do Tauri, instaladores no CI e migração de quem usa o Electron (sessão, configurações,
   pasta de clipes).
6. Gate de mídia (CLAUDE.md): vídeo e áudio do sistema em duas máquinas Windows reais, em redes diferentes, com
   encerramento e reconexão. Até lá: BLOQUEADO PARA VALIDAÇÃO.

## Alternativas descartadas
- Continuar com `getDisplayMedia` no WebView2: o seletor não é do app e a live custa o mesmo que no Electron.
- Captura nativa entregando os quadros ao WebView (câmera virtual ou canal de dados) para o `livekit-client`
  publicar: copia cada quadro entre processos e mantém a codificação no navegador; perde o motivo da mudança.
- Mover toda a mídia (voz incluída) para o Rust: muito maior (processamento de voz, assistir lives no WebView) e não é
  o que trava a live hoje.

## Consequências
- Um participante a mais por live na SFU (só publica). Clientes antigos, sem o `engine.ts` novo, veriam o `:live` como
  um participante desconhecido: a live nativa só sai quando os dois apps tiverem o `engine.ts` novo.
- O SDK do LiveKit em Rust traz o libwebrtc nativo (dezenas de MB no instalador, ainda bem abaixo do Electron).
- Compilação do Rust no Windows (Rust + Visual Studio Build Tools), a partir do WSL por `scripts/build-win.mjs`.

## Evidências do spike (2026-11-10, Windows 11 do mantenedor, RTX/NVENC)
- `oc-live sources`: 3 telas e 5 janelas com miniatura em 560 ms (Steam, explorador, terminal; o próprio app fica
  de fora pelo pid).
- `oc-live run`: Tela 1 em 1920×1080, 60 fps, 12 Mbps, encoder escolhido "NVIDIA H.264 Encoder MFT"; com a tela em
  movimento, 57–60 fps saindo do encoder usando **4–12 % de um núcleo de CPU e 100–112 MB de RAM** no processo.
- Espectador (Edge no Windows, `livekit-client` 2.22.4) num LiveKit 1.13.10 local (`scripts/dev-livekit.sh`):
  1920×1080 H.264 (`profile-level-id=42e01f`) recebido, decodificado e renderizado, 0 pacotes perdidos, jitter
  ~3 ms; o quadro conferido na tela (cores e texto certos, cursor junto). Tela parada: o Windows só entrega quadro
  quando muda; o `oc-live` repete o último a cada 250 ms (4 fps na rede, ~20–200 kbps).
- Dois tropeços achados no caminho, já corrigidos: a fonte pré-codificada precisa de
  `video_encoder: VideoEncoderBackend::PreEncoded` (senão o libwebrtc negocia um encoder próprio e nada sai), e a SFU
  só libera o vídeo para quem assiste num quadro-chave **com SPS** — o encoder da NVIDIA manda SPS/PPS só no
  primeiro, então os seguintes levam o último cabeçalho visto (sem isso, a SFU pedia quadro-chave a cada segundo).
- Ainda não medido: 1440p60 com jogo aberto, o Go Live do Electron na mesma máquina para comparar, o áudio do
  sistema pelo `oc-audio`, placas AMD/Intel e máquina sem encoder de hardware.

## Adendo (2026-11-11): migração automática do Electron para o Tauri (preparada, desligada)
Pedido do mantenedor: quem tem o app Electron instalado passa para o Tauri **sem baixar instalador novo**, na versão
0.3.0 (a tela mostra "0.3.0-tauri"). Decisão do mantenedor: deixar tudo pronto e só ligar depois de resolver os
clipes nativos e o vazamento das vozes no áudio da live.
- **Versão:** o atualizador do Electron só entende `x.y.z` (`isNewer`); o instalador sai como `0.3.<n>` e o app em
  Tauri exibe `<versão>-tauri` (`sys.rs`, `app_info`).
- **Entrega:** o mesmo caminho de hoje (ADR-0051). Com a variável `TAURI_WINDOWS=1` (e `TAURI_FIRST_RUN` = o run da
  primeira versão), o CI gera o Windows pelo Tauri (`windows-tauri`, `scripts/build-ci.mjs`) com o nome
  `OpenCord-Setup-<versão>-x64.exe`; macOS e Linux seguem no Electron. O atualizador do Electron baixa, confere o
  SHA-256 e executa como se fosse uma versão sua.
- **Instalador** (`installer-hooks.nsh`): antes de instalar, fecha o `OpenCord.exe` (Electron) e roda o desinstalador
  dele em silêncio (os atalhos "OpenCord" saem antes de o novo criá-los; os dados ficam); depois, com `--force-run`
  (o que o atualizador do Electron passa no modo ocioso/"atualizar agora"), abre o app novo.
- **Dados** (`migrate.rs`, uma vez, antes da janela): os segredos do Electron (`serverUrl`, `session`) são decifrados
  (`safeStorage` = `os_crypt` do Chromium: AES-256-GCM `v10` com a chave do `Local State` protegida pela DPAPI) e
  gravados no cofre do Tauri; `app-prefs.json` (placa de vídeo) e `clips-dir.json` vêm junto. Só se o Tauri ainda
  não tem sessão. Não migram: o que a interface guardava no `localStorage` do Electron (preferências locais de tela,
  jogo, etc.) e fixações na barra de tarefas (o atalho fixado aponta para o exe antigo).
- **Atualizações seguintes** (`updater.rs`): o Tauri tem o próprio atualizador com as regras do Electron (mesma
  origem, https, tamanho e SHA-256; instala ao encerrar, ocioso fora de chamada/jogo ou em "atualizar agora").
- **Placa de vídeo:** "Sem aceleração" vira `--disable-gpu` no WebView2 e exige reiniciar; o reinício espera a
  instância anterior sair (o `app.restart()` abria a nova com o WebView2 antigo de pé). A sua live nativa continua
  na placa (processo à parte); o texto da opção diz isso.
- **Evidências:** `cargo test` 3/3 (versão `x.y.z`, URL confiável, decifrar `v10`); `--migration-check` na máquina do
  mantenedor decifrou `serverUrl` e `session` do Electron; build e instalador no Windows. **Falta:** o teste de ponta
  a ponta (Electron instalado → atualização → Tauri logado), o CI do `windows-tauri` rodando de verdade e o gate de
  mídia.

## Adendo (2026-11-11): replay dos clipes nativo
No WebView2 cada `getDisplayMedia` abre o seletor de tela, então o replay (que liga sozinho com um jogo aberto) abria
o seletor ao abrir o app. Agora a tela do replay sai do `oc-live clip` (mesma captura, conversão e encoder da live;
monitor principal; quadro-chave pelo relógio a cada 2 s, para a tela parada não alongar o GOP) e cada quadro vai para
a interface por um canal binário (cabeçalho de 13 bytes + H.264 Annex B). A interface converte para o formato do MP4
(`clips/annexb.ts`: NAL com tamanho, SPS/PPS no `avcC`), leva o relógio do processo para o `performance.now()` (o
mesmo do áudio) e guarda no mesmo `ChunkRing`; o áudio (sistema pelo `oc-audio apps-except`, outras saídas, microfone,
vozes) continua misturado e codificado no WebCodecs. Placa sem H.264: os clipes avisam que não gravam.
Evidência: `oc-live clip` 1080p e 720p no Windows do mantenedor, quadros-chave a 2,0 s, `ffprobe`/`ffmpeg` decodificam
o MP4 montado pelo `muxClip` com os quadros nativos sem aviso (após corrigir o tempo do quadro repetido, que usava
outro relógio — valia também para a live); `clips-annexb.test.ts` 4/4. Falta: salvar um clipe de verdade (jogo aberto
+ atalho) e ouvir o som dele.

## Adendo (2026-11-11): teste em massa antes de ligar a migração
O app em Tauri foi usado de ponta a ponta (variante de teste com API e LiveKit locais, dirigido pelo DevTools do
WebView2, com um segundo usuário no Edge). Gargalos achados: num monitor de 480 Hz, laços de `requestAnimationFrame` e
animações CSS infinitas recompunham a janela de vidro 480 vezes por segundo — a aurora do fundo passou a `setTimeout`,
o brilho do "Ao vivo" pulsa 3 vezes (opacidade/escala, sem sombra animada), o Espaço 3D cai para 30 qps sem foco e a
prévia da própria live nativa só recebe vídeo com a janela à vista (correção do mesmo dia: "ativa" congelava a prévia
de quem assiste a própria live em outro monitor; agora só minimizada ou na bandeja, pelo evento `oc:window-shown` do
Rust — minimizado, o `visibilityState` do WebView2 continua "visible"). No WebView2 o `document.hasFocus()` continua
verdadeiro com outra janela na frente, então a ponte ganhou `windowActive` (evento `Focused` da janela no Rust).
Erros corrigidos: CSP sem `blob:`/`data:` no `connect-src` (sons do gunfight), user agent (aparelho como "Edge"), Alt
sozinho deixava a janela no modo menu (subclasse que ignora `SC_KEYMENU` de teclado), live/clipes nativos órfãos após
recarregar, instaladores de atualização antigos acumulados em `%TEMP%`, tempos repetidos nos clipes nativos.
Medido (CPU somada da árvore, % de um núcleo): ocioso 12–20 → 5; live sem foco ~140 → ~25; Espaço 3D 119 → 56.

## Adendo (2026-11-11): Windows 10
No Windows 10 a live nativa não começava (`GraphicsCaptureApiError(BorderConfigUnsupported)`): o `windows-capture`
recusa iniciar quando uma opção fora do padrão não existe no sistema, e pedíamos sem borda amarela (`IsBorderRequired`,
Windows 11) e intervalo mínimo entre quadros (`MinUpdateInterval`, Windows 11 24H2). Agora cada opção só é pedida se o
Windows tem (`capture_options` no `oc-live`); sem `MinUpdateInterval` o handler descarta os quadros acima do fps pedido
(grade com tolerância de 1/4 de quadro). No Windows 10 a WGC sempre desenha a borda amarela; por isso, quando o
sistema não deixa tirá-la, **monitor inteiro** (live e clipes) vai pela Desktop Duplication do DXGI (`dxgi.rs`, sem
borda; o cursor é desenhado pelo GDI numa cópia da imagem; duplicação perdida em troca de resolução/UAC é refeita;
se não abrir, volta para a WGC). **Janela** continua pela WGC, com a borda no Windows 10 (não há outra API de janela).
`OC_LIVE_DXGI=1` força a duplicação para testar no Windows 11. Evidência da duplicação: `oc-live clip` com
`OC_LIVE_DXGI=1` na máquina do mantenedor (jogo em tela cheia aberto) gravou 1920×1080 decodificável, sem aviso de
volta para a WGC; o cursor desenhado e a live `run` pela duplicação ficam para o teste num Windows 10. Evidência: `oc-live clip` compilado fingindo um Windows sem as três opções, no monitor de 480 Hz do
mantenedor: começa, 59,5 qps com alvo 60 e menor intervalo 15,5 ms (sem o limite do handler: 8,5 ms). Falta: testar
numa máquina com Windows 10 de verdade.
