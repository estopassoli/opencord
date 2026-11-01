# @opencord/bot

SDK para criar bots do OpenCord em Node 20+. A forma de uso (`Client`, `Events`, `SlashCommandBuilder`,
`interaction.reply`…) é a que a comunidade de bots de chat já conhece, implementada do zero sobre a API REST e o
gateway Socket.IO do OpenCord. Guia completo (criar o bot no app, comandos, referência da API, portabilidade):
[`docs/BOTS.md`](../../docs/BOTS.md).

## Instalar (por enquanto, a partir do repositório)

```sh
git clone https://github.com/estopassoli/opencord && cd opencord
pnpm install
pnpm --filter @opencord/bot build        # gera packages/bot-sdk/dist
```

No seu projeto:

```sh
pnpm add file:../opencord/packages/bot-sdk      # ou: pnpm link ../opencord/packages/bot-sdk
```

## Usar

```sh
export OPENCORD_URL=https://api.seu-opencord.dev   # URL da API da instância
export OPENCORD_TOKEN=ocb_...                      # token do bot (Configurações → Aplicativos → Novo bot)
node bot.mjs
```

```js
import { Client, Events } from '@opencord/bot';

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
pnpm --filter @opencord/bot typecheck
pnpm --filter @opencord/bot lint
pnpm --filter @opencord/bot test
```
