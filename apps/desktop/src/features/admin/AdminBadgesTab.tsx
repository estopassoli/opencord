/**
 * Insígnias no painel admin (ADR-0043): criar, editar (ícone + cor ou imagem enviada), apagar, e dar ou tirar de uma
 * pessoa. O catálogo chega a todos em InstanceInfo.badges; aqui só escrevemos pela API do admin.
 */
import {
  BADGE_DESCRIPTION_MAX,
  BADGE_NAME_MAX,
  type AdminUser,
  type Badge,
  type CreateBadgeRequest,
} from '@opencord/contracts';
import { Button, Checkbox, ColorSwatches, Icon, RadioGroup, TextArea, TextField } from '@opencord/ui';
import { useRef, useState, type FormEvent } from 'react';
import { askConfirm } from '../../components/AskDialog';
import { Dialog } from '../../components/Dialog';
import { BADGE_ICONS, BadgeGlyph, useBadgeCatalog } from '../../components/UserBadges';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { Card, Empty, IconButton } from './adminKit';

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

export function BadgesTab() {
  const catalog = useBadgeCatalog();
  const [editing, setEditing] = useState<Badge | 'new' | null>(null);

  const remove = async (b: Badge) => {
    if (
      !(await askConfirm('A insígnia some do perfil de todo mundo que a tem.', {
        title: `Apagar “${b.name}”`,
        confirmLabel: 'Apagar',
        danger: true,
      }))
    )
      return;
    try {
      await api().request('DELETE', `/admin/badges/${b.id}`);
      useUi.getState().toast('success', 'Insígnia apagada.');
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="adm-stack">
      <div className="adm-toolbar">
        <p className="muted small adm-toolbar-text">
          {catalog.length === 0
            ? 'Nenhuma insígnia ainda.'
            : `${catalog.length} insígnia(s). O selo Verificado continua no menu de cada usuário.`}
        </p>
        <Button size="sm" icon="plus" onClick={() => setEditing('new')}>
          Nova insígnia
        </Button>
      </div>
      {catalog.length === 0 ? (
        <Card>
          <Empty icon="star">Crie a primeira insígnia e dê para as pessoas em Usuários → Insígnias.</Empty>
        </Card>
      ) : (
        <ul className="adm-badge-grid">
          {catalog.map((b) => (
            <li key={b.id} className="adm-badge-card">
              <span className="adm-badge-glyph">
                <BadgeGlyph badge={b} size={28} />
              </span>
              <span className="adm-badge-text">
                <strong className="truncate">{b.name}</strong>
                <span className="muted small">{b.description || 'Sem descrição'}</span>
              </span>
              <span className="adm-badge-actions">
                <IconButton icon="edit" label={`Editar ${b.name}`} onClick={() => setEditing(b)} />
                <IconButton icon="trash" label={`Apagar ${b.name}`} danger onClick={() => void remove(b)} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && <BadgeDialog badge={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

type Look = 'icon' | 'image';

function BadgeDialog({ badge, onClose }: { badge: Badge | null; onClose: () => void }) {
  const [name, setName] = useState(badge?.name ?? '');
  const [description, setDescription] = useState(badge?.description ?? '');
  const [look, setLook] = useState<Look>(badge?.imageKey ? 'image' : 'icon');
  const [icon, setIcon] = useState(badge?.icon ?? 'star');
  const [color, setColor] = useState<string | null>(badge?.color ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (look === 'image' && !file && !badge?.imageKey)
      return useUi.getState().toast('info', 'Escolha uma imagem ou use um ícone.');
    setBusy(true);
    try {
      const body: CreateBadgeRequest = { name: name.trim(), description: description.trim(), icon, color };
      const saved = badge
        ? await api().request<Badge>('PATCH', `/admin/badges/${badge.id}`, body)
        : await api().request<Badge>('POST', '/admin/badges', body);
      if (look === 'image' && file) await api().upload<Badge>(`/admin/badges/${saved.id}/image`, file);
      if (look === 'icon' && saved.imageKey) await api().request('DELETE', `/admin/badges/${saved.id}/image`);
      useUi.getState().toast('success', badge ? 'Insígnia salva.' : 'Insígnia criada.');
      onClose();
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  const shown = { name, icon, color, imageKey: look === 'image' && !preview ? (badge?.imageKey ?? null) : null };

  return (
    <Dialog title={badge ? `Editar “${badge.name}”` : 'Nova insígnia'} onClose={onClose}>
      <form className="badge-form" onSubmit={(e) => void submit(e)}>
        <div className="badge-preview" aria-hidden>
          {look === 'image' && preview ? (
            <img className="badge-img" src={preview} alt="" width={40} height={40} />
          ) : (
            <BadgeGlyph badge={look === 'image' ? shown : { ...shown, imageKey: null }} size={40} />
          )}
          <span className="truncate">{name || 'Nome da insígnia'}</span>
        </div>
        <TextField
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={BADGE_NAME_MAX}
          required
          placeholder="Ex.: Testador"
        />
        <TextArea
          label="Descrição (aparece no perfil)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={BADGE_DESCRIPTION_MAX}
          rows={2}
          placeholder="Ex.: Ajudou a testar as primeiras versões"
        />
        <RadioGroup<Look>
          label="Aparência"
          value={look}
          onChange={setLook}
          options={[
            { value: 'icon', label: 'Ícone e cor' },
            { value: 'image', label: 'Imagem enviada' },
          ]}
        />
        {look === 'icon' ? (
          <>
            <div className="badge-icon-grid" role="radiogroup" aria-label="Ícone">
              {BADGE_ICONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={icon === n}
                  aria-label={n}
                  className="badge-icon-option"
                  onClick={() => setIcon(n)}
                >
                  <Icon name={n} size={20} />
                </button>
              ))}
            </div>
            <ColorSwatches label="Cor" value={color} onChange={setColor} />
          </>
        ) : (
          <div className="badge-upload">
            <Button type="button" variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
              <Icon name="upload" size={16} /> {file || badge?.imageKey ? 'Trocar imagem' : 'Escolher imagem'}
            </Button>
            <span className="muted small">PNG, JPEG, WebP ou GIF, quadrada, de 16 a 1024 px (até 1 MB).</span>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>
        )}
        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {badge ? 'Salvar' : 'Criar'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Dar ou tirar insígnias de uma pessoa (Usuários → menu → Insígnias). */
export function UserBadgesDialog({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  onClose: () => void;
  onSaved: (u: AdminUser) => void;
}) {
  const catalog = useBadgeCatalog();
  const [picked, setPicked] = useState<string[]>(user.badges ?? []);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));

  const save = async () => {
    setBusy(true);
    try {
      const u = await api().request<AdminUser>('PUT', `/admin/users/${user.id}/badges`, { badgeIds: picked });
      onSaved(u);
      useUi.getState().toast('success', 'Insígnias atualizadas.');
      onClose();
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Insígnias de ${user.displayName}`} onClose={onClose}>
      {catalog.length === 0 ? (
        <p className="muted">Crie insígnias na aba Insígnias primeiro.</p>
      ) : (
        <ul className="badge-pick">
          {catalog.map((b) => (
            <li key={b.id}>
              <Checkbox
                checked={picked.includes(b.id)}
                onChange={(on) => toggle(b.id, on)}
                label={
                  <span className="badge-pick-label">
                    <BadgeGlyph badge={b} size={18} />
                    {b.name}
                  </span>
                }
                description={b.description || undefined}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button disabled={busy || !catalog.length} onClick={() => void save()}>
          Salvar
        </Button>
      </div>
    </Dialog>
  );
}
