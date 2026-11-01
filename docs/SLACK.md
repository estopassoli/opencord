# Ponte com o Slack

Um canal de texto do OpenCord e um canal do Slack com as mesmas mensagens, nos dois sentidos, com o nome de quem
escreveu (ADR-0033). Um app do Slack por instância; quem gerencia cada servidor escolhe quais canais ligar.

## 1. Criar o app no Slack (quem administra a instância)
1. Em https://api.slack.com/apps → **Create New App** → *From scratch*, no workspace da turma.
2. **OAuth & Permissions** → *Bot Token Scopes*: `chat:write`, `chat:write.customize`, `channels:read`,
   `channels:history`, `channels:join`, `users:read`. Instale o app no workspace e copie o **Bot User OAuth Token**
   (`xoxb-…`).
3. **Basic Information** → copie o **Signing Secret**.
4. Na API do OpenCord (`.env`):
   ```
   SLACK_BOT_TOKEN=xoxb-…
   SLACK_SIGNING_SECRET=…
   ```
   e reinicie a API.
5. **Event Subscriptions** → ligue, *Request URL* = `https://<sua API>/integrations/slack/events` (o Slack manda um
   desafio; a API responde na hora). Em *Subscribe to bot events* adicione `message.channels`. Salve.

Sem as duas variáveis, a aba Slack do servidor só mostra este passo a passo.

## 2. Ligar canais (quem gerencia o servidor)
Configurações do servidor → **Slack** → escolha o canal daqui e o canal do Slack → **Ligar**. A API tenta entrar no
canal do Slack sozinha; se for privado, convide o app por lá (`/invite @NomeDoApp`). Para parar, **Desligar**.

## O que passa
- OpenCord → Slack: texto, menções como `@nome`, anexos como links. Posta com o nome de quem escreveu.
- Slack → OpenCord: texto e links de arquivos. Cada pessoa do Slack aparece como um usuário com selo **APP** e o
  nome do perfil dela no Slack.
- Não passa (por enquanto): edições, exclusões, reações, threads, mensagens de outros bots.

## Segurança
- Só o app da instância fala com o Slack; nenhum token do Slack fica no banco.
- A entrada confere a assinatura do Slack sobre o corpo exato da requisição, com janela de 5 minutos, e ignora
  reenvios do mesmo evento.
- O endpoint de eventos tem limite por IP.
