/**
 * Compartilhar um clipe numa conversa ou canal de texto: o vídeo (ou o corte) sobe em partes de 8 MB, até 1 GB,
 * vira anexo e vai numa mensagem.
 */
import { LARGE_UPLOAD_MAX_BYTES } from '@opencord/contracts';
import { Avatar, Button, Icon, TextField } from '@opencord/ui';
import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { ServerIcon } from '../../components/ServerIcon';
import { useData, keyOf } from '../../store/data';
import { describeError, loadServer } from '../../store/session';
import { useUi } from '../../store/ui';
import { sendMessage, type ChatTarget } from '../chat/ChatView';
import { uploadLarge } from './account';

interface Destination {
  id: string;
  target: ChatTarget;
  label: string;
  sub: string;
  icon: React.ReactNode;
  go: () => void;
}

export function ShareClipDialog({
  name,
  getData,
  onClose,
}: {
  name: string;
  /** o arquivo a enviar (o clipe inteiro ou o corte) */
  getData: () => Promise<Blob>;
  onClose: () => void;
}) {
  const me = useData((d) => d.me);
  const conversations = useData((d) => d.conversations);
  const servers = useData((d) => d.servers);
  const details = useData((d) => d.details);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Destination | null>(null);
  const [text, setText] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  // canais dos servidores ainda não abertos nesta sessão
  useEffect(() => {
    for (const s of useData.getState().servers)
      if (!useData.getState().details[s.id]) void loadServer(s.id).catch(() => undefined);
  }, []);

  const all = useMemo<Destination[]>(() => {
    const out: Destination[] = [];
    for (const c of conversations) {
      const others = c.members.filter((m) => m.id !== me?.id);
      const first = others[0];
      out.push({
        id: `d:${c.id}`,
        target: { conversationId: c.id },
        label: c.name ?? (others.map((m) => m.displayName).join(', ') || 'Conversa'),
        sub: 'Mensagem direta',
        icon: first ? <Avatar id={first.id} name={first.displayName} size={24} /> : <Icon name="chat" size={20} />,
        go: () => useUi.getState().go({ kind: 'dm', conversationId: c.id }),
      });
    }
    for (const s of servers) {
      const d = details[s.id];
      for (const ch of d?.channels ?? []) {
        if (ch.kind !== 'text') continue;
        out.push({
          id: `c:${ch.id}`,
          target: { channelId: ch.id },
          label: `#${ch.name}`,
          sub: s.name,
          icon: (
            <span className="share-server-icon">
              <ServerIcon name={s.name} iconKey={s.iconKey} official={s.official} />
            </span>
          ),
          go: () => useUi.getState().go({ kind: 'server', serverId: s.id, channelId: ch.id }),
        });
      }
    }
    return out;
  }, [conversations, servers, details, me?.id]);
  const q = query.trim().toLowerCase();
  const list = (q ? all.filter((d) => `${d.label} ${d.sub}`.toLowerCase().includes(q)) : all).slice(0, 60);

  const send = async () => {
    if (!picked) return;
    setProgress(0);
    try {
      const data = await getData();
      if (data.size > LARGE_UPLOAD_MAX_BYTES) throw new Error('O clipe passa de 1 GB. Corte um trecho menor.');
      const att = await uploadLarge(data, `${name}.mp4`, setProgress);
      await sendMessage(keyOf(picked.target), picked.target, crypto.randomUUID(), text.trim(), undefined, [att.id]);
      useUi.getState().toast('success', `Clipe enviado em ${picked.label}.`, { label: 'Abrir', run: picked.go });
      onClose();
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
      setProgress(null);
    }
  };

  return (
    <Dialog
      title="Compartilhar clipe"
      onClose={progress === null ? onClose : () => undefined}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={progress !== null}>
            Cancelar
          </Button>
          <Button icon="upload" disabled={!picked || progress !== null} onClick={() => void send()}>
            {progress === null ? 'Enviar' : `Enviando… ${Math.round(progress * 100)}%`}
          </Button>
        </>
      }
    >
      <div className="share-clip">
        <TextField
          leadingIcon="search"
          aria-label="Buscar conversa ou canal"
          placeholder="Buscar conversa ou canal"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="share-list" role="listbox" aria-label="Onde enviar">
          {list.map((d) => (
            <li key={d.id} role="option" aria-selected={picked?.id === d.id}>
              <button type="button" onClick={() => setPicked(d)} disabled={progress !== null}>
                {d.icon}
                <span className="share-names">
                  <strong className="truncate">{d.label}</strong>
                  <span className="muted small truncate">{d.sub}</span>
                </span>
                {picked?.id === d.id && <Icon name="check" size={18} />}
              </button>
            </li>
          ))}
          {!list.length && <li className="muted small">Nada encontrado.</li>}
        </ul>
        <TextField
          label="Mensagem (opcional)"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          disabled={progress !== null}
        />
        {progress !== null && (
          <div
            className="share-progress"
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
