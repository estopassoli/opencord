# ADR-0004 — Versões da toolchain (majors estáveis)
Status: Accepted · Data: 2026-10-29

## Contexto
Na data, os majors mais novos eram TypeScript 7 (compilador nativo), NestJS 12, Prisma 7, Vite 8, Vitest 5 e ESLint 10, todos com poucas semanas de vida e mudanças de API relevantes (ex.: Prisma 7 exige driver adapters; TS 7 muda o suporte a `emitDecoratorMetadata`, do qual o DI do NestJS depende).

## Decisão
Usar o último patch de majors estáveis e mantidos: TypeScript 6.0.3, NestJS 11.2.7 (Fastify 5), Prisma 6.19.3, Vite 7.3.7, Vitest 3.2.7, ESLint 9.39.5, React 19.1.10, Electron 44.7.1, livekit-client 2.22.4, livekit-server-sdk 2.19.1, Zod 4.6.7, pnpm 12, Turborepo 2.11. Política geral: versões fixadas (sem `^`) e com ao menos ~2 semanas de publicação.

## Consequências
- Upgrade para os majors novos é trabalho planejado (Prisma 7: adapter `pg`; TS 7: validar decorators do NestJS ou trocar o DI para tokens explícitos).
- API e pacotes compartilhados em ESM (Node 24); testes da API com SWC (`unplugin-swc`) para emitir metadata de decorators.
