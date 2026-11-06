# ADR-0051: Atualização automática do app desktop (Windows)
Status: Accepted (pedido do mantenedor, 2026-11-06). Substitui a decisão "avisar e baixar" de 2026-10-29 em `docs/DECISIONS.md`.

## Contexto
Até aqui o app baixava o instalador novo e só o executava quando a pessoa clicava em "Atualização pronta".
Muita gente ficava várias versões para trás.
O mantenedor pediu atualização automática como a do Discord: baixou, instala sem precisar de clique.

O instalador do Windows é NSIS "um clique", por usuário (`electron-builder.yml`). Ele **não é assinado**: não há certificado de assinatura de código.

## Decisão
- **Download e integridade:**
  - Continua igual: o app consulta `/downloads/desktop` do próprio servidor e só aceita instalador da mesma origem, por https (http só em localhost), com nome validado e tamanho conferido.
  - A API passa a publicar `sha256` (hex) em cada `DesktopFile`. O hash é calculado por arquivo (chave nome+tamanho+data) e fica em memória.
  - O app calcula o SHA-256 durante o download e só marca "pronta" se o hash conferir (`hashMatches` em `electron/shared/update-core.ts`). Se não conferir, o arquivo é apagado e nada é executado.
  - Antes de executar pelo clique ou pela instalação automática, o hash do arquivo é calculado de novo. Se o arquivo mudou na pasta temporária, ele é descartado.
  - Servidor antigo, sem `sha256`: valem só a origem https e o tamanho (registrado no log do main). Link externo (`DESKTOP_DOWNLOAD_URL`) vem com `sha256: null` e já é recusado pela regra de mesma origem.
- **Quando instala (só Windows, só no app empacotado):**
  1. **Ao encerrar** (bandeja → Encerrar, `app.quit`): no `will-quit`, chama o instalador com `/S --updated`, em silêncio e sem reabrir. A próxima abertura já é a versão nova.
  2. **Sozinho, com a pessoa longe:** a cada minuto o main avalia `shouldAutoInstall`. As condições são:
     - instalador pronto;
     - fora de chamada de voz (`IPC.trayVoiceState`; Go Live e gravação da chamada só existem dentro de uma chamada);
     - nenhum jogo detectado;
     - sem teclado/mouse no sistema (`powerMonitor.getSystemIdleTime`) há **10 min** com a janela à mostra, ou há **2 min** com a janela escondida ou minimizada.

     Atendidas as condições, chama `/S --updated --force-run`, que instala em silêncio e reabre. O estado é conferido de novo depois de recalcular o hash, então nunca interrompe uma chamada.
     Se a janela estava escondida, uma marca em `userData/update-relaunch.json` faz o app reaberto (com `--updated`, até 10 min depois) voltar escondido na bandeja.
  3. **"Reiniciar e atualizar agora"** (diálogo da barra de título, menu da bandeja, tela de erro): `--updated --force-run`, mostrando a janela de progresso. É o mesmo comportamento de antes.
  4. **"Reiniciar o app"** pedido por uma configuração, com atualização pronta: o instalador reabre o app já na versão nova.
- **Desligamento do Windows:** com `query-session-end`/`session-end`, a instalação **não** começa. O Windows mataria o instalador no meio da cópia e deixaria a instalação quebrada. Fica para a próxima vez: o próximo encerramento ou a próxima vez em que a pessoa ficar longe do PC.
- **Comportamento do NSIS (electron-builder, `oneClick`):**
  - `/S`: sem janela.
  - `--updated`: encerra o app que ainda estiver fechando sem perguntar e reabre o app com `--updated`.
  - `--force-run`: reabre mesmo em modo silencioso (`RUN_AFTER_FINISH` com `${isForceRun}`).
- **macOS/Linux:** sem mudança. O clique abre o download no navegador.
- **Dev/E2E** (sem empacotar): a instalação automática fica desligada. O instalador falso do E2E nunca roda.

## Consequências
- Instalar algo sem clique, sem assinatura de código, depende de confiar no servidor configurado.
  O SHA-256 protege contra download corrompido ou truncado e contra troca do arquivo na pasta temporária.
  Ele **não** protege contra um servidor comprometido, que publicaria hash e instalador juntos. O "avisar e baixar" também não protegia: o clique só confirmava.
  Assinatura própria (Ed25519 com chave fora do servidor) ou certificado de código continuam como próximos passos. `docs/SECURITY.md` foi atualizado.
- O SmartScreen não aparece no modo silencioso, porque o arquivo baixado pelo `net.fetch` não recebe a marca da internet. Isso também não foi verificado num Windows real.
- A primeira consulta a `/downloads/desktop` depois de publicar um instalador espera a API ler o arquivo (~100 MB).
- **Não testado em Windows real:** instalação silenciosa, reabertura com `--force-run`, volta escondida na bandeja, recusa no desligamento. A lógica de decisão tem testes unitários (`apps/desktop/test/update-core.test.ts`) e o hash da API tem teste de integração (`apps/api/test/downloads.int.test.ts`).

## Reversão
- Para voltar ao "avisar e baixar", remova as chamadas a `installOnQuit`, `autoInstallIfSafe` e `relaunchIntoUpdate` em `electron/main/index.ts`.
- O campo `sha256` da API é aditivo: clientes antigos o ignoram.
