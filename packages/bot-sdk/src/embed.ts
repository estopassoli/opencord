export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface EmbedData {
  title?: string;
  description?: string;
  url?: string;
  fields: EmbedField[];
  footer?: { text: string };
  image?: { url: string };
  thumbnail?: { url: string };
  author?: { name: string; url?: string };
  timestamp?: string;
}

/**
 * Embeds não existem no OpenCord: a mensagem é markdown. O builder guarda os mesmos campos e `toMarkdown()` produz
 * um bloco que o app renderiza (negrito, itálico, links, listas, citação). Cor é aceita e ignorada.
 */
export class EmbedBuilder {
  readonly data: EmbedData = { fields: [] };

  constructor(data: Partial<EmbedData> = {}) {
    Object.assign(this.data, data, { fields: [...(data.fields ?? [])] });
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
  /** sem efeito: mensagens não têm cor */
  setColor(_color: unknown) {
    return this;
  }
  addFields(...fields: EmbedField[]) {
    for (const f of fields) {
      if (!f.name?.trim() || !f.value?.trim()) throw new Error('campo do embed precisa de name e value');
      this.data.fields.push({ name: f.name, value: f.value, inline: f.inline });
    }
    return this;
  }
  setFields(...fields: EmbedField[]) {
    this.data.fields = [];
    return this.addFields(...fields);
  }
  setFooter(footer: { text: string } | null) {
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
  setAuthor(author: { name: string; url?: string } | null) {
    this.data.author = author ?? undefined;
    return this;
  }
  setTimestamp(at: Date | number | null = new Date()) {
    this.data.timestamp = at == null ? undefined : new Date(at).toISOString();
    return this;
  }

  toJSON(): EmbedData {
    return { ...this.data, fields: [...this.data.fields] };
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

export type EmbedLike = EmbedBuilder | Partial<EmbedData>;

/** Junta conteúdo e embeds num único texto (o que a API aceita). */
export function composeContent(content: string | undefined, embeds: EmbedLike[] | undefined): string {
  const parts: string[] = [];
  if (content?.trim()) parts.push(content);
  for (const e of embeds ?? []) parts.push((e instanceof EmbedBuilder ? e : new EmbedBuilder(e)).toMarkdown());
  const out = parts.join('\n\n');
  if (!out.trim()) throw new Error('mensagem vazia: informe content ou ao menos um embed');
  return out;
}
