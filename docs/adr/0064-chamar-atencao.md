# ADR-0064 — "Chamar atenção"

- **Status:** aceito (2026-11-13)
- **Pedido do mantenedor:** botão direito numa pessoa → "Chamar atenção", para quem está mutado ou sem áudio na
  chamada; treme o app dela e toca um som, como nos mensageiros antigos.

## Decisão

- **Envio:** `POST /users/:userId/nudge` (204). Nada vai para o banco: o servidor manda o evento em tempo real
  `user:nudge` `{ fromUserId, fromName }` só para a pessoa (`rooms.user`).
- **Quem pode chamar quem:** alguém com quem eu divido um servidor (membro visível) ou de quem sou amigo, sem
  bloqueio de nenhum lado. Inexistente, desativado, bot, bloqueado ou sem nada em comum respondem o mesmo 404 (não
  revela quem bloqueou). Chamar a si mesmo: 403.
- **Opção de quem recebe:** Configurações → Notificações → "Chamar atenção" (`notifications.nudges`, padrão ligado,
  dentro do JSON das configurações: sem migração). Desligado: 403 com o motivo para quem chamou.
- **Offline:** 409 ("não está conectado agora"), em vez de um evento perdido.
- **Limites contra spam (Redis):** a mesma pessoa a cada 15 s (`NUDGE_COOLDOWN_MS`, 429 com `retryAfterSec`) e 10
  chamadas por minuto no total por quem chama. O app de quem recebe ainda junta chamadas de pessoas diferentes em uma a
  cada 2,5 s.
- **No app de quem recebe** (`lib/nudge.ts`):
  - a interface treme por ~0,6 s (CSS em `#root`);
  - no app desktop a janela também treme (`bridge.shakeWindow`; Electron por `setPosition` no processo principal,
    Tauri por `setPosition` com a permissão `core:window:allow-set-position`), só com a janela à mostra e solta
    (maximizada, em tela cheia ou minimizada não sai do lugar);
  - toca um aviso próprio sintetizado (`NUDGE_NOTES`, trinado curto e dois toques; nenhum som de terceiros), no volume
    dos efeitos, mesmo com "Efeitos sonoros" desligado (é um pedido explícito de atenção e tem chave própria);
  - mostra "<nome> está chamando sua atenção!" e, com o app em segundo plano, notificação do sistema e piscar na barra
    de tarefas.
- **Exceções de quem recebe:** Não perturbe → só o aviso na tela, sem tremer nem tocar; reduzir animações (do app ou
  do sistema) → não treme; modo streamer escondendo sons → não toca.
- **Menu:** "Chamar atenção" (sino) para qualquer pessoa que não seja eu, bot ou a conta de avisos; mostra "Mutado" ou
  "Sem áudio" quando a pessoa está assim na voz.

## Alternativas

- Só dentro da mesma chamada: o pedido é justamente alcançar quem não está ouvindo; amigos e quem divide um servidor
  cobrem o caso sem abrir para desconhecidos.
- Mensagem de sistema na DM: deixaria rastro e notificação dupla; o evento efêmero basta.

## Evidência

- `apps/api/test/nudge.int.test.ts` (evento chega com nome, intervalo de 15 s por par, 403/404/409, bloqueio,
  opção desligada) e `apps/desktop/test/nudge.test.ts` (tremor, som, Não perturbe, reduzir animações, modo streamer,
  junção de chamadas).
- Duas pessoas no app local (Chromium, áudio mudo): menu → "Chamar atenção" → o outro app tremeu, tocou `nudge` e
  mostrou o aviso; repetir na hora mostrou "Espere 11 s…".
- **Não verificado:** o tremor da janela nativa no Windows (Tauri) e no Electron.
