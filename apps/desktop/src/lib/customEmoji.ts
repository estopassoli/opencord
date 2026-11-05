/**
 * Emojis personalizados (ADR-0050): no texto e nas reações viram `<:nome:id>` (ou `<a:nome:id>` se animado). Quem
 * escreve `:nome:` no compositor tem o código trocado pelo token ao enviar. Funções puras (testadas sem o app).
 */
import { CUSTOM_EMOJI_TOKEN, type CustomEmoji } from '@opencord/contracts';

export const emojiToken = (e: CustomEmoji) => `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;

/** o texto inteiro é um token? (reações) */
export function parseEmojiToken(s: string): CustomEmoji | null {
  const m = new RegExp(`^${CUSTOM_EMOJI_TOKEN.source}$`).exec(s);
  return m ? { animated: m[1] === 'a', name: m[2]!, id: m[3]! } : null;
}

const SHORTCODE = /(?<![<\w]|<a):([A-Za-z0-9_]{2,24}):(?![0-9a-f]{8}-)/g;

/** troca `:nome:` pelo token do emoji (fora de `código`); nomes que `pick` não conhece ficam como estão */
export function resolveShortcodes(text: string, pick: (name: string) => CustomEmoji | undefined): string {
  // pedaços ímpares do split por crases estão dentro de código
  return text
    .split(/(`+[^`]*`+)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(SHORTCODE, (whole, name: string) => {
            const e = pick(name);
            return e ? emojiToken(e) : whole;
          }),
    )
    .join('');
}

/** mensagem só com emojis personalizados (até 27) e espaços: mostra grande */
export function onlyCustomEmojis(text: string): boolean {
  const re = new RegExp(CUSTOM_EMOJI_TOKEN.source, 'g');
  const tokens = text.match(re);
  return Boolean(tokens && tokens.length <= 27 && text.replace(re, '').trim() === '');
}

/** busca por nome: primeiro no servidor aberto, depois nos outros servidores da pessoa */
export function emojiPicker(
  current: CustomEmoji[] | undefined,
  others: (CustomEmoji[] | undefined)[],
): (name: string) => CustomEmoji | undefined {
  const map = new Map<string, CustomEmoji>();
  for (const list of [...others].reverse()) for (const e of list ?? []) map.set(e.name.toLowerCase(), e);
  for (const e of current ?? []) map.set(e.name.toLowerCase(), e);
  return (name) => map.get(name.toLowerCase());
}
