/**
 * Configurações do servidor → Webhooks (ADR-0030): links secretos que recebem POST e viram mensagem num canal de
 * texto. Criar com nome e canal; copiar o link; apagar.
 */
import type { ServerDetail, Webhook } from '@opencord/contracts';
import { Button, Icon, Select, TextField } from '@opencord/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { askConfirm } from '../../components/AskDialog';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { Section } from '../settings/Section';

export function WebhooksTab({ detail }: { detail: ServerDetail }) {
  const [list, setList] = useState<Webhook[] | null>(null);
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const texts = detail.channels.filter((c) => c.kind === 'text');
  const channelName = (id: string) => detail.channels.find((c) => c.id === id)?.name ?? '?';

  useEffect(() => {
    void api()
      .request<Webhook[]>('GET', `/servers/${detail.id}/webhooks`)
      .then(setList, (e: unknown) => setError(describeError(e)));
  }, [detail.id]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!channelId) return setError('Escolha o canal.');
    setBusy(true);
    setError(null);
    try {
      const w = await api().request<Webhook>('POST', `/servers/${detail.id}/webhooks`, { name, channelId });
      setList((l) => [...(l ?? []), w]);
      setName('');
      void navigator.clipboard.writeText(w.url).catch(() => undefined);
      useUi.getState().toast('success', 'Webhook criado e link copiado.');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  const copy = (w: Webhook) =>
    void navigator.clipboard
      .writeText(w.url)
      .then(() => useUi.getState().toast('success', 'Link copiado. Guarde: quem tem o link posta no canal.'));
  const remove = async (w: Webhook) => {
    if (
      !(await askConfirm(`O link de "${w.name}" para de funcionar na hora.`, {
        title: 'Apagar webhook',
        confirmLabel: 'Apagar',
        danger: true,
      }))
    )
      return;
    void api()
      .request('DELETE', `/webhooks/${w.id}`)
      .then(
        () => setList((l) => l?.filter((x) => x.id !== w.id) ?? null),
        (err: unknown) => useUi.getState().toast('error', describeError(err)),
      );
  };

  return (
    <>
      <Section
        title="Webhooks de entrada"
        description={
          <>
            Um link secreto por canal: qualquer programa que faça <code>POST</code> nele com{' '}
            <code>{'{"content":"texto"}'}</code> (ou <code>{'{"text":"..."}'}</code>) publica a mensagem no canal, com o
            selo APP. Serve para avisos do servidor do jogo, GitHub, Twitch "foi ao vivo" e afins. Quem tem o link
            posta: trate como senha.
          </>
        }
      >
        <form className="form webhook-form" onSubmit={create}>
          <TextField
            label="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={64}
            placeholder="Ex.: Servidor do Minecraft"
          />
          <Select<string>
            label="Canal de texto"
            placeholder="Escolher canal"
            value={channelId}
            onChange={setChannelId}
            options={texts.map((c) => ({ value: c.id, label: `#${c.name}` }))}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={busy || !name.trim()}>
              Criar webhook
            </Button>
          </div>
        </form>
      </Section>
      <Section title={list ? `Webhooks (${list.length})` : 'Webhooks'}>
        {!list && !error && <p className="muted small">Carregando…</p>}
        {list?.length === 0 && <p className="muted small">Nenhum webhook ainda.</p>}
        <ul className="webhook-list">
          {list?.map((w) => (
            <li key={w.id} className="webhook-item">
              <Icon name="link" size={18} />
              <div className="webhook-main">
                <strong className="truncate">{w.name}</strong>
                <span className="muted small truncate">
                  #{channelName(w.channelId)} · criado por {w.createdBy.displayName}
                </span>
              </div>
              <Button size="sm" variant="secondary" icon="copy" onClick={() => copy(w)}>
                Copiar link
              </Button>
              <button
                className="icon-btn"
                aria-label={`Apagar webhook ${w.name}`}
                data-tip="Apagar"
                onClick={() => void remove(w)}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
