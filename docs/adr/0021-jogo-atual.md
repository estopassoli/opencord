# ADR-0021: Jogo que estou jogando (presença de jogo)
Status: Accepted (pedido do mantenedor, 2026-10-31)

## Contexto
O mantenedor pediu: "quero implementar uma feat pra identificar o jogo que estou jogando". Quem está jogando aparece com o nome do jogo no painel do usuário, na lista da voz, na lista de membros e no cartão de perfil ("Jogando agora", tempo de jogo e atalho para a Steam).

O OpenCord não pode usar a lista de jogos do Discord: é conteúdo dele (`CLAUDE.md`).

## Decisão
- **Detecção no app desktop**, no processo principal (`electron/main/games.ts`, parte pura em `electron/shared/games-core.ts`). Só roda no Windows.
  - A cada 15 s roda `reg query` e `tasklist /fo csv /nh`, com `execFile`, sem shell e sem módulo nativo.
  - **Steam primeiro.** O cliente da Steam escreve `HKCU\Software\Valve\Steam\RunningAppID`, e o nome do jogo fica em `...\Apps\<id>\Name`. Assim todo jogo da Steam vem com o nome oficial e o id da loja, sem lista.
  - **Depois, os jogos cadastrados pela pessoa** (executável → nome, em Configurações → Jogos). A pessoa escolhe entre os programas abertos.
  - **Por fim, uma lista própria** de executáveis conhecidos fora da Steam (`KNOWN_GAMES`), montada pelo OpenCord a partir dos nomes públicos dos executáveis.
  - O tempo de jogo conta a partir de quando o jogo foi visto pela primeira vez, e não reinicia enquanto for o mesmo jogo.
- **Envio:** comando Socket.IO `presence:game` com `{ game: { name, startedAt, steamAppId? } | null }`.
  - Vai ao mudar o jogo, ao mudar a opção e ao (re)conectar.
  - É reenviado a cada 10 min enquanto o jogo segue aberto.
- **Servidor:** guarda `presence:game:<userId>` no Redis com TTL de 30 min. Se o app sumir sem avisar, o jogo expira.
  - O aviso `presence:game:changed` vai para os mesmos destinos de `presence:changed`: servidores, amigos e as outras sessões da pessoa.
  - Invisível ou offline esconde o jogo; voltar a aparecer mostra de novo. Fechar o app (nenhum socket) apaga.
  - `GET /servers/:id/games` traz os jogos dos membros, e `GET /friends` passa a trazer `game` em cada amigo.
- **Privacidade:** "Mostrar o jogo que estou jogando" vem ligado. Desligado, os outros não recebem nada, mas a detecção continua só no computador da pessoa, para os clipes. Só o nome do jogo e o início saem do computador; nunca a lista de programas.
- **Ícone do jogo:** ao detectar, o processo principal acha o executável em execução (Steam: pasta `steamapps\common\<installdir>` das bibliotecas do `libraryfolders.vdf`; fora dela: o processo pelo nome, via `Get-Process`) e lê o ícone com `app.getFileIcon` (PNG 32×32). Ele vai na presença como data URL (só `data:image/png;base64`, até 16 KB, validado no contrato).
- A capa de jogo da Steam vem do CDN da Steam (`cdn.cloudflare.steamstatic.com`). Sem capa, aparece um ícone de controle.

## Consequências
- **Evidência:**
  - unidade `games-core.test.ts`: registro, `tasklist`, a ordem Steam → cadastrado → lista, e o tempo que não reinicia;
  - integração `realtime.int.test.ts`: os outros recebem e listam; invisível esconde e voltar mostra; fechar o app apaga; nome vazio é recusado.
- **Limitações:**
  - Jogos fora da Steam e fora da lista só aparecem depois de cadastrados.
  - Ferramentas abertas pela Steam (por exemplo Wallpaper Engine) também aparecem como "jogo".
  - Sem macOS ou Linux por enquanto.
- **Compatibilidade:** o app novo com a API antiga segue sem jogos (a rota falha e é ignorada). O app antigo ignora o evento novo.
