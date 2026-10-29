# ADR-0007 — Conta opcional, entrada por apelido e servidores abertos
Status: Accepted (decisão do mantenedor, 2026-10-29) · Substitui o P01 do PRD e o fluxo de convites · **Servidores abertos revisado pela ADR-0011** (só o servidor oficial é aberto; os demais usam convite)

## Contexto
Pedidos do mantenedor:
1. "não quero que precise de conta pra entrar, apenas que escolha um nick e entre";
2. "não deveria precisar colocar o endereço do servidor, apenas o nome";
3. "criar conta é opcional, o usuário pode logar apenas com o apelido. Os servidores são para ser abertos a todos, sem a necessidade de aceitar um convite".

## Decisão
**Entrada**
- Tela padrão com **apenas o apelido**. O endereço do servidor vem do build do desktop (`VITE_OPENCORD_SERVER_URL`) ou do último servidor usado.
- Só apelido (`POST /auth/guest`): identidade sem senha, presa ao dispositivo pela sessão (refresh rotativo, cifrado com DPAPI via safeStorage).
- **Conta opcional** (`POST /auth/register`: apelido + senha, e-mail opcional): permite entrar de qualquer computador (`POST /auth/login` com apelido **ou** e-mail).
- Quem entrou só com apelido pode **criar conta depois** (`POST /auth/claim`), mantendo o mesmo usuário, servidores e histórico.
- Apelido único sem diferenciar maiúsculas, acentos ou espaços (`nickKey`). Usar o apelido de uma conta sem senha é recusado com a orientação "entre com a senha".

**Servidores abertos**
- Não existem convites. Toda nova identidade entra em todos os servidores, e todo servidor novo inclui todos os usuários.
- `GET /servers/directory` lista os servidores e `POST /servers/:id/join` entra sem convite (por exemplo, depois de ter saído ou sido expulso).
- Moderação continua valendo: cargos, overrides por canal, kick (a pessoa pode voltar pelo diretório; para impedir de vez, o caminho futuro é bloqueio/ban, ainda não implementado).
- Migrações: `20261029080000_open_servers_no_invites` (remove a tabela Invite e torna todos membros) e `20261029090000_drop_invite_permission_bit` (bit 17 reservado).

**Proteções configuráveis da instância**
`GUEST_JOIN_ENABLED` (padrão true), `INSTANCE_ACCESS_CODE` opcional (exigido para entrar por apelido ou criar conta; comparação em tempo constante) e `GUEST_JOIN_PER_IP_HOUR` (padrão 10 novas identidades por IP/hora), além do rate limit das rotas de auth.

## Consequências e riscos
- **Instância aberta por padrão:** qualquer pessoa que alcance o servidor entra em todos os servidores. Em servidor exposto na internet, recomenda-se `INSTANCE_ACCESS_CODE`.
- Sem conta, perder o dispositivo = perder o apelido. Mitigação: criar conta (opcional), a qualquer momento.
- Kick não impede a volta (não há ban). Registrado como pendência.
- Evidência: `apps/api/test/guest.int.test.ts`, `auth.int.test.ts` e `servers.int.test.ts` (diretório e join); E2E `smoke.spec.ts` (só apelido, links de conta opcionais, explorar sem convite).
