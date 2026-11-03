# ADR-0039: Privacidade e dados pessoais (LGPD e Marco Civil)

Status: Accepted (pedido do mantenedor, 2026-11-03)

## Contexto
O mantenedor perguntou se mensagens e chamadas são criptografadas de ponta a ponta e se o OpenCord fere a lei
brasileira. A resposta técnica: criptografia só em trânsito (HTTPS/WSS/DTLS-SRTP); o servidor vê mensagens, arquivos
e mídia (SFU), e a moderação por IA (ADR-0036) manda conteúdo à Anthropic. Nenhuma lei exige E2EE, mas faltavam as
obrigações básicas da LGPD (Lei 13.709/2018) e do Marco Civil (Lei 12.965/2014): transparência (política e termos),
direitos do titular (acesso, portabilidade, exclusão), idade mínima e prazos de retenção. O mantenedor pediu só
esses quatro itens (E2EE e criptografia em repouso ficaram de fora, de propósito).

## Decisão
1. **Termos de uso e Política de privacidade** escritos uma vez e publicados em dois lugares com o mesmo texto: no
   app (`apps/desktop/src/features/legal/legalText.tsx`, com o nome da instância e o contato do operador) e na landing
   (`site/termos.html`, `site/privacidade.html`). O operador define o contato (e-mail ou link) no painel do super
   admin → Instância → "Contato para privacidade" (`InstanceConfig.privacyContact`, exposto em `InstanceInfo`);
   sem ele, o texto aponta para o canal do projeto no GitHub. A política diz o que é verdade no código: dados
   guardados (IP, user agent, hardware ID, conteúdo), finalidades e bases legais, envio à Anthropic (transferência
   internacional, art. 33), leitura de retidos por moderadores/admins, criptografia só em trânsito, prazos, direitos.
2. **Aceite no cadastro com idade mínima de 13 anos**: `acceptTerms: z.literal(true)` em `GuestJoinRequest` e
   `RegisterRequest` (400 sem ele); a tela de entrada só envia com a caixa marcada; `User.termsAcceptedAt` registra
   quando. Quem já tinha identidade antes (coluna nula) vê `Me.termsAccepted = false` e o app abre um diálogo sem
   fechar (aceitar ou sair); `POST /me/accept-terms` grava. Bots e webhooks não passam por isso.
3. **Exportar e excluir** (LGPD art. 18): `GET /me/export` devolve um JSON em streaming (conta, configurações,
   sessões com IP/aparelho, servidores e cargos, conversas, amizades, bloqueios, casos de moderação, bloqueios de
   dispositivo, arquivos e todas as mensagens, paginadas), limitado a 5 por hora. `POST /me/delete` (senha obrigatória
   para quem tem conta) derruba sessões, passa servidores a quem é membro há mais tempo (ou exclui os vazios), remove
   bots, sai de todos os servidores avisando, apaga anexos e gravações prontas do armazenamento, foto, amizades,
   bloqueios, participação em conversas, estados de leitura, configurações, reações, votos, convites e casos de
   moderação, desvincula bloqueios de dispositivo e **anonimiza** a linha do usuário (`removido_xxxxxxxx`, "Usuário
   removido", sem e-mail/senha/apelido, `deletedAt`). Mensagens ficam: são parte do histórico dos outros (modelo do
   Discord), e o autor é obrigatório no esquema. Quem criou a instância e super admins não excluem pelo app.
   Tudo em Configurações → Conta → Privacidade e dados.
4. **Expurgo automático** (`RetentionService`, a cada 6 h, primeira vez 60 s após subir; desligado em testes):
   sessões encerradas ou expiradas após `RETENTION_SESSIONS_DAYS` (180, os 6 meses do Marco Civil art. 15);
   auditoria após `RETENTION_AUDIT_DAYS` (365); casos de moderação já decididos após `RETENTION_MODERATION_DAYS`
   (365; pendentes ficam); bloqueios de dispositivo após `RETENTION_DEVICE_BANS_DAYS` (365). Gravações (24 h) e
   anexos órfãos (24 h) já tinham varredura. Os prazos estão escritos na política.

Migração `20261103000000_privacy` (aditiva): `User.termsAcceptedAt`, `User.deletedAt`, `InstanceConfig.privacyContact`.

## Alternativas descartadas
- Apagar as mensagens na exclusão: destruiria o histórico das conversas dos outros; a anonimização atende à LGPD
  (dado deixa de identificar a pessoa) e o texto da política avisa.
- Política só na landing, com link no app: self-hosters precisam do texto com o nome e o contato da própria instância.
- Pedir data de nascimento: guardar mais um dado pessoal para provar idade; a declaração "13 anos ou mais" com
  registro do aceite é o que a LGPD art. 14 e o ECA Digital (Lei 15.211/2025) pedem de um serviço deste porte.
- Bloquear cadastro de clientes antigos sem `acceptTerms` com 400 é deliberado: a web e o instalador novos mandam o
  campo; app antigo vê a mensagem do contrato ao criar identidade nova (login continua igual).

## Consequências
- Contato de privacidade da instância pública: a landing cita `privacidade@opencord.pro`; o mantenedor precisa criar
  ou redirecionar esse endereço (ou trocar o texto) e preencher o campo no painel para o app mostrar o mesmo.
- Ainda fora: criptografia em repouso (infra), encarregado nomeado (opcional para agente de pequeno porte), canal de
  denúncia de conteúdo documentado, notificação de incidentes (processo).
- Mudanças essenciais no texto pedem novo aceite: zerar `termsAcceptedAt` à mão (decisão do mantenedor), e atualizar
  `LEGAL_VERSION` e as duas páginas da landing juntas.

## Evidências (2026-11-03)
- `apps/api/test/account.int.test.ts` 6/6: cadastro sem aceite 400, aceite tardio, exportação com sessões/servidores/
  conversas/mensagens, exclusão (senha, anonimização, login 401, apelido liberado, servidor transferido ao Bruno,
  servidor vazio excluído, mensagem fica como "Usuário removido", criador recusado), identidade só com apelido exclui
  sem senha, expurgo (sessões/auditoria/casos/bloqueios antigos somem, recentes e pendentes ficam). Suíte 198/198.
- Desktop: typecheck, lint, unit 209/209; páginas da landing e tela de entrada conferidas em captura headless.
