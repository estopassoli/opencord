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
import { Avatar, AvatarSource, Button, ColorSwatches, Icon, TextArea, TextField } from '@opencord/ui';
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { ImageCropDialog } from '../../components/ImageCropDialog';
import { ProfileCardHead, profileThemeVars, useBannerUrl } from '../../components/ProfileCardView';
import { bannerImage, keepsAnimation, squareImage } from '../../lib/images';
import { useData } from '../../store/data';
import { EMPTY_APPEARANCE, useProfiles } from '../../store/profiles';
import { api, describeError, useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { GifPicker } from '../chat/GifPicker';

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
const HEX = /^#[0-9a-f]{6}$/i;

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
  const [colors, setColors] = useState<[string, string] | null | undefined>(undefined);
  const [banner, setBanner] = useState<ImageDraft>({ kind: 'keep' });
  const [avatar, setAvatar] = useState<AvatarDraft>({ kind: 'keep' });
  const [busy, setBusy] = useState(false);
  const [gifFor, setGifFor] = useState<'avatar' | 'banner' | null>(null);
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

  return (
    <div className="profile-editor">
      <div className="profile-editor-controls">
        <section>
          <h3>Foto</h3>
          <div className="profile-editor-row">
            <Button size="sm" icon="upload" onClick={() => avatarInput.current?.click()}>
              Enviar imagem
            </Button>
            {gifCfg && (
              <Button size="sm" variant="ghost" icon="image" onClick={() => setGifFor('avatar')}>
                Escolher GIF
              </Button>
            )}
            {avatarSrc && (
              <Button size="sm" variant="ghost" onClick={() => setAvatar({ kind: 'none' })}>
                Remover
              </Button>
            )}
          </div>
          {recent.length > 0 && (
            <div className="profile-recent" role="group" aria-label="Fotos recentes">
              <span className="muted small">Recentes</span>
              <div>
                {recent.map((r) => (
                  <button
                    key={r.entry}
                    type="button"
                    className="profile-recent-item"
                    aria-pressed={avatar.kind === 'recent' && avatar.entry === r.entry}
                    aria-label="Usar esta foto de novo"
                    data-tip="Usar de novo"
                    onClick={() =>
                      setAvatar({
                        kind: 'recent',
                        entry: r.entry,
                        url: r.url.startsWith('/') && base ? `${base}${r.url}` : r.url,
                      })
                    }
                  >
                    <Avatar
                      id={me.id}
                      name={me.displayName}
                      size={44}
                      src={r.url.startsWith('/') && base ? `${base}${r.url}` : r.url}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section>
          <h3>Banner</h3>
          <div className="profile-editor-row">
            <Button size="sm" icon="upload" onClick={() => bannerInput.current?.click()}>
              Enviar imagem
            </Button>
            {gifCfg && (
              <Button size="sm" variant="ghost" icon="image" onClick={() => setGifFor('banner')}>
                Escolher GIF
              </Button>
            )}
            {bannerSrc && (
              <Button size="sm" variant="ghost" onClick={() => setBanner({ kind: 'none' })}>
                Remover
              </Button>
            )}
          </div>
          <span className="muted small">
            PNG, JPEG, WebP ou GIF animado (até 4 MB). Sem banner, vale a primeira cor.
          </span>
        </section>

        <section>
          <h3>Cores do perfil</h3>
          <ColorSwatches
            label="Cor de cima"
            colors={PROFILE_COLORS}
            value={shownColors?.[0] ?? null}
            onChange={(c) => setColor(0, c)}
          />
          <ColorSwatches
            label="Cor de baixo"
            colors={PROFILE_COLORS}
            value={shownColors?.[1] ?? null}
            onChange={(c) => setColor(1, c)}
          />
          <div className="profile-editor-row">
            <HexField label="Cor de cima (#rrggbb)" value={shownColors?.[0] ?? ''} onChange={(c) => setColor(0, c)} />
            <HexField label="Cor de baixo (#rrggbb)" value={shownColors?.[1] ?? ''} onChange={(c) => setColor(1, c)} />
          </div>
          {shownColors && (
            <Button size="sm" variant="ghost" onClick={() => setColors(null)}>
              Tirar as cores
            </Button>
          )}
        </section>

        <section>
          <h3>Bio</h3>
          <TextArea
            aria-label="Sobre mim"
            value={draft.bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={BIO_MAX}
            rows={4}
            placeholder="Conte um pouco sobre você. Dá para usar **negrito**, links e emojis."
          />
          <span className="muted small profile-bio-count">
            {draft.bio.length}/{BIO_MAX}
          </span>
        </section>
      </div>

      <div className="profile-editor-preview">
        <span className="muted small">Como os outros veem</span>
        <div className="profile-preview" data-themed={shownColors ? 'true' : undefined} style={previewStyle}>
          <AvatarOverride id={me.id} src={avatarSrc}>
            <ProfileCardHead
              user={me}
              appearance={draft}
              bannerSrc={bannerSrc}
              name={me.displayName}
              subtitle={`@${me.username}`}
            />
          </AvatarOverride>
        </div>
      </div>

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

/** campo de cor digitada: só aplica quando o hex fica válido */
function HexField({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <TextField
      label={label}
      value={text}
      maxLength={7}
      fieldClassName="profile-hex"
      onChange={(e) => {
        const v = e.target.value.trim();
        setText(v);
        const hex = v.startsWith('#') ? v : `#${v}`;
        if (HEX.test(hex)) onChange(hex.toLowerCase());
      }}
    />
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
