import type { ActionRow, Button, Modal, SelectMenu, SelectOption, TextInput } from '@opencord/contracts';
import { ButtonStyle, ComponentType, Limits, TextInputStyle, type ComponentTypeValue } from '../constants.js';

type ButtonStyleValue = Button['style'];
type SelectKind = SelectMenu['kind'];
type TextInputStyleValue = TextInput['style'];

/** `ButtonStyle.Primary`, a string do contrato ou o número que a comunidade conhece (1 = Primary … 5 = Link) */
export type ButtonStyleResolvable = ButtonStyleValue | 1 | 2 | 3 | 4 | 5;
export type TextInputStyleResolvable = TextInputStyleValue | 1 | 2;
export type EmojiResolvable = string | { name: string; id?: string | null };

const BUTTON_STYLES: readonly ButtonStyleValue[] = ['primary', 'secondary', 'success', 'danger', 'link'];
const HTTP_RE = /^https?:\/\/\S+$/i;

function resolveButtonStyle(style: ButtonStyleResolvable): ButtonStyleValue {
  if (typeof style === 'number') {
    const s = BUTTON_STYLES[style - 1];
    if (!s) throw new RangeError(`estilo de botão inválido: ${style}`);
    return s;
  }
  if (!BUTTON_STYLES.includes(style)) throw new RangeError(`estilo de botão inválido: "${String(style)}"`);
  return style;
}
function resolveEmoji(emoji: EmojiResolvable): string {
  const name = typeof emoji === 'string' ? emoji : emoji.name;
  if (!name?.trim() || name.length > 64) throw new Error('emoji inválido (1 a 64 caracteres)');
  return name;
}
function checkCustomId(kind: string, id: string | undefined): string {
  if (!id || id.length > Limits.customId)
    throw new Error(`${kind}: customId obrigatório (até ${Limits.customId} caracteres)`);
  return id;
}

export interface ButtonData {
  style: ButtonStyleValue;
  label?: string;
  emoji?: string;
  customId?: string;
  url?: string;
  disabled: boolean;
}

/** Botão: `setCustomId` + `setStyle(ButtonStyle.Primary)` (ou `setURL` com `ButtonStyle.Link`). */
export class ButtonBuilder {
  readonly data: ButtonData = { style: 'secondary', disabled: false };

  constructor(data: Partial<ButtonData & { style: ButtonStyleResolvable }> = {}) {
    const { style, ...rest } = data;
    Object.assign(this.data, rest);
    if (style !== undefined) this.setStyle(style);
  }
  static from(data: Button | ButtonBuilder) {
    return new ButtonBuilder(data instanceof ButtonBuilder ? data.data : data);
  }

  setCustomId(customId: string) {
    this.data.customId = customId;
    return this;
  }
  setLabel(label: string) {
    this.data.label = label;
    return this;
  }
  setStyle(style: ButtonStyleResolvable) {
    this.data.style = resolveButtonStyle(style);
    return this;
  }
  setEmoji(emoji: EmojiResolvable) {
    this.data.emoji = resolveEmoji(emoji);
    return this;
  }
  setURL(url: string) {
    this.data.url = url;
    return this;
  }
  setDisabled(disabled = true) {
    this.data.disabled = disabled;
    return this;
  }

  toJSON(): Button {
    const d = this.data;
    if (!d.label?.trim() && !d.emoji) throw new Error('botão precisa de label ou emoji');
    if (d.label && d.label.length > Limits.buttonLabel)
      throw new Error(`botão: label até ${Limits.buttonLabel} caracteres`);
    const out: Button = { type: 'button', style: d.style, disabled: d.disabled };
    if (d.label !== undefined) out.label = d.label;
    if (d.emoji !== undefined) out.emoji = d.emoji;
    if (d.style === 'link') {
      if (!d.url || !HTTP_RE.test(d.url)) throw new Error('botão de link precisa de uma URL http(s) (setURL)');
      if (d.customId) throw new Error('botão de link não tem customId');
      out.url = d.url;
    } else {
      if (d.url) throw new Error('só botões de link (ButtonStyle.Link) têm URL');
      out.customId = checkCustomId('botão', d.customId);
    }
    return out;
  }
}

export interface SelectMenuOptionData {
  label: string;
  value: string;
  description?: string;
  emoji?: string;
  default: boolean;
}

/** Uma opção de menu de texto. */
export class StringSelectMenuOptionBuilder {
  readonly data: Partial<SelectMenuOptionData> = { default: false };
  constructor(data: Partial<SelectMenuOptionData> = {}) {
    Object.assign(this.data, data);
  }
  setLabel(label: string) {
    this.data.label = label;
    return this;
  }
  setValue(value: string) {
    this.data.value = value;
    return this;
  }
  setDescription(description: string) {
    this.data.description = description;
    return this;
  }
  setEmoji(emoji: EmojiResolvable) {
    this.data.emoji = resolveEmoji(emoji);
    return this;
  }
  setDefault(isDefault = true) {
    this.data.default = isDefault;
    return this;
  }
  toJSON(): SelectOption {
    const d = this.data;
    if (!d.label?.trim() || d.label.length > 100)
      throw new Error('opção de menu: label obrigatório (até 100 caracteres)');
    if (!d.value || d.value.length > 100)
      throw new Error(`opção de menu "${d.label}": value obrigatório (até 100 caracteres)`);
    if (d.description && d.description.length > 100)
      throw new Error(`opção de menu "${d.label}": description até 100 caracteres`);
    const out: SelectOption = { label: d.label, value: d.value, default: d.default ?? false };
    if (d.description !== undefined) out.description = d.description;
    if (d.emoji !== undefined) out.emoji = d.emoji;
    return out;
  }
}
export type SelectMenuOptionLike = StringSelectMenuOptionBuilder | Partial<SelectMenuOptionData>;

export interface SelectMenuData {
  customId?: string;
  placeholder?: string;
  minValues: number;
  maxValues: number;
  disabled: boolean;
}

abstract class BaseSelectMenuBuilder {
  readonly data: SelectMenuData = { minValues: 1, maxValues: 1, disabled: false };
  abstract readonly kind: SelectKind;

  setCustomId(customId: string) {
    this.data.customId = customId;
    return this;
  }
  setPlaceholder(placeholder: string) {
    this.data.placeholder = placeholder;
    return this;
  }
  setMinValues(min: number) {
    this.data.minValues = min;
    return this;
  }
  setMaxValues(max: number) {
    this.data.maxValues = max;
    return this;
  }
  setDisabled(disabled = true) {
    this.data.disabled = disabled;
    return this;
  }
  protected base(options: SelectOption[]): SelectMenu {
    const d = this.data;
    if (d.placeholder && d.placeholder.length > 150) throw new Error('menu: placeholder até 150 caracteres');
    if (d.minValues < 0 || d.maxValues < 1 || d.maxValues > 25 || d.minValues > d.maxValues)
      throw new Error('menu: minValues ≥ 0, maxValues de 1 a 25 e minValues ≤ maxValues');
    const out: SelectMenu = {
      type: 'select',
      customId: checkCustomId('menu', d.customId),
      kind: this.kind,
      minValues: d.minValues,
      maxValues: d.maxValues,
      options,
      disabled: d.disabled,
    };
    if (d.placeholder !== undefined) out.placeholder = d.placeholder;
    return out;
  }
  abstract toJSON(): SelectMenu;
}

/** Menu com opções fixas (`addOptions({ label, value })`). */
export class StringSelectMenuBuilder extends BaseSelectMenuBuilder {
  readonly kind = 'string' as const;
  readonly options: StringSelectMenuOptionBuilder[] = [];

  constructor(data: Partial<SelectMenuData> & { options?: SelectMenuOptionLike[] } = {}) {
    super();
    const { options, ...rest } = data;
    Object.assign(this.data, rest);
    if (options) this.addOptions(...options);
  }
  addOptions(...options: (SelectMenuOptionLike | SelectMenuOptionLike[])[]) {
    for (const o of options.flat())
      this.options.push(o instanceof StringSelectMenuOptionBuilder ? o : new StringSelectMenuOptionBuilder(o));
    if (this.options.length > Limits.selectOptions) throw new Error(`menu: até ${Limits.selectOptions} opções`);
    return this;
  }
  setOptions(...options: (SelectMenuOptionLike | SelectMenuOptionLike[])[]) {
    this.options.length = 0;
    return this.addOptions(...options);
  }
  spliceOptions(index: number, deleteCount: number, ...options: SelectMenuOptionLike[]) {
    this.options.splice(
      index,
      deleteCount,
      ...options.map((o) => (o instanceof StringSelectMenuOptionBuilder ? o : new StringSelectMenuOptionBuilder(o))),
    );
    return this;
  }
  toJSON(): SelectMenu {
    const options = this.options.map((o) => o.toJSON());
    if (!options.length) throw new Error('menu de texto precisa de ao menos uma opção');
    if (new Set(options.map((o) => o.value)).size !== options.length) throw new Error('menu: value repetido');
    return this.base(options);
  }
}

/** Menus em que o app lista pessoas, cargos ou canais do servidor (sem opções fixas). */
abstract class EntitySelectMenuBuilder extends BaseSelectMenuBuilder {
  constructor(data: Partial<SelectMenuData> = {}) {
    super();
    Object.assign(this.data, data);
  }
  toJSON(): SelectMenu {
    return this.base([]);
  }
}
export class UserSelectMenuBuilder extends EntitySelectMenuBuilder {
  readonly kind = 'user' as const;
  /** aceito e ignorado (o app não pré-seleciona) */
  setDefaultUsers(..._ids: (string | string[])[]) {
    return this;
  }
}
export class RoleSelectMenuBuilder extends EntitySelectMenuBuilder {
  readonly kind = 'role' as const;
  setDefaultRoles(..._ids: (string | string[])[]) {
    return this;
  }
}
export class ChannelSelectMenuBuilder extends EntitySelectMenuBuilder {
  readonly kind = 'channel' as const;
  /** aceito e ignorado: o app lista todos os canais que a pessoa vê */
  addChannelTypes(..._types: unknown[]) {
    return this;
  }
  setChannelTypes(..._types: unknown[]) {
    return this;
  }
  setDefaultChannels(..._ids: (string | string[])[]) {
    return this;
  }
}
/** Menus de usuário/cargo/canal (`isAnySelectMenu`). */
export type AnySelectMenuBuilder =
  StringSelectMenuBuilder | UserSelectMenuBuilder | RoleSelectMenuBuilder | ChannelSelectMenuBuilder;

export interface TextInputData {
  customId?: string;
  label?: string;
  style: TextInputStyleValue;
  placeholder?: string;
  value?: string;
  required: boolean;
  minLength?: number;
  maxLength?: number;
}

/** Campo de texto de um modal (`TextInputStyle.Short` ou `Paragraph`). */
export class TextInputBuilder {
  readonly data: TextInputData = { style: 'short', required: true };

  constructor(data: Partial<TextInputData & { style: TextInputStyleResolvable }> = {}) {
    const { style, ...rest } = data;
    Object.assign(this.data, rest);
    if (style !== undefined) this.setStyle(style);
  }
  setCustomId(customId: string) {
    this.data.customId = customId;
    return this;
  }
  setLabel(label: string) {
    this.data.label = label;
    return this;
  }
  setStyle(style: TextInputStyleResolvable) {
    if (style === 1 || style === TextInputStyle.Short) this.data.style = 'short';
    else if (style === 2 || style === TextInputStyle.Paragraph) this.data.style = 'paragraph';
    else throw new RangeError(`estilo de campo inválido: ${String(style)}`);
    return this;
  }
  setPlaceholder(placeholder: string) {
    this.data.placeholder = placeholder;
    return this;
  }
  setValue(value: string) {
    this.data.value = value;
    return this;
  }
  setRequired(required = true) {
    this.data.required = required;
    return this;
  }
  setMinLength(n: number) {
    this.data.minLength = n;
    return this;
  }
  setMaxLength(n: number) {
    this.data.maxLength = n;
    return this;
  }
  toJSON(): TextInput {
    const d = this.data;
    const id = checkCustomId('campo do modal', d.customId);
    if (!d.label?.trim() || d.label.length > Limits.textInputLabel)
      throw new Error(`campo "${id}": label obrigatório (até ${Limits.textInputLabel} caracteres)`);
    if (d.placeholder && d.placeholder.length > 100) throw new Error(`campo "${id}": placeholder até 100 caracteres`);
    if (d.value && d.value.length > Limits.textInputValue)
      throw new Error(`campo "${id}": value até ${Limits.textInputValue} caracteres`);
    if ((d.minLength ?? 0) > (d.maxLength ?? Limits.textInputValue))
      throw new Error(`campo "${id}": minLength > maxLength`);
    const out: TextInput = { type: 'text', customId: id, label: d.label, style: d.style, required: d.required };
    if (d.placeholder !== undefined) out.placeholder = d.placeholder;
    if (d.value !== undefined) out.value = d.value;
    if (d.minLength !== undefined) out.minLength = d.minLength;
    if (d.maxLength !== undefined) out.maxLength = d.maxLength;
    return out;
  }
}

type RowComponentJSON = ActionRow['components'][number];
/** builder ou JSON cru de botão/menu */
export type RowComponentLike = ButtonBuilder | AnySelectMenuBuilder | RowComponentJSON;

function toRowComponent(c: RowComponentLike): RowComponentJSON {
  return 'toJSON' in c && typeof c.toJSON === 'function' ? c.toJSON() : (c as RowComponentJSON);
}

/** Linha de componentes: até 5 botões ou 1 menu. Num modal, as linhas levam `TextInputBuilder`. */
export class ActionRowBuilder<T extends RowComponentLike | TextInputBuilder = RowComponentLike> {
  readonly components: T[] = [];

  constructor(data: { components?: T[] } = {}) {
    if (data.components) this.components.push(...data.components);
  }
  static from<T extends RowComponentLike | TextInputBuilder>(
    row: ActionRow | ActionRowBuilder<T>,
  ): ActionRowBuilder<T> {
    if (row instanceof ActionRowBuilder) return new ActionRowBuilder<T>({ components: [...row.components] });
    return new ActionRowBuilder<T>({ components: row.components as unknown as T[] });
  }
  addComponents(...components: (T | T[])[]) {
    for (const c of components) {
      if (Array.isArray(c)) this.components.push(...(c as T[]));
      else this.components.push(c as T);
    }
    return this;
  }
  setComponents(...components: (T | T[])[]) {
    this.components.length = 0;
    return this.addComponents(...components);
  }
  toJSON(): ActionRow {
    if (!this.components.length) throw new Error('linha de componentes vazia');
    if (this.components.some((c) => c instanceof TextInputBuilder))
      throw new Error('campos de texto só vão em modais (ModalBuilder.addComponents)');
    const components = (this.components as RowComponentLike[]).map(toRowComponent);
    const buttons = components.every((c) => c.type === 'button');
    if (!buttons && components.length !== 1) throw new Error('linha com até 5 botões ou 1 menu');
    if (components.length > Limits.buttonsPerRow) throw new Error(`linha com até ${Limits.buttonsPerRow} botões`);
    return { type: 'row', components };
  }
}

/** builder ou JSON cru de linha */
export type ActionRowLike = ActionRowBuilder<RowComponentLike> | ActionRow;

/** Normaliza builders e JSON para `ActionRow[]` (até 5 linhas, customId único). */
export function resolveComponents(rows: readonly ActionRowLike[] | undefined): ActionRow[] | undefined {
  if (!rows) return undefined;
  if (rows.length > Limits.componentRows) throw new Error(`até ${Limits.componentRows} linhas de componentes`);
  const out = rows.map((r) => (r instanceof ActionRowBuilder ? r.toJSON() : r));
  const ids = out
    .flatMap((r) => r.components.map((c) => ('customId' in c ? c.customId : undefined)))
    .filter((x): x is string => !!x);
  if (new Set(ids).size !== ids.length) throw new Error('customId repetido entre os componentes');
  return out;
}

/** Descobre o tipo do componente com aquele `customId` entre as linhas de uma mensagem. */
export function componentTypeOf(rows: readonly ActionRow[] | undefined, customId: string): ComponentTypeValue | null {
  for (const row of rows ?? []) {
    for (const c of row.components) {
      if (!('customId' in c) || c.customId !== customId) continue;
      if (c.type === 'button') return ComponentType.Button;
      return selectTypeOf(c.kind);
    }
  }
  return null;
}
export function selectTypeOf(kind: SelectKind): ComponentTypeValue {
  return kind === 'user'
    ? ComponentType.UserSelect
    : kind === 'role'
      ? ComponentType.RoleSelect
      : kind === 'channel'
        ? ComponentType.ChannelSelect
        : ComponentType.StringSelect;
}

export interface ModalData {
  customId?: string;
  title?: string;
}
type ModalComponentLike = TextInputBuilder | ActionRowBuilder<TextInputBuilder> | TextInput;

/** Formulário aberto com `interaction.showModal(modal)`; até 5 campos de texto. */
export class ModalBuilder {
  readonly data: ModalData = {};
  readonly components: TextInputBuilder[] = [];

  constructor(data: ModalData & { components?: ModalComponentLike[] } = {}) {
    const { components, ...rest } = data;
    Object.assign(this.data, rest);
    if (components) this.addComponents(...components);
  }
  setCustomId(customId: string) {
    this.data.customId = customId;
    return this;
  }
  setTitle(title: string) {
    this.data.title = title;
    return this;
  }
  /** aceita `TextInputBuilder` direto ou dentro de `ActionRowBuilder` (como a comunidade escreve) */
  addComponents(...components: (ModalComponentLike | ModalComponentLike[])[]) {
    for (const c of components.flat()) {
      if (c instanceof ActionRowBuilder) {
        for (const inner of c.components) {
          if (!(inner instanceof TextInputBuilder)) throw new Error('modal: só campos de texto (TextInputBuilder)');
          this.components.push(inner);
        }
      } else if (c instanceof TextInputBuilder) this.components.push(c);
      else this.components.push(new TextInputBuilder(c));
    }
    if (this.components.length > Limits.modalInputs) throw new Error(`modal: até ${Limits.modalInputs} campos`);
    return this;
  }
  setComponents(...components: (ModalComponentLike | ModalComponentLike[])[]) {
    this.components.length = 0;
    return this.addComponents(...components);
  }
  toJSON(): Modal {
    const d = this.data;
    const customId = checkCustomId('modal', d.customId);
    if (!d.title?.trim() || d.title.length > Limits.modalTitle)
      throw new Error(`modal "${customId}": título obrigatório (até ${Limits.modalTitle} caracteres)`);
    if (!this.components.length) throw new Error(`modal "${customId}": ao menos um campo`);
    const components = this.components.map((c) => c.toJSON());
    if (new Set(components.map((c) => c.customId)).size !== components.length)
      throw new Error(`modal "${customId}": customId repetido`);
    return { customId, title: d.title, components };
  }
}
export type ModalLike = ModalBuilder | Modal;
export function resolveModal(modal: ModalLike): Modal {
  return modal instanceof ModalBuilder ? modal.toJSON() : modal;
}

export { ButtonStyle, TextInputStyle };
