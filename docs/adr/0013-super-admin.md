# ADR-0013: Super admin da instância e selo de verificado
Status: Accepted (pedidos do mantenedor, 2026-10-30)

## Contexto
- Depois da ADR-0011 (servidores privados), o mantenedor perguntou: "eu como admin consigo ter acesso a todos os servidores criados né?". Não tinha, e ele pediu: "pode fazer esse cadastro de super admin".
- Depois pediu o selo de verificado no servidor "rinha de galo": "Só o selo, continua privado".

## Decisão
**Super admin**
- A coluna `User.isInstanceAdmin` marca o super admin. A migração `20261030030000_instance_admin` marca o dono do servidor oficial. Para promover outra pessoa: `UPDATE "User" SET "isInstanceAdmin" = true WHERE username = '<apelido>';`.
- `GET /admin/servers` lista todos os servidores, com dono, membros e selo. Quem não é admin recebe 404.
- `POST /admin/servers/:id/join`: o admin entra como **membro**. A entrada fica na auditoria (`member.join`, `via: instance-admin`) e aparece para todos. Antes de entrar, o servidor dá 404 também para o admin: não há acesso escondido.
- Já como membro, o admin tem permissões e hierarquia de dono (`ctx.ownerId = admin` em `PermissionsService.server`). Excluir e transferir continuam exclusivos do dono real.

**Selo de verificado**
- A coluna `Server.verified`, migração `20261030031000_server_verified`, só exibe o selo. Não muda privacidade, diretório nem entrada automática (essas continuam com `official`).
- O super admin marca e desmarca com `PUT /admin/servers/:id/verified`. A ação fica na auditoria (`server.verified`) e os membros recebem o selo na hora (`server:updated`).
- No app, o selo aparece se o servidor for `official || verified`. A marca do OpenCord como ícone continua só no oficial.

## Consequências
- Quem cria um servidor privado deve saber que o super admin pode entrar. A entrada é sempre visível e auditada.
- **Deploy:** as duas migrações são aditivas e precisam rodar antes ou logo depois da API nova, porque a API passa a ler as colunas.
- **Reversão:** `ALTER TABLE "User" DROP COLUMN "isInstanceAdmin"; ALTER TABLE "Server" DROP COLUMN "verified";` e voltar a imagem anterior.
- **Evidência:** `servers.int.test.ts`. Cobre:
  - 404 para quem não é admin;
  - o admin não acessa antes de entrar, e a entrada fica auditada;
  - o admin cria canal, mas não exclui o servidor (403);
  - o selo marcado mantém o servidor privado e fora do diretório.

## Adendo (2026-11-02): ninguém expulsa o super admin
Pedido do mantenedor: "ninguém consiga me expulsar de um servidor, eu sendo super admin".
- `PermissionsService.memberTop` (antes `targetTop`, privado em `ServersService`) devolve posição infinita para o dono **e** para quem tem `isInstanceAdmin`. Expulsar, mudar cargos, silenciar no servidor, desconectar e mover na voz passam por `assertAbove` contra essa posição, então ninguém (nem o dono real, nem outro super admin) consegue agir sobre o super admin. Ele ainda sai sozinho por `POST /servers/:id/leave`.
- Efeito colateral deliberado: a moderação de voz (`serverMute`, `disconnectMember`, `moveMember`) passou a conferir hierarquia contra o alvo, como expulsar já fazia. Antes, qualquer pessoa com MUTE_MEMBERS/MOVE_MEMBERS silenciava ou derrubava o dono.
- `UserPublic.isInstanceAdmin` (só presente quando verdadeiro) deixa o app esconder os botões e marcar "super admin" na lista de membros. Não é segredo: a entrada do admin já é visível e auditada.
- Fora do alcance: excluir o servidor (dono real) continua removendo todo mundo, inclusive o admin; suspender o super admin no painel já era bloqueado (ADR-0020).
- **Evidência:** `servers.int.test.ts` (dono recebe 403 ao expulsar e ao mudar cargos do admin; `isInstanceAdmin` na lista); `voice.int.test.ts` 16/16 continua verde.

## Adendo (2026-11-02): selo de verificado em perfis
Pedido do mantenedor: "quero poder atribuir o selo verificado para outros perfis".
- Coluna `User.verified` (migração `20261102000000_user_verified`, aditiva). `PUT /admin/users/:id/verified`
  `{ verified }` no painel do super admin (menu da pessoa: "Dar selo de verificado"); auditado como
  `admin.user.verified`. As mesmas regras de `target()` valem: não na própria conta nem no criador (que já tem o selo).
- `UserPublic.verified` só vem quando é verdade. Quem compartilha servidor com a pessoa recebe `user:updated` na hora.
- No app o selo aparece na lista de membros ("verificado", mesmo estilo de "criador"), na lista de voz, ao lado do
  nome nas mensagens e no painel de perfil. É só exibição: não dá permissão nenhuma.
- **Reversão:** `ALTER TABLE "User" DROP COLUMN "verified";` e voltar a imagem anterior.
- **Evidência:** `admin.int.test.ts` (marca/desmarca, 404 para quem não é admin, perfil público e auditoria).

## Adendo (2026-11-02): modo invisível
Pedido do mantenedor: ficar nos servidores "de forma invisível" para moderar o que é postado, depois de ter sido
expulso de alguns (antes do adendo que tornou o super admin intocável).
- `ServerMember.hidden` (migração `20261102020000_member_hidden`, aditiva), só para quem é `isInstanceAdmin`:
  `POST /admin/servers/:id/join { hidden: true }` e `PUT /admin/servers/:id/hidden { hidden }`.
- Invisível: não aparece em `GET /servers/:id` (exceto para si, com `hidden: true`), nem nas contagens de membros
  (diretório, painel, prévia de convite), nem em `GET /servers/:id/presence`/status; a presença dele não é enviada à
  sala do servidor; "digitando" não é anunciado; `server:member:joined/updated/left` não são emitidos; servidores em
  que está invisível não contam como "em comum" no perfil. Ao ficar invisível os membros recebem `server:member:left`
  e `presence:changed offline`; ao ficar visível, `server:member:joined` + presença, com `member.join` na auditoria
  do servidor (como a entrada visível de sempre).
- Em voz não entra enquanto invisível (403 "fique visível no servidor para entrar em voz"): a chamada mostraria a
  pessoa. Mensagens que ele enviar são visíveis normalmente (é o esperado ao moderar).
- Registro: entrada/saída/alternância invisíveis ficam na **auditoria global** (`admin.server.join_hidden`,
  `admin.server.hide`, `admin.server.leave_hidden`), visível só no painel do super admin — a ADR original dizia "não
  há acesso escondido" dos membros; isso deixa de valer para o modo invisível, por decisão do mantenedor.
- **Reversão:** `ALTER TABLE "ServerMember" DROP COLUMN "hidden";` e voltar a imagem anterior.
- **Evidência:** `servers.int.test.ts` (entrada invisível: lista/contagem/presença sem o admin, visão própria com
  `hidden`, alternância visível/invisível com eventos).

