# ADR-0011: Servidor oficial aberto e servidores privados com convite
Status: Accepted (decisão do mantenedor, 2026-10-29). Revisa a parte "Servidores abertos" da ADR-0007.

## Contexto
O mantenedor relatou que outros usuários viam o servidor que ele tinha acabado de criar sem ter sido convidados. Pedido: "Deixe para os usuarios terem acesso somente ao servidor principal que é o OpenCord, inclusive coloque um icone nele e coloque um icone de verificado também". Para o convite ele escolheu um código ou link. Para os servidores já existentes: "Manter como estão".

## Decisão
- A coluna `Server.official` marca o servidor oficial da instância, que é aberto a todos:
  - entrada automática de toda identidade nova (`joinAllServers` só considera os oficiais);
  - aparece no diretório (`GET /servers/directory`);
  - aceita entrada direta (`POST /servers/:id/join`).
  - A migração `20261029230000_official_server_invites` marca como oficial o servidor do bootstrap (auditoria `server.bootstrap`) ou, na falta dele, o mais antigo. `create-owner` e `seed` criam o servidor já como oficial.
- Servidores criados por usuários (inclusive os importados do Discord) nascem **privados**: só com o dono. Quem não é membro recebe 404, sem revelar que o servidor existe.
- Convites (tabela `Invite`):
  - Qualquer membro gera um código com `POST /servers/:id/invites`. É um código por pessoa e servidor, de 10 caracteres de um alfabeto sem letras ambíguas, gerado com `crypto.randomInt` (~57 bits).
  - `GET /invites/:code` devolve uma prévia: nome, imagem e número de membros.
  - `POST /invites/:code` faz a pessoa entrar. É idempotente e conta o uso só uma vez.
  - Códigos fora do formato dão 404 sem consultar o banco. As rotas valem o rate limit global.
  - Ainda não há expiração nem revogação pela interface. O convite some quando o servidor é excluído (cascade).
- No desktop:
  - selo "Servidor oficial verificado" no cabeçalho e no diretório;
  - a marca do OpenCord como ícone do oficial quando ele não tem imagem;
  - "Convidar pessoas" no cabeçalho do servidor e no menu da barra de servidores;
  - "Tenho um convite" em Explorar servidores.
- Os membros atuais dos servidores privados são mantidos (nenhuma remoção automática).

## Consequências
- **Deploy:** a migração precisa rodar em produção (`prisma migrate deploy`). Ela é aditiva (coluna com padrão e tabela nova), então pode rodar antes da API nova. Já a API nova falha nas consultas de servidor até a migração rodar.
- **Reversão:** `DROP TABLE "Invite"; ALTER TABLE "Server" DROP COLUMN "official";` e voltar à versão anterior da API.
- **Pendências:** expiração e revogação de convites, e um link clicável (`opencord://`).
- **Evidência:** `apps/api/test/servers.int.test.ts` (privado fora do diretório e sem entrada direta, fluxo de convite, código inválido) e `discord-import.int.test.ts` (importado nasce privado e o membro entra por convite). Rodaram 96 testes de integração. No desktop: unit `test/invite.test.ts`. O E2E `smoke.spec.ts` foi atualizado, mas **não foi executado** (a pedido do mantenedor, E2E só quando extremamente necessário).
