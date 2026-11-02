import type { CreateInteractionRequest, ServerEvents } from '@opencord/contracts';
import { Avatar, Button, TextArea, TextField } from '@opencord/ui';
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { ApiError } from '../../lib/api';
import { api, describeError } from '../../store/session';
import { lengthHint, validateModalFields } from './bot-ui';

/**
 * Formulário que um bot abriu para quem interagiu (`interaction:modal`, ADR-0034): campos curtos (uma linha) e
 * parágrafos, com obrigatório, tamanho mínimo/máximo e contador. Enviar vira `POST /interactions { type: 'modal' }`;
 * cancelar ou Esc fecha sem mandar nada. Enter num campo curto envia; Ctrl+Enter num parágrafo também.
 */
export function BotModalDialog({
  request: req,
  onClose,
}: {
  request: ServerEvents['interaction:modal'];
  onClose: () => void;
}) {
  const fields = req.modal.components;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.customId, f.value ?? ''])),
  );
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const errors = touched ? validateModalFields(fields, values) : {};

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setTouched(true);
    const errs = validateModalFields(fields, values);
    const firstBad = fields.find((f) => errs[f.customId]);
    if (firstBad) {
      form.current?.querySelector<HTMLElement>(`[data-field="${firstBad.customId}"]`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: CreateInteractionRequest = { type: 'modal', modalId: req.modalId, fields: values };
      await api().request('POST', '/interactions', body);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? 'Bot offline.' : describeError(err));
      setBusy(false);
    }
  };

  const paragraphKeys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.current?.requestSubmit();
    }
  };

  return (
    <Dialog title={req.modal.title} onClose={onClose}>
      <form ref={form} className="form bot-modal" onSubmit={(e) => void submit(e)} noValidate>
        <p className="bot-modal-from muted small">
          <Avatar id={req.bot.id} name={req.bot.displayName} size={20} />
          <span className="truncate">{req.bot.displayName}</span>
          <span className="bot-badge">APP</span>
        </p>
        {fields.map((f, i) => {
          const value = values[f.customId] ?? '';
          const label = (f.required ?? true) ? f.label : `${f.label} (opcional)`;
          const common = {
            label,
            value,
            placeholder: f.placeholder,
            maxLength: f.maxLength,
            autoFocus: i === 0,
            'aria-required': (f.required ?? true) || undefined,
            'data-field': f.customId,
            error: errors[f.customId],
            hint: lengthHint(f, value.length),
            onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [f.customId]: e.target.value })),
          };
          return (f.style ?? 'short') === 'paragraph' ? (
            <TextArea key={f.customId} {...common} rows={4} onKeyDown={paragraphKeys} />
          ) : (
            <TextField key={f.customId} {...common} />
          );
        })}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
