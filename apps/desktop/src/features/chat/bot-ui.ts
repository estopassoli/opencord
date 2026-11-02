import type { ButtonStyle, EmbedField, SelectMenu, ServerDetail, TextInput } from '@opencord/contracts';
import type { ButtonVariant, IconName } from '@opencord/ui';

/**
 * Helpers puros da UI de bots v2 (ADR-0034): embeds, componentes e modais. Sem React, para testar à parte.
 */

/** quantos campos `inline` cabem lado a lado numa linha do embed */
export const EMBED_FIELDS_PER_ROW = 3;

/** Campos do embed em linhas: inline seguidos ficam lado a lado (até 3); não-inline ocupa a linha inteira. */
export function groupEmbedFields(fields: EmbedField[]): EmbedField[][] {
  const rows: EmbedField[][] = [];
  for (const f of fields) {
    const last = rows.at(-1);
    if (f.inline && last && last[0]?.inline && last.length < EMBED_FIELDS_PER_ROW) last.push(f);
    else rows.push([f]);
  }
  return rows;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Data do rodapé do embed em pt-BR: "hoje às 14:30", "ontem às 09:12" ou "02/11/2026 14:30". */
export function formatEmbedDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, now)) return `hoje às ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `ontem às ${time}`;
  return `${d.toLocaleDateString('pt-BR')} ${time}`;
}

/** Estilo do botão do bot → variante do kit (`link` é um <a>, tratado à parte). */
export function buttonVariant(style: ButtonStyle | undefined): ButtonVariant {
  switch (style) {
    case 'primary':
      return 'primary';
    case 'success':
      return 'success';
    case 'danger':
      return 'danger';
    default:
      return 'secondary';
  }
}

/** opção de um menu de seleção já pronta para a lista (texto fixo ou membro/cargo/canal do servidor) */
export interface SelectChoice {
  value: string;
  label: string;
  description?: string;
  emoji?: string;
  /** bolinha de cor (cargo) */
  color?: string | null;
  icon?: IconName;
}

/** Opções de um menu: as do bot (`string`) ou membros/cargos/canais de texto do servidor (`user|role|channel`). */
export function selectChoices(
  menu: Pick<SelectMenu, 'kind' | 'options'>,
  detail: Pick<ServerDetail, 'members' | 'roles' | 'channels'> | undefined,
  nameOf?: (id: string) => string,
): SelectChoice[] {
  switch (menu.kind ?? 'string') {
    case 'user':
      return (detail?.members ?? [])
        .map((m) => {
          const alias = nameOf?.(m.user.id);
          return {
            value: m.user.id,
            label: alias && alias !== 'alguém' ? alias : (m.nickname ?? m.user.displayName),
            description: m.user.bot ? `@${m.user.username} · app` : `@${m.user.username}`,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
    case 'role':
      return [...(detail?.roles ?? [])]
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ value: r.id, label: r.name, color: r.color }));
    case 'channel':
      return (detail?.channels ?? [])
        .filter((c) => c.kind === 'text')
        .sort((a, b) => a.position - b.position)
        .map((c) => ({ value: c.id, label: c.name, icon: 'hashtag' as const }));
    default:
      return (menu.options ?? []).map((o) => ({
        value: o.value,
        label: o.label,
        ...(o.description ? { description: o.description } : {}),
        ...(o.emoji ? { emoji: o.emoji } : {}),
      }));
  }
}

/** Alterna um valor na seleção respeitando `maxValues` (seleção única troca; múltipla marca/desmarca). */
export function toggleSelection(selected: string[], value: string, maxValues: number): string[] {
  if (maxValues <= 1) return selected.includes(value) ? [] : [value];
  if (selected.includes(value)) return selected.filter((v) => v !== value);
  if (selected.length >= maxValues) return selected;
  return [...selected, value];
}

/** Texto curto do que está escolhido no menu ("Ana, Bia" ou "3 selecionados"). */
export function selectionSummary(selected: string[], choices: SelectChoice[], max = 2): string {
  const labels = selected.map((v) => choices.find((c) => c.value === v)?.label ?? v);
  if (labels.length <= max) return labels.join(', ');
  return `${labels.length} selecionados`;
}

/** Erros de validação local de um modal (campo → mensagem); vazio = pode enviar. */
export function validateModalFields(fields: TextInput[], values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const raw = values[f.customId] ?? '';
    const required = f.required ?? true;
    if (required && !raw.trim()) errors[f.customId] = 'Preencha este campo.';
    else if (raw && f.minLength !== undefined && raw.length < f.minLength)
      errors[f.customId] = `Mínimo de ${f.minLength} ${f.minLength === 1 ? 'caractere' : 'caracteres'}.`;
    else if (f.maxLength !== undefined && raw.length > f.maxLength)
      errors[f.customId] = `Máximo de ${f.maxLength} caracteres.`;
  }
  return errors;
}

/** Contador/dica de tamanho de um campo do modal ("12/200", "mín. 10 caracteres") ou null se não há limite. */
export function lengthHint(field: Pick<TextInput, 'minLength' | 'maxLength'>, length: number): string | null {
  if (field.maxLength !== undefined) return `${length}/${field.maxLength}`;
  if (field.minLength !== undefined && field.minLength > 0) return `mín. ${field.minLength} caracteres`;
  return null;
}
