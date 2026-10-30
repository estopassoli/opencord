# ADR-0020: Painel do super admin

Status: Accepted (pedido do mantenedor, 2026-10-30)

## Contexto
- A ADR-0013 criou o super admin (`User.isInstanceAdmin`), mas ele só tinha uma lista de servidores dentro de "Explorar servidores".
- Promover alguém exigia SQL direto no banco.
- O mantenedor pediu: "Crie um setor admin para mim com configurações de administrador". Escolheu os quatro blocos: visão geral com servidores, usuários, configuração da instância e auditoria global.

## Decisão
**Interface**
- O painel é um modal de tela cheia com abas, igual às configurações.
- Abre por um escudo no rail, que só aparece para super admins.
- A lista de servidores saiu de "Explorar servidores" e virou a aba Servidores, agora com busca.

**API**
- Todas as rotas `/admin/*` dão 404 para quem não é super admin.
- `GET /admin/stats`: usuários (e novos em 7 dias), online agora, em chamada, servidores, mensagens em 24 h, super admins e contas suspensas.
- `GET /admin/users?q=&filter=all|admins|suspended&cursor=`: 50 por página, mais novos primeiro (id uuid v7).
- `POST /admin/users/:id/suspend` com `{reason?}`:
  - marca `User.disabledAt` (a coluna já existia e já era checada no login, no refresh e em cada requisição);
  - revoga todas as sessões, tira a pessoa da chamada e derruba os sockets (`session:revoked`).
- `POST /admin/users/:id/unsuspend` reativa a conta.
- `POST /admin/users/:id/logout` encerra as sessões sem suspender.
- `PUT /admin/users/:id/admin` com `{admin}` promove ou rebaixa e ressincroniza as permissões dos servidores da pessoa.

**Regras de proteção**
- Ninguém age sobre a própria conta nem sobre o criador (o dono do servidor oficial).
- Um super admin não pode ser suspenso sem antes perder o admin.
- Conta suspensa não pode ser promovida.

**Instância**
- `GET/PATCH /admin/instance` lê e grava a tabela `InstanceConfig`, que tem uma linha só (`id = 1`, com CHECK).
- `registrationOpen = false` faz `register` e `guest` darem 403. Quem já tem conta continua entrando.
- `announcement {text, tone}` aparece numa faixa no topo do app de todos. Cada pessoa pode dispensar até o texto mudar.
- `uploadMaxBytes` só reduz o `UPLOAD_MAX_BYTES` do ambiente; acima dele dá 400.
- `GET /auth/instance` passa a trazer `registrationOpen`, `announcement` e `uploadMaxBytes`.
- Ao salvar, o evento `instance:updated` vai para todos os sockets. A API guarda a configuração em memória por 5 s e invalida ao salvar.

**Auditoria**
- Ações novas, com `serverId = null`: `admin.user.suspend|unsuspend|logout|promote|demote` e `admin.instance.update`.
- `GET /admin/audit?scope=admin|all&before=`:
  - `admin` filtra as ações `admin.*`, `server.verified` e `member.join` com `via: instance-admin`;
  - `all` mostra a auditoria de todos os servidores;
  - o novo índice `AuditLog(createdAt)` sustenta a listagem global.

## Consequências
- O motivo da suspensão fica só na auditoria; não há coluna para ele.
- "Online agora" conta os sockets deste processo da API. Com mais de uma réplica, seria preciso o adapter do Socket.IO.
- **Deploy:** a migração `20261030220000_instance_config` é aditiva. Se a API nova subir antes dela, `InstanceService` registra um aviso e segue com os padrões, sem derrubar login nem upload.
- **Reversão:** `DROP TABLE "InstanceConfig"; DROP INDEX "AuditLog_createdAt_idx";` e voltar a imagem anterior.
- **Evidência:** `apps/api/test/admin.int.test.ts` (7 testes). Cobre:
  - 404 para quem não é admin;
  - números, busca e filtros;
  - suspensão (401 nas sessões, login recusado, reativação);
  - proteções (própria conta, criador, admin antes de suspender);
  - encerrar sessões;
  - cadastro fechado, aviso e limite de upload;
  - os filtros da auditoria.
