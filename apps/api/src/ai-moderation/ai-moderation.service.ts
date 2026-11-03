/**
 * Moderação por IA (ADR-0036): antes de publicar, texto e anexos passam pelo Claude (Haiku 5.5 por padrão, o modelo
 * mais barato), com o contexto do canal (servidor, canal, regras do servidor, últimas mensagens). Três vereditos:
 * `allow` publica; `block` (IA segura) não publica e fica registrado; `review` (em dúvida) não publica e entra na
 * fila dos moderadores, que aprovam (publica) ou reprovam (e podem punir).
 *
 * IA fora do ar ou lenta: libera (fail-open) e registra, salvo MODERATION_AI_FAIL_CLOSED, que retém para revisão.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { InstanceService } from '../admin/instance.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../common/prisma.service.js';
import { StorageService } from '../attachments/storage.service.js';
import { imageForModel, videoFrames, type ImageInput } from './media.js';

export const VERDICT_CATEGORIES = [
  'assedio',
  'odio',
  'sexual',
  'menores',
  'violencia',
  'autoagressao',
  'ilegal',
  'golpe',
  'spam',
  'doxxing',
  'outro',
  'nenhuma',
] as const;

const VerdictSchema = z.object({
  decision: z.enum(['allow', 'block', 'review']),
  category: z.enum(VERDICT_CATEGORIES),
  /** 0–1: quão certa a IA está da decisão */
  confidence: z.number().min(0).max(1),
  /** uma ou duas frases para quem modera, em português */
  reason: z.string().max(400),
});
export type Verdict = z.infer<typeof VerdictSchema>;

/** categorias que, com certeza alta, disparam o bloqueio automático da pessoa (ligado no painel) */
export const SEVERE_CATEGORIES = new Set<Verdict['category']>(['menores', 'sexual', 'violencia']);
export const SEVERE_MIN_CONFIDENCE = 0.85;
/** em mensagem direta (revisão de 2026-11-03): ninguém lê DM por dúvida; só o grave, com certeza, bloqueia */
export const DM_BLOCK_CATEGORIES = new Set<Verdict['category']>(['menores', 'sexual', 'violencia', 'doxxing']);
export const DM_MIN_CONFIDENCE = 0.8;
export const isSevere = (v: Verdict) =>
  v.decision === 'block' && SEVERE_CATEGORIES.has(v.category) && v.confidence >= SEVERE_MIN_CONFIDENCE;

export interface ModerationInput {
  serverName: string | null;
  channelName: string | null;
  channelTopic: string | null;
  serverRules: string | null;
  /** DM: true (regras mais frouxas, sem regras de servidor) */
  direct: boolean;
  authorName: string;
  body: string;
  /** últimas mensagens do destino, da mais antiga para a mais nova */
  recent: { author: string; body: string; attachments: number }[];
  attachments: { id: string; name: string; mime: string; sizeBytes: number; storageKey: string }[];
  /** edição de uma mensagem já publicada */
  editing?: boolean;
}

export type ModerationResult =
  | { kind: 'allow'; verdict: Verdict | null }
  | { kind: 'block'; verdict: Verdict }
  | { kind: 'review'; verdict: Verdict }
  | { kind: 'unavailable'; error: string };

const SYSTEM_PROMPT = `Você é o moderador automático de um aplicativo de chat e voz usado por grupos de amigos (parecido com um servidor de Discord). Cada envio chega antes de ser publicado; você decide se ele pode ir ao ar.

Responda somente com o JSON pedido.

Julgue SÓ o envio a analisar. As últimas mensagens servem apenas para entender o tom e a quem o envio se dirige; nunca barre um envio inofensivo por causa do que alguém disse antes. "ai", "kkk", "sim", um emoji, uma pergunta comum ou um convite para outro servidor são "allow", não importa o histórico.

Decisões:
- "allow": publica. É o padrão, na dúvida também. Conversa entre amigos tem palavrão, zoeira, xingamento entre eles, apelidos, discussão acalorada, humor ácido, provocação de jogo e links; nada disso é motivo para barrar. Brincadeira que poderia ser lida como ofensa também passa.
- "block": NÃO publica. Só quando o próprio envio é claramente grave: conteúdo sexual envolvendo menores (sempre), nudez ou pornografia explícita, gore/violência gráfica real, ameaça crível de violência contra alguém, incitação a ódio contra grupo (raça, religião, orientação, etnia, deficiência), doxxing (endereço, telefone, documento de alguém), golpe/phishing ou malware evidentes, venda de drogas/armas/ilegais, incentivo a autoagressão ou suicídio, spam massivo.
- "review": NÃO publica e manda para os moderadores humanos. Use pouco, só nestes casos: imagem ou vídeo que pode ser nudez, pornografia ou gore mas não dá para afirmar; possível ameaça real ou doxxing sem certeza; conteúdo que as regras do servidor proíbem de forma explícita, quando não está claro. Não use "review" para tom, zoeira, palavrão, discussão, contexto insuficiente ou link.

As regras do servidor valem além destas. Em mensagens diretas, só existe "allow" ou "block" para o que é grave (menores, nudez, gore, ameaça, doxxing).

Imagens e quadros de vídeo: avalie o que aparece neles como parte do envio. Arquivos sem prévia (áudio, documentos) são avaliados pelo nome, tipo e texto que acompanha.

"category" descreve o problema principal ("nenhuma" quando allow). "confidence" é sua certeza na decisão. "reason" explica em uma ou duas frases, em português, para quem modera; em "allow" pode ser curta.`;

const MAX_RECENT = 12;
const MAX_BODY = 4000;
const MAX_IMAGES = 12;
const MAX_FILE_BYTES = 60 * 1024 * 1024;

@Injectable()
export class AiModerationService {
  private readonly log = new Logger('AiModeration');
  private readonly client: Anthropic | null;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly instance: InstanceService,
    private readonly storage: StorageService,
  ) {
    this.client = cfg.ANTHROPIC_API_KEY
      ? new Anthropic({
          apiKey: cfg.ANTHROPIC_API_KEY,
          ...(cfg.MODERATION_AI_BASE_URL ? { baseURL: cfg.MODERATION_AI_BASE_URL } : {}),
          timeout: cfg.MODERATION_AI_TIMEOUT_MS,
          maxRetries: 1,
        })
      : null;
  }

  /** Recurso disponível: chave no ambiente. Ligado de fato depende também do painel (instância). */
  get available(): boolean {
    return this.client !== null;
  }

  get model(): string {
    return this.cfg.MODERATION_AI_MODEL;
  }

  /** Vale para este envio? (instância ligada; DMs só se o painel permitir) */
  async appliesTo(direct: boolean): Promise<boolean> {
    if (!this.client) return false;
    const row = await this.instance.row();
    if (row && !row.aiModeration) return false;
    if (direct) return row?.aiModerationDms ?? false;
    return true;
  }

  /** Bloqueio automático (painel): suspender a conta e, opcionalmente, bloquear o aparelho/IP. */
  async autoBlockPolicy(): Promise<{ enabled: boolean; device: boolean }> {
    const row = await this.instance.row();
    return { enabled: row?.aiAutoBlock ?? false, device: row?.aiAutoBlockDevice ?? false };
  }

  /** Classifica um envio. Nunca lança: falhas viram `unavailable` (quem chama decide fail-open/closed). */
  async classify(input: ModerationInput): Promise<ModerationResult> {
    if (!this.client) return { kind: 'allow', verdict: null };
    // links não passam pela IA (pedido do mantenedor, 2026-11-03): mensagem só com link(s) e sem anexo publica direto
    if (onlyLinks(input.body) && !input.attachments.length) return { kind: 'allow', verdict: null };
    try {
      const images = await this.collectImages(input.attachments);
      const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text: this.describe(input) }];
      for (const img of images) {
        content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } });
      }
      const res = await this.client.messages.parse({
        model: this.cfg.MODERATION_AI_MODEL,
        max_tokens: 400,
        // sem raciocínio longo: classificação curta, barata e previsível
        output_config: { effort: 'low', format: zodOutputFormat(VerdictSchema) },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content }],
      });
      if (res.stop_reason === 'refusal') {
        // o próprio modelo se recusou a olhar: conteúdo provavelmente grave; vai para os humanos
        return {
          kind: 'review',
          verdict: {
            decision: 'review',
            category: 'outro',
            confidence: 0.5,
            reason: 'A IA se recusou a analisar este envio; confira manualmente.',
          },
        };
      }
      const v = res.parsed_output;
      if (!v) return { kind: 'unavailable', error: 'resposta da IA sem o formato esperado' };
      if (v.decision === 'allow') return { kind: 'allow', verdict: v };
      if (input.direct) {
        // DM: nunca retém para revisão; bloqueia só o grave com certeza alta, o resto publica
        const grave = DM_BLOCK_CATEGORIES.has(v.category) && v.confidence >= DM_MIN_CONFIDENCE;
        return grave ? { kind: 'block', verdict: { ...v, decision: 'block' } } : { kind: 'allow', verdict: v };
      }
      return { kind: v.decision, verdict: v };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`moderação indisponível: ${msg}`);
      return { kind: 'unavailable', error: msg };
    }
  }

  get failClosed(): boolean {
    return this.cfg.MODERATION_AI_FAIL_CLOSED;
  }

  private describe(i: ModerationInput): string {
    const lines: string[] = [];
    lines.push(i.direct ? 'Destino: mensagem direta entre pessoas.' : `Servidor: ${i.serverName ?? '?'}`);
    if (!i.direct && i.channelName)
      lines.push(`Canal: #${i.channelName}${i.channelTopic ? ` — ${i.channelTopic}` : ''}`);
    if (!i.direct && i.serverRules?.trim()) lines.push(`Regras do servidor:\n${i.serverRules.trim()}`);
    if (i.recent.length) {
      lines.push('Últimas mensagens do canal (da mais antiga para a mais nova):');
      for (const m of i.recent.slice(-MAX_RECENT)) {
        const extra = m.attachments ? ` [${m.attachments} anexo(s)]` : '';
        lines.push(`- ${m.author}: ${m.body.slice(0, 300)}${extra}`);
      }
    }
    lines.push('');
    lines.push(i.editing ? 'Envio a analisar (edição de mensagem publicada):' : 'Envio a analisar:');
    lines.push(`Autor: ${i.authorName}`);
    lines.push(`Texto: ${i.body ? i.body.slice(0, MAX_BODY) : '(sem texto)'}`);
    if (i.attachments.length) {
      lines.push('Anexos:');
      for (const a of i.attachments) lines.push(`- ${a.name} (${a.mime}, ${Math.round(a.sizeBytes / 1024)} KB)`);
      lines.push('As imagens a seguir são os anexos de imagem e quadros dos vídeos, nesta ordem.');
    }
    return lines.join('\n');
  }

  private async collectImages(atts: ModerationInput['attachments']): Promise<ImageInput[]> {
    const out: ImageInput[] = [];
    for (const a of atts) {
      if (out.length >= MAX_IMAGES) break;
      const isImage = a.mime.startsWith('image/');
      const isVideo = a.mime.startsWith('video/');
      if (!isImage && !isVideo) continue;
      if (a.sizeBytes > MAX_FILE_BYTES) continue;
      let data: Buffer;
      try {
        data = await this.readAll(a.storageKey);
      } catch (e) {
        this.log.warn(`anexo ${a.id} ilegível para moderação: ${String(e)}`);
        continue;
      }
      if (isImage) {
        const img = await imageForModel(data, a.mime);
        if (img) out.push(img);
      } else {
        for (const f of await videoFrames(data, a.mime === 'video/webm' ? 'webm' : 'mp4')) {
          if (out.length >= MAX_IMAGES) break;
          out.push(f);
        }
      }
    }
    return out;
  }

  private async readAll(key: string): Promise<Buffer> {
    const stream = await this.storage.read(key);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
  }
}

/** Texto feito só de links http(s) (um ou mais, separados por espaço ou quebra de linha). */
export function onlyLinks(body: string): boolean {
  const parts = body.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 && parts.every((p) => /^<?https?:\/\/\S+>?$/i.test(p));
}
