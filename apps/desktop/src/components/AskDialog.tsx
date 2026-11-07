import { Button, Checkbox, TextField } from '@opencord/ui';
import { useState } from 'react';
import { create } from 'zustand';
import { Dialog } from './Dialog';

/**
 * Confirmações e perguntas no tema do app, no lugar do `confirm()`/`prompt()` nativos (caixa cinza do Windows com
 * o nome do pacote no título). `await askConfirm(...)` devolve true/false; `await askText(...)` devolve o texto ou
 * null se cancelar; `await askChoice(...)` devolve a opção escolhida ou null.
 */
interface Choice {
  id: string;
  label: string;
  /** ação destrutiva: botão vermelho */
  danger?: boolean;
}

interface Ask {
  id: number;
  title: string;
  message: string;
  /** botões além de "Cancelar" (da esquerda para a direita; o último recebe o foco e responde ao Enter) */
  choices: Choice[];
  /** pergunta com campo de texto (prompt) */
  input?: { label: string; placeholder?: string };
  /** caixa de marcar opcional (ex.: "apagar junto os canais"); a resposta leva se ficou marcada */
  check?: { label: string; description?: string };
  resolve: (v: string | null, checked?: boolean) => void;
}

const useAsk = create<{ queue: Ask[] }>(() => ({ queue: [] }));

let seq = 0;
function ask(
  a: Omit<Ask, 'resolve' | 'id'>,
  signal?: AbortSignal,
  onChecked?: (checked: boolean) => void,
): Promise<string | null> {
  const id = ++seq;
  return new Promise((done) => {
    const resolve = (v: string | null, checked?: boolean) => {
      if (v !== null) onChecked?.(checked ?? false);
      done(v);
    };
    if (signal?.aborted) return resolve(null);
    useAsk.setState((s) => ({ queue: [...s.queue, { ...a, id, resolve }] }));
    // a pergunta perdeu o sentido (ex.: quem pediu desistiu): some sem resposta
    signal?.addEventListener(
      'abort',
      () => {
        if (!useAsk.getState().queue.some((q) => q.id === id)) return;
        useAsk.setState((s) => ({ queue: s.queue.filter((q) => q.id !== id) }));
        resolve(null);
      },
      { once: true },
    );
  });
}

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  /** ação destrutiva (excluir, expulsar): botão vermelho */
  danger?: boolean;
  /** fecha a pergunta sozinha (resposta: cancelar) */
  signal?: AbortSignal;
}

export async function askConfirm(message: string, o: ConfirmOptions = {}): Promise<boolean> {
  const r = await ask(
    {
      title: o.title ?? 'Tem certeza?',
      message,
      choices: [{ id: 'ok', label: o.confirmLabel ?? 'Confirmar', danger: o.danger ?? false }],
    },
    o.signal,
  );
  return r !== null;
}

export function askText(
  message: string,
  o: ConfirmOptions & { label: string; placeholder?: string },
): Promise<string | null> {
  return ask(
    {
      title: o.title ?? 'Tem certeza?',
      message,
      choices: [{ id: 'ok', label: o.confirmLabel ?? 'Confirmar', danger: o.danger ?? false }],
      input: { label: o.label, placeholder: o.placeholder },
    },
    o.signal,
  );
}

/** Confirmação com uma caixa de marcar; devolve null se cancelar, ou se a caixa ficou marcada. */
export async function askConfirmCheck(
  message: string,
  o: ConfirmOptions & { check: string; checkDescription?: string },
): Promise<{ checked: boolean } | null> {
  let checked = false;
  const r = await ask(
    {
      title: o.title ?? 'Tem certeza?',
      message,
      choices: [{ id: 'ok', label: o.confirmLabel ?? 'Confirmar', danger: o.danger ?? false }],
      check: { label: o.check, description: o.checkDescription },
    },
    o.signal,
    (c) => (checked = c),
  );
  return r === null ? null : { checked };
}

/** Pergunta com mais de uma resposta possível (além de cancelar); devolve o id da escolhida. */
export function askChoice<T extends string>(
  message: string,
  o: { title: string; choices: { id: T; label: string; danger?: boolean }[]; signal?: AbortSignal },
): Promise<T | null> {
  return ask({ title: o.title, message, choices: o.choices }, o.signal) as Promise<T | null>;
}

/** Montado uma vez na raiz do app; mostra uma pergunta por vez. */
export function AskHost() {
  const cur = useAsk((s) => s.queue[0]);
  return cur ? <AskView key={cur.id} a={cur} /> : null;
}

function AskView({ a }: { a: Ask }) {
  const [text, setText] = useState('');
  const [checked, setChecked] = useState(false);
  const done = (v: string | null) => {
    useAsk.setState((s) => ({ queue: s.queue.slice(1) }));
    a.resolve(v, checked);
  };
  const main = a.choices[a.choices.length - 1];
  const answer = (c: Choice) => done(a.input ? text : c.id);
  return (
    <Dialog
      title={a.title}
      onClose={() => done(null)}
      actions={
        <>
          <Button variant="secondary" onClick={() => done(null)}>
            Cancelar
          </Button>
          {a.choices.map((c) => (
            <Button
              key={c.id}
              variant={c.danger ? 'danger' : c === main ? 'primary' : 'secondary'}
              // Enter confirma (foco começa aqui quando não há campo)
              autoFocus={!a.input && c === main}
              onClick={() => answer(c)}
            >
              {c.label}
            </Button>
          ))}
        </>
      }
    >
      <form
        className="ask-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (main) answer(main);
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
        {a.check && (
          <Checkbox checked={checked} onChange={setChecked} label={a.check.label} description={a.check.description} />
        )}
      </form>
    </Dialog>
  );
}
