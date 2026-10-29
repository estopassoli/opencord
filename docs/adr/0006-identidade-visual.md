# ADR-0006 — Identidade visual própria (cor de marca e logotipo)
Status: Accepted · Data: 2026-10-29

## Contexto
O `DESIGN_SYSTEM.md` sugeria `--brand: #5865f2`, que é a cor de marca do Discord. O CLAUDE.md e o PRD proíbem reproduzir a marca ou os tokens de terceiros.

## Decisão
- Cor de marca própria, teal `#127a73` (texto branco 5,1:1, AA), com `--brand-text` `#5fd3c6` sobre superfícies escuras.
- Logotipo original desenhado proceduralmente (anel aberto + ponto) em `apps/desktop/electron/main/logo.ts`, usado em janela, bandeja, badge e instalador.
- Superfícies, texto e status recalibrados e verificados para WCAG AA (ver `packages/ui/src/tokens.css`).
- Ícones Heroicons 2 (MIT) via `react-icons/hi2`, com crossfade de outline para solid em hover, foco ou estado ativo, respeitando `prefers-reduced-motion`.

## Consequências
Layout e fluxos familiares, sem marca, cores de marca, ícones ou assets do Discord.

## Atualização 2026-10-29
- A pedido do mantenedor, a cor de marca passou a **#4d56fd**, a cor de fundo do logotipo fornecido por ele (`apps/desktop/resources/opencord-logo.png`). Texto branco 5,2:1 (AA); `--brand-text` #9ca3ff no escuro (≥ 5,4:1) e #3a42d6 no claro (7,2:1).
- A cor de destaque agora é personalizável por usuário (Aparência). Hover, texto sobre o destaque e texto na cor do destaque são derivados em `apps/desktop/src/lib/theme.ts` mantendo ≥ 4,5:1 (testado em `test/theme.test.ts`).
- Fontes proprietárias de terceiros (ex.: gg sans, cuja licença restringe o uso a materiais da Discord Inc.) não são embutidas nem versionadas. O usuário pode selecionar qualquer fonte instalada no próprio computador.
