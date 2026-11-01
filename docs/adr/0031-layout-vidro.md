# ADR-0031: Layout Vidro (segunda casca da interface, padrão)
Status: Accepted (pedido e aprovação do mantenedor, 2026-11-01)

## Contexto
O mantenedor pediu um redesign com vidro, animação e three.js, para testar localmente antes de ir a produção; o
teste anterior (Roda) não agradou. Aprovou o Vidro depois de testar contra o servidor de produção pelo proxy local.

## Decisão
- **Duas cascas, as mesmas telas.** `src/features/vidro/VidroShell.tsx` monta a navegação (rail + canais + painel do
  usuário), o conteúdo e a lateral em três painéis de vidro sobre um fundo vivo; as telas do meio (chat, voz, quadro,
  configurações, diálogos) são as do clássico. `AppShell` continua existindo; os comportamentos comuns (canal padrão,
  contador da bandeja, Ctrl+K, PTT) estão em `useShellBehavior`. No celular (largura pequena) o Vidro cai no clássico.
- **Escolha da pessoa** em `src/lib/layout.ts` (`localStorage` `oc-layout`, por computador): padrão `vidro`;
  Configurações → Aparência → "Glassmorfismo (visual Vidro)" e Ctrl+Alt+L alternam. `VITE_OPENCORD_LAYOUT=classico`
  muda o padrão do build. Fica fora das configurações da API de propósito: não depende de deploy e cada máquina
  (fraca/forte) decide a sua.
- **Fundo em three.js** (`Backdrop.tsx`): um plano com shader (ruído simplex com deformação de domínio, três luzes
  em órbita; a primeira é a cor do servidor aberto ou a cor do tema da pessoa) em meia resolução, no máximo 30 fps.
  Para com jogo detectado (ADR-0021), janela escondida, "reduzir movimento" ou aceleração de hardware desligada; sem
  WebGL fica o gradiente do CSS. Pulsa com quem fala na chamada.
- **Vidro em CSS** (`vidro.css`, escopo `html[data-layout='vidro']`): `backdrop-filter`, borda especular em gradiente
  com ângulo fixo (o reflexo que seguia o ponteiro foi removido em 2026-11-01: trocar `--mx/--my` a cada quadro
  fazia o Chromium recriar as camadas dos painéis sem liberar as antigas, +1 GB/min medido em soak de 60 s; com as
  variáveis congeladas a memória ficou estável; sem parallax de posição desde o primeiro teste),
  tokens de superfície traduzidos para vidro e uma passada nos componentes de dentro (cartões "Em atividade",
  novidades, eventos, abas, buscas, linhas de lista, menus, diálogos, configurações em tela cheia, opções em cartão,
  botões da chamada, reações), fonte Sora (local, OFL) para títulos.
- **Teste contra remoto sem deploy**: `scripts/dev-remote-proxy.mjs` + `pnpm dev:vidro` + `OPENCORD_DEV_PROFILE`
  (herdados do teste Roda).

## Alternativas descartadas
- Reescrever as telas de dentro: risco alto e nada a ganhar; a identidade vem da casca e das superfícies.
- Shader em WebGL puro, sem three.js: o mantenedor pediu three.js e a dependência é pequena para o que faz.
- Parallax de posição (painéis e fundo deslizando contra o mouse): implementado e removido a pedido.

## Consequências
- `three` entra no bundle do desktop (~150 KB gzip). GPU: o fundo custa pouco em meia resolução e some com jogo.
- Qualquer superfície nova deve usar os tokens (`--chat`, `--elevated`, `--border`): é assim que vira vidro.
- O clássico fica como alternativa; não é mais o padrão.

## Evidências (2026-11-01)
- Capturas sem janela (Chromium headless, 1600×900) do chat, da home e do login durante o desenvolvimento.
- Teste no Windows do mantenedor pelo `pnpm dev:vidro` contra produção: aprovado ("pode aplicar").
- Teste de fumaça E2E no layout padrão novo; typecheck, lint e unitários.
