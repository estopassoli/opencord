# ADR-0016: Efeitos sonoros na chamada
Status: Accepted (pedido do mantenedor, 2026-10-30)

## Contexto
O mantenedor pediu: "qualquer um consegue fazer upload de um arquivo mp3 e colocar um nome, qualquer pessoa pode usar o efeito, ao clicar ele reproduz o efeito na chamada de voz que o usuário estiver conectado, todos na chamada escutam". Os sons são adicionados pelas configurações do servidor ou pelo botão "Adicionar som".

## Decisão
- **Tabela `SoundEffect`** (migração `20261030120000_sound_effects`), uma lista por servidor: nome (até 32 caracteres), emoji opcional, volume do som (0–1), duração e quem enviou. Máximo de 48 sons por servidor.
- **Arquivo:** MP3, OGG ou WAV, até 1 MB e 10 s.
  - O tipo é detectado pelos bytes.
  - A duração é medida pelo decodificador do app e validada pelo contrato.
  - Fica no armazenamento configurado (R2 ou disco), em `sounds/<uuid>`.
  - `GET /sounds/:id/file` entrega o arquivo só a membros do servidor do som.
- **Quem envia e remove:** qualquer membro envia (`POST /servers/:id/sounds`). Remove quem enviou ou quem tem MANAGE_SERVER. Envio e remoção ficam na auditoria e avisam por `sound:list:changed`.
- **Tocar:** comando Socket.IO `sound:play`, só para quem está na chamada, e só com sons do servidor dela.
  - O servidor só repassa o aviso `sound:played`. Cada pessoa na chamada toca o arquivo no próprio app, baixado uma vez e guardado em cache, pelo dispositivo de saída escolhido.
  - Nenhuma mídia passa pelo Socket.IO.
  - Anti-flood: um som por pessoa a cada 1,5 s (Redis `SET NX PX`).
- **Por pessoa:** volume dos efeitos e "silenciar efeitos", lembrados neste computador. Quem está ensurdecido não ouve. "Utilizados com frequência" usa o histórico local.

## Consequências
- **Evidência:**
  - integração `sounds.int.test.ts`: membro comum envia; arquivo só para membros; tocar exige estar na chamada; o aviso chega; anti-flood; remoção; tipo pelos bytes; 1 MB;
  - E2E `voice.spec.ts`: A envia um WAV pelo painel da chamada e toca, e B ouve (contador de diagnóstico, já que o app de teste roda mudo).
- **Deploy:** a migração é aditiva (tabela nova) e pode rodar antes da API nova.
