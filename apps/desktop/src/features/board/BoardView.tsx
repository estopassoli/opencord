import {
  BOARD_COLUMNS,
  hasPermission,
  Permission,
  type BoardCard,
  type BoardColumn,
  type Channel,
} from '@opencord/contracts';
import { Avatar, Button, Icon, Select, TextArea, TextField } from '@opencord/ui';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { openContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { Dialog } from '../../components/Dialog';
import { MobileNavButton } from '../../components/MobileNavButton';
import { useBoards } from '../../store/boards';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';

const NO_CARDS: BoardCard[] = [];
const date = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

/**
 * Quadro kanban (ADR-0017): colunas fixas (Novo, Em análise, Em andamento, Resolvido). Quem gerencia mensagens
 * arrasta cards entre colunas (ou usa o menu/diálogo pelo teclado), edita, cria e exclui; os demais só veem.
 * Cards de relatos mostram quem relatou e levam à mensagem original.
 */
export function BoardView({ channel }: { channel: Channel }) {
  const cards = useBoards((s) => s.byBoard[channel.id]) ?? NO_CARDS;
  const loaded = useBoards((s) => channel.id in s.byBoard);
  const canManage = hasPermission(channel.myPermissions, Permission.MANAGE_MESSAGES);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ column: BoardColumn; before: string | null } | null>(null);

  useEffect(() => {
    void useBoards.getState().load(channel.id);
  }, [channel.id]);

  const columns = useMemo(
    () =>
      BOARD_COLUMNS.map((col) => ({
        ...col,
        cards: cards.filter((c) => c.column === col.id).sort((a, b) => a.position - b.position),
      })),
    [cards],
  );
  const openCard = cards.find((c) => c.id === open) ?? null;

  /** posição para soltar antes de `before` (ou no fim da coluna) */
  const positionFor = (column: BoardColumn, before: string | null) => {
    const list = columns.find((c) => c.id === column)?.cards.filter((c) => c.id !== dragging) ?? [];
    if (!list.length) return 0;
    const i = before ? list.findIndex((c) => c.id === before) : -1;
    if (i === -1) return (list[list.length - 1] as BoardCard).position + 1;
    const next = list[i] as BoardCard;
    const prev = list[i - 1];
    return prev ? (prev.position + next.position) / 2 : next.position - 1;
  };

  const drop = () => {
    const card = cards.find((c) => c.id === dragging);
    if (card && dropAt) void useBoards.getState().move(card, dropAt.column, positionFor(dropAt.column, dropAt.before));
    setDragging(null);
    setDropAt(null);
  };

  return (
    <section className="board" aria-label={`Quadro ${channel.name}`}>
      <header className="chat-header">
        <MobileNavButton />
        <Icon name="kanban" size={22} />
        <h2 className="truncate">{channel.name}</h2>
        {channel.topic && <span className="chat-topic truncate">{channel.topic}</span>}
        <span className="spacer" />
        {canManage && (
          <Button size="sm" icon="plus" onClick={() => setCreating(true)}>
            Novo card
          </Button>
        )}
      </header>
      <div className="board-columns" aria-busy={!loaded || undefined}>
        {columns.map((col) => (
          <section
            key={col.id}
            className="board-column"
            aria-label={`${col.label}, ${col.cards.length} ${col.cards.length === 1 ? 'card' : 'cards'}`}
            data-drop={dropAt?.column === col.id && dropAt.before === null ? 'true' : undefined}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              // sobre o fundo da coluna (não sobre um card): fim da coluna
              if ((e.target as HTMLElement).closest('.board-card') === null)
                setDropAt((d) => (d?.column === col.id && d.before === null ? d : { column: col.id, before: null }));
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop();
            }}
          >
            <h3 className="board-column-title" data-column={col.id}>
              <span className="truncate">{col.label}</span>
              <span className="board-count">{col.cards.length}</span>
            </h3>
            <ul className="board-cards">
              {col.cards.map((card) => (
                <li
                  key={card.id}
                  data-drop-before={dropAt?.before === card.id ? 'true' : undefined}
                  onDragOver={(e) => {
                    if (!dragging || dragging === card.id) return;
                    e.preventDefault();
                    setDropAt((d) => (d?.before === card.id ? d : { column: col.id, before: card.id }));
                  }}
                >
                  <CardItem
                    card={card}
                    canManage={canManage}
                    dragging={dragging === card.id}
                    onOpen={() => setOpen(card.id)}
                    onDragStart={() => setDragging(card.id)}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropAt(null);
                    }}
                  />
                </li>
              ))}
            </ul>
            {loaded && !col.cards.length && <p className="board-empty muted small">Nada aqui.</p>}
          </section>
        ))}
      </div>
      {openCard && <CardDialog card={openCard} canManage={canManage} onClose={() => setOpen(null)} />}
      {creating && <NewCardDialog boardId={channel.id} onClose={() => setCreating(false)} />}
    </section>
  );
}

function cardMenu(card: BoardCard, canManage: boolean, onOpen: () => void): MenuEntry[] {
  const items: MenuEntry[] = [{ label: 'Abrir', icon: 'edit', onSelect: onOpen }];
  if (card.sourceChannelId) items.push({ label: 'Ir para o relato', icon: 'chat', onSelect: () => goToSource(card) });
  if (canManage) {
    items.push(
      'separator',
      {
        kind: 'submenu',
        label: 'Mover para',
        items: BOARD_COLUMNS.filter((c) => c.id !== card.column).map((c) => ({
          label: c.label,
          onSelect: () => void useBoards.getState().move(card, c.id),
        })),
      },
      'separator',
      {
        label: 'Excluir card',
        icon: 'trash',
        danger: true,
        onSelect: () => {
          if (confirm(`Excluir o card "${card.title}"?`)) void useBoards.getState().destroy(card);
        },
      },
    );
  }
  return items;
}

function goToSource(card: BoardCard) {
  if (!card.sourceChannelId) return;
  const serverId = Object.values(useData.getState().details).find((d) =>
    d.channels.some((c) => c.id === card.sourceChannelId),
  )?.id;
  if (serverId) useUi.getState().go({ kind: 'server', serverId, channelId: card.sourceChannelId });
}

function CardItem({
  card,
  canManage,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: BoardCard;
  canManage: boolean;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <button
      className="board-card"
      data-column={card.column}
      data-dragging={dragging ? 'true' : undefined}
      draggable={canManage || undefined}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.title);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onContextMenu={(e) => openContextMenu(e, cardMenu(card, canManage, onOpen), `Card ${card.title}`)}
    >
      <span className="board-card-title">{card.title}</span>
      {card.body && card.body !== card.title && (
        <span className="board-card-body">
          {card.body
            .split('\n')
            .slice(card.messageId ? 1 : 0)
            .join(' ')}
        </span>
      )}
      <span className="board-card-foot">
        {card.reporter && <Avatar id={card.reporter.id} name={card.reporter.displayName} size={18} />}
        <span className="truncate">{card.reporter?.displayName ?? 'Equipe'}</span>
        {card.attachments > 0 && <Icon name="attach" size={14} label={`${card.attachments} anexo(s)`} />}
        <time dateTime={card.createdAt}>{date(card.createdAt)}</time>
      </span>
    </button>
  );
}

function CardDialog({ card, canManage, onClose }: { card: BoardCard; canManage: boolean; onClose: () => void }) {
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body);
  const dirty = title.trim() !== card.title || body.trim() !== card.body;
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    void useBoards.getState().update(card, { title: title.trim(), body: body.trim() });
    onClose();
  };
  return (
    <Dialog title={canManage ? 'Editar card' : card.title} onClose={onClose} wide>
      <form className="form board-dialog" onSubmit={save}>
        <p className="muted small">
          {card.reporter
            ? `${card.messageId ? 'Relatado' : 'Criado'} por ${card.reporter.displayName}`
            : 'Criado pela equipe'}{' '}
          em {date(card.createdAt)}
          {card.attachments > 0 && ` · ${card.attachments} anexo(s) na mensagem`}
        </p>
        {canManage ? (
          <>
            <TextField
              label="Título"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
            />
            <TextArea
              label="Descrição"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              maxLength={4000}
            />
            <Select<BoardColumn>
              label="Coluna"
              value={card.column}
              onChange={(c) => void useBoards.getState().move(card, c)}
              options={BOARD_COLUMNS.map((c) => ({ value: c.id, label: c.label }))}
            />
          </>
        ) : (
          <p className="board-dialog-body">{card.body}</p>
        )}
        <div className="form-actions">
          {canManage && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (!confirm(`Excluir o card "${card.title}"?`)) return;
                void useBoards.getState().destroy(card);
                onClose();
              }}
            >
              Excluir
            </Button>
          )}
          <span className="spacer" />
          {card.sourceChannelId && (
            <Button
              variant="ghost"
              icon="chat"
              onClick={() => {
                goToSource(card);
                onClose();
              }}
            >
              Ir para o relato
            </Button>
          )}
          {canManage ? (
            <Button type="submit" disabled={!dirty || !title.trim()}>
              Salvar
            </Button>
          ) : (
            <Button onClick={onClose}>Fechar</Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

function NewCardDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  return (
    <Dialog title="Novo card" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          void useBoards.getState().create(boardId, title.trim(), body.trim());
          onClose();
        }}
      >
        <TextField
          label="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          autoFocus
        />
        <TextArea label="Descrição" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} />
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!title.trim()}>
            Criar card
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
