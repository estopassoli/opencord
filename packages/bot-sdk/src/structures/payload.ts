import { randomUUID } from 'node:crypto';
import type { ActionRow, Embed, Message as MessageDto } from '@opencord/contracts';
import type { Client } from '../client.js';
import { toAttachmentBuilder, type FileResolvable } from '../builders/attachment.js';
import { resolveComponents, type ActionRowLike } from '../builders/components.js';
import { Limits } from '../constants.js';
import { resolveEmbeds, type EmbedLike } from '../embed.js';
import { Message } from './message.js';

export interface PollCreateOptions {
  question: string | { text: string };
  answers: ({ text: string } | string)[];
  allowMultiselect?: boolean;
  /** prazo em horas: 0 (sem prazo), 1, 4, 8, 24 (padrão), 72 ou 168 */
  duration?: number;
}

export interface MessageCreateOptions {
  content?: string;
  embeds?: EmbedLike[];
  /** linhas de botões/menus (`ActionRowBuilder`) */
  components?: ActionRowLike[];
  /** arquivos: `AttachmentBuilder`, Buffer, caminho, URL, stream ou `{ attachment, name }` (sobem em `POST /attachments`) */
  files?: FileResolvable[];
  /** responder a uma mensagem (id ou a própria mensagem) */
  reply?: { messageReference: string | { id: string }; failIfNotExists?: boolean };
  /** enquete (vira `POST /channels/:id/polls`) */
  poll?: PollCreateOptions;
  /** aceitos e ignorados */
  allowedMentions?: unknown;
  tts?: boolean;
  nonce?: unknown;
  flags?: number;
}
export type MessagePayload = string | MessageCreateOptions;

export interface MessageEditOptions {
  content?: string | null;
  embeds?: EmbedLike[];
  /** `[]` tira os botões */
  components?: ActionRowLike[];
  /** não há como trocar anexos numa edição (EditMessageRequest): lança erro claro */
  files?: FileResolvable[];
  attachments?: unknown;
  allowedMentions?: unknown;
  flags?: number;
}
export type MessageEditPayload = string | MessageEditOptions;

export function toOptions(payload: MessagePayload): MessageCreateOptions {
  return typeof payload === 'string' ? { content: payload } : { ...payload };
}

/** Sobe cada arquivo em `POST /attachments` e devolve os ids, na ordem. */
export async function uploadFiles(
  client: Client,
  files: readonly FileResolvable[] | undefined,
): Promise<string[] | undefined> {
  if (!files?.length) return undefined;
  if (files.length > Limits.attachments) throw new Error(`até ${Limits.attachments} anexos por mensagem`);
  const ids: string[] = [];
  for (const f of files) {
    const file = await toAttachmentBuilder(f).toFile();
    const att = await client.rest.upload(file);
    ids.push(att.id);
  }
  return ids;
}

export interface MessageBody {
  requestId: string;
  body: string;
  replyToId?: string;
  attachmentIds?: string[];
  embeds?: Embed[];
  components?: ActionRow[];
}

function checkContent(content: string | undefined | null): string {
  const body = content ?? '';
  if (body.length > Limits.messageBody) throw new Error(`mensagem com mais de ${Limits.messageBody} caracteres`);
  return body;
}

/** Monta o corpo de `POST /channels/:id/messages` (sobe os arquivos antes). */
export async function buildMessageBody(client: Client, payload: MessagePayload): Promise<MessageBody> {
  const o = toOptions(payload);
  const body = checkContent(o.content);
  const embeds = resolveEmbeds(o.embeds);
  const components = resolveComponents(o.components);
  const attachmentIds = await uploadFiles(client, o.files);
  if (!body.trim() && !embeds?.length && !attachmentIds?.length)
    throw new Error('mensagem vazia: informe content, embeds ou files');
  const ref = o.reply?.messageReference;
  const replyToId = typeof ref === 'string' ? ref : ref?.id;
  const out: MessageBody = { requestId: randomUUID(), body };
  if (replyToId) out.replyToId = replyToId;
  if (attachmentIds) out.attachmentIds = attachmentIds;
  if (embeds) out.embeds = embeds;
  if (components) out.components = components;
  return out;
}

export interface EditBody {
  body?: string;
  embeds?: Embed[];
  components?: ActionRow[];
}

/** Monta o corpo de `PATCH /messages/:id` (só o que veio muda). */
export function buildEditBody(payload: MessageEditPayload): EditBody {
  const o: MessageEditOptions = typeof payload === 'string' ? { content: payload } : payload;
  if (o.files?.length) throw new Error('não dá para acrescentar anexos ao editar: envie uma nova mensagem com files');
  const out: EditBody = {};
  if (o.content !== undefined) out.body = checkContent(o.content);
  const embeds = resolveEmbeds(o.embeds);
  if (embeds) out.embeds = embeds;
  const components = resolveComponents(o.components);
  if (components) out.components = components;
  if (out.body === undefined && out.embeds === undefined && out.components === undefined)
    throw new Error('nada para editar: informe content, embeds ou components');
  if (out.body !== undefined && !out.body.trim() && !out.embeds?.length)
    throw new Error('mensagem vazia: informe content ou embeds');
  return out;
}

export type MessageTarget = { channelId: string } | { conversationId: string };

function pollBody(poll: PollCreateOptions) {
  const question = typeof poll.question === 'string' ? poll.question : poll.question.text;
  const options = poll.answers.map((a) => (typeof a === 'string' ? a : a.text));
  if (options.length < 2 || options.length > Limits.pollOptions)
    throw new Error(`enquete: de 2 a ${Limits.pollOptions} respostas`);
  const durationHours = poll.duration ?? 24;
  if (!(Limits.pollDurations as readonly number[]).includes(durationHours))
    throw new Error(`enquete: duração em horas precisa ser uma de ${Limits.pollDurations.join(', ')}`);
  return { requestId: randomUUID(), question, options, multiple: poll.allowMultiselect ?? false, durationHours };
}

/** Cria uma mensagem (ou enquete) num canal (`channelId`) ou numa conversa direta (`conversationId`). */
export async function sendMessage(client: Client, target: MessageTarget, payload: MessagePayload): Promise<Message> {
  const base = 'channelId' in target ? `/channels/${target.channelId}` : `/conversations/${target.conversationId}`;
  const o = toOptions(payload);
  if (o.poll) {
    const dto = await client.rest.post<MessageDto>(`${base}/polls`, pollBody(o.poll));
    return new Message(client, dto);
  }
  const dto = await client.rest.post<MessageDto>(`${base}/messages`, await buildMessageBody(client, payload));
  return new Message(client, dto);
}
