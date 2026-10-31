# Segurança e privacidade

## Modelo de ameaça
Convites vazados, roubo de sessão, abuso de upload, escalada de cargo, entrada em voz não autorizada, IPC comprometido, links maliciosos, SSRF em previews, abuso de banda, vazamento de tokens e atualização desktop adulterada.

## Entrada por apelido (ADR-0007)
Identidades sem senha ficam ligadas ao dispositivo pela sessão. Servidores são abertos (sem convites). Riscos: instância aberta a quem alcança o servidor (mitigar com `INSTANCE_ACCESS_CODE`), criação em massa de apelidos (limite por IP + rate limit) e personificação (apelido único normalizado, sem caracteres invisíveis).

## Controles
- Argon2id; login rate limit; e-mails normalizados; convites armazenados como hash e com expiração/uso máximo.
- Access token curto; refresh rotativo com hash e revogação; armazenamento de tokens com mecanismo seguro do sistema quando disponível.
- RBAC por servidor/canal, deny explícito prevalece conforme regra documentada; verificar permissões no backend e no momento de emitir tokens LiveKit.
- Remoção de membro implica expulsão ativa da SFU e rooms de realtime.
- Upload: tamanho máximo, MIME real, nome sanitizado, URLs assinadas e política de retenção.
- Electron: sandbox, contextIsolation, nodeIntegration=false, CSP estrita, navigation/window.open controlados, preload allowlist e validação de parâmetros.
- Sem logs de tokens, senhas, mensagens privadas ou conteúdo de mídia; mascaramento e retenção limitada.
- HTTPS e WSS; TURN com credenciais temporárias; secrets via env/secret manager; backups criptografados.
- Assinar builds/updates quando possível; publicar hashes e provenance.

## Privacidade
Não gravar chamadas por padrão. WebRTC usa criptografia em trânsito, mas isso não significa E2EE contra SFU. Não alegar E2EE sem implementação específica. Expor exclusão de conta/dados e política de retenção antes de disponibilizar publicamente.

## Checklist de revisão
Testar IDOR, permissões por canal, tokens expirados, reuso de convites, rate limit, MIME spoofing, XSS em mensagens, URL schemes, atualização e IPC.

## Regra de resolução de permissões (implementada em `packages/contracts/src/permissions.ts`)
1. Dono do servidor ou `ADMINISTRATOR` → todas as permissões.
2. Base = OR de @everyone com os cargos do membro.
3. Overrides do canal, do menos para o mais específico: @everyone (deny, depois allow) → cargos do membro agregados (deny, depois allow) → membro (deny, depois allow). O nível mais específico prevalece; dentro de um nível, o allow agregado vence o deny agregado.
4. Sem `VIEW_CHANNEL`, o canal inteiro é negado (e a API responde 404, não 403, para não revelar a existência).
5. Sem `CONNECT`, SPEAK/VIDEO/STREAM são removidos. Os grants do token LiveKit (`canPublishSources`) derivam dessas permissões e são reaplicados na SFU quando mudam.
6. Hierarquia: só se gerenciam cargos e membros estritamente abaixo do próprio cargo mais alto; não é possível conceder bits que o ator não possui.

## Revisão de segurança — 2026-10-29 (automatizada; não substitui auditoria externa)
| Item do checklist | Evidência |
|---|---|
| IDOR / não membro | `apps/api/test/servers.int.test.ts` (404 para servidor/canal alheio), `messages.int.test.ts` (DM de terceiros 404) |
| Permissões por canal | overrides de VIEW/SEND/CONNECT/STREAM em `servers`, `messages`, `realtime` e `voice` int tests |
| Tokens expirados/adulterados | `auth.int.test.ts` (token adulterado 401, logout invalida na hora, reuso de refresh revoga a família) |
| Entrada por apelido / conta opcional | `guest.int.test.ts` (unicidade normalizada, código de acesso, limite por IP, claim) |
| Rate limit | login: 10 falhas/15 min por e-mail (Redis); global 300/min/IP; rotas de auth 10/min; socket: token bucket (teste) |
| MIME spoofing / upload | `attachments.int.test.ts` (EXE como PNG rejeitado, limite 413, URL assinada adulterada 404, anexo de terceiro recusado) |
| XSS em mensagens | renderização sem `innerHTML` (`apps/desktop/test/rich.test.tsx`), CSP sem inline script |
| URL schemes | só http(s) vira link; `openExternal` valida http(s) no main |
| IPC | allowlist + Zod + verificação do remetente; E2E prova sem `require`/`process` no renderer e rejeição de argumento inválido |
| Electron fuses | REA `inspect_electron_fuses` no build empacotado: RunAsNode, NODE_OPTIONS e inspect desativados; ASAR integrity e onlyLoadAppFromAsar ativados |
| Revogação de mídia | `voice.int.test.ts` + E2E: kick ou perda de CONNECT remove da SFU em < 5 s |
| Atualização | sem auto-update silencioso: o app baixa o instalador novo do próprio servidor (mesma origem, https, nome validado) e só executa no clique "Atualização pronta"; instalador não assinado (SmartScreen avisará) |

Pendências: auditoria por terceiros, teste de abuso de banda com clientes reais, assinatura de código, política de retenção.

## Auditoria — 2026-10-31 (skill `security-audit` da Cloudflare, perfil `quick`; parcial)
Revisão de código + checagens locais em sandbox (bwrap, sem rede). Relatório completo fora do repositório (`~/security-audit-skill/opencord/run-1/`). Confirmados e corrigidos:

| Achado | Gravidade | Correção / regressão |
|---|---|---|
| Trocar a senha revogava as outras sessões no banco, mas os sockets delas seguiam autenticados | média | `AuthService.changePassword` chama `disconnectSession`; `auth.int.test.ts` |
| Envio grande abandonado deixava as partes no armazenamento (estado no Redis expirava antes da varredura) | média | estado vive 1 h além do prazo, que anda a cada parte; `large-upload.service.ts` |
| Quem tinha só MANAGE_CHANNELS lia canal oculto ligando-o a um quadro (e renomeava/excluía canal que não via) | média | `updateChannel`/`deleteChannel` usam `requireChannel`; ligar a quadro exige MANAGE_ROLES e ver o quadro; `boards.int.test.ts` |
| Silenciado pela moderação recuperava o microfone ao reentrar / sair e voltar | baixa | silenciamento persistido por servidor (`voice:muted:*`), filtrado no `join`; `voice.int.test.ts` |
| `sound:play` ignorava SPEAK e o silenciamento | baixa | exige SPEAK e não estar silenciado; `sounds.int.test.ts` |
| Estado de voz de canais ocultos visível para todo membro | baixa | `listServer` filtra por VIEW_CHANNEL; eventos de voz/atividade/música/som vão para a room do canal; `voice.int.test.ts` |
| Texto de mensagem apagada continuava no card do quadro | baixa | `remove` apaga o texto do card na mesma transação; `boards.int.test.ts` |
| Cargo por reação ganhava moderação via override de canal ou edição posterior | baixa | bits proibidos conferidos com overrides, também ao aplicar; `reaction-roles.int.test.ts` |

Leads sem confirmação, já endurecidos: placeholders `CHANGE_ME` do LiveKit aceitos em produção (a API agora recusa `CHANGE_ME*`, `devkey` e segredo < 32; o CI gera chaves aleatórias), e aspas Unicode fechando literal no PowerShell (`copyClip`/`runningPath` agora passam o valor por variável de ambiente; validar em Windows real). Não cobertos nesta rodada: cota de gasto do YouTube/importação do Discord, fan-out de presença, CVEs de dependências (`pnpm audit`).

### Endurecimento aplicado depois da auditoria (2026-10-31)
- Login: tentativa reservada no Redis antes de verificar a senha (sem corrida); apelido e e-mail somam no mesmo contador da conta; bloqueio por conta+IP (10/15 min) com teto por conta (100/15 min), então um estranho não tranca a conta de outro.
- Sessões: suspensão pelo admin limpa o cache de sessão; sockets abertos têm a sessão conferida a cada 60 s (`RealtimeGateway.revalidate`); sair da última sessão tira da chamada.
- Permissões: `chat:typing:start` exige SEND_MESSAGES; dar cargo exige ter os bits dele; trocar overrides exige ter os bits dos que forem removidos/alterados; overrides de membro somem ao expulsar/sair; parte de gravação exige ainda ter CONNECT no canal.
- Envios: uma parte por vez (trava no Redis) em envio grande e gravação; envio grande grava o anexo antes de soltar o estado (sem órfão se o insert falhar) e no máximo 3 abertos por pessoa; no máximo 50 anexos não usados por pessoa em 24 h; troca de avatar/ícone por compare-and-swap (sem arquivo órfão).
- Desktop: IPC aceita só o `index.html` empacotado (não qualquer `file://`); permissões de mídia/notificação só para a página do app; player do YouTube em iframe com `sandbox`.
- Infra/CI: nginx envia `frame-ancestors 'none'`/`X-Frame-Options` na interface; coturn não sobe com o segredo de exemplo e bloqueia relay para link-local/metadados de nuvem, CGNAT e faixas IPv6 privadas; Actions fixadas por SHA; versão passa por variável de ambiente no workflow do desktop.

Mantidos de propósito: links assinados de anexo valem 1–2 h mesmo após perder acesso ao canal (encurtar quebraria vídeos longos pausados; mesmo modelo do Discord); o token de acesso da sessão rotacionada vale até expirar (no máximo `ACCESS_TOKEN_TTL_SECONDS`); e-mail sem verificação (não há recuperação de conta por e-mail); instalador sem assinatura de código (depende de certificado, DECISIONS.md).
