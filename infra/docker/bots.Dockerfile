# Bots públicos oficiais (ADR-0037): um container roda YOU6, Dínamo, Carlos, Dank Mineiro, Tíquete e Oráculo.
# Build a partir da raiz do repositório:
#   docker build -f infra/docker/bots.Dockerfile -t opencord-bots .
# Ambiente: OPENCORD_URL (API), OFFICIAL_BOTS_SECRET (mesmo valor da API) ou BOT_TOKEN_<KEY>, ANTHROPIC_API_KEY (Oráculo),
# DATA_DIR=/data (volume com o SQLite dos bots).
FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN npm install -g pnpm@12.4.1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/bot-sdk/package.json packages/bot-sdk/
COPY apps/bots/package.json apps/bots/
RUN pnpm install --frozen-lockfile --filter @opencord/bots...
COPY packages/contracts packages/contracts
COPY packages/bot-sdk packages/bot-sdk
COPY apps/bots apps/bots
RUN pnpm turbo run build --filter @opencord/bots
RUN pnpm --filter @opencord/bots deploy --prod --legacy /out

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY --from=build /out /app
VOLUME ["/data"]
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]
