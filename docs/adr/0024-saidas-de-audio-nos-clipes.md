# ADR-0024: Cada saída de áudio do Windows nos clipes (oc-audio.exe)
Status: Accepted (pedido do mantenedor, 2026-10-31)

## Contexto
O mantenedor usa um fone com duas saídas no Windows ("A50 X Game", a padrão, e "A50 X Voice", a de comunicação). Os
clipes (ADR-0022) gravavam só uma delas: a captura `loopback` do Chromium grava apenas o **dispositivo de saída
padrão**, e não há API web para escolher outro. Ele pediu que o clipe tivesse, como em outros apps: o som que ele ouve
das vozes, o microfone dele e o som do jogo.

## Decisão
- **Componente nativo pequeno:** `apps/desktop/native/win-audio/OcAudio.cs`, compilado em `oc-audio.exe` com o `csc` do
  .NET Framework 4 que vem em todo Windows (`scripts/build-win-audio.mjs`, chamado pelo `build`; no WSL, via `cmd.exe`).
  - Sem dependência nova, sem rede, sem privilégio. Entra no instalador como `extraResources` (só Windows).
  - `oc-audio list`: saídas ativas (id, nome, padrão, comunicação), pela MMDevice API.
  - `oc-audio capture <id>`: WASAPI loopback em modo compartilhado; converte qualquer formato da saída (16/24/32 bits,
    float, 5.1/7.1) para estéreo float 48 kHz e escreve o PCM no stdout. Para quando o stdin fecha (o app fecha o
    stdin ao parar; se o app morrer, o pipe fecha e ele sai sozinho).
- **Processo principal** (`electron/main/win-audio.ts`): IPC `win-audio:list|start|stop` (id validado), um processo
  por saída, PCM para a janela pelo evento `ev:win-audio` em pedaços de quadros inteiros. Para tudo ao recarregar ou
  fechar a janela e ao sair.
- **Janela** (`src/clips/audio.ts`): um `AudioWorklet` (`pcm-worklet.js`, arquivo próprio por causa do CSP) toca o PCM
  de cada saída com fila de até 200 ms (relógios diferentes: o excesso é descartado, a falta vira silêncio).
- **Trilhas do clipe** (a 1ª é a mistura, que qualquer player toca):
  1. Tudo;
  2. a saída padrão, pela captura do Chromium (que tira o som do próprio OpenCord, `restrictOwnAudio`);
  3. cada outra saída ligada, pelo `oc-audio.exe`, com o nome do Windows;
  4. Microfone (o meu, já processado);
  5. Vozes da chamada (o som que chega dos outros);
  6. Efeitos sonoros.
  - Se o OpenCord toca numa das outras saídas (Configurações → Voz → saída), as vozes e os efeitos já estão no som
    dela: as trilhas 5 e 6 não existem nesse caso (sairiam dobradas).
- **Escolha das saídas:** Configurações → Jogos → Clipes lista as saídas; todas ligadas por padrão, desligadas ficam
  em `games.clipOutputsOff` (pelo nome).

## Alternativas
- Captura por processo (`AUDIOCLIENT_PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE`): tira o OpenCord, mas mistura
  todas as saídas numa só (não separa jogo de vozes) e exige Windows 10 2004+. Fica como evolução.
- Addon N-API compilado: exige toolchain C++ no CI e rebuild por versão do Electron. O executável em C# não.
- PowerShell com `Add-Type` em tempo de execução: compila a cada abertura e costuma ser bloqueado por antivírus.

## Limitações reais
- Uma saída parada (nenhum app tocando nela) não entrega pacotes; a trilha fica em silêncio (correto).
- Nas saídas extras, o som do OpenCord não é separado do resto (veja a regra das trilhas 5 e 6).
- Saídas virtuais que repassam o som para outra (ex.: "NVIDIA Broadcast") podem gravar o mesmo som duas vezes; dá para
  desligar a saída em Configurações → Jogos.
- `oc-audio.exe` não é assinado (como o próprio instalador ainda não é).

## Evidências
- `oc-audio list` no Windows do mantenedor: 4 saídas, com "A50 X Game" padrão e "A50 X Voice" comunicação.
- E2E `clips.spec.ts` (Windows real): clipe com 8 trilhas nomeadas; PCM de 3 MB recebido da "A50 X Voice" em ~8 s.
- MP4 decodificado trilha a trilha (mediabunny no Chromium): Game pico 0,37, Voice pico 0,24, saídas paradas 0.
- Depois do teste, nenhum `oc-audio.exe` ficou aberto.
