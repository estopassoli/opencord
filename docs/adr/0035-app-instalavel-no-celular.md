# ADR-0035: App instalável no celular (PWA) e revisão do layout de celular

Status: Accepted (pedido do mantenedor, 2026-11-02)

## Contexto
A interface no navegador (`app.opencord.pro`, mesmo renderer do desktop) é o que os amigos usam no celular. Duas
queixas com capturas reais: (1) no layout Vidro as gavetas (servidores + canais, membros) ficavam translúcidas e o
chat vazava por trás; o painel do usuário cobria o fim das listas; na chamada a barra de controles não cabia em
390 px e a faixa de participantes ficava escondida atrás dela; (2) não dava para "instalar" o app no celular, só
abrir a aba.

## Decisão

### Layout de celular (`styles/mobile.css`, só ≤ 768 px ou deitado com toque)
- No Vidro, as superfícies viram opacas dentro de `.shell` (tons do `--vidro-bg` do tema): o fundo vivo não existe
  no celular, então o vidro só atrapalhava.
- `.rail` e `.sidebar-scroll` terminam acima do painel do usuário (`padding-bottom`).
- Chamada: barra centralizada e limitada à largura da tela; saem do celular o seletor de microfone, atividades,
  efeitos sonoros, gravação e o botão de tela cheia do palco; "Transmitir tela" só aparece onde há
  `getDisplayMedia` (não há no iOS nem no Chrome Android). Em pé, a live em destaque fica em 16:9 e os participantes
  viram uma grade de duas colunas embaixo; deitado, volta a faixa de uma linha. Cabeçalho mostra só o canal e o selo
  AO VIVO.

### PWA
- `public/manifest.webmanifest` (standalone, `start_url`/`scope` relativos por causa do `base: './'` do Electron),
  ícones 192/512 e maskable 512 gerados do `build/icon.png`, `apple-touch-icon` 180 e as metas do iOS no `index.html`.
- Service worker **gerado no build** por um plugin próprio do Vite (`scripts/pwa.mjs`, sem dependência nova):
  pré-cacheia a casca (index, chunk de entrada, CSS, manifesto, ícones), cache-first para `assets/*` (com hash),
  rede-first com reserva para o resto da origem e **nunca toca outras origens** (API, LiveKit, imagens). Versão do
  cache = hash dos nomes do bundle; caches antigos somem no `activate`.
- Registro só no navegador por http(s) e fora do modo dev (`lib/pwa.ts`); o Electron (`file://`, `window.opencord`)
  nunca registra. Versão nova → toast "OpenCord atualizado. Vale na próxima vez que abrir." (sem recarregar sozinho:
  podia derrubar uma chamada).
- Convite de instalação: Android/Chrome via `beforeinstallprompt` (item no rail "Instalar o OpenCord no celular" e
  bloco em Configurações → Sobre); iOS não tem o evento, então o app orienta (Compartilhar → Adicionar à Tela de
  Início). Já instalado (`display-mode: standalone`), nada aparece.

### Chamada em segundo plano no navegador do celular (adendo, mesmo dia)
Relato real (iPhone): ao minimizar, a voz dos outros parava e o microfone ficava mudo. Causa: três `AudioContext`
no caminho da voz (mixer Web Audio do livekit-client, RNNoise em worklet e o analisador do gate de voz) que o iOS
suspende fora da frente; o gate fechado desligava a trilha. Em `isMobileWeb()` (Android/iOS no navegador): sem
`webAudioMix` (áudio remoto direto em `<audio>`), sem RNNoise (fica a supressão do navegador), sem gate (microfone
sempre aberto; "falando" vem da SFU), silenciar/ensurdecer via `muted` do elemento (o iOS ignora `volume`), Media
Session (`playing` + play/pause inertes + `hangup` sai da chamada) e, ao voltar à frente, `startAudio()` e
`restartTrack` se o sistema encerrou o microfone. A tela ociosa do canal de voz ganhou cabeçalho com o menu.
Limite honesto: o iOS ainda pode cortar o microfone em segundo plano conforme a versão; a reprodução deve seguir.
Validação em iPhone/Android reais pendente.

## Alternativas
- `vite-plugin-pwa`/Workbox: mais poder (precache completo, estratégias), mas dependência extra e precache de
  vários MB (three.js, fontes, wasm) que não precisamos; o worker de 60 linhas cobre o caso.
- Recarregar automaticamente ao atualizar: rejeitado (chamada em andamento).
- Notificações push: fora desta decisão (exigem servidor de push e chaves VAPID).

## Consequências
- Sem rede o app abre a casca e mostra o aviso de conexão; nada do conteúdo é guardado offline.
- O nginx do app serve `sw.js` e `manifest.webmanifest` com `no-cache` (regra existente: só o que tem hash é
  imutável); o tipo `application/manifest+json` foi explicitado.
- Validação real pendente: instalar num Android e num iPhone de verdade (o headless só confirma registro do worker,
  cache preenchido e manifesto com 3 ícones).

## Evidências
- `apps/desktop/test/pwa.test.ts` 6/6 (precache, versão, worker só GET da própria origem, iOS/standalone/Android).
- Capturas headless 390×844 e 844×390 (gavetas opacas, membros, chamada em grade, live em destaque, deitado) em
  `scratchpad/rn/mob5-*.png`; `navigator.serviceWorker.getRegistration()` → `activated`, cache com 12 entradas.
