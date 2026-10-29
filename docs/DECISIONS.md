# Registro de decisões e pendências

## Definidas
- Nome: OpenCord; código aberto e self-hosted.
- Público: amigos, instância privada, desktop-first Windows 11.
- Visual: experiência familiar ao Discord, dark e compacta, com marca/assets próprios; descartar tema Órbita.
- Stack: Electron/React/Vite; NestJS/PostgreSQL/Prisma/Redis/Socket.IO; LiveKit/coturn.
- Sem gravação por padrão; sem federação no MVP.

## Registro
- 2026-10-29 | Áudio do sistema na V1 via loopback do Chromium + `restrictOwnAudio` (ADR-0003, Proposed) | módulo nativo WASAPI process loopback | caminho comprovado no spike F0.4 sem código nativo | sem áudio por aplicativo; revalidar a cada upgrade do Electron | agente (aguarda aprovação do mantenedor)
- 2026-10-29 | Preferir H.264 (encoder de hardware) para Go Live, VP8 como fallback | VP9/AV1 | F0.5: H.264/HEVC via NVENC; VP9/AV1 só software no Chromium 152 | perfis devem medir `encoderImplementation` | agente
- 2026-10-29 | Pesquisa REA restrita a observação black-box; sem análise estática/CDP do Discord | análise de ASAR/binário | termos do Discord restringem engenharia reversa | RE-0.3+ depende do usuário | agente (aguarda revisão do mantenedor)

- 2026-10-29 | Toolchain em majors estáveis (ADR-0004) | majors mais novos | risco de API | upgrades planejados | agente
- 2026-10-29 | PTT global em alternância, sem hook nativo (ADR-0005) | uiohook | privacidade/anti-cheat | sem "segurar" com jogo em foco | agente
- 2026-10-29 | Identidade visual própria: teal #127a73 e logotipo original (ADR-0006) | #5865f2 do pack | evitar marca de terceiros | DESIGN_SYSTEM atualizado | agente
- 2026-10-29 | Cor de marca passa a #4d56fd (fundo da logo fornecida pelo mantenedor; ADR-0006 atualizado) | manter teal | pedido do mantenedor; texto branco 5,2:1 (AA) | tokens/Avatar | mantenedor
- 2026-10-29 | Aparência personalizável salva na conta (destaque, fundo, cantos, fonte instalada, tamanho) | só tema claro/escuro | pedido do mantenedor | `UserSettingsV1.appearance` (defaults retrocompatíveis) | mantenedor
- 2026-10-29 | Fontes/ícones proprietários de terceiros (ex.: gg sans) não são embutidos nem versionados; `public/fonts/` no .gitignore. Usuário pode escolher uma fonte instalada ou **importar arquivos de fonte** (Aparência → Importar fonte), guardados só no IndexedDB daquele PC; a conta sincroniza apenas o nome da família | embutir | licença proíbe uso/redistribuição; responsabilidade pela licença fica com quem importa | `lib/fonts.ts` | agente
- 2026-10-29 | `AUTH_RATE_PER_MINUTE` (padrão 10) configurável; dev usa 500 para E2E | fixo em 10 | suíte E2E excedia o limite | só dev | agente
- 2026-10-29 | Refresh serializado entre abas/janelas (Web Locks) e restore single-flight; reuso no servidor continua revogando a família | período de graça no servidor | manter detecção de roubo estrita | sessão persiste ao reabrir | agente
- 2026-10-29 | Dev sem Docker: Postgres/Redis nativos do WSL, bancos `opencord_dev`/`opencord_test`, Redis db 10/11 com prefixo `oc:` | instalar Docker Desktop | mudança grande no host | Compose não validado | agente
- 2026-10-29 | Go Live com simulcast (H.264 em software no Chromium 152) | camada única com NVENC | camada única ficou em 480×270 no teste | revisitar | agente

- 2026-10-29 | Conta opcional (entrar só com apelido), sem endereço do servidor e servidores abertos sem convites (ADR-0007) | convite + login | pedido do mantenedor | instância aberta por padrão; código de acesso opcional; sem ban | mantenedor
- 2026-10-29 | App desktop também para macOS (dmg arm64/x64) e Linux (AppImage/deb), gerados no workflow `desktop.yml`; API lista todas as plataformas (ADR-0008) | só Windows | pedido do mantenedor | macOS sem notarização; áudio do sistema no Go Live só no Windows | mantenedor
- 2026-10-29 | Go Live volta a camada única com contentHint `detail` + `maintain-resolution` (substitui a entrada do simulcast) | simulcast | em teste real, com banda estimada baixa o espectador recebia só 960×540; camada única manteve 1920×1080 no E2E | sem camada leve para espectadores com download fraco; sob pressão cai o fps | mantenedor
- 2026-10-29 | Supressão de ruído com RNNoise (`@sapphi-red/web-noise-suppressor`, MIT, WASM local) como processador do microfone; CSP ganha `'wasm-unsafe-eval'` | só `noiseSuppression` do navegador; Krisp (exige LiveKit Cloud) | teste real: ruído da casa passava | ~1 MB de WASM; se falhar, segue sem filtro | mantenedor
- 2026-10-29 | Tela de entrada pede apelido/e-mail e senha por padrão; "Utilizar apenas apelido (dados ficam neste navegador/computador)" vira link (ajusta ADR-0007, que mantém a entrada sem conta) | apelido como padrão | pedido do mantenedor | E2E de login/apelido atualizados | mantenedor
- 2026-10-29 | Atualização do desktop "avisar e baixar": o app consulta `/downloads/desktop` do próprio servidor (mesma origem, https), baixa o instalador mais novo e mostra "Atualização pronta"; só executa no clique (SmartScreen/instalador confirmam). macOS/Linux abrem o download | auto-update silencioso com assinatura própria (Ed25519); certificado pago | instaladores sem assinatura (SECURITY.md proíbe auto-update silencioso) | publicar = tag `v*` (versão vem do tag) + copiar arquivos ao DOWNLOADS_DIR; servidor comprometido ainda poderia oferecer instalador malicioso, mas nada roda sem o clique | mantenedor
- 2026-10-29 | Lançamento automático do desktop: push no main que mexe no app → versão `x.y.<run>` + instaladores das 3 plataformas + entrega no volume de downloads por SSH restrito (`rrsync -wo`, host fixado em known_hosts) | build só por tag e cópia manual; GitHub Releases + token na API; API do Dokploy | pedido do mantenedor | ~60–70 min de Actions por lançamento; a chave só grava na pasta; sem os secrets `DOWNLOADS_SSH_*` vira só artefato | mantenedor
- 2026-10-29 | Go Live sem escolhas de modo/áudio: sempre `contentHint` `motion` + `maintain-resolution`, prioridade alta, áudio do sistema sempre incluído; 1080p60 a 8 Mb/s e 1440p60 a 12 Mb/s; perfil padrão 1080p60 | seletor Movimento/Nitidez; caixa de áudio | pedido do mantenedor ("pronto para jogos e nítido"); `detail` limitou jogo a 16 fps, `balanced` derrubou a 540p | 60 fps estáveis dependem do upload e do encoder (software hoje); sob banda baixa cai o fps | mantenedor

## Pendentes de decisão do mantenedor
- Licença (MIT, Apache-2.0 ou AGPL-3.0); não inventar licença. **Ainda pendente; nenhum arquivo LICENSE foi criado.**
- Nome do domínio, infraestrutura e política de retenção.
- ~~Política de contas~~: decidido, entrada por apelido (ADR-0007). Pendente: exigir ou não `INSTANCE_ACCESS_CODE` em produção.
- Certificados de assinatura de código (Windows/macOS); com eles, reavaliar auto-update silencioso.
- Limites máximos de upload, stream e usuários.
- Exigir `INSTANCE_ACCESS_CODE` em produção? Implementar ban (kick hoje permite voltar pelo diretório)?
- Upgrade do REA 6.5.0 → 6.8.0 e escopo da pesquisa (black-box vs CDP).
- Docker: instalar Docker Desktop (WSL integration) ou rodar Postgres/Redis/LiveKit nativos no dev.

## Modelo de registro
`YYYY-MM-DD | decisão | alternativas | motivo | impacto | responsável`
