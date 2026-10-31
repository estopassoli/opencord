import type { ServerFolder, ServerLayoutItem, ServerSummary } from '@opencord/contracts';
import { Avatar, Button, ColorSwatches, Icon, TextField } from '@opencord/ui';
import { useShallow } from 'zustand/react/shallow';
import { ServerIcon } from '../../components/ServerIcon';
import { useMemo, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { openContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { Dialog } from '../../components/Dialog';
import { DownloadAppRailItem } from '../../components/DownloadApp';
import { Tooltip } from '../../components/Tooltip';
import {
  applyDrop,
  dropPosAt,
  folderLabel,
  moveBy,
  normalizeLayout,
  removeFromFolder,
  resolveLayout,
  ungroup,
  updateFolder,
  type DragSource,
  type DropPos,
} from '../../lib/serverLayout';
import { useData } from '../../store/data';
import { markServerRead } from '../../store/session';
import { updateSettings } from '../../store/settings';
import { useUi } from '../../store/ui';

/**
 * Item do rail com pílula indicadora à esquerda:
 * ponto quando há não lidas, média no hover/foco e alta quando ativo.
 */
function RailItem({
  label,
  active,
  unread,
  badge,
  card,
  variant,
  onClick,
  onContextMenu,
  dnd,
  drop,
  className,
  expanded,
  style,
  children,
}: {
  label: string;
  active?: boolean;
  unread?: boolean;
  badge?: number;
  /** conteúdo rico do tooltip (cartão do servidor); sem ele, o tooltip é só o nome */
  card?: ReactNode;
  variant?: 'home' | 'action';
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** arrastar para reordenar/agrupar (servidores e pastas) */
  dnd?: HTMLAttributes<HTMLLIElement>;
  /** indicador de onde o item arrastado vai cair */
  drop?: DropPos;
  className?: string;
  /** pasta: aberta/fechada */
  expanded?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <li
      className={className ? `rail-li ${className}` : 'rail-li'}
      data-active={active ? 'true' : undefined}
      data-unread={unread && !active ? 'true' : undefined}
      data-drop={drop}
      {...dnd}
    >
      <span className="rail-pill" aria-hidden />
      <Tooltip label={card ?? label} side="right">
        <button
          className={variant ? `rail-item rail-${variant}` : 'rail-item'}
          aria-current={active ? 'page' : undefined}
          aria-expanded={expanded}
          aria-label={badge ? `${label}, ${badge} menções` : label}
          style={style}
          onClick={onClick}
          onContextMenu={onContextMenu}
        >
          {children}
          {badge ? (
            <span className="badge" aria-hidden>
              {badge > 99 ? '99+' : badge}
            </span>
          ) : null}
        </button>
      </Tooltip>
    </li>
  );
}

export function ServerRail() {
  const servers = useData((s) => s.servers);
  const unread = useData((s) => s.unread);
  const details = useData((s) => s.details);
  const view = useUi((s) => s.view);
  const go = useUi((s) => s.go);
  const open = useUi((s) => s.openModal);
  const isAdmin = useData((s) => Boolean(s.me?.isInstanceAdmin));
  const homeActive = view.kind === 'home' || view.kind === 'dm';
  const dmUnread = Object.values(unread).reduce((n, u) => n + (u.conversationId ? u.unreadCount : 0), 0);

  const layout = useData((s) => s.settings?.serverLayout);
  const entries = useMemo(() => resolveLayout(layout ?? [], servers), [layout, servers]);
  const [drag, setDrag] = useState<DragSource | null>(null);
  const [over, setOver] = useState<{ id: string; pos: DropPos } | null>(null);
  const [editing, setEditing] = useState<ServerFolder | null>(null);
  const mutate = (fn: (l: ServerLayoutItem[]) => ServerLayoutItem[]) =>
    updateSettings((st) => ({ ...st, serverLayout: fn(normalizeLayout(st.serverLayout, servers)) }));
  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };

  /**
   * Arrastar e soltar no rail: borda de cima/baixo do item reordena; o meio de um servidor solto cria uma pasta
   * com os dois e o meio de uma pasta põe o servidor nela. Pasta só reordena.
   */
  const dndFor = (target: DragSource, groupable: boolean): HTMLAttributes<HTMLLIElement> => ({
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', target.id);
      setDrag(target);
    },
    onDragOver: (e) => {
      if (!drag || drag.id === target.id) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const r = e.currentTarget.getBoundingClientRect();
      const pos = dropPosAt(e.clientY - r.top, r.height, groupable && drag.type === 'server');
      if (over?.id !== target.id || over.pos !== pos) setOver({ id: target.id, pos });
    },
    onDragLeave: (e) => {
      if (over?.id === target.id && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
    },
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (drag && over?.id === target.id) {
        const src = drag;
        const pos = over.pos;
        mutate((l) => applyDrop(l, src, { ...target, pos }));
      }
      endDrag();
    },
    onDragEnd: endDrag,
  });
  const dropOn = (id: string) => (over?.id === id ? over.pos : undefined);

  const moveItems = (src: DragSource, inFolder: boolean): MenuEntry[] => [
    'separator',
    { label: 'Mover para cima', icon: 'chevron-up', onSelect: () => mutate((l) => moveBy(l, src, -1)) },
    { label: 'Mover para baixo', icon: 'chevron-down', onSelect: () => mutate((l) => moveBy(l, src, 1)) },
    ...(inFolder
      ? [
          {
            label: 'Tirar da pasta',
            icon: 'folder' as const,
            onSelect: () => mutate((l) => removeFromFolder(l, src.id)),
          },
        ]
      : []),
  ];

  const openServer = (id: string) =>
    go({ kind: 'server', serverId: id, channelId: useUi.getState().lastChannel[id] ?? null }, { keepPanel: true });

  const serverItem = (s: ServerSummary, folder: ServerFolder | null) => {
    const active = view.kind === 'server' && view.serverId === s.id;
    const b = serverBadge(s.id);
    return (
      <RailItem
        key={s.id}
        label={s.name}
        card={<ServerHoverCard server={s} />}
        active={active}
        unread={b.any}
        badge={b.mentions}
        dnd={dndFor({ type: 'server', id: s.id }, !folder)}
        drop={dropOn(s.id)}
        onClick={() => openServer(s.id)}
        onContextMenu={(e) =>
          openContextMenu(
            e,
            [
              {
                label: 'Marcar como lido',
                icon: 'check',
                disabled: !b.any,
                onSelect: () => void markServerRead(s.id),
              },
              {
                label: 'Convidar pessoas',
                icon: 'user-plus',
                onSelect: () => open({ kind: 'invite', serverId: s.id }),
              },
              ...moveItems({ type: 'server', id: s.id }, Boolean(folder)),
              'separator',
              {
                label: 'Configurações do servidor',
                icon: 'settings',
                onSelect: () => open({ kind: 'server-settings', serverId: s.id }),
              },
            ],
            `Opções de ${s.name}`,
          )
        }
      >
        <ServerIcon name={s.name} iconKey={s.iconKey} official={s.official} />
      </RailItem>
    );
  };

  const folderItem = (f: ServerFolder, inside: ServerSummary[]) => {
    const label = folderLabel(f, inside);
    const badges = inside.map((s) => serverBadge(s.id));
    const mentions = badges.reduce((n, b) => n + b.mentions, 0);
    const anyUnread = badges.some((b) => b.any);
    const hasActive = view.kind === 'server' && inside.some((s) => s.id === view.serverId);
    const style = f.color ? ({ '--folder-color': f.color } as CSSProperties) : undefined;
    const toggle = () => mutate((l) => updateFolder(l, f.id, { open: !f.open }));
    const menu = (e: React.MouseEvent) =>
      openContextMenu(
        e,
        [
          {
            label: 'Marcar pasta como lida',
            icon: 'check',
            disabled: !anyUnread,
            onSelect: () => inside.forEach((s) => void markServerRead(s.id)),
          },
          { label: 'Configurações da pasta', icon: 'edit', onSelect: () => setEditing(f) },
          ...moveItems({ type: 'folder', id: f.id }, false),
          'separator',
          { label: 'Desfazer pasta', icon: 'trash', danger: true, onSelect: () => mutate((l) => ungroup(l, f.id)) },
        ],
        `Opções da pasta ${label}`,
      );
    const head = (
      <RailItem
        key={`h:${f.id}`}
        label={f.open ? `Fechar pasta ${label}` : `Pasta ${label}`}
        card={f.open ? undefined : <span className="rail-folder-card">{label}</span>}
        active={!f.open && hasActive}
        unread={!f.open && anyUnread}
        badge={f.open ? undefined : mentions}
        expanded={f.open}
        className="rail-folder-li"
        style={style}
        dnd={dndFor({ type: 'folder', id: f.id }, true)}
        drop={dropOn(f.id)}
        onClick={toggle}
        onContextMenu={menu}
      >
        {f.open ? (
          <span className="rail-folder-icon">
            <Icon name="folder" size={22} />
          </span>
        ) : (
          <span className="rail-folder-grid" aria-hidden>
            {inside.slice(0, 4).map((s) => (
              <span key={s.id} className="rail-folder-cell">
                <ServerIcon name={s.name} iconKey={s.iconKey} official={s.official} />
              </span>
            ))}
          </span>
        )}
      </RailItem>
    );
    if (!f.open) return head;
    return (
      <li key={f.id} className="rail-folder-open" style={style}>
        <ul className="rail-list rail-folder-list" aria-label={`Pasta ${label}`}>
          {head}
          {inside.map((s) => serverItem(s, f))}
        </ul>
      </li>
    );
  };

  const serverBadge = (serverId: string) => {
    let mentions = 0;
    let any = false;
    for (const c of details[serverId]?.channels ?? []) {
      const u = unread[`c:${c.id}`];
      if (u) {
        mentions += u.mentionCount;
        if (u.unreadCount > 0) any = true;
      }
    }
    return { mentions, any };
  };

  return (
    <nav className="rail" aria-label="Servidores">
      <ul className="rail-list">
        <RailItem
          label="Mensagens diretas"
          variant="home"
          active={homeActive}
          unread={dmUnread > 0}
          badge={dmUnread}
          onClick={() => go({ kind: 'home', tab: 'friends' }, { keepPanel: true })}
        >
          <span className="brand-mark brand-mark-sm" aria-hidden />
        </RailItem>
        <li className="rail-sep" role="separator" />
        {entries.map((e) => (e.kind === 'server' ? serverItem(e.server, null) : folderItem(e.folder, e.servers)))}
        <RailItem label="Criar um servidor" variant="action" onClick={() => open({ kind: 'create-server' })}>
          <Icon name="plus" />
        </RailItem>
        <RailItem label="Explorar servidores" variant="action" onClick={() => open({ kind: 'explore-servers' })}>
          <Icon name="search" />
        </RailItem>
        {isAdmin && (
          <RailItem label="Painel admin" variant="action" onClick={() => open({ kind: 'admin' })}>
            <Icon name="shield" />
          </RailItem>
        )}
        <DownloadAppRailItem />
      </ul>
      {editing && (
        <FolderDialog
          folder={editing}
          placeholder={folderLabel(
            { ...editing, name: '' },
            editing.serverIds.flatMap((id) => servers.filter((s) => s.id === id)),
          )}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            const id = editing.id;
            mutate((l) => updateFolder(l, id, patch));
            setEditing(null);
          }}
        />
      )}
    </nav>
  );
}

/** Nome e cor da pasta (só a própria pessoa vê). */
function FolderDialog({
  folder,
  placeholder,
  onClose,
  onSave,
}: {
  folder: ServerFolder;
  placeholder: string;
  onClose: () => void;
  onSave: (patch: { name: string; color: string | null }) => void;
}) {
  const [name, setName] = useState(folder.name);
  const [color, setColor] = useState<string | null>(folder.color);
  return (
    <Dialog
      title="Configurações da pasta"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSave({ name: name.trim(), color })}>Salvar</Button>
        </>
      }
    >
      <form
        className="folder-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name: name.trim(), color });
        }}
      >
        <TextField
          label="Nome da pasta"
          value={name}
          maxLength={32}
          placeholder={placeholder}
          hint="Em branco, a pasta mostra os nomes dos servidores."
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <ColorSwatches label="Cor da pasta" value={color} onChange={setColor} />
      </form>
    </Dialog>
  );
}

/**
 * Cartão ao passar o mouse num servidor: imagem, nome (com selo) e quem está em voz agora, com o canal e se há live.
 * Os avatares vêm do estado de voz que o app já recebe em tempo real.
 */
function ServerHoverCard({ server }: { server: ServerSummary }) {
  const inVoice = useData(useShallow((st) => Object.values(st.voiceStates).filter((v) => v.serverId === server.id)));
  const detail = useData((st) => st.details[server.id]);
  const nameOf = (id: string) => {
    const m = detail?.members.find((x) => x.user.id === id);
    return m?.nickname ?? m?.user.displayName ?? '?';
  };
  const channels = new Set(inVoice.map((v) => v.channelId));
  const firstChannel = detail?.channels.find((c) => channels.has(c.id))?.name;
  const live = inVoice.some((v) => v.streaming);
  return (
    <span className="server-card">
      <span className="server-card-head">
        <span className="server-card-icon" aria-hidden="true">
          <ServerIcon name={server.name} iconKey={server.iconKey} official={server.official} />
        </span>
        <strong className="truncate">{server.name}</strong>
        {(server.official || server.verified) && <Icon name="verified" size={14} active label="Verificado" />}
      </span>
      {inVoice.length > 0 && (
        <span className="server-card-voice">
          <Icon name="speaker" size={16} label="Em voz" />
          <span className="server-card-avatars">
            {inVoice.slice(0, 6).map((v) => (
              <Avatar key={v.userId} id={v.userId} name={nameOf(v.userId)} size={24} />
            ))}
            {inVoice.length > 6 && <span className="server-card-more">+{inVoice.length - 6}</span>}
          </span>
          {live && <span className="live-pill">AO VIVO</span>}
        </span>
      )}
      {inVoice.length > 0 && (
        <span className="server-card-sub">
          {inVoice.length} em voz
          {channels.size === 1 && firstChannel
            ? ` · ${firstChannel}`
            : channels.size > 1
              ? ` · ${channels.size} canais`
              : ''}
        </span>
      )}
    </span>
  );
}
