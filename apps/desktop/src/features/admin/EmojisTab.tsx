/**
 * Configurações do servidor › Emoji (ADR-0050): até 50 emojis por servidor, animados para todo mundo (sem plano pago).
 * Quem gerencia o servidor envia, renomeia e apaga; qualquer membro vê a lista. No chat: `:nome:`.
 */
import {
  EMOJI_NAME,
  MAX_SERVER_EMOJIS,
  Permission,
  hasPermission,
  type CustomEmoji,
  type ServerDetail,
} from '@opencord/contracts';
import { Button, Icon, TextField } from '@opencord/ui';
import { useRef, useState } from 'react';
import { askConfirm } from '../../components/AskDialog';
import { CustomEmojiImg } from '../../components/CustomEmoji';
import { emojiImage, emojiNameFrom } from '../../lib/images';
import { loadServer, api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { Section } from '../settings/SettingsModal';

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

function EmojiRow({ emoji, canManage }: { emoji: CustomEmoji; canManage: boolean }) {
  const [name, setName] = useState(emoji.name);
  const valid = EMOJI_NAME.test(name);
  const save = async () => {
    if (name === emoji.name) return;
    if (!valid) {
      setName(emoji.name);
      return useUi.getState().toast('error', 'Use de 2 a 24 letras, números ou _.');
    }
    try {
      await api().request('PATCH', `/emojis/${emoji.id}`, { name });
    } catch (e) {
      setName(emoji.name);
      toastError(e);
    }
  };
  const remove = async () => {
    if (
      !(await askConfirm(`:${emoji.name}: some do servidor; onde já foi usado, aparece só o nome.`, {
        title: 'Apagar emoji',
        confirmLabel: 'Apagar',
        danger: true,
      }))
    )
      return;
    try {
      await api().request('DELETE', `/emojis/${emoji.id}`);
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <li className="emoji-row">
      <span className="emoji-row-img">
        <CustomEmojiImg emoji={emoji} />
      </span>
      {canManage ? (
        <TextField
          aria-label={`Nome do emoji :${emoji.name}:`}
          fieldClassName="emoji-row-name"
          value={name}
          maxLength={24}
          error={valid ? undefined : 'Use de 2 a 24 letras, números ou _'}
          onChange={(e) => setName(e.target.value.replace(/\s/g, '_'))}
          onBlur={() => void save()}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      ) : (
        <code className="emoji-row-name">:{emoji.name}:</code>
      )}
      {emoji.animated && <span className="chip">Animado</span>}
      {canManage && (
        <button
          type="button"
          className="icon-btn danger"
          aria-label={`Apagar :${emoji.name}:`}
          data-tip="Apagar"
          onClick={() => void remove()}
        >
          <Icon name="trash" size={16} />
        </button>
      )}
    </li>
  );
}

export function EmojisTab({ detail }: { detail: ServerDetail }) {
  const canManage = hasPermission(detail.myPermissions, Permission.MANAGE_SERVER);
  const emojis = detail.emojis ?? [];
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const left = MAX_SERVER_EMOJIS - emojis.length;

  const send = async (files: FileList | null) => {
    if (input.current) input.current.value = '';
    if (!files?.length) return;
    setBusy(true);
    const taken = new Set(emojis.map((e) => e.name.toLowerCase()));
    let sent = 0;
    try {
      for (const file of [...files].slice(0, left)) {
        if (!file.type.startsWith('image/')) continue;
        let name = emojiNameFrom(file.name);
        for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${emojiNameFrom(file.name).slice(0, 21)}_${n}`;
        try {
          await api().upload(`/servers/${detail.id}/emojis?name=${encodeURIComponent(name)}`, await emojiImage(file));
          taken.add(name.toLowerCase());
          sent++;
        } catch (e) {
          useUi.getState().toast('error', `${file.name}: ${describeError(e)}`);
        }
      }
      if (files.length > left) useUi.getState().toast('info', `Só cabem mais ${left} emojis neste servidor.`);
      if (sent) {
        useUi.getState().toast('success', sent === 1 ? 'Emoji enviado.' : `${sent} emojis enviados.`);
        // o resumo atualizado chega por server:updated; recarrega por garantia
        await loadServer(detail.id).catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section
        title="Emoji"
        description={
          <>
            Até {MAX_SERVER_EMOJIS} emojis por servidor, animados também, para todo mundo. No chat, escreva{' '}
            <code>:nome:</code> ou use o botão de emojis do campo de mensagem. Dá para usar em qualquer servidor ou
            conversa.
          </>
        }
      >
        {canManage && (
          <div className="form-actions">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => void send(e.target.files)}
            />
            <Button icon="upload" disabled={busy || left <= 0} onClick={() => input.current?.click()}>
              {busy ? 'Enviando…' : 'Enviar emoji'}
            </Button>
            <span className="muted small">
              {left > 0
                ? `${left} de ${MAX_SERVER_EMOJIS} vagas livres`
                : 'Sem vagas: apague um emoji para enviar outro'}
              . PNG, JPEG, WebP ou GIF (até 512 KB). O nome vem do arquivo e pode ser trocado.
            </span>
          </div>
        )}
      </Section>
      <Section title={`Emojis do servidor (${emojis.length})`}>
        {emojis.length === 0 ? (
          <p className="muted">Nenhum emoji ainda.</p>
        ) : (
          <ul className="emoji-list">
            {[...emojis].reverse().map((e) => (
              <EmojiRow key={`${e.id}:${e.name}`} emoji={e} canManage={canManage} />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
