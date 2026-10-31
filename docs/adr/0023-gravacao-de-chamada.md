# ADR-0023: Gravação da chamada (montada no app de quem grava, 24 h no servidor)
Status: Accepted (pedido do mantenedor, 2026-10-31)

## Contexto
O mantenedor pediu: "muitas pessoas irao utilizar o opencord para reunioes profissionais. Gostaria que tivesse alguma forma de gravar a call e apos gravar, poder baixar esse video em até 24hrs, o video se exclui sozinho dos nossos servidores".

Entre montar o vídeo no servidor (LiveKit Egress, um container com Chrome e 2 a 4 núcleos por gravação) e no app de quem grava, ele escolheu **o app de quem grava**: sem infraestrutura nova.

## Decisão
- **Quem grava:** qualquer pessoa que está na chamada (com CONNECT no canal). Uma gravação por vez em cada chamada.
- **Aviso:** todos veem o selo **GRAVANDO** com o tempo no cabeçalho da chamada.
  - Quem está na chamada recebe um aviso quando a gravação começa.
  - Quem grava confirma antes, num diálogo que explica o aviso, as 24 h e o limite de 4 h.
  - Evento `recording:state` para a sala do servidor.
- **Montagem (app de quem grava):**
  - `CallCompositor` desenha, a 1280×720 e 30 fps, cada pessoa (câmera, ou iniciais com o nome, com borda verde ao falar) e as transmissões de tela, que ocupam o palco com as pessoas numa coluna.
  - Os quadros vêm de `MediaStreamTrackProcessor` e saem por `MediaStreamTrackGenerator`, então funciona com a janela minimizada.
  - O motor de voz recebe todas as transmissões enquanto grava (`setRecordAll`).
  - `AudioMix` junta o meu microfone, as vozes e o som das transmissões num `AudioContext`, revisto a cada segundo.
  - A codificação é a mesma dos clipes (ADR-0022): H.264 a 2,5 Mb/s e AAC.
- **Envio:** MP4 fragmentado (`mp4-muxer`, `fastStart: 'fragmented'`, só anexa ao fim) cortado em partes de 8 MB e enviado em ordem durante a chamada (`POST /recordings/:id/parts`, com novas tentativas).
  - Nada fica inteiro na memória.
  - No servidor, o S3 usa multipart; no disco local, as partes são anexadas ao arquivo.
  - Limite de 4 h e 4 GB.
- **Fim:** parar, sair da chamada ou cair dela fecha o arquivo, sobe o resto e chama `complete`.
  - A gravação fica `ready` com `expiresAt = fim + 24 h`, e o evento `recording:ready` avisa quem está na chamada com "Baixar".
  - Se o app de quem grava some, o aviso "gravando" expira em 2 min sem `alive`/partes, e a varredura transforma o que já subiu numa gravação pronta (ou descarta, se nada subiu).
- **Download:** quem pode ver o canal pede um link assinado de 10 min (`POST /recordings/:id/link`, HMAC com `ATTACHMENT_URL_SECRET`). O navegador ou o app baixa direto, sem passar o arquivo pela memória.
  - Quem gravou, ou quem tem MANAGE_SERVER, pode apagar antes.
- **24 h:** uma varredura a cada minuto apaga o arquivo e a linha das gravações vencidas.
- **Banco:** tabela `CallRecording`, migração aditiva `20261031020000_call_recordings`.

## Consequências
- **Evidência:**
  - unidade `recording-layout.test.ts`;
  - integração `recordings.int.test.ts`: fora da chamada não grava; uma por vez; partes em ordem e só de quem grava; o aviso chega; o link baixa as partes juntas; quem não vê o canal não baixa; apaga após 24 h; app caído vira gravação pronta; sem partes é descartada;
  - E2E `recording.spec.ts` no Windows 11 real: selo GRAVANDO, 10 s gravados, MP4 fragmentado H.264 1280×720 + AAC que o Chromium toca até o fim (9,9 s).
- **Custos:** a CPU e a GPU de quem grava (uma codificação 720p30), o upload dessa pessoa (~2,7 Mb/s) e o armazenamento por 24 h (~1,2 GB por hora de chamada).
- **Limitações:**
  - A qualidade depende do computador e da rede de quem grava.
  - As transmissões entram na resolução recebida.
  - Apagar o canal apaga a linha, mas o arquivo só sai na próxima limpeza manual do armazenamento (`recordings/`).
- **Deploy:** a migração precisa rodar em produção antes da API nova, com aprovação do mantenedor.
