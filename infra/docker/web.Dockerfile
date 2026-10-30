# Web estático — landing (site/) e interface no navegador (renderer do desktop), num nginx só.
# Build a partir da raiz do repositório:
#   docker build -f infra/docker/web.Dockerfile --build-arg VITE_OPENCORD_SERVER_URL=https://api.exemplo.com -t opencord-web .
# O nginx escolhe pelo Host: APP_HOST serve a interface; qualquer outro host, a landing (ver nginx-web.conf).
FROM node:24-bookworm-slim AS build
WORKDIR /repo
# corepack não encontra o pnpm 12; instala a versão exata do packageManager
RUN npm install -g pnpm@12.4.1
# Só o renderer é buildado aqui: o binário do Electron (devDependency) não é necessário.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/media/package.json packages/media/
COPY packages/ui/package.json packages/ui/
COPY apps/desktop/package.json apps/desktop/
RUN pnpm install --frozen-lockfile --filter @opencord/desktop...
COPY packages/contracts packages/contracts
COPY packages/media packages/media
COPY packages/ui packages/ui
COPY apps/desktop apps/desktop
ARG VITE_OPENCORD_SERVER_URL
ENV VITE_OPENCORD_SERVER_URL=${VITE_OPENCORD_SERVER_URL}
RUN pnpm turbo run build --filter "@opencord/desktop^..." && pnpm --filter @opencord/desktop build:renderer

FROM nginx:1.29-alpine
COPY infra/docker/nginx-web.conf /etc/nginx/templates/default.conf.template
COPY site /usr/share/nginx/site
COPY --from=build /repo/apps/desktop/dist /usr/share/nginx/app
ENV APP_HOST=app.opencord.pro
# API pública: o link de convite (/invite/<código>) redireciona para a página de cartão dela
ENV PUBLIC_API_URL=https://api.opencord.pro
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
