/**
 * Configurações do servidor › Canais: lista compacta por categoria à esquerda (busca, indicadores de quadro, privado e
 * criador de salas) e, à direita, o painel do canal ou da categoria escolhida, com salvar só quando algo mudou e a
 * exclusão separada numa zona de perigo.
 */
import {
  hasPermission,
  Permission,
  SLOWMODE_OPTIONS,
  type Category,
  type Channel,
  type ServerDetail,
} from '@opencord/contracts';
import { formatSlowmode } from '../forum/ForumView';
import { Button, Icon, Select, Switch, TextArea, TextField } from '@opencord/ui';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { askConfirm } from '../../components/AskDialog';
import { CHANNEL_ICON, CHANNEL_LABEL } from '../../lib/channels';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import './channels-tab.css';

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

type Selection = { kind: 'channel'; id: string } | { kind: 'category'; id: string } | null;
type Group = { id: string | null; name: string; channels: Channel[] };

export function ChannelsTab({ detail }: { detail: ServerDetail }) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<Selection>(null);
  const [newCat, setNewCat] = useState<string | null>(null);
  const canChannels = hasPermission(detail.myPermissions, Permission.MANAGE_CHANNELS);

  const groups = useMemo<Group[]>(() => {
    const byPos = (a: Channel, b: Channel) => a.position - b.position;
    const visible = detail.channels.filter((c) => !c.temporary);
    const out: Group[] = [
      { id: null, name: 'Sem categoria', channels: visible.filter((c) => !c.categoryId).sort(byPos) },
    ];
    for (const cat of [...detail.categories].sort((a, b) => a.position - b.position))
      out.push({ id: cat.id, name: cat.name, channels: visible.filter((c) => c.categoryId === cat.id).sort(byPos) });
    return out.filter((g) => g.id !== null || g.channels.length > 0);
  }, [detail.categories, detail.channels]);

  const q = query.trim().toLowerCase();
  const shown = q
    ? groups
        .map((g) => ({
          ...g,
          channels: g.channels.filter(
            (c) => c.name.toLowerCase().includes(q) || (c.topic ?? '').toLowerCase().includes(q),
          ),
        }))
        .filter((g) => g.channels.length > 0 || g.name.toLowerCase().includes(q))
    : groups;

  // começa no primeiro canal; se o escolhido sumir (excluído por alguém), volta para o primeiro
  const first = groups.flatMap((g) => g.channels)[0];
  const channel = sel?.kind === 'channel' ? detail.channels.find((c) => c.id === sel.id) : undefined;
  const category = sel?.kind === 'category' ? detail.categories.find((c) => c.id === sel.id) : undefined;
  useEffect(() => {
    if ((!sel || (!channel && !category)) && first) setSel({ kind: 'channel', id: first.id });
  }, [sel, channel, category, first]);

  const total = detail.channels.filter((c) => !c.temporary).length;
  const boards = detail.channels.filter((c) => c.kind === 'board');

  const createCategory = async (e: FormEvent) => {
    e.preventDefault();
    const n = newCat?.trim();
    if (!n) return;
    try {
      const c = await api().request<Category>('POST', `/servers/${detail.id}/categories`, { name: n });
      useData.getState().upsertCategory(c);
      setNewCat(null);
      setSel({ kind: 'category', id: c.id });
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <div className="ch-admin">
      <header className="ch-toolbar">
        <div className="ch-toolbar-title">
          <span className="muted small">
            {total} {total === 1 ? 'canal' : 'canais'} · {detail.categories.length}{' '}
            {detail.categories.length === 1 ? 'categoria' : 'categorias'}
          </span>
        </div>
        <TextField
          aria-label="Buscar canais"
          type="search"
          leadingIcon="search"
          placeholder="Buscar canal ou tópico"
          fieldClassName="ch-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {canChannels && (
          <div className="ch-toolbar-actions">
            <Button size="sm" variant="secondary" icon="folder" onClick={() => setNewCat('')}>
              Nova categoria
            </Button>
            <Button
              size="sm"
              icon="plus"
              onClick={() =>
                useUi.getState().openModal({
                  kind: 'create-channel',
                  serverId: detail.id,
                  channelKind: 'text',
                  categoryId: channel?.categoryId ?? category?.id ?? null,
                })
              }
            >
              Criar canal
            </Button>
          </div>
        )}
      </header>

      {newCat !== null && (
        <form className="ch-newcat" onSubmit={(e) => void createCategory(e)}>
          <TextField
            aria-label="Nome da nova categoria"
            autoFocus
            placeholder="Nome da categoria"
            maxLength={64}
            value={newCat}
            fieldClassName="ch-search"
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNewCat(null)}
          />
          <Button type="submit" size="sm" disabled={!newCat.trim()}>
            Criar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setNewCat(null)}>
            Cancelar
          </Button>
        </form>
      )}

      <div className="ch-split">
        <nav className="ch-list" aria-label="Canais do servidor">
          {shown.length === 0 && <p className="muted small ch-empty">Nenhum canal encontrado.</p>}
          {shown.map((g) => (
            <section key={g.id ?? 'none'} className="ch-group">
              {g.id ? (
                <button
                  type="button"
                  className="ch-group-head"
                  aria-current={sel?.kind === 'category' && sel.id === g.id ? 'true' : undefined}
                  onClick={() => setSel({ kind: 'category', id: g.id! })}
                >
                  <span className="truncate">{g.name}</span>
                  <span className="ch-count">{g.channels.length}</span>
                  <Icon name="edit" size={14} className="ch-group-edit" />
                </button>
              ) : (
                <div className="ch-group-head ch-group-static">
                  <span className="truncate">{g.name}</span>
                  <span className="ch-count">{g.channels.length}</span>
                </div>
              )}
              <ul>
                {g.channels.map((c) => {
                  const board = c.boardId ? boards.find((b) => b.id === c.boardId) : undefined;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="ch-item"
                        aria-current={sel?.kind === 'channel' && sel.id === c.id ? 'true' : undefined}
                        onClick={() => setSel({ kind: 'channel', id: c.id })}
                      >
                        <Icon name={CHANNEL_ICON[c.kind]} size={18} className="ch-item-icon" />
                        <span className="ch-item-text">
                          <span className="ch-item-name truncate">{c.name}</span>
                          {c.topic && <span className="ch-item-topic truncate">{c.topic}</span>}
                        </span>
                        <span className="ch-item-flags">
                          {c.private && (
                            <span className="ch-flag" data-tip="Privado">
                              <Icon name="lock" size={13} label="Privado" />
                            </span>
                          )}
                          {board && (
                            <span className="ch-flag" data-tip={`Vira card em ${board.name}`}>
                              <Icon name={CHANNEL_ICON.board} size={13} label={`Vira card em ${board.name}`} />
                            </span>
                          )}
                          {c.roomHub && (
                            <span className="ch-flag" data-tip="Criador de salas">
                              <Icon name="plus" size={13} label="Criador de salas" />
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>

        <div className="ch-detail">
          {channel ? (
            <ChannelEditor key={channel.id} channel={channel} detail={detail} canEdit={canChannels} />
          ) : category ? (
            <CategoryEditor key={category.id} category={category} detail={detail} canEdit={canChannels} />
          ) : (
            <div className="ch-placeholder">
              <Icon name="hashtag" size={28} />
              <p className="muted">Escolha um canal na lista para editar.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChannelEditor({ channel, detail, canEdit }: { channel: Channel; detail: ServerDetail; canEdit: boolean }) {
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [categoryId, setCategoryId] = useState(channel.categoryId ?? 'none');
  const [boardId, setBoardId] = useState(channel.boardId ?? 'none');
  const [busy, setBusy] = useState(false);
  const isText = channel.kind === 'text';
  const boards = detail.channels.filter((c) => c.kind === 'board');
  const categoryName = detail.categories.find((c) => c.id === channel.categoryId)?.name ?? 'Sem categoria';

  const patch: Record<string, unknown> = {};
  if (name.trim() !== channel.name) patch.name = name.trim();
  if (isText && topic.trim() !== (channel.topic ?? '')) patch.topic = topic.trim() || null;
  if (categoryId !== (channel.categoryId ?? 'none')) patch.categoryId = categoryId === 'none' ? null : categoryId;
  if (isText && boardId !== (channel.boardId ?? 'none')) patch.boardId = boardId === 'none' ? null : boardId;
  const dirty = Object.keys(patch).length > 0;

  const send = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      const c = await api().request<Channel>('PATCH', `/channels/${channel.id}`, body);
      useData.getState().upsertChannel({ ...c, myPermissions: channel.myPermissions });
      useUi.getState().toast('success', ok);
      return c;
    } catch (err) {
      toastError(err);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || !name.trim()) return;
    const c = await send(patch, 'Canal atualizado.');
    if (c) {
      setName(c.name);
      setTopic(c.topic ?? '');
    }
  };
  const reset = () => {
    setName(channel.name);
    setTopic(channel.topic ?? '');
    setCategoryId(channel.categoryId ?? 'none');
    setBoardId(channel.boardId ?? 'none');
  };
  const remove = async () => {
    if (
      !(await askConfirm(`O canal “${channel.name}” e as mensagens dele serão perdidos.`, {
        title: 'Excluir canal',
        confirmLabel: 'Excluir',
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await api().request('DELETE', `/channels/${channel.id}`);
      useData.getState().removeChannel(channel.serverId, channel.id);
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  return (
    <form className="ch-editor" onSubmit={(e) => void save(e)}>
      <header className="ch-editor-head">
        <span className="ch-editor-icon" aria-hidden>
          <Icon name={CHANNEL_ICON[channel.kind]} size={22} />
        </span>
        <span className="ch-editor-names">
          <strong className="truncate">{channel.name}</strong>
          <span className="muted small">
            {CHANNEL_LABEL[channel.kind]} · {categoryName}
          </span>
        </span>
      </header>

      <div className="ch-editor-body">
        <TextField
          label="Nome do canal"
          value={name}
          disabled={!canEdit}
          required
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
        {(isText || channel.kind === 'forum') && (
          <TextArea
            label="Tópico"
            hint="Aparece no topo do canal."
            value={topic}
            disabled={!canEdit}
            rows={3}
            maxLength={1024}
            placeholder="Do que se fala aqui?"
            onChange={(e) => setTopic(e.target.value)}
          />
        )}
        <div className="ch-editor-row">
          <Select<string>
            label="Categoria"
            value={categoryId}
            onChange={setCategoryId}
            options={[
              { value: 'none', label: 'Sem categoria' },
              ...[...detail.categories]
                .sort((a, b) => a.position - b.position)
                .map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          {(isText || channel.kind === 'forum') && (
            <Select<string>
              label="Modo lento"
              hint="Tempo entre duas mensagens da mesma pessoa. Quem gerencia mensagens não espera."
              value={String(channel.slowmodeSec)}
              disabled={!canEdit || busy}
              onChange={(v) => {
                const sec = Number(v);
                void send({ slowmodeSec: sec }, sec ? `Modo lento: ${formatSlowmode(sec)}.` : 'Modo lento desligado.');
              }}
              options={[
                ...((SLOWMODE_OPTIONS as readonly number[]).includes(channel.slowmodeSec)
                  ? []
                  : [{ value: String(channel.slowmodeSec), label: formatSlowmode(channel.slowmodeSec) }]),
                ...SLOWMODE_OPTIONS.map((n) => ({ value: String(n), label: n ? formatSlowmode(n) : 'Desligado' })),
              ]}
            />
          )}
          {isText && boards.length > 0 && (
            <Select<string>
              label="Quadro kanban"
              value={boardId}
              onChange={setBoardId}
              options={[
                { value: 'none', label: 'Não vira card' },
                ...boards.map((b) => ({ value: b.id, label: `Vira card em ${b.name}` })),
              ]}
            />
          )}
        </div>

        {canEdit && channel.kind !== 'board' && (
          <div className="ch-editor-switches">
            <Switch
              label="Canal privado"
              description="Só quem tiver permissão de ver o canal o encontra na lista."
              checked={channel.private}
              disabled={busy}
              onChange={(v) => void send({ private: v }, v ? 'Canal agora é privado.' : 'Canal aberto para todos.')}
            />
            {channel.kind === 'voice' && (
              <Switch
                label="Criador de salas"
                description="Quem entra aqui ganha uma sala temporária só sua."
                checked={channel.roomHub}
                disabled={busy}
                onChange={(v) =>
                  void send({ roomHub: v }, v ? 'Criador de salas ligado.' : 'Criador de salas desligado.')
                }
              />
            )}
          </div>
        )}
      </div>

      {canEdit && (
        <>
          <footer className="ch-editor-foot" data-dirty={dirty ? 'true' : undefined}>
            <span className="muted small">{dirty ? 'Há alterações não salvas.' : 'Tudo salvo.'}</span>
            {dirty && (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={reset}>
                Desfazer
              </Button>
            )}
            <Button type="submit" size="sm" disabled={busy || !dirty || !name.trim()}>
              Salvar alterações
            </Button>
          </footer>
          <section className="ch-danger" aria-label="Zona de perigo">
            <span className="ch-danger-text">
              <strong>Excluir canal</strong>
              <span className="muted small">Apaga o canal e todas as mensagens dele. Não dá para desfazer.</span>
            </span>
            <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void remove()}>
              Excluir
            </Button>
          </section>
        </>
      )}
    </form>
  );
}

function CategoryEditor({ category, detail, canEdit }: { category: Category; detail: ServerDetail; canEdit: boolean }) {
  const [name, setName] = useState(category.name);
  const [busy, setBusy] = useState(false);
  const count = detail.channels.filter((c) => c.categoryId === category.id && !c.temporary).length;
  const dirty = name.trim() !== category.name;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || !name.trim()) return;
    setBusy(true);
    try {
      const c = await api().request<Category>('PATCH', `/categories/${category.id}`, { name: name.trim() });
      useData.getState().upsertCategory(c);
      useUi.getState().toast('success', 'Categoria renomeada.');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (
      !(await askConfirm(`A categoria “${category.name}” some; os ${count} canais dela ficam sem categoria.`, {
        title: 'Excluir categoria',
        confirmLabel: 'Excluir',
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await api().request('DELETE', `/categories/${category.id}`);
      useData.getState().removeCategory(detail.id, category.id);
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  return (
    <form className="ch-editor" onSubmit={(e) => void save(e)}>
      <header className="ch-editor-head">
        <span className="ch-editor-icon" aria-hidden>
          <Icon name="folder" size={22} />
        </span>
        <span className="ch-editor-names">
          <strong className="truncate">{category.name}</strong>
          <span className="muted small">
            Categoria · {count} {count === 1 ? 'canal' : 'canais'}
          </span>
        </span>
      </header>
      <div className="ch-editor-body">
        <TextField
          label="Nome da categoria"
          value={name}
          disabled={!canEdit}
          required
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {canEdit && (
        <>
          <footer className="ch-editor-foot" data-dirty={dirty ? 'true' : undefined}>
            <span className="muted small">{dirty ? 'Há alterações não salvas.' : 'Tudo salvo.'}</span>
            <Button type="submit" size="sm" disabled={busy || !dirty || !name.trim()}>
              Salvar alterações
            </Button>
          </footer>
          <section className="ch-danger" aria-label="Zona de perigo">
            <span className="ch-danger-text">
              <strong>Excluir categoria</strong>
              <span className="muted small">Os canais continuam existindo, só ficam sem categoria.</span>
            </span>
            <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => void remove()}>
              Excluir
            </Button>
          </section>
        </>
      )}
    </form>
  );
}
