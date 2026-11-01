/**
 * Eventos do servidor (ADR-0028): lista dos próximos ("sex 21:00 · Raid"), quem vai, "Vou"/"Talvez", e o formulário
 * para criar ou editar. Abre pela linha "Eventos" no topo da lista de canais.
 */
import {
  hasPermission,
  Permission,
  type CreateEventRequest,
  type RsvpStatus,
  type ServerEvent,
} from '@opencord/contracts';
import { Avatar, Button, Icon, Select, TextArea, TextField } from '@opencord/ui';
import { useState, type FormEvent } from 'react';
import { askConfirm } from '../../components/AskDialog';
import { Dialog } from '../../components/Dialog';
import { useAliases } from '../../lib/names';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { whenLabel } from '../../lib/when';

/** valor do campo datetime-local (hora local, sem fuso) */
function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function EventsDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const events = useData((s) => s.events[serverId]);
  const detail = useData((s) => s.details[serverId]);
  const meId = useData((s) => s.me?.id ?? '');
  const aliases = useAliases();
  const [editing, setEditing] = useState<ServerEvent | 'new' | null>(null);
  const canManage = hasPermission(detail?.myPermissions ?? 0, Permission.MANAGE_CHANNELS);
  const nameOf = (id: string) => {
    const m = detail?.members.find((x) => x.user.id === id);
    return aliases?.[id] ?? m?.nickname ?? m?.user.displayName ?? 'alguém';
  };
  const channelName = (id: string | null) => detail?.channels.find((c) => c.id === id)?.name;

  const rsvp = (e: ServerEvent, status: RsvpStatus | null) =>
    void api()
      .request<ServerEvent>('PUT', `/events/${e.id}/rsvp`, { status })
      .then(
        (ev) => useData.getState().upsertEvent({ ...ev, me: status }),
        (err: unknown) => useUi.getState().toast('error', describeError(err)),
      );
  const remove = async (e: ServerEvent) => {
    if (
      !(await askConfirm(`"${e.title}" some para todo mundo.`, {
        title: 'Apagar evento',
        confirmLabel: 'Apagar',
        danger: true,
      }))
    )
      return;
    void api()
      .request('DELETE', `/events/${e.id}`)
      .then(
        () => useData.getState().removeEvent(serverId, e.id),
        (err: unknown) => useUi.getState().toast('error', describeError(err)),
      );
  };
  const join = (e: ServerEvent) => {
    if (!e.channelId) return;
    void useVoice.getState().join(e.channelId, serverId);
    onClose();
  };

  if (editing)
    return (
      <EventForm serverId={serverId} event={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
    );

  const now = Date.now();
  return (
    <Dialog
      title="Eventos"
      onClose={onClose}
      actions={
        <Button icon="calendar" onClick={() => setEditing('new')}>
          Criar evento
        </Button>
      }
    >
      <div className="events-list">
        {!events?.length && (
          <div className="pins-empty">
            <Icon name="calendar" size={32} />
            <p>Nenhum evento marcado.</p>
            <p className="muted small">
              Combine a próxima jogatina: dia, hora e canal de voz. Quem confirmar recebe um lembrete.
            </p>
          </div>
        )}
        {events?.map((e) => {
          const started = new Date(e.startsAt).getTime() <= now;
          return (
            <article key={e.id} className="event-card" data-started={started ? 'true' : undefined}>
              <div className="event-when">
                <Icon name="calendar" size={16} />
                <span>{started ? 'Rolando agora' : whenLabel(e.startsAt)}</span>
                {e.channelId && channelName(e.channelId) && (
                  <span className="muted">
                    <Icon name="speaker" size={14} /> {channelName(e.channelId)}
                  </span>
                )}
              </div>
              <h3 className="event-title">{e.title}</h3>
              {e.description && <p className="event-desc">{e.description}</p>}
              <div className="event-people">
                <span className="event-avatars">
                  {e.going.slice(0, 6).map((id) => (
                    <Avatar key={id} id={id} name={nameOf(id)} size={22} />
                  ))}
                </span>
                <span className="muted small">
                  {e.going.length === 1 ? '1 pessoa vai' : `${e.going.length} pessoas vão`}
                  {e.maybe.length > 0 && ` · ${e.maybe.length} talvez`}
                  {' · criado por '}
                  {nameOf(e.createdBy.id)}
                </span>
              </div>
              <div className="event-actions">
                <Button
                  size="sm"
                  variant={e.me === 'going' ? 'primary' : 'secondary'}
                  aria-pressed={e.me === 'going'}
                  onClick={() => rsvp(e, e.me === 'going' ? null : 'going')}
                >
                  Vou
                </Button>
                <Button
                  size="sm"
                  variant={e.me === 'maybe' ? 'primary' : 'secondary'}
                  aria-pressed={e.me === 'maybe'}
                  onClick={() => rsvp(e, e.me === 'maybe' ? null : 'maybe')}
                >
                  Talvez
                </Button>
                {started && e.channelId && (
                  <Button size="sm" icon="speaker" onClick={() => join(e)}>
                    Entrar na chamada
                  </Button>
                )}
                <span className="spacer" />
                {(e.createdBy.id === meId || canManage) && (
                  <>
                    <button
                      className="icon-btn"
                      aria-label="Editar evento"
                      data-tip="Editar"
                      onClick={() => setEditing(e)}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="Apagar evento"
                      data-tip="Apagar"
                      onClick={() => void remove(e)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </Dialog>
  );
}

function EventForm({ serverId, event, onClose }: { serverId: string; event: ServerEvent | null; onClose: () => void }) {
  const channels = useData((s) => s.details[serverId]?.channels);
  const voices = (channels ?? []).filter((c) => c.kind === 'voice');
  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [channelId, setChannelId] = useState<string>(event?.channelId ?? '');
  const [startsAt, setStartsAt] = useState(toLocalInput(event?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(event?.endsAt ? toLocalInput(event.endsAt) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: CreateEventRequest = {
      title,
      description,
      channelId: channelId || null,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
    };
    try {
      const saved = event
        ? await api().request<ServerEvent>('PATCH', `/events/${event.id}`, body)
        : await api().request<ServerEvent>('POST', `/servers/${serverId}/events`, body);
      useData.getState().upsertEvent(saved);
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={event ? 'Editar evento' : 'Criar evento'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <TextField
          label="Nome"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={100}
          autoFocus
        />
        <TextField
          label="Começa em"
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          required
        />
        <TextField
          label="Termina em (opcional)"
          type="datetime-local"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
        />
        <Select<string>
          label="Canal de voz (opcional)"
          placeholder="Sem canal"
          value={channelId}
          onChange={setChannelId}
          options={[{ value: '', label: 'Sem canal' }, ...voices.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <TextArea
          label="Descrição (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          rows={3}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !title.trim()}>
            {event ? 'Salvar' : 'Criar evento'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
