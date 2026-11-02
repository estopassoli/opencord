import type { Embed } from '@opencord/contracts';
import { Colors, Limits, type ColorName } from './constants.js';

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}
export interface EmbedFooterOptions {
  text: string;
  /** ícone ao lado do rodapé (nome usual) */
  iconURL?: string;
  /** o mesmo, no nome do contrato */
  iconUrl?: string;
}
export interface EmbedAuthorOptions {
  name: string;
  url?: string;
  iconURL?: string;
  iconUrl?: string;
}

export interface EmbedData {
  title?: string;
  description?: string;
  url?: string;
  /** `#rrggbb` */
  color?: string;
  fields: EmbedField[];
  footer?: EmbedFooterOptions;
  image?: { url: string };
  thumbnail?: { url: string };
  author?: EmbedAuthorOptions;
  timestamp?: string;
}

/** número `0xRRGGBB`, `'#rrggbb'`, `[r, g, b]`, nome de `Colors` (`'Red'`) ou `'Random'`; `null` tira a cor */
export type ColorResolvable = number | string | readonly [number, number, number] | null;

const HEX_RE = /^#?([0-9a-f]{6})$/i;

/** Converte qualquer forma de cor aceita para `#rrggbb`. */
export function resolveColor(color: ColorResolvable): string | undefined {
  if (color === null || color === undefined) return undefined;
  if (typeof color === 'number') {
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff)
      throw new RangeError(`cor fora de 0x000000–0xffffff: ${color}`);
    return `#${color.toString(16).padStart(6, '0')}`;
  }
  if (Array.isArray(color)) {
    const [r, g, b] = color as readonly [number, number, number];
    for (const c of [r, g, b])
      if (!Number.isInteger(c) || c < 0 || c > 255) throw new RangeError('cor RGB: componentes de 0 a 255');
    return resolveColor((r << 16) | (g << 8) | b);
  }
  const s = String(color);
  if (s === 'Random') return resolveColor(Math.floor(Math.random() * 0x1000000));
  const hex = HEX_RE.exec(s);
  if (hex) return `#${hex[1]!.toLowerCase()}`;
  if (s in Colors) return Colors[s as ColorName];
  const upper = s.charAt(0).toUpperCase() + s.slice(1);
  if (upper in Colors) return Colors[upper as ColorName];
  throw new RangeError(`cor desconhecida: "${s}" (use 0xRRGGBB, '#rrggbb' ou um nome de Colors)`);
}

/**
 * Cartão rico numa mensagem (ADR-0034): `toJSON()` devolve o `Embed` do contrato (barra colorida, autor, título com
 * link, campos, imagem, miniatura, rodapé com data). `toMarkdown()` continua existindo para quem quer texto puro.
 */
export class EmbedBuilder {
  readonly data: EmbedData = { fields: [] };

  constructor(data: Partial<EmbedData> = {}) {
    Object.assign(this.data, data, { fields: [...(data.fields ?? [])] });
    if (typeof data.color === 'string' || typeof data.color === 'number') this.data.color = resolveColor(data.color);
  }

  static from(data: Partial<EmbedData> | EmbedBuilder) {
    return new EmbedBuilder(data instanceof EmbedBuilder ? data.toJSON() : data);
  }

  setTitle(title: string | null) {
    this.data.title = title ?? undefined;
    return this;
  }
  setDescription(description: string | null) {
    this.data.description = description ?? undefined;
    return this;
  }
  setURL(url: string | null) {
    this.data.url = url ?? undefined;
    return this;
  }
  /** cor da barra lateral: `0xff0000`, `'#ff0000'`, `'Red'`, `[255, 0, 0]`; `null` tira */
  setColor(color: ColorResolvable) {
    this.data.color = resolveColor(color);
    return this;
  }
  addFields(...fields: EmbedField[]) {
    for (const f of fields) {
      if (!f.name?.trim() || !f.value?.trim()) throw new Error('campo do embed precisa de name e value');
      this.data.fields.push({ name: f.name, value: f.value, inline: f.inline });
    }
    if (this.data.fields.length > Limits.embed.fields) throw new Error(`embed: até ${Limits.embed.fields} campos`);
    return this;
  }
  setFields(...fields: EmbedField[]) {
    this.data.fields = [];
    return this.addFields(...fields);
  }
  spliceFields(index: number, deleteCount: number, ...fields: EmbedField[]) {
    this.data.fields.splice(index, deleteCount, ...fields);
    return this;
  }
  setFooter(footer: EmbedFooterOptions | null) {
    this.data.footer = footer ?? undefined;
    return this;
  }
  setImage(url: string | null) {
    this.data.image = url ? { url } : undefined;
    return this;
  }
  setThumbnail(url: string | null) {
    this.data.thumbnail = url ? { url } : undefined;
    return this;
  }
  setAuthor(author: EmbedAuthorOptions | null) {
    this.data.author = author ?? undefined;
    return this;
  }
  setTimestamp(at: Date | number | null = new Date()) {
    this.data.timestamp = at == null ? undefined : new Date(at).toISOString();
    return this;
  }

  /** soma de título, descrição, campos, rodapé e autor (limite 6000) */
  get length() {
    const d = this.data;
    return (
      (d.title?.length ?? 0) +
      (d.description?.length ?? 0) +
      (d.footer?.text.length ?? 0) +
      (d.author?.name.length ?? 0) +
      d.fields.reduce((n, f) => n + f.name.length + f.value.length, 0)
    );
  }

  /** O embed no formato do contrato, validado com os mesmos limites da API. */
  toJSON(): Embed {
    const d = this.data;
    const L = Limits.embed;
    const check = (what: string, v: string | undefined, max: number) => {
      if (v !== undefined && v.length > max) throw new Error(`embed: ${what} com mais de ${max} caracteres`);
    };
    check('título', d.title, L.title);
    check('descrição', d.description, L.description);
    check('rodapé', d.footer?.text, L.footer);
    check('autor', d.author?.name, L.author);
    if (d.fields.length > L.fields) throw new Error(`embed: até ${L.fields} campos`);
    for (const f of d.fields) {
      check('nome de campo', f.name, L.fieldName);
      check('valor de campo', f.value, L.fieldValue);
    }
    if (this.length > L.total) throw new Error(`embed com mais de ${L.total} caracteres`);
    if (d.color !== undefined && !HEX_RE.test(d.color)) throw new Error(`embed: cor "${d.color}" não é #rrggbb`);
    if (!(d.title || d.description || d.fields.length || d.image || d.thumbnail || d.author))
      throw new Error('embed vazio: informe título, descrição, campos, imagem, miniatura ou autor');
    const out: Embed = { fields: d.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline ?? false })) };
    if (d.title !== undefined) out.title = d.title;
    if (d.description !== undefined) out.description = d.description;
    if (d.url !== undefined) out.url = d.url;
    if (d.color !== undefined) out.color = d.color.toLowerCase();
    if (d.footer) {
      out.footer = { text: d.footer.text };
      const icon = d.footer.iconURL ?? d.footer.iconUrl;
      if (icon) out.footer.iconUrl = icon;
    }
    if (d.image) out.image = { url: d.image.url };
    if (d.thumbnail) out.thumbnail = { url: d.thumbnail.url };
    if (d.author) {
      out.author = { name: d.author.name };
      if (d.author.url) out.author.url = d.author.url;
      const icon = d.author.iconURL ?? d.author.iconUrl;
      if (icon) out.author.iconUrl = icon;
    }
    if (d.timestamp !== undefined) out.timestamp = d.timestamp;
    return out;
  }

  /** Markdown que o app renderiza: título em negrito (com link), descrição, campos `**nome**: valor`, rodapé em itálico. */
  toMarkdown(): string {
    const d = this.data;
    const lines: string[] = [];
    if (d.author) lines.push(d.author.url ? `[${d.author.name}](${d.author.url})` : d.author.name);
    if (d.title) lines.push(`**${d.url ? `[${d.title}](${d.url})` : d.title}**`);
    if (d.description) lines.push(d.description);
    for (const f of d.fields) lines.push(`**${f.name}**: ${f.value}`);
    if (d.thumbnail) lines.push(d.thumbnail.url);
    if (d.image) lines.push(d.image.url);
    const footer = [d.footer?.text, d.timestamp ? new Date(d.timestamp).toLocaleString('pt-BR') : null].filter(
      (x): x is string => !!x,
    );
    if (footer.length) lines.push(`_${footer.join(' • ')}_`);
    return lines.join('\n');
  }
}

/** builder, dados do builder ou um `Embed` cru do contrato */
export type EmbedLike = EmbedBuilder | Partial<EmbedData> | Embed;

function toBuilder(e: EmbedLike): EmbedBuilder {
  if (e instanceof EmbedBuilder) return e;
  const d = e as Partial<EmbedData> & {
    footer?: { text: string; iconUrl?: string };
    author?: { name: string; iconUrl?: string };
  };
  return new EmbedBuilder({ ...d, fields: d.fields ?? [] });
}

/** Normaliza builders e objetos para `Embed[]` (até 10). */
export function resolveEmbeds(embeds: readonly EmbedLike[] | undefined): Embed[] | undefined {
  if (!embeds) return undefined;
  if (embeds.length > Limits.embed.perMessage) throw new Error(`até ${Limits.embed.perMessage} embeds por mensagem`);
  return embeds.map((e) => toBuilder(e).toJSON());
}

/** Junta conteúdo e embeds num único texto markdown (como o SDK 0.1 fazia). */
export function composeContent(content: string | undefined, embeds: EmbedLike[] | undefined): string {
  const parts: string[] = [];
  if (content?.trim()) parts.push(content);
  for (const e of embeds ?? []) parts.push(toBuilder(e).toMarkdown());
  const out = parts.join('\n\n');
  if (!out.trim()) throw new Error('mensagem vazia: informe content ou ao menos um embed');
  return out;
}
