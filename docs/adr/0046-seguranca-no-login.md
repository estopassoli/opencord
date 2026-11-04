# ADR-0046: Segurança no login: duas etapas, aparelhos conectados e aviso de acesso novo
Status: Accepted (pedido do mantenedor, 2026-11-04; card "segurança na hora de login" do #kanban-de-ideias)

## Contexto
O card pedia "segurança na hora de login". O mantenedor escolheu as três opções propostas:
- verificação em duas etapas;
- lista de aparelhos conectados;
- aviso de login de aparelho novo dentro do app.

Aviso por e-mail ficou de fora: a instância não envia e-mail (sem SMTP).

## Decisão
### Verificação em duas etapas (opcional, só para conta com senha)
- **TOTP** (RFC 6238: HMAC-SHA1, 6 dígitos, 30 s, tolerância de ±1 passo), implementado com `node:crypto`, sem dependência.
  - O segredo fica em `User.totpSecret`, cifrado com AES-256-GCM. A chave é derivada por HKDF do `JWT_ACCESS_SECRET`.
  - `totpLastStep` impede reusar o mesmo código.
  - Migração `20261104010000_two_factor`.
- **Ligar:**
  - `POST /me/2fa/setup {password}` gera o segredo, que fica pendente no Redis por 10 minutos, e a URL `otpauth://`. O app desenha o QR com a lib `qrcode`.
  - `POST /me/2fa/enable {code}` confere o primeiro código e devolve **10 códigos de recuperação**, mostrados uma única vez e guardados só como SHA-256.
- **Desligar e gerar novos códigos:** `POST /me/2fa/disable` e `POST /me/2fa/recovery-codes`. Os dois pedem a senha e um código, do app ou de recuperação.
- **Login:**
  - Se a senha confere e as duas etapas estão ligadas, `POST /auth/login` responde `{ twoFactorRequired, ticket }` em vez da sessão. O bilhete fica no Redis por 5 minutos.
  - `POST /auth/login/2fa {ticket, code}` cria a sessão. Depois de 5 erros, o bilhete é apagado.
  - O bilhete é de uso único, e o código de recuperação é gasto de forma atômica.
- **`Me.twoFactorEnabled`:** mostra o estado em Configurações.

### Aparelhos conectados
- Cada login cria uma família de sessões, que é rotacionada a cada refresh. A lista mostra uma linha por família ativa: aparelho (pelo user agent), IP mascarado, desde quando e último uso.
- **Rotas:** `GET /me/sessions`, `DELETE /me/sessions/:família` e `POST /me/sessions/revoke-others`. Elas reaproveitam a revogação por família que já existia, que desconecta o socket e sai da voz.
- Sem migração.

### Aviso de acesso novo
- **Quando avisa:** no login por senha (com ou sem duas etapas), se o `deviceId` nunca teve sessão dessa conta e a conta já tinha outras sessões.
- **Como:** a conta de avisos do OpenCord (ADR-0045) manda uma DM sem resposta com aparelho, IP mascarado, horário de Brasília e o caminho para encerrar o aparelho.
- **Infra:** o envio de avisos virou um serviço comum, o `SystemNoticesService`, também usado pela recusa de ideias.

## Alternativas descartadas
- **Biblioteca de TOTP:** o algoritmo cabe em poucas linhas e está coberto pelo vetor da RFC.
- **Segredo TOTP em texto puro:** quem tivesse um vazamento do banco conseguiria gerar códigos.
- **Chave própria para o TOTP (env nova):** mais um segredo para configurar. Derivar do `JWT_ACCESS_SECRET` basta, com o efeito colateral descrito abaixo.
- **E-mail de aviso:** exige um serviço de envio. Pode entrar depois.

## Consequências
- Trocar o `JWT_ACCESS_SECRET` invalida os segredos TOTP. Quem tem as duas etapas ligadas passa a entrar com um código de recuperação e precisa religar.
- Um cliente antigo que recebe `twoFactorRequired` não sabe seguir e mostra erro. Só afeta quem ligou as duas etapas.
- **Deploy:** a migração é aditiva e roda antes da API nova (Rick).
- **Reversão:** remover as rotas e apagar as colunas (SQL na migração). Quem tinha as duas etapas volta a entrar só com a senha.
