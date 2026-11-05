/** Emoji personalizado (ADR-0050): imagem pública da API; se o emoji foi apagado, mostra o `:nome:` em texto. */
import type { CustomEmoji } from '@opencord/contracts';
import { useState } from 'react';
import { parseEmojiToken } from '../lib/customEmoji';
import { useSession } from '../store/session';

export function CustomEmojiImg({ emoji, big }: { emoji: CustomEmoji; big?: boolean }) {
  const base = useSession((s) => s.serverUrl)?.replace(/\/+$/, '');
  const [broken, setBroken] = useState(false);
  if (!base || broken) return <>:{emoji.name}:</>;
  return (
    <img
      className="custom-emoji"
      data-big={big ? 'true' : undefined}
      src={`${base}/emojis/${emoji.id}`}
      alt={`:${emoji.name}:`}
      data-tip={`:${emoji.name}:`}
      draggable={false}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/** emoji comum (texto) ou personalizado (token), como nas reações */
export function EmojiGlyph({ value }: { value: string }) {
  const custom = parseEmojiToken(value);
  return custom ? <CustomEmojiImg emoji={custom} /> : <>{value}</>;
}
