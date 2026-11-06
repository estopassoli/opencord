#!/usr/bin/env node
// Gera o SQL que publica as Novidades (apps/desktop/src/features/home/changelog.ts) como posts no fórum #novidades do
// servidor oficial, assinados pela conta @opencord (super admin, e-mail oficial@opencord.pro). Cada post mantém a data
// e a hora da novidade. Idempotente: rodar de novo só acrescenta as novidades que ainda não viraram post (requestId
// derivado de data+hora+título), então serve também para publicar as próximas.
//
// Uso (Node 24 lê o changelog.ts direto): node scripts/changelog-forum-sql.mjs > scripts/sql/novidades-forum.sql
// Aplicar: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v pwhash='<hash argon2id>' -f scripts/sql/novidades-forum.sql
//   pwhash: hash da senha inicial da conta (só usado se a conta ainda não existe; vazio = sem senha).
import { createHash, randomBytes } from 'node:crypto';
import { CHANGELOG } from '../apps/desktop/src/features/home/changelog.ts';

const KIND = { novo: 'Novo', melhoria: 'Melhoria', correção: 'Correção' };
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** UUIDv7 com o instante do post: os ids ficam na mesma ordem das datas */
function uuid7(ms) {
  const b = randomBytes(16);
  b.writeUIntBE(ms, 0, 6);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** UUID estável (formato v5) para a idempotência */
function stableUuid(key) {
  const b = createHash('sha256').update(`opencord-novidades:${key}`).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// horário de Brasília; entradas sem hora ficam ao meio-dia; empates descem 1 s cada (a lista já vem da mais nova)
const seen = new Map();
const rows = CHANGELOG.map((e) => {
  const base = Date.parse(`${e.date}T${e.time ?? '12:00'}:00-03:00`);
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  const at = base - n * 1000;
  const body = `**${KIND[e.kind] ?? e.kind}**\n${e.body}`;
  return `(${q(uuid7(at))}::uuid, ${q(stableUuid(`${e.date}|${e.time ?? ''}|${e.title}`))}::uuid, ${q(new Date(at).toISOString())}::timestamptz, ${q(e.title.slice(0, 100))}, ${q(body)})`;
});

process.stdout.write(`-- Gerado por scripts/changelog-forum-sql.mjs (${CHANGELOG.length} novidades). Não editar à mão.
\\set ON_ERROR_STOP on
SELECT set_config('oc.pwhash', :'pwhash', false);
BEGIN;

CREATE TEMP TABLE oc_posts (id uuid, request_id uuid, created_at timestamptz, title text, body text) ON COMMIT DROP;
INSERT INTO oc_posts VALUES
${rows.join(',\n')};

DO $$
DECLARE
  v_server uuid;
  v_user uuid;
  v_channel uuid;
  v_kind text;
  v_msgs int;
  v_hash text := NULLIF(current_setting('oc.pwhash', true), '');
  v_added int;
BEGIN
  SELECT id INTO v_server FROM "Server" WHERE official ORDER BY "createdAt" LIMIT 1;
  IF v_server IS NULL THEN RAISE EXCEPTION 'nenhum servidor oficial'; END IF;

  -- conta @opencord: reaproveita se já for ela (mesmo e-mail); nunca toma o nome de outra pessoa
  SELECT id INTO v_user FROM "User" WHERE email = 'oficial@opencord.pro';
  IF v_user IS NULL THEN
    IF EXISTS (SELECT 1 FROM "User" WHERE username = 'opencord' OR "nickKey" = 'opencord') THEN
      RAISE EXCEPTION 'o nome opencord já pertence a outra conta';
    END IF;
    INSERT INTO "User" (id, email, username, "passwordHash", "displayName", "nickKey", "isInstanceAdmin", verified,
                        "emailVerifiedAt", "termsAcceptedAt")
    VALUES (gen_random_uuid(), 'oficial@opencord.pro', 'opencord', v_hash, 'OpenCord', 'opencord', true, true, now(), now())
    RETURNING id INTO v_user;
    RAISE NOTICE 'conta @opencord criada: %', v_user;
  ELSE
    UPDATE "User" SET "isInstanceAdmin" = true, verified = true WHERE id = v_user;
  END IF;
  INSERT INTO "ServerMember" ("serverId", "userId")
    SELECT id, v_user FROM "Server" WHERE official ON CONFLICT DO NOTHING;

  -- canal #novidades: usa o fórum que já existe, converte um canal de texto vazio ou cria um
  SELECT id, kind::text INTO v_channel, v_kind FROM "Channel"
    WHERE "serverId" = v_server AND lower(name) = 'novidades' AND kind IN ('text', 'forum')
    ORDER BY (kind = 'forum') DESC, position LIMIT 1;
  IF v_channel IS NULL THEN
    INSERT INTO "Channel" (id, "serverId", "categoryId", kind, name, topic, position)
    VALUES (gen_random_uuid(), v_server,
            (SELECT id FROM "Category" WHERE "serverId" = v_server ORDER BY position LIMIT 1),
            'forum', 'novidades', 'O que entrou no OpenCord, do mais novo para o mais antigo.',
            0)
    RETURNING id INTO v_channel;
    RAISE NOTICE 'canal #novidades criado: %', v_channel;
  ELSIF v_kind = 'text' THEN
    -- as mensagens antigas (as mesmas novidades, postadas como texto) saem da lista: apagadas do jeito normal
    -- ("deletedAt"), dá para voltar com UPDATE ... SET "deletedAt" = NULL
    UPDATE "Message" SET "deletedAt" = now()
      WHERE "channelId" = v_channel AND "deletedAt" IS NULL AND "authorId" <> v_user;
    GET DIAGNOSTICS v_msgs = ROW_COUNT;
    UPDATE "Channel" SET kind = 'forum', topic = COALESCE(topic, 'O que entrou no OpenCord, do mais novo para o mais antigo.')
      WHERE id = v_channel;
    RAISE NOTICE 'canal #novidades convertido para fórum (% mensagens antigas apagadas): %', v_msgs, v_channel;
  END IF;

  INSERT INTO "Message" (id, "authorId", "channelId", "requestId", body, mentions, title, "createdAt")
    SELECT id, v_user, v_channel, request_id, body, '{}', title, created_at FROM oc_posts
    ON CONFLICT ("authorId", "requestId") DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  RAISE NOTICE 'posts novos em #novidades: %', v_added;
END $$;

COMMIT;
`);
