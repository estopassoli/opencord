# API OpenCord — imagem de produção (multi-stage). Build a partir da raiz do repositório:
#   docker build -f infra/docker/api.Dockerfile -t opencord-api .
FROM node:24-bookworm-slim AS build
WORKDIR /repo
# corepack não encontra o pnpm 12; instala a versão exata do packageManager.
# openssl: o prisma generate escolhe o engine pela versão do openssl (sem ele, gera o de 1.1 e o runtime tem 3.x).
RUN npm install -g pnpm@12.4.1 && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @opencord/api... --filter @opencord/db...
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm turbo run build --filter @opencord/api...
RUN pnpm --filter @opencord/api deploy --prod --legacy /out
# O pnpm deploy reinstala os pacotes e perde o client gerado no build do @opencord/db: copia o .prisma gerado
# para o mesmo @prisma/client dentro de /out (gerar de novo no runtime não resolve o @prisma/client do pnpm).
RUN cp -r node_modules/.pnpm/@prisma+client@*/node_modules/.prisma /out/node_modules/.pnpm/@prisma+client@*/node_modules/

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# CLI do Prisma (só para `migrate deploy`) na MESMA versão do @prisma/client; `npx prisma` puxaria a última.
RUN npm install -g prisma@6.19.3
COPY --from=build /out /app
COPY --from=build /repo/packages/db/prisma /app/prisma
COPY infra/docker/api-entrypoint.sh /usr/local/bin/api-entrypoint
# Pastas de upload do usuário `node`: volume novo herda esse dono. Volume antigo criado como root é corrigido
# pelo entrypoint, que sobe como root só para o chown e então roda a API como `node` (setpriv).
RUN chmod 755 /usr/local/bin/api-entrypoint && mkdir -p /data/uploads /app/var/uploads && chown -R node:node /data /app/var
ENTRYPOINT ["/usr/local/bin/api-entrypoint"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Migrações NÃO rodam na subida (regra do projeto): aplicar como passo do deploy com
#   prisma migrate deploy --schema /app/prisma/schema.prisma
CMD ["node", "--enable-source-maps", "dist/main.js"]
