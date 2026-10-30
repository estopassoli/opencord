import { POLL_DURATIONS, POLL_MAX_OPTIONS, type Message, type Poll } from '@opencord/contracts';
import { Button, Checkbox, Icon, Select, TextField } from '@opencord/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { useMessages, type TargetKey } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import type { ChatTarget } from './ChatView';

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

const DURATION_LABEL: Record<number, string> = {
  0: 'Sem prazo',
  1: '1 hora',
  4: '4 horas',
  8: '8 horas',
  24: '1 dia',
  72: '3 dias',
  168: '1 semana',
};

/** "termina em 3 h" / "terminou" a partir de agora (relógio que avança a cada minuto) */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function remaining(ms: number) {
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} dias`;
}

/**
 * Enquete numa mensagem (ADR-0018). Um clique vota (de novo na mesma opção retira); com várias opções, cada
 * clique marca ou desmarca. O resultado aparece depois que você vota ou quando a enquete encerra.
 */
export function PollCard({
  poll,
  messageId,
  targetKey,
  canClose,
}: {
  poll: Poll;
  messageId: string;
  targetKey: TargetKey;
  canClose: boolean;
}) {
  const now = useNow(Boolean(poll.endsAt) && !poll.closed);
  const closed = poll.closed || (poll.endsAt !== null && new Date(poll.endsAt).getTime() <= now);
  const [busy, setBusy] = useState(false);
  const voted = poll.mine.length > 0;
  const showResults = voted || closed;
  const total = poll.options.reduce((n, o) => n + o.votes, 0);
  const top = Math.max(0, ...poll.options.map((o) => o.votes));

  const send = async (optionIds: string[]) => {
    setBusy(true);
    try {
      const p = await api().request<Poll>('PUT', `/polls/${poll.id}/vote`, { optionIds });
      useMessages.getState().setPoll(targetKey, messageId, p, false);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const choose = (id: string) => {
    if (poll.multiple) void send(poll.mine.includes(id) ? poll.mine.filter((x) => x !== id) : [...poll.mine, id]);
    else void send(poll.mine.includes(id) ? [] : [id]);
  };
  const close = async () => {
    if (!confirm('Encerrar a enquete agora? Ninguém mais poderá votar.')) return;
    try {
      const p = await api().request<Poll>('POST', `/polls/${poll.id}/close`);
      useMessages.getState().setPoll(targetKey, messageId, p, false);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="poll" data-closed={closed ? 'true' : undefined}>
      <div className="poll-head">
        <Icon name="poll" size={18} />
        <strong className="poll-question">{poll.question}</strong>
      </div>
      <p className="poll-hint muted small">
        {closed ? 'Enquete encerrada' : poll.multiple ? 'Escolha uma ou mais opções' : 'Escolha uma opção'}
      </p>
      <ul className="poll-options" role={poll.multiple ? 'group' : 'radiogroup'} aria-label={poll.question}>
        {poll.options.map((o) => {
          const pct = total ? Math.round((o.votes / total) * 100) : 0;
          const mine = poll.mine.includes(o.id);
          return (
            <li key={o.id}>
              <button
                className="poll-option"
                role={poll.multiple ? 'checkbox' : 'radio'}
                aria-checked={mine}
                disabled={closed || busy}
                data-winner={closed && o.votes > 0 && o.votes === top ? 'true' : undefined}
                onClick={() => choose(o.id)}
                style={showResults ? ({ '--pct': `${pct}%` } as React.CSSProperties) : undefined}
                data-results={showResults ? 'true' : undefined}
              >
                <span className="poll-check" aria-hidden="true">
                  {mine && <Icon name="check" size={14} />}
                </span>
                <span className="poll-text">{o.text}</span>
                {showResults && (
                  <span className="poll-count">
                    {o.votes} · {pct}%
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="poll-foot muted small">
        <span>
          {poll.voters} {poll.voters === 1 ? 'voto' : 'votos'}
          {!closed && poll.endsAt && ` · termina em ${remaining(new Date(poll.endsAt).getTime() - now)}`}
          {!showResults && ' · vote para ver o resultado'}
        </span>
        <span className="spacer" />
        {voted && !closed && (
          <button className="link-btn" disabled={busy} onClick={() => void send([])}>
            Retirar voto
          </button>
        )}
        {canClose && !closed && (
          <button className="link-btn" onClick={() => void close()}>
            Encerrar
          </button>
        )}
      </div>
    </div>
  );
}

/** Criar enquete: pergunta, de 2 a 10 opções, uma ou várias escolhas e o prazo. */
export function CreatePollDialog({ target, onClose }: { target: ChatTarget; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [duration, setDuration] = useState('24');
  const [busy, setBusy] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const dup = new Set(filled.map((o) => o.toLowerCase())).size !== filled.length;
  const valid = question.trim() && filled.length >= 2 && !dup;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const path = target.channelId
        ? `/channels/${target.channelId}/polls`
        : `/conversations/${target.conversationId}/polls`;
      const m = await api().request<Message>('POST', path, {
        requestId: crypto.randomUUID(),
        question: question.trim(),
        options: filled,
        multiple,
        durationHours: Number(duration),
      });
      useMessages.getState().upsert(m);
      onClose();
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Criar enquete" onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <TextField
          label="Pergunta"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={300}
          required
          autoFocus
        />
        <fieldset className="poll-editor">
          <legend className="oc-label">Opções</legend>
          {options.map((o, i) => (
            <div key={i} className="poll-editor-row">
              <TextField
                aria-label={`Opção ${i + 1}`}
                placeholder={`Opção ${i + 1}`}
                value={o}
                maxLength={80}
                onChange={(e) => setOptions((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remover opção ${i + 1}`}
                  data-tip="Remover"
                  onClick={() => setOptions((l) => l.filter((_, j) => j !== i))}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          ))}
          {options.length < POLL_MAX_OPTIONS && (
            <Button variant="ghost" size="sm" icon="plus" onClick={() => setOptions((l) => [...l, ''])}>
              Adicionar opção
            </Button>
          )}
          {dup && <p className="form-error">Há opções repetidas.</p>}
        </fieldset>
        <Checkbox checked={multiple} onChange={setMultiple} label="Permitir escolher mais de uma opção" />
        <Select<string>
          label="Duração"
          value={duration}
          onChange={setDuration}
          options={POLL_DURATIONS.map((h) => ({ value: String(h), label: DURATION_LABEL[h] ?? `${h} h` }))}
        />
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!valid || busy}>
            Publicar enquete
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
