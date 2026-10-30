/**
 * Conteúdo do servidor oficial da instância (ADR-0011): categorias, canais de texto e voz, cargos, mensagens de
 * boas-vindas/regras/ajuda e o histórico de Novidades. Idempotente: pode rodar de novo (só cria o que falta e
 * posta só as novidades novas). Também coloca no oficial quem ainda não está nele.
 *
 * Uso (no contêiner da API, com DATABASE_URL):
 *   node node_modules/@opencord/db/dist/seed-official.js novidades.json [--dry]
 * `novidades.json` = CHANGELOG do app (apps/desktop/src/features/home/changelog.ts) em JSON; `--dry` faz tudo numa
 * transação e desfaz no fim, só mostrando o que mudaria.
 * Escreve direto no banco: quem está com o app aberto vê as mudanças ao recarregar.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Permission } from '@opencord/contracts';
import type { Prisma } from '@prisma/client';
import { createPrismaClient } from './index.js';

interface NewsEntry {
  date: string;
  time?: string;
  kind: 'novo' | 'melhoria' | 'correção';
  title: string;
  body: string;
}

interface ChannelSpec {
  name: string;
  kind: 'text' | 'voice' | 'board';
  topic?: string;
  /** nomes antigos: o canal existente é renomeado (mantém mensagens e as chaves dos posts) */
  formerly?: string;
  /** só a equipe escreve (@everyone sem SEND_MESSAGES; reações continuam) */
  readOnly?: boolean;
  /** só quem tem Administrador (ou é dono/super admin) vê (@everyone sem VIEW_CHANNEL) */
  staffOnly?: boolean;
  /** canal de texto: cada mensagem nova vira card neste quadro (nome do canal "board") */
  feeds?: string;
  /** mensagens fixas da equipe, na ordem; o seed atualiza o texto se ele mudar aqui */
  posts?: string[];
}

const REPO = 'https://github.com/estopassoli/opencord';
const SITE = 'https://opencord.pro';
const WEB = 'https://app.opencord.pro';

const LAYOUT: { category: string; channels: ChannelSpec[] }[] = [
  {
    category: 'Informações',
    channels: [
      {
        name: 'boas-vindas',
        kind: 'text',
        topic: 'Comece por aqui',
        readOnly: true,
        posts: [
          [
            '**Bem-vindo ao OpenCord!** 👋',
            'Este é o servidor oficial da instância: todo mundo que entra no OpenCord já está aqui.',
            '',
            '**Por onde começar**',
            '• Leia as **#regras** (são poucas).',
            '• Diga oi em **#apresente-se** e converse em **#geral**.',
            '• Tudo o que muda no app sai em **#novidades**; avisos importantes, em **#anúncios**.',
            '• Dúvidas: **#ajuda**. Ideias: **#sugestões**. Algo quebrou: **#reportar-bugs**.',
            '• Quer jogar ou conversar por voz? Entre em qualquer canal da categoria **Voz**.',
            '',
            `O app de desktop (Windows, macOS e Linux) está em ${SITE} e a versão no navegador em ${WEB}.`,
          ].join('\n'),
        ],
      },
      {
        name: 'regras',
        kind: 'text',
        topic: 'Convivência no servidor oficial',
        readOnly: true,
        posts: [
          [
            '**Regras do servidor**',
            '1. Respeito acima de tudo: sem ofensas, assédio, discurso de ódio ou ataques pessoais.',
            '2. Nada de conteúdo ilegal, pornográfico ou violento explícito.',
            '3. Sem spam, flood ou propaganda não combinada com a equipe.',
            '4. Use cada canal para o que ele é (o tópico do canal explica).',
            '5. Nas chamadas, respeite quem está falando; música e efeitos sonoros com moderação.',
            '6. Não compartilhe dados pessoais seus ou de outras pessoas.',
            '7. Encontrou uma falha de segurança? Não divulgue: reporte em particular pelo GitHub (Security → Report a vulnerability).',
            '',
            'A equipe pode silenciar, mover ou expulsar quem descumprir as regras.',
          ].join('\n'),
        ],
      },
      {
        name: 'anúncios',
        kind: 'text',
        topic: 'Avisos importantes da equipe',
        readOnly: true,
        posts: [
          [
            '**O OpenCord é código aberto** 🎉',
            `Todo o código está em ${REPO}, sob a licença AGPL-3.0.`,
            'O projeto não tem fins lucrativos: sem anúncios, sem planos pagos, sem venda de dados.',
            'Qualquer pessoa pode hospedar a própria instância (veja **#self-hosting**) ou usar esta aqui.',
          ].join('\n'),
        ],
      },
      {
        name: 'novidades',
        kind: 'text',
        topic: 'Tudo o que muda no OpenCord, do lançamento até hoje',
        readOnly: true,
      },
    ],
  },
  {
    category: 'Comunidade',
    channels: [
      { name: 'geral', kind: 'text', topic: 'Conversa livre' },
      {
        name: 'apresente-se',
        kind: 'text',
        topic: 'Conte quem você é',
        posts: ['Chegou agora? Conta pra gente: como te chamam, de onde você é e o que gosta de jogar ou fazer. 🙂'],
      },
      { name: 'off-topic', kind: 'text', topic: 'Assuntos aleatórios' },
      { name: 'memes', kind: 'text', topic: 'Memes e coisas engraçadas (respeitando as regras)' },
      { name: 'clipes-e-prints', kind: 'text', topic: 'Seus melhores momentos: clipes, prints e fotos' },
    ],
  },
  {
    category: 'OpenCord',
    channels: [
      {
        name: 'ajuda',
        kind: 'text',
        topic: 'Dúvidas sobre o app',
        posts: [
          [
            '**Perguntas frequentes**',
            `• **Como atualizo o app?** Baixe o instalador mais novo em ${SITE} e instale por cima. O app ainda não se atualiza sozinho.`,
            '• **A interface trava ou engasga enquanto jogo.** Em Configurações → Sobre → Desempenho, escolha "Interface leve, lives na placa de vídeo".',
            '• **O som do PC não vai na live.** Hoje o áudio do sistema no Go Live funciona só no app para Windows.',
            '• **A live dos outros engasga quando eu transmito.** Diminua o bitrate da transmissão (engrenagem no seletor do Go Live, ou Configurações → Vídeo).',
            '• **Ninguém me ouve.** Confira o microfone em Configurações → Voz e se você não está silenciado (ícone do microfone cortado).',
            '',
            'Não achou a resposta? Pergunte aqui; descreva o sistema (Windows, macOS, Linux ou navegador) e o que aconteceu.',
          ].join('\n'),
        ],
      },
      {
        name: 'sugestões',
        kind: 'text',
        topic: 'Ideias para o OpenCord',
        posts: [
          'Tem uma ideia? Mande aqui: **o que** você quer e **por que** ajudaria. Reaja com 👍 nas sugestões dos outros para mostrar o que é mais pedido.',
        ],
      },
      {
        name: 'reportar-bugs',
        formerly: 'bugs',
        kind: 'text',
        topic: 'Algo quebrou? Conte aqui: cada mensagem vira um card para a equipe',
        feeds: 'kanban-de-bugs',
        posts: [
          [
            '**Como reportar um bug**',
            '1. O que você fez (passo a passo).',
            '2. O que esperava que acontecesse e o que aconteceu.',
            '3. Sistema e versão do app (Configurações → Sobre) ou navegador.',
            '4. Um print ou vídeo ajuda muito.',
            `Também dá para abrir uma issue em ${REPO}/issues.`,
          ].join('\n'),
          [
            '**Cada mensagem enviada aqui vira um card no quadro de bugs da equipe.** 🐞',
            'Comece pela frase que resume o problema: ela vira o título do card. Os detalhes podem vir nas linhas de baixo.',
            'A equipe acompanha o card de "Novo" até "Resolvido".',
          ].join('\n'),
        ],
      },
      {
        name: 'kanban-de-bugs',
        kind: 'board',
        topic: 'Bugs relatados em #reportar-bugs (só a equipe vê)',
        staffOnly: true,
      },
      {
        name: 'self-hosting',
        kind: 'text',
        topic: 'Hospede sua própria instância',
        posts: [
          [
            '**Rode o seu próprio OpenCord**',
            `O README em ${REPO} tem o passo a passo com Docker Compose: API, interface web, PostgreSQL, Redis e LiveKit para a voz.`,
            'Dúvidas sobre instalação, domínio, TURN ou portas: pergunte aqui.',
          ].join('\n'),
        ],
      },
      {
        name: 'código-aberto',
        kind: 'text',
        topic: 'Contribuições, código e desenvolvimento',
        posts: [
          [
            '**Quer contribuir?**',
            `Código, issues e pull requests em ${REPO}.`,
            'Stack: TypeScript, NestJS, React, Electron, PostgreSQL, Redis, Socket.IO e LiveKit.',
            'Antes de um PR grande, comente a ideia aqui ou numa issue para alinharmos.',
          ].join('\n'),
        ],
      },
    ],
  },
  {
    category: 'Jogos',
    channels: [
      { name: 'jogos', kind: 'text', topic: 'Notícias, dicas e conversa sobre jogos' },
      {
        name: 'procurando-grupo',
        kind: 'text',
        topic: 'Ache gente para jogar',
        posts: [
          [
            'Procurando grupo? Use este modelo:',
            '**Jogo:**',
            '**Modo/rank:**',
            '**Quantas vagas:**',
            '**Horário:**',
            'Depois é só chamar a galera para um canal de voz da categoria **Voz**.',
          ].join('\n'),
        ],
      },
    ],
  },
  {
    category: 'Voz',
    channels: [
      { name: 'Sala', kind: 'voice' },
      { name: 'Bate-papo', kind: 'voice' },
      { name: 'Jogando 1', kind: 'voice' },
      { name: 'Jogando 2', kind: 'voice' },
      { name: 'Jogando 3', kind: 'voice' },
      { name: 'Assistir juntos', kind: 'voice' },
      { name: 'Música', kind: 'voice' },
      { name: 'Estudo e foco', kind: 'voice' },
      { name: 'AFK', kind: 'voice' },
    ],
  },
];

/** Categorias padrão de servidor novo: somem se ficarem vazias depois de reorganizar. */
const DEFAULT_CATEGORIES = ['Canais de texto', 'Canais de voz'];

const MOD =
  Permission.MANAGE_MESSAGES |
  Permission.MENTION_EVERYONE |
  Permission.MUTE_MEMBERS |
  Permission.MOVE_MEMBERS |
  Permission.KICK_MEMBERS |
  Permission.VIEW_AUDIT_LOG;
/** de baixo para cima; só cria os que faltam (cargos existentes ficam como estão) */
const ROLES = [
  { name: 'Contribuidor', color: '#2dd4bf', permissions: 0 },
  { name: 'Moderação', color: '#f59e0b', permissions: MOD },
  { name: 'Equipe OpenCord', color: '#8b5cf6', permissions: Permission.ADMINISTRATOR, owner: true },
];

const KIND_LABEL: Record<NewsEntry['kind'], string> = {
  novo: '🆕 Novo',
  melhoria: '✨ Melhoria',
  correção: '🔧 Correção',
};

/** requestId determinístico: a mesma mensagem nunca é postada duas vezes (unique authorId+requestId). */
function stableId(key: string): string {
  const h = createHash('sha256').update(`opencord-official:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const at = (e: NewsEntry) => new Date(`${e.date}T${e.time ?? '12:00'}:00-03:00`);

async function seed(tx: Prisma.TransactionClient, news: NewsEntry[], log: (s: string) => void) {
  const server = await tx.server.findFirst({ where: { official: true }, orderBy: { createdAt: 'asc' } });
  if (!server) throw new Error('nenhum servidor oficial nesta instância');
  log(`Servidor oficial: ${server.name} (${server.id})`);
  const ownerId = server.ownerId;

  // membros: todo usuário ativo
  const users = await tx.user.findMany({ where: { disabledAt: null }, select: { id: true } });
  const inside = new Set(
    (await tx.serverMember.findMany({ where: { serverId: server.id }, select: { userId: true } })).map((m) => m.userId),
  );
  const missing = users.filter((u) => !inside.has(u.id)).map((u) => u.id);
  if (missing.length) {
    await tx.serverMember.createMany({
      data: missing.map((userId) => ({ serverId: server.id, userId })),
      skipDuplicates: true,
    });
    await tx.auditLog.createMany({
      data: missing.map((userId) => ({
        actorId: userId,
        serverId: server.id,
        action: 'member.join',
        targetId: userId,
        metadata: { via: 'official-seed' },
      })),
    });
  }
  log(`Membros: ${inside.size} já estavam, ${missing.length} adicionados`);

  // cargos
  const roles = await tx.role.findMany({ where: { serverId: server.id } });
  const everyone = roles.find((r) => r.isEveryone);
  if (!everyone) throw new Error('servidor sem @everyone');
  let top = Math.max(0, ...roles.map((r) => r.position));
  for (const spec of ROLES) {
    let role = roles.find((r) => r.name.toLowerCase() === spec.name.toLowerCase());
    if (!role) {
      role = await tx.role.create({
        data: {
          serverId: server.id,
          name: spec.name,
          color: spec.color,
          permissions: spec.permissions,
          position: ++top,
        },
      });
      log(`Cargo criado: ${spec.name}`);
    }
    if (spec.owner)
      await tx.memberRole.createMany({
        data: [{ serverId: server.id, userId: ownerId, roleId: role.id }],
        skipDuplicates: true,
      });
  }

  // categorias e canais
  const cats = await tx.category.findMany({ where: { serverId: server.id } });
  const chans = await tx.channel.findMany({ where: { serverId: server.id } });
  let created = 0;
  let posted = 0;
  let edited = 0;
  const ids = new Map<string, string>();
  const newsChannel: { id?: string } = {};
  for (const [ci, group] of LAYOUT.entries()) {
    let cat = cats.find((c) => c.name.toLowerCase() === group.category.toLowerCase());
    if (cat) await tx.category.update({ where: { id: cat.id }, data: { position: ci } });
    else {
      cat = await tx.category.create({ data: { serverId: server.id, name: group.category, position: ci } });
      log(`Categoria criada: ${group.category}`);
    }
    for (const [pi, spec] of group.channels.entries()) {
      const named = (n: string) => chans.find((c) => c.kind === spec.kind && c.name.toLowerCase() === n.toLowerCase());
      let ch = named(spec.name);
      const renamed = !ch && spec.formerly ? named(spec.formerly) : undefined;
      if (renamed) {
        ch = await tx.channel.update({
          where: { id: renamed.id },
          data: { name: spec.name, categoryId: cat.id, position: pi, ...(spec.topic ? { topic: spec.topic } : {}) },
        });
        log(`Canal renomeado: ${renamed.name} → ${spec.name}`);
      } else if (ch) {
        await tx.channel.update({
          where: { id: ch.id },
          data: { categoryId: cat.id, position: pi, ...(spec.topic && !ch.topic ? { topic: spec.topic } : {}) },
        });
      } else {
        ch = await tx.channel.create({
          data: {
            serverId: server.id,
            categoryId: cat.id,
            kind: spec.kind,
            name: spec.name,
            topic: spec.topic ?? null,
            position: pi,
          },
        });
        created++;
      }
      if (spec.readOnly) {
        const key = { channelId: ch.id, subjectType: 'role' as const, subjectId: everyone.id };
        await tx.channelPermissionOverride.upsert({
          where: { channelId_subjectType_subjectId: key },
          create: { ...key, allow: 0, deny: Permission.SEND_MESSAGES },
          update: {},
        });
      }
      if (spec.staffOnly) {
        const key = { channelId: ch.id, subjectType: 'role' as const, subjectId: everyone.id };
        await tx.channelPermissionOverride.upsert({
          where: { channelId_subjectType_subjectId: key },
          create: { ...key, allow: 0, deny: Permission.VIEW_CHANNEL },
          update: { deny: Permission.VIEW_CHANNEL, allow: 0 },
        });
      }
      ids.set(spec.name, ch.id);
      if (spec.name === 'novidades') newsChannel.id = ch.id;
      // posts fixos: um segundo entre eles, para a ordem ficar estável
      const base = Date.now() - (spec.posts?.length ?? 0) * 1000;
      for (const [i, body] of (spec.posts ?? []).entries()) {
        // chave pelo nome original: renomear o canal não posta tudo de novo
        const requestId = stableId(`post:${spec.formerly ?? spec.name}:${i}`);
        const old = await tx.message.findUnique({
          where: { authorId_requestId: { authorId: ownerId, requestId } },
          select: { id: true, body: true, deletedAt: true },
        });
        if (old) {
          // texto mudou no seed: edita a mensagem (fica marcada como editada); apagada pela equipe fica apagada
          if (old.body !== body && !old.deletedAt) {
            await tx.message.update({ where: { id: old.id }, data: { body, editedAt: new Date() } });
            edited++;
          }
          continue;
        }
        await tx.message.create({
          data: {
            authorId: ownerId,
            channelId: ch.id,
            requestId,
            body,
            mentions: [],
            createdAt: new Date(base + i * 1000),
          },
        });
        posted++;
      }
    }
  }
  // canais que alimentam quadros (depois do laço: o quadro pode vir depois do canal)
  for (const spec of LAYOUT.flatMap((g) => g.channels).filter((c) => c.feeds)) {
    const from = ids.get(spec.name);
    const to = ids.get(spec.feeds!);
    if (from && to) await tx.channel.update({ where: { id: from }, data: { boardId: to } });
  }
  log(`Canais criados: ${created}; mensagens fixas postadas: ${posted}, editadas: ${edited}`);

  // categorias padrão que ficaram vazias
  for (const c of cats.filter((c) => DEFAULT_CATEGORIES.includes(c.name))) {
    if ((await tx.channel.count({ where: { categoryId: c.id } })) === 0) {
      await tx.category.delete({ where: { id: c.id } });
      log(`Categoria vazia removida: ${c.name}`);
    }
  }
  // demais categorias (criadas à mão) vão para depois das do layout, na ordem em que estavam
  const extra = cats
    .filter((c) => !DEFAULT_CATEGORIES.includes(c.name))
    .filter((c) => !LAYOUT.some((g) => g.category.toLowerCase() === c.name.toLowerCase()))
    .sort((a, b) => a.position - b.position);
  for (const [i, c] of extra.entries())
    await tx.category.update({ where: { id: c.id }, data: { position: LAYOUT.length + i } });

  // novidades: uma mensagem por entrada, da mais antiga para a mais nova, com a data da entrada
  if (newsChannel.id) {
    const ordered = [...news].sort((a, b) => at(a).getTime() - at(b).getTime());
    const r = await tx.message.createMany({
      data: ordered.map((e) => ({
        authorId: ownerId,
        channelId: newsChannel.id!,
        requestId: stableId(`news:${e.date}:${e.time ?? ''}:${e.title}`),
        body: `**${e.title}** · ${KIND_LABEL[e.kind] ?? e.kind}\n${e.body}`,
        mentions: [],
        createdAt: at(e),
      })),
      skipDuplicates: true,
    });
    log(`Novidades: ${r.count} novas de ${news.length}`);
  }
}

class DryRun extends Error {}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!file) throw new Error('uso: seed-official.js novidades.json [--dry]');
  const dry = process.argv.includes('--dry');
  const news = JSON.parse(readFileSync(file, 'utf8')) as NewsEntry[];
  if (!Array.isArray(news) || news.some((e) => !e.date || !e.title || !e.body))
    throw new Error('novidades.json inválido');
  const prisma = createPrismaClient();
  try {
    await prisma.$transaction(
      async (tx) => {
        await seed(tx, news, (s) => console.warn(s));
        if (dry) throw new DryRun();
      },
      { timeout: 120_000 },
    );
    console.warn('Pronto.');
  } catch (e) {
    if (e instanceof DryRun) console.warn('--dry: nada foi gravado.');
    else throw e;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
