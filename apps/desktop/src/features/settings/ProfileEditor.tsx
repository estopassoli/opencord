/**
 * Configurações → Perfil (ADR-0048): editor com prévia ao vivo. À esquerda foto (enviar, GIF do KLIPY ou uma das
 * recentes), banner (enviar ou GIF), as duas cores do cartão e a bio; à direita o cartão como os outros vão ver.
 * Nada vai para o servidor até "Salvar" (a barra aparece quando há mudanças).
 */
import {
  BIO_MAX,
  type Me,
  type ProfileAppearance,
  type ProfileUpdateResponse,
  type RecentAvatar,
} from '@opencord/contracts';
import { Avatar, AvatarSource, Button, ColorPicker, Icon, TextArea, TextField } from '@opencord/ui';
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { ImageCropDialog } from '../../components/ImageCropDialog';
import { ProfileCardHead, profileThemeVars, useBannerUrl } from '../../components/ProfileCardView';
import { bannerImage, keepsAnimation, squareImage } from '../../lib/images';
import { BadgeGlyph, useBadgeCatalog } from '../../components/UserBadges';
import { useData } from '../../store/data';
import { EMPTY_APPEARANCE, useProfiles } from '../../store/profiles';
import { api, describeError, useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { GifPicker } from '../chat/GifPicker';
import { renderRich } from '../chat/rich';

/** cores para o degradê: claras, médias e escuras (o texto do cartão se ajusta sozinho) */
const PROFILE_COLORS = [
  '#ff5a5f',
  '#b3262f',
  '#4a0d14',
  '#ff9f43',
  '#b45f06',
  '#ffd166',
  '#3fb27f',
  '#0f5132',
  '#5fd3c6',
  '#1b6f8a',
  '#6cc7ff',
  '#1e3a8a',
  '#8a9cff',
  '#b98cf2',
  '#5b2a86',
  '#e86fb4',
  '#7a1f5c',
  '#a7b0bf',
  '#2b2d31',
  '#0b0c0e',
] as const;

type ImageDraft =
  { kind: 'keep' } | { kind: 'none' } | { kind: 'file'; file: File; preview: string } | { kind: 'url'; url: string };
type AvatarDraft = ImageDraft | { kind: 'recent'; entry: string; url: string };

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

export function ProfileEditor({ me }: { me: Me }) {
  const saved = useProfiles((s) => s.byId[me.id]);
  const gifCfg = useData((s) => s.instance?.gifs ?? null);
  const base = useSession((s) => s.serverUrl)?.replace(/\/+$/, '');
  useEffect(() => {
    void api()
      .request<ProfileUpdateResponse>('GET', '/me/profile')
      .then((r) => useProfiles.getState().set(me.id, r.appearance), toastError);
  }, [me.id]);
  const current = saved ?? EMPTY_APPEARANCE;

  const [bio, setBio] = useState<string | null>(null);
  // insígnias em destaque (até 3 das minhas)
  const catalog = useBadgeCatalog();
  const myBadges = catalog.filter((b) => (me.badges ?? []).includes(b.id));
  const [featured, setFeatured] = useState<string[] | null>(null);
  const featuredDraft = featured ?? me.featuredBadges ?? [];
  // status com texto (o mesmo do menu do usuário): no balão ao lado da foto
  const savedStatus = useData((s) => s.myStatusText) ?? '';
  const [status, setStatus] = useState<string | null>(null);
  const statusDraft = status ?? savedStatus;
  const [colors, setColors] = useState<[string, string] | null | undefined>(undefined);
  const [banner, setBanner] = useState<ImageDraft>({ kind: 'keep' });
  const [avatar, setAvatar] = useState<AvatarDraft>({ kind: 'keep' });
  const [busy, setBusy] = useState(false);
  const [gifFor, setGifFor] = useState<'avatar' | 'banner' | null>(null);
  const [pickFor, setPickFor] = useState<'avatar' | 'banner' | null>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const [recent, setRecent] = useState<RecentAvatar[]>([]);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const loadRecent = () =>
    void api()
      .request<RecentAvatar[]>('GET', '/me/avatars/recent')
      .then(setRecent, () => undefined);
  useEffect(loadRecent, []);

  const draft: ProfileAppearance = {
    bio: bio ?? current.bio,
    colors: colors === undefined ? current.colors : colors,
    bannerKey: banner.kind === 'keep' ? current.bannerKey : null,
    bannerUrl: banner.kind === 'keep' ? current.bannerUrl : banner.kind === 'url' ? banner.url : null,
  };
  const storedBanner = useBannerUrl(current);
  const bannerSrc =
    banner.kind === 'keep'
      ? storedBanner
      : banner.kind === 'file'
        ? banner.preview
        : banner.kind === 'url'
          ? banner.url
          : null;
  const storedAvatar =
    me.avatarUrl ?? (me.avatarKey && base ? `${base}/avatars/${encodeURIComponent(me.avatarKey)}` : null);
  const avatarSrc =
    avatar.kind === 'keep'
      ? storedAvatar
      : avatar.kind === 'file'
        ? avatar.preview
        : avatar.kind === 'url' || avatar.kind === 'recent'
          ? avatar.url
          : null;
  const dirty =
    (featured !== null && JSON.stringify(featured) !== JSON.stringify(me.featuredBadges ?? [])) ||
    (status !== null && status.trim() !== savedStatus) ||
    (bio !== null && bio.trim() !== current.bio) ||
    (colors !== undefined && JSON.stringify(colors) !== JSON.stringify(current.colors)) ||
    banner.kind !== 'keep' ||
    avatar.kind !== 'keep';

  // libera as prévias locais
  useEffect(
    () => () => {
      if (banner.kind === 'file') URL.revokeObjectURL(banner.preview);
    },
    [banner],
  );
  useEffect(
    () => () => {
      if (avatar.kind === 'file') URL.revokeObjectURL(avatar.preview);
    },
    [avatar],
  );

  const reset = () => {
    setBio(null);
    setFeatured(null);
    setStatus(null);
    setColors(undefined);
    setBanner({ kind: 'keep' });
    setAvatar({ kind: 'keep' });
  };

  const save = async () => {
    setBusy(true);
    try {
      let last: ProfileUpdateResponse | null = null;
      // foto
      if (avatar.kind === 'file') useData.getState().patchUser(await api().upload<Me>('/me/avatar', avatar.file));
      else if (avatar.kind === 'none') useData.getState().patchUser(await api().request<Me>('DELETE', '/me/avatar'));
      else if (avatar.kind === 'recent')
        useData.getState().patchUser(await api().request<Me>('POST', '/me/avatars/recent', { entry: avatar.entry }));
      // banner
      if (banner.kind === 'file') last = await api().upload<ProfileUpdateResponse>('/me/banner', banner.file);
      else if (banner.kind === 'none') last = await api().request<ProfileUpdateResponse>('DELETE', '/me/banner');
      // texto, cores e o que é GIF do KLIPY
      const patch = {
        ...(bio !== null && bio.trim() !== current.bio ? { bio: bio.trim() } : {}),
        ...(colors !== undefined ? { colors } : {}),
        ...(banner.kind === 'url' ? { bannerUrl: banner.url } : {}),
        ...(avatar.kind === 'url' ? { avatarUrl: avatar.url } : {}),
      };
      if (Object.keys(patch).length) last = await api().request<ProfileUpdateResponse>('PATCH', '/me/profile', patch);
      if (featured !== null) {
        await api().request('PUT', '/me/badges/featured', { badgeIds: featured });
        useData.setState((s) =>
          s.me ? { me: { ...s.me, featuredBadges: featured.length ? featured : undefined } } : {},
        );
      }
      if (status !== null && status.trim() !== savedStatus) {
        const text = status.trim() || null;
        await api().request('PUT', '/me/status-text', { text });
        useData.setState({ myStatusText: text });
      }
      if (last) {
        useProfiles.getState().set(me.id, last.appearance);
        useData.getState().patchUser(last.me);
      }
      reset();
      loadRecent();
      useUi.getState().toast('success', 'Perfil salvo.');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const pickAvatar = async (file: File | undefined) => {
    if (avatarInput.current) avatarInput.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/'))
      return useUi.getState().toast('error', 'Escolha uma imagem (PNG, JPEG, WebP ou GIF).');
    // GIF animado pequeno vai como está (recortar perderia a animação)
    if (await keepsAnimation(file)) return setAvatar({ kind: 'file', file, preview: URL.createObjectURL(file) });
    setCropping(file);
  };

  const pickBanner = async (file: File | undefined) => {
    if (bannerInput.current) bannerInput.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/'))
      return useUi.getState().toast('error', 'Escolha uma imagem (PNG, JPEG, WebP ou GIF).');
    try {
      const f = await bannerImage(file);
      setBanner({ kind: 'file', file: f, preview: URL.createObjectURL(f) });
    } catch (e) {
      toastError(e);
    }
  };

  const shownColors = draft.colors;
  const setColor = (i: 0 | 1, c: string | null) => {
    if (!c) return setColors(null);
    const pair: [string, string] = shownColors ? [...shownColors] : ['#2b2d31', '#0b0c0e'];
    pair[i] = c;
    setColors(pair);
  };

  const previewStyle = useMemo(() => profileThemeVars(shownColors), [shownColors]);

  const recentUrl = (r: RecentAvatar) => (r.url.startsWith('/') && base ? `${base}${r.url}` : r.url);

  return (
    <div className="profile-editor">
      <div className="profile-editor-controls">
        <section>
          <h3>Foto</h3>
          <button
            type="button"
            className="profile-tile profile-tile-avatar"
            aria-label="Trocar foto de perfil"
            onClick={() => setPickFor('avatar')}
          >
            <AvatarOverride id={me.id} src={avatarSrc}>
              <Avatar id={me.id} name={me.displayName} size={72} />
            </AvatarOverride>
            <span className="profile-tile-edit" aria-hidden>
              <Icon name="edit" size={16} />
            </span>
          </button>
        </section>

        <section>
          <h3>Banner</h3>
          <button
            type="button"
            className="profile-tile profile-tile-banner"
            aria-label="Trocar banner"
            onClick={() => setPickFor('banner')}
            style={previewStyle}
          >
            {bannerSrc ? <img src={bannerSrc} alt="" draggable={false} /> : <span className="profile-tile-empty" />}
            <span className="profile-tile-edit" aria-hidden>
              <Icon name="edit" size={16} />
            </span>
          </button>
        </section>

        {myBadges.length > 0 && (
          <section>
            <h3>Insígnias em destaque</h3>
            <span className="muted small">Escolha até 3 para aparecer ao lado do seu nome.</span>
            <div className="profile-featured" role="group" aria-label="Insígnias em destaque">
              {myBadges.map((b) => {
                const on = featuredDraft.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    className="profile-featured-item"
                    aria-pressed={on}
                    disabled={!on && featuredDraft.length >= 3}
                    onClick={() => setFeatured(on ? featuredDraft.filter((x) => x !== b.id) : [...featuredDraft, b.id])}
                  >
                    <BadgeGlyph badge={b} size={18} />
                    <span className="truncate">{b.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section>
          <h3>Cores do perfil</h3>
          <div className="profile-colors">
            <ColorPicker
              label="Cor de cima"
              value={shownColors?.[0] ?? null}
              presets={PROFILE_COLORS}
              onChange={(c) => setColor(0, c)}
            />
            <ColorPicker
              label="Cor de baixo"
              value={shownColors?.[1] ?? null}
              presets={PROFILE_COLORS}
              onChange={(c) => setColor(1, c)}
            />
          </div>
          {shownColors && (
            <Button size="sm" variant="ghost" onClick={() => setColors(null)}>
              Tirar as cores
            </Button>
          )}
        </section>
      </div>

      <div className="profile-editor-preview">
        <span className="muted small">Como os outros veem · clique na foto ou no banner para trocar</span>
        <div className="profile-preview" data-themed={shownColors ? 'true' : undefined} style={previewStyle}>
          <AvatarOverride id={me.id} src={avatarSrc}>
            <ProfileCardHead
              user={me}
              appearance={draft}
              bannerSrc={bannerSrc}
              name={me.displayName}
              subtitle={`@${me.username}`}
              onEditAvatar={() => setPickFor('avatar')}
              onEditBanner={() => setPickFor('banner')}
              bioEditor={<BioField value={draft.bio} onChange={setBio} />}
              statusEditor={<StatusBubble value={statusDraft} onChange={setStatus} />}
            />
          </AvatarOverride>
        </div>
      </div>

      {pickFor && (
        <ImageSourceDialog
          kind={pickFor}
          canGif={Boolean(gifCfg)}
          canRemove={pickFor === 'avatar' ? Boolean(avatarSrc) : Boolean(bannerSrc)}
          recent={pickFor === 'avatar' ? recent.map((r) => ({ ...r, url: recentUrl(r) })) : []}
          meId={me.id}
          meName={me.displayName}
          onClose={() => setPickFor(null)}
          onUpload={() => {
            setPickFor(null);
            (pickFor === 'avatar' ? avatarInput : bannerInput).current?.click();
          }}
          onGif={() => {
            setGifFor(pickFor);
            setPickFor(null);
          }}
          onRecent={(r) => {
            setAvatar({ kind: 'recent', entry: r.entry, url: r.url });
            setPickFor(null);
          }}
          onRemove={() => {
            if (pickFor === 'avatar') setAvatar({ kind: 'none' });
            else setBanner({ kind: 'none' });
            setPickFor(null);
          }}
        />
      )}

      {dirty && (
        <div className="profile-editor-bar" role="status">
          <span>Você tem alterações não salvas.</span>
          <span className="spacer" />
          <Button size="sm" variant="ghost" disabled={busy} onClick={reset}>
            Desfazer
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      )}

      <input
        ref={avatarInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        aria-label="Escolher foto de perfil"
        onChange={(e) => void pickAvatar(e.target.files?.[0])}
      />
      <input
        ref={bannerInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        aria-label="Escolher banner"
        onChange={(e) => void pickBanner(e.target.files?.[0])}
      />
      {cropping && (
        <ImageCropDialog
          file={cropping}
          title="Recortar foto de perfil"
          shape="circle"
          onCancel={() => setCropping(null)}
          onConfirm={(crop) => {
            const f = cropping;
            setCropping(null);
            void squareImage(f, 256, 'avatar', crop).then(
              (out) => setAvatar({ kind: 'file', file: out, preview: URL.createObjectURL(out) }),
              toastError,
            );
          }}
        />
      )}
      {gifFor && gifCfg && (
        <GifDialog
          title={gifFor === 'avatar' ? 'GIF para a foto' : 'GIF para o banner'}
          onClose={() => setGifFor(null)}
          onPick={(url) => {
            if (gifFor === 'avatar') setAvatar({ kind: 'url', url });
            else setBanner({ kind: 'url', url });
            setGifFor(null);
          }}
        />
      )}
    </div>
  );
}

/** Bio editada no próprio cartão (seção "Bio" abaixo do nome): clique para escrever. */
function BioField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="pc-section">
      <h4>Bio</h4>
      {editing ? (
        <div className="pc-bio-editing">
          <TextArea
            bare
            autoFocus
            aria-label="Bio"
            value={value}
            maxLength={BIO_MAX}
            rows={3}
            placeholder="Conte um pouco sobre você. Dá para usar **negrito**, links e emojis."
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setEditing(false);
              }
            }}
          />
          <span className="pc-bio-count">
            {value.length}/{BIO_MAX}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="pc-bio pc-inline-edit"
          data-empty={value ? undefined : 'true'}
          aria-label={value ? 'Editar bio' : 'Escrever bio'}
          onClick={() => setEditing(true)}
        >
          {value ? renderRich(value, () => 'alguém') : 'Escreva algo sobre você'}
        </button>
      )}
    </section>
  );
}

/** Balão ao lado da foto: o status com texto (o mesmo do menu do usuário), editado ali mesmo. */
function StatusBubble({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <div className="pc-status pc-status-editing">
        <TextField
          autoFocus
          aria-label="Status"
          value={value}
          maxLength={80}
          placeholder="O que você está fazendo?"
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setEditing(false);
            }
          }}
        />
      </div>
    );
  return (
    <button
      type="button"
      className="pc-status pc-inline-edit"
      data-empty={value ? undefined : 'true'}
      aria-label={value ? 'Editar status' : 'Escrever status'}
      onClick={() => setEditing(true)}
    >
      {value || (
        <>
          <Icon name="plus-circle" size={14} /> O que você está fazendo?
        </>
      )}
    </button>
  );
}

/** Escolher de onde vem a foto ou o banner: enviar do computador, um GIF do KLIPY ou (foto) uma das recentes. */
function ImageSourceDialog({
  kind,
  canGif,
  canRemove,
  recent,
  meId,
  meName,
  onClose,
  onUpload,
  onGif,
  onRecent,
  onRemove,
}: {
  kind: 'avatar' | 'banner';
  canGif: boolean;
  canRemove: boolean;
  recent: RecentAvatar[];
  meId: string;
  meName: string;
  onClose: () => void;
  onUpload: () => void;
  onGif: () => void;
  onRecent: (r: RecentAvatar) => void;
  onRemove: () => void;
}) {
  return (
    <Dialog title={kind === 'avatar' ? 'Escolher foto' : 'Escolher banner'} onClose={onClose}>
      <div className="image-source">
        <div className="image-source-tiles">
          <button type="button" className="image-source-tile" onClick={onUpload}>
            <Icon name="upload" size={28} />
            <strong>Enviar imagem</strong>
            <span className="muted small">
              {kind === 'avatar' ? 'PNG, JPEG, WebP ou GIF' : 'PNG, JPEG, WebP ou GIF animado, até 4 MB'}
            </span>
          </button>
          {canGif && (
            <button type="button" className="image-source-tile image-source-gif" onClick={onGif}>
              <span className="gif-btn-label">GIF</span>
              <strong>Escolher GIF</strong>
              <span className="muted small">Busque no KLIPY</span>
            </button>
          )}
        </div>
        {recent.length > 0 && (
          <div className="image-source-recent">
            <strong className="small">Fotos recentes</strong>
            <span className="muted small">As últimas {recent.length} que você usou.</span>
            <div>
              {recent.map((r) => (
                <button
                  key={r.entry}
                  type="button"
                  className="profile-recent-item"
                  aria-label="Usar esta foto de novo"
                  data-tip="Usar de novo"
                  onClick={() => onRecent(r)}
                >
                  <Avatar id={meId} name={meName} size={52} src={r.url} />
                </button>
              ))}
            </div>
          </div>
        )}
        {canRemove && (
          <div className="form-actions">
            <Button size="sm" variant="ghost" icon="trash" onClick={onRemove}>
              {kind === 'avatar' ? 'Remover foto' : 'Remover banner'}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** a prévia mostra a foto escolhida (ainda não salva) no lugar da atual */
function AvatarOverride({ id, src, children }: { id: string; src: string | null; children: ReactNode }) {
  const parent = useContext(AvatarSource);
  const resolve = useMemo(() => (uid: string) => (uid === id ? src : parent(uid)), [id, src, parent]);
  return <AvatarSource.Provider value={resolve}>{children}</AvatarSource.Provider>;
}

function GifDialog({ title, onClose, onPick }: { title: string; onClose: () => void; onPick: (url: string) => void }) {
  const cfg = useData((s) => s.instance?.gifs ?? null);
  const anchor = useRef<HTMLDivElement>(null);
  if (!cfg) return null;
  return (
    <Dialog title={title} onClose={onClose} wide>
      <div ref={anchor}>
        <GifPicker cfg={cfg} anchor={anchor} inline onClose={onClose} onPick={(g) => onPick(g.url)} />
      </div>
      <p className="muted small">
        <Icon name="image" size={14} /> O GIF continua vindo do KLIPY: quem abre o seu perfil carrega direto de lá.
      </p>
    </Dialog>
  );
}
