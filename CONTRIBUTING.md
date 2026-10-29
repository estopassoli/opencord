# Contribuindo

1. Leia `CLAUDE.md`, `docs/SDD.md` e `docs/IMPLEMENTATION_PLAN.md`.
2. `pnpm install`; Node 24 e pnpm 12.
3. Antes de abrir PR: `pnpm format:check && pnpm turbo run build typecheck lint test` e, se tocar a API, `pnpm --filter @opencord/api test:integration`.
4. TypeScript strict, sem `any`; contratos novos em `packages/contracts` com Zod.
5. Ícones só pelo componente `Icon` de `@opencord/ui` (Heroicons 2, outline com crossfade para solid). Não usar Lucide.
6. Mudança de arquitetura exige ADR em `docs/adr/` e registro em `docs/DECISIONS.md`.
7. Mídia: não declarar "funciona" sem o teste manual em dois Windows e redes distintas (gate em `CLAUDE.md`).
8. Não copiar nome, logos, ícones, assets ou código do Discord.
