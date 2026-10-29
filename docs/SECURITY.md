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
| Atualização | auto-update desativado (sem assinatura); instalador não assinado (SmartScreen avisará) |

Pendências: auditoria por terceiros, teste de abuso de banda com clientes reais, assinatura de código, política de retenção.
