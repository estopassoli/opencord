# ADR-0063: Versionamento semântico (SemVer) do app desktop

Status: Accepted (pedido do mantenedor, 2026-11-11)

## Contexto
Desde 29/10 cada push no main que mexe no app gerava a versão `<major>.<minor>.<nº do run do CI>` (e, no app em
Tauri, `0.3.<run − TAURI_FIRST_RUN>`). O número só dizia quantas builds houve: uma correção e um recurso novo subiam do
mesmo jeito, um run que falhava pulava uma versão (0.3.0 → 0.3.2) e o minor só mudava à mão.

## Decisão
A versão segue o SemVer 2.0.0 (`MAJOR.MINOR.PATCH`) e é calculada no CI a partir da **última tag de release**
(`vX.Y.Z`, criada pela própria release) e dos **commits desde ela que mexem no app** (os caminhos do `desktop.yml`),
lidos como Conventional Commits (`apps/desktop/scripts/next-version.mjs`):
- `tipo!:` ou `BREAKING CHANGE:` no corpo → **MAJOR** (zera minor e patch);
- `feat` → **MINOR** (zera o patch);
- qualquer outro tipo (`fix`, `perf`, `refactor`, `docs`, `chore`, `test`, `ci`…) → **PATCH**.

Vale o maior salto entre os commits. Um push que só repete o que já saiu ainda gera build nova, então sobe o patch.
Tag `vX.Y.Z` empurrada à mão continua usando exatamente essa versão. Electron (macOS/Linux) e Tauri (Windows) têm a
mesma versão. A variável `TAURI_FIRST_RUN` deixa de existir.

Na prática, o tipo do commit passa a decidir a versão: `feat` só para recurso novo de verdade.

## Alternativas
- Subir a versão à mão no `package.json` a cada release: fácil de esquecer e, com o lançamento automático por push,
  duas builds sairiam com a mesma versão (o atualizador não veria a segunda).
- semantic-release/changesets: dependência e configuração novas para o que um script de 60 linhas resolve com as tags
  que o CI já cria.

## Consequências
- Run que falha não "gasta" versão: a próxima build parte da última release publicada.
- A versão sobe mais devagar (0.3.2 → 0.3.3 numa correção; 0.4.0 num recurso) e sempre cresce, então os atualizadores
  (Electron e Tauri, comparação numérica `x.y.z`) continuam vendo cada release como nova.
- O checkout do job de versão precisa do histórico completo (`fetch-depth: 0`).
- Evidência: `test/next-version.test.ts` 4/4; o script em 11/11 a partir de `v0.3.2` com o commit `fix(oc-live)` deu
  `0.3.3`.
