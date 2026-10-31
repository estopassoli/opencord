import { Button, TextField } from '@opencord/ui';
import { useState } from 'react';
import { create } from 'zustand';
import { Dialog } from './Dialog';

/**
 * Confirmações e perguntas no tema do app, no lugar do `confirm()`/`prompt()` nativos (caixa cinza do Windows com
 * o nome do pacote no título). `await askConfirm(...)` devolve true/false; `await askText(...)` devolve o texto ou
 * null se cancelar.
 */
interface Ask {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  /** pergunta com campo de texto (prompt) */
  input?: { label: string; placeholder?: string };
  resolve: (v: string | null) => void;
}

const useAsk = create<{ queue: Ask[] }>(() => ({ queue: [] }));

let seq = 0;
function ask(a: Omit<Ask, 'resolve' | 'id'>): Promise<string | null> {
  const id = ++seq;
  return new Promise((resolve) => useAsk.setState((s) => ({ queue: [...s.queue, { ...a, id, resolve }] })));
}

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  /** ação destrutiva (excluir, expulsar): botão vermelho */
  danger?: boolean;
}

export async function askConfirm(message: string, o: ConfirmOptions = {}): Promise<boolean> {
  const r = await ask({
    title: o.title ?? 'Tem certeza?',
    message,
    confirmLabel: o.confirmLabel ?? 'Confirmar',
    danger: o.danger ?? false,
  });
  return r !== null;
}

export function askText(
  message: string,
  o: ConfirmOptions & { label: string; placeholder?: string },
): Promise<string | null> {
  return ask({
    title: o.title ?? 'Tem certeza?',
    message,
    confirmLabel: o.confirmLabel ?? 'Confirmar',
    danger: o.danger ?? false,
    input: { label: o.label, placeholder: o.placeholder },
  });
}

/** Montado uma vez na raiz do app; mostra uma pergunta por vez. */
export function AskHost() {
  const cur = useAsk((s) => s.queue[0]);
  return cur ? <AskView key={cur.id} a={cur} /> : null;
}

function AskView({ a }: { a: Ask }) {
  const [text, setText] = useState('');
  const done = (v: string | null) => {
    useAsk.setState((s) => ({ queue: s.queue.slice(1) }));
    a.resolve(v);
  };
  return (
    <Dialog
      title={a.title}
      onClose={() => done(null)}
      actions={
        <>
          <Button variant="secondary" onClick={() => done(null)}>
            Cancelar
          </Button>
          <Button
            variant={a.danger ? 'danger' : 'primary'}
            // Enter confirma (foco começa aqui quando não há campo)
            autoFocus={!a.input}
            onClick={() => done(a.input ? text : '')}
          >
            {a.confirmLabel}
          </Button>
        </>
      }
    >
      <form
        className="ask-body"
        onSubmit={(e) => {
          e.preventDefault();
          done(a.input ? text : '');
        }}
      >
        <p className="ask-message">{a.message}</p>
        {a.input && (
          <TextField
            label={a.input.label}
            placeholder={a.input.placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
        )}
      </form>
    </Dialog>
  );
}
