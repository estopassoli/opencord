# ADR-0047: E-mail da conta e verificação em duas etapas por e-mail
Status: Accepted (pedido do mantenedor, 2026-11-04)

## Contexto
Depois da ADR-0046 (TOTP), o mantenedor pediu "coloca 2fa com o email". Ele escolheu:
- a pessoa decide entre app autenticador e código por e-mail;
- o envio pelo **Resend** (`RESEND_API_KEY`, `RESEND_FROM`).

Antes disso, a instância não enviava e-mail nenhum, e o e-mail da conta nunca era confirmado.

## Decisão
- **Envio:** o `MailService` usa a API HTTPS do Resend quando há `RESEND_API_KEY`. Senão, usa SMTP quando há `SMTP_HOST`, para quem faz self-hosting com o próprio provedor. Sem nenhum dos dois, `InstanceInfo.email = false` e o app esconde as opções.
  - Os e-mails têm texto puro + HTML simples, sem imagens.
  - Falha no envio vira 503. O limite de envio é liberado e o código não enviado deixa de valer.
- **E-mail da conta:** `PUT /me/email {email, password}` define ou troca o e-mail (fica sem confirmar e a troca zera a confirmação).
  - `POST /me/email/verify/send` e `POST /me/email/verify {code}` confirmam o e-mail com um código de 6 dígitos.
  - **Colunas novas:** `User.emailVerifiedAt` e `User.twoFactorEmailAt` (migração `20261104020000_email_2fa`).
- **Códigos por e-mail:** 6 dígitos, guardados no Redis só como hash.
  - Valem 10 minutos.
  - 5 tentativas, uso único.
  - Um envio por minuto.
  - O código de confirmar e-mail e o da segunda etapa são separados.
- **Segunda etapa por e-mail:** `POST /me/2fa/email/enable {password}` exige e-mail confirmado. Só um método fica ligado por vez (app **ou** e-mail).
  - Os 10 códigos de recuperação e a rota `disable` são os mesmos da ADR-0046. Para desligar ou gerar códigos novos, `POST /me/2fa/email/send` manda o código.
  - Com o código por e-mail ligado, não dá para trocar o e-mail: isso tiraria da pessoa o acesso ao código.
- **Login:** o desafio passa a dizer o método (`method`, `emailHint` mascarado).
  - Com e-mail, o código já sai no login (o bilhete vale 10 min), e `POST /auth/login/2fa/resend` manda outro.
  - Uma falha no envio não trava: dá para reenviar ou usar um código de recuperação.
- **Aviso de acesso novo (ADR-0046):** também vai por e-mail para quem tem o e-mail confirmado.
- **`Me` ganha:** `twoFactorMethod` e `emailVerified`.

## Alternativas descartadas
- **Só SMTP:** o mantenedor usa o Resend. O SMTP ficou como alternativa para outras instâncias.
- **E-mail e app ligados juntos:** mais opções de entrada e mais superfície de ataque. Um método por vez, com os códigos de recuperação como reserva, é mais simples de explicar.
- **Link mágico no lugar de código:** depende do navegador em que o e-mail é aberto, o que é ruim no app desktop.

## Consequências
- **Privacidade:** o Resend recebe o e-mail e o texto das mensagens que entrega. A Política de privacidade cita o Resend.
- **Deploy:**
  - Migração aditiva antes da API nova (Rick).
  - `RESEND_API_KEY` e `RESEND_FROM` na API, com o domínio do remetente validado no Resend.
- **Reversão:** remover as rotas e as duas colunas. Quem usava código por e-mail volta a entrar só com a senha.
