/**
 * Configurações do servidor → Bots (ADR-0032): bots que são membros deste servidor. Adicionar da lista pública ou
 * pelo id (bots privados); remover. Precisa de MANAGE_SERVER.
 */
import type { Bot, ServerDetail } from '@opencord/contracts';
import { Avatar, Button, Icon, TextField } from '@opencord/ui';
import { useEffect, useMemo, useState } from 'react';
import { askConfirm } from '../../components/AskDialog';
import { Dialog } from '../../components/Dialog';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { Section } from '../settings/Section';

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

export function ServerBotsTab({ detail }: { detail: ServerDetail }) {
  const [list, setList] = useState<Bot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void api()
      .request<Bot[]>('GET', `/servers/${detail.id}/bots`)
      .then(setList, (e: unknown) => setError(describeError(e)));
  }, [detail.id]);

  const remove = async (b: Bot) => {
    if (
      !(await askConfirm(`"${b.user.displayName}" sai do servidor e os comandos dele somem do composer.`, {
        title: 'Remover bot',
        confirmLabel: 'Remover',
        danger: true,
      }))
    )
      return;
    void api()
      .request('DELETE', `/servers/${detail.id}/bots/${b.id}`)
      .then(() => setList((l) => l?.filter((x) => x.id !== b.id) ?? null), toastError);
  };

  return (
    <>
      <Section
        title={list ? `Bots (${list.length})` : 'Bots'}
        description="Entram como membros: cargos e permissões valem como para qualquer pessoa."
      >
        <div className="bots-toolbar">
          <Button icon="plus" onClick={() => setAdding(true)} disabled={!list}>
            Adicionar bot
          </Button>
        </div>
        {!list && !error && <p className="muted small">Carregando…</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {list?.length === 0 && <p className="muted small">Nenhum bot ainda.</p>}
        <ul className="bots-list">
          {list?.map((b) => (
            <li key={b.id} className="bots-item">
              <Avatar id={b.user.id} name={b.user.displayName} size={36} />
              <div className="bots-main">
                <strong className="truncate">
                  {b.user.displayName} <span className="bot-badge">APP</span>
                </strong>
                {b.description && <span className="muted small truncate">{b.description}</span>}
                <span className="bots-meta muted small">
                  <span>
                    {b.commands.length} {b.commands.length === 1 ? 'comando' : 'comandos'}
                  </span>
                </span>
              </div>
              <button
                className="icon-btn danger"
                aria-label={`Remover ${b.user.displayName}`}
                data-tip="Remover"
                onClick={() => void remove(b)}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      </Section>
      {adding && list && (
        <AddBotDialog
          serverId={detail.id}
          present={list}
          onClose={() => setAdding(false)}
          onAdded={(b) => {
            setList((l) => (l?.some((x) => x.id === b.id) ? l : [...(l ?? []), b]));
            setAdding(false);
            useUi.getState().toast('success', `${b.user.displayName} entrou no servidor.`);
          }}
        />
      )}
    </>
  );
}

function AddBotDialog({
  serverId,
  present,
  onClose,
  onAdded,
}: {
  serverId: string;
  present: Bot[];
  onClose: () => void;
  onAdded: (b: Bot) => void;
}) {
  const [directory, setDirectory] = useState<Bot[] | null>(null);
  const [query, setQuery] = useState('');
  const [botId, setBotId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api()
      .request<Bot[]>('GET', '/bots/directory')
      .then(setDirectory, (e: unknown) => setError(describeError(e)));
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (directory ?? []).filter(
      (b) =>
        !q ||
        b.user.displayName.toLowerCase().includes(q) ||
        b.user.username.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q),
    );
  }, [directory, query]);

  const add = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      onAdded(await api().request<Bot>('POST', `/servers/${serverId}/bots`, { botId: id }));
    } catch (e) {
      setError(describeError(e));
      setBusy(null);
    }
  };

  return (
    <Dialog title="Adicionar bot" onClose={onClose}>
      <div className="form">
        <TextField
          label="Bots públicos"
          leadingIcon="search"
          placeholder="Buscar"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {!directory && !error && <p className="muted small">Carregando…</p>}
        {directory && shown.length === 0 && (
          <p className="muted small">{query ? 'Nada com esse nome.' : 'Nenhum bot público ainda.'}</p>
        )}
        <ul className="bots-list bots-dir" aria-label="Bots públicos">
          {shown.map((b) => {
            const here = present.some((x) => x.id === b.id);
            return (
              <li key={b.id} className="bots-item">
                <Avatar id={b.user.id} name={b.user.displayName} size={32} />
                <div className="bots-main">
                  <strong className="truncate">{b.user.displayName}</strong>
                  <span className="muted small truncate">{b.description || `${b.commands.length} comandos`}</span>
                </div>
                <Button size="sm" variant="secondary" disabled={here || busy !== null} onClick={() => void add(b.id)}>
                  {here ? 'Já está aqui' : busy === b.id ? 'Adicionando…' : 'Adicionar'}
                </Button>
              </li>
            );
          })}
        </ul>
        <form
          className="bots-byid"
          onSubmit={(e) => {
            e.preventDefault();
            if (botId.trim()) void add(botId.trim());
          }}
        >
          <TextField
            label="Ou cole o id do bot"
            placeholder="Para bots privados"
            value={botId}
            onChange={(e) => setBotId(e.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={!botId.trim() || busy !== null}>
            Adicionar
          </Button>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
