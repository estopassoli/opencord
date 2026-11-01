/**
 * Configurações → Aplicativos (ADR-0032): meus bots. Criar (o token aparece uma única vez), editar, gerar novo
 * token, excluir. O id do bot serve para adicioná-lo num servidor quando ele é privado.
 */
import { MAX_BOTS_PER_USER, type Bot, type BotWithToken } from '@opencord/contracts';
import { Avatar, Button, Icon, Switch, TextField } from '@opencord/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { askConfirm } from '../../components/AskDialog';
import { Dialog } from '../../components/Dialog';
import { bridge } from '../../lib/bridge';
import { agoLabel } from '../../lib/when';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { Section } from './SettingsModal';

const DOCS_URL = 'https://github.com/estopassoli/opencord/blob/main/docs/BOTS.md';

const copyText = (text: string, done: string) =>
  void navigator.clipboard.writeText(text).then(
    () => useUi.getState().toast('success', done),
    () => useUi.getState().toast('error', 'Não deu para copiar.'),
  );

export function BotsTab() {
  const [list, setList] = useState<Bot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ bot?: Bot } | null>(null);
  const [token, setToken] = useState<BotWithToken | null>(null);

  useEffect(() => {
    void api()
      .request<Bot[]>('GET', '/me/bots')
      .then(setList, (e: unknown) => setError(describeError(e)));
  }, []);

  const upsert = (b: Bot) =>
    setList((l) => (l?.some((x) => x.id === b.id) ? l.map((x) => (x.id === b.id ? b : x)) : [...(l ?? []), b]));

  const regenerate = async (b: Bot) => {
    if (
      !(await askConfirm(`O token atual de "${b.user.displayName}" para de funcionar na hora.`, {
        title: 'Gerar novo token',
        confirmLabel: 'Gerar',
        danger: true,
      }))
    )
      return;
    try {
      const t = await api().request<BotWithToken>('POST', `/bots/${b.id}/token`);
      upsert(t);
      setToken(t);
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    }
  };

  const remove = async (b: Bot) => {
    if (
      !(await askConfirm(`"${b.user.displayName}" sai de todos os servidores e o token deixa de valer.`, {
        title: 'Excluir bot',
        confirmLabel: 'Excluir',
        danger: true,
      }))
    )
      return;
    void api()
      .request('DELETE', `/bots/${b.id}`)
      .then(
        () => setList((l) => l?.filter((x) => x.id !== b.id) ?? null),
        (e: unknown) => useUi.getState().toast('error', describeError(e)),
      );
  };

  const count = list?.length ?? 0;
  const full = count >= MAX_BOTS_PER_USER;
  const openDocs = () => (bridge ? void bridge.openExternal(DOCS_URL) : window.open(DOCS_URL, '_blank', 'noopener'));

  return (
    <>
      <Section
        title={list ? `Meus bots (${count}/${MAX_BOTS_PER_USER})` : 'Meus bots'}
        description={
          <>
            Um bot entra nos servidores como membro e responde a comandos de barra.{' '}
            <button type="button" className="link-btn" onClick={openDocs}>
              Guia para quem desenvolve
            </button>
          </>
        }
      >
        <div className="bots-toolbar">
          <Button icon="plus" onClick={() => setForm({})} disabled={!list || full}>
            Novo bot
          </Button>
          {full && <span className="muted small">Limite de {MAX_BOTS_PER_USER} bots.</span>}
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
                  {b.user.displayName} <span className="muted small">@{b.user.username}</span>
                </strong>
                {b.description && <span className="muted small truncate">{b.description}</span>}
                <span className="bots-meta muted small">
                  <span className="bots-tag">{b.public ? 'público' : 'privado'}</span>
                  <span>
                    {b.commands.length} {b.commands.length === 1 ? 'comando' : 'comandos'}
                  </span>
                  <span>{b.lastSeenAt ? `visto ${agoLabel(b.lastSeenAt)}` : 'nunca conectou'}</span>
                </span>
              </div>
              <button
                className="icon-btn"
                aria-label={`Copiar id de ${b.user.displayName}`}
                data-tip="Copiar id"
                onClick={() => copyText(b.id, 'Id copiado.')}
              >
                <Icon name="copy" size={16} />
              </button>
              <button
                className="icon-btn"
                aria-label={`Editar ${b.user.displayName}`}
                data-tip="Editar"
                onClick={() => setForm({ bot: b })}
              >
                <Icon name="edit" size={16} />
              </button>
              <button
                className="icon-btn"
                aria-label={`Gerar novo token de ${b.user.displayName}`}
                data-tip="Gerar novo token"
                onClick={() => void regenerate(b)}
              >
                <Icon name="refresh" size={16} />
              </button>
              <button
                className="icon-btn danger"
                aria-label={`Excluir ${b.user.displayName}`}
                data-tip="Excluir"
                onClick={() => void remove(b)}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      </Section>
      {form && (
        <BotFormDialog
          bot={form.bot}
          onClose={() => setForm(null)}
          onSaved={(b) => {
            upsert(b);
            setForm(null);
            if ('token' in b) setToken(b);
          }}
        />
      )}
      {token && <TokenDialog bot={token} onClose={() => setToken(null)} />}
    </>
  );
}

function BotFormDialog({
  bot,
  onClose,
  onSaved,
}: {
  bot?: Bot | undefined;
  onClose: () => void;
  onSaved: (b: Bot | BotWithToken) => void;
}) {
  const [name, setName] = useState(bot?.user.displayName ?? '');
  const [description, setDescription] = useState(bot?.description ?? '');
  const [isPublic, setPublic] = useState(bot?.public ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), description: description.trim(), public: isPublic };
    try {
      onSaved(
        bot
          ? await api().request<Bot>('PATCH', `/bots/${bot.id}`, body)
          : await api().request<BotWithToken>('POST', '/me/bots', body),
      );
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title={bot ? 'Editar bot' : 'Novo bot'} onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <TextField
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={32}
          autoFocus
          placeholder="Ex.: Clima"
        />
        <TextField
          label="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
          placeholder="O que ele faz, em uma linha"
        />
        <Switch
          label="Público"
          description="Aparece na lista 'Adicionar bot' de qualquer servidor."
          checked={isPublic}
          onChange={setPublic}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {bot ? 'Salvar' : 'Criar'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TokenDialog({ bot, onClose }: { bot: BotWithToken; onClose: () => void }) {
  return (
    <Dialog
      title="Token do bot"
      onClose={onClose}
      actions={
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <div className="form">
        <p className="bots-warning">
          <Icon name="warning" size={16} /> Guarde agora: não dá para ver de novo.
        </p>
        <div className="bots-secret">
          <code className="bots-token">{bot.token}</code>
          <Button size="sm" icon="copy" onClick={() => copyText(bot.token, 'Token copiado.')}>
            Copiar
          </Button>
        </div>
        <div className="bots-secret">
          <span className="muted small">Id do bot (para adicionar em servidores):</span>
          <code className="bots-id">{bot.id}</code>
          <Button size="sm" variant="secondary" icon="copy" onClick={() => copyText(bot.id, 'Id copiado.')}>
            Copiar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
