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
