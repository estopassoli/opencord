/**
 * Botão de emojis para qualquer caixa de texto controlada: abre o seletor e põe o emoji onde está o cursor (ou no
 * lugar do trecho selecionado), respeitando o maxLength da caixa. Personalizados entram como `:nome:` com espaço.
 */
import { Icon } from '@opencord/ui';
import { useRef, useState, type RefObject } from 'react';
import { EmojiPicker } from '../features/chat/EmojiPicker';

type Box = HTMLTextAreaElement | HTMLInputElement;

/** insere `text` em `value` na seleção da caixa; devolve o texto novo e onde o cursor fica */
export function insertAtCaret(el: Box | null, value: string, text: string) {
  const start = Math.min(el?.selectionStart ?? value.length, value.length);
  const end = Math.min(el?.selectionEnd ?? start, value.length);
  const before = value.slice(0, start);
  // `:nome:` colado numa palavra não vira emoji
  const ins =
    text.startsWith(':') && before && !/\s$/.test(before) ? ` ${text} ` : text.startsWith(':') ? `${text} ` : text;
  return { next: before + ins + value.slice(end), caret: start + ins.length };
}

export function EmojiButton({
  target,
  value,
  onChange,
  serverId,
  className,
}: {
  target: RefObject<Box | null>;
  value: string;
  onChange: (v: string) => void;
  serverId?: string | undefined;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`icon-btn emoji-btn${className ? ` ${className}` : ''}`}
        aria-label="Emojis"
        aria-expanded={open}
        data-tip="Emojis"
        // não tira o foco (nem a seleção) da caixa ao clicar
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="emoji" />
      </button>
      {open && (
        <EmojiPicker
          serverId={serverId}
          anchor={btn}
          onClose={() => setOpen(false)}
          onPick={(text, keepOpen) => {
            const el = target.current;
            const { next, caret } = insertAtCaret(el, value, text);
            const max = el?.maxLength ?? -1;
            if (max > 0 && next.length > max) return;
            onChange(next);
            if (!keepOpen) setOpen(false);
            requestAnimationFrame(() => {
              const box = target.current;
              if (!box) return;
              if (!keepOpen) box.focus();
              box.setSelectionRange(caret, caret);
            });
          }}
        />
      )}
    </>
  );
}
