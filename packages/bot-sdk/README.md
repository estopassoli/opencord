# @opencord-chat/bot

SDK para criar bots do OpenCord em Node 20+. A forma de uso (`Client`, `Events`, `SlashCommandBuilder`,
`interaction.reply`…) é a que a comunidade de bots de chat já conhece, implementada do zero sobre a API REST e o
gateway Socket.IO do OpenCord. Guia completo (criar o bot no app, comandos, referência da API, portabilidade):
[`docs/BOTS.md`](https://github.com/estopassoli/opencord/blob/main/docs/BOTS.md).

Licença MIT (o restante do OpenCord é AGPL-3.0): seu bot não herda nenhuma obrigação de licença por usar o SDK.

## Instalar

```sh
pnpm add @opencord-chat/bot      # ou npm i @opencord-chat/bot
```

Para usar a versão do repositório antes de uma publicação: `pnpm --filter @opencord-chat/bot build` dentro do
monorepo e, no seu projeto, `pnpm add file:../opencord/packages/bot-sdk`.

## Usar

```sh
export OPENCORD_URL=https://api.seu-opencord.dev   # URL da API da instância
export OPENCORD_TOKEN=ocb_...                      # token do bot (Configurações → Aplicativos → Novo bot)
node bot.mjs
```

```js
import { Client, Events } from '@opencord-chat/bot';

const client = new Client();
client.once(Events.ClientReady, (c) => console.log(`online como ${c.user.tag}`));
client.on(Events.MessageCreate, async (m) => {
  if (m.author.bot) return;
  if (m.content === '!ping') await m.reply('pong');
});
await client.login();
```

Exemplo completo com comando de barra: [`examples/ping.mjs`](./examples/ping.mjs).

## Desenvolver o SDK

```sh
pnpm --filter @opencord-chat/bot typecheck
pnpm --filter @opencord-chat/bot lint
pnpm --filter @opencord-chat/bot test
pnpm --filter @opencord-chat/bot build   # tsc + scripts/bundle-types.mjs (embute as declarações do contracts)
```

## Publicar

A publicação é automática pelo workflow `publish-sdk.yml` quando uma tag `bot-sdk-vX.Y.Z` é criada e bate com a
versão do `package.json`. Usa o "trusted publishing" do npm (OIDC, sem token no repositório), que precisa ser
configurado uma vez na página do pacote no npm (Settings → Trusted publisher → GitHub Actions,
`estopassoli/opencord`, workflow `publish-sdk.yml`).

```sh
# subir a versão em packages/bot-sdk/package.json, commitar e:
git tag bot-sdk-v0.1.0 && git push origin bot-sdk-v0.1.0
```
