/**
 * Configurações do servidor (ADR-0050), para todos os servidores, sem plano pago:
 * - Perfil do servidor: faixa (cor pronta ou imagem), até 5 características, descrição, com prévia ao vivo;
 * - Engajamento: canal das mensagens do sistema, boas-vindas, notificação padrão, canal de ausentes e fundo do convite.
 */
import {
  AFK_TIMEOUTS,
  SERVER_BANNER_COLORS,
  type ServerDetail,
  type ServerSummary,
  type ServerTrait,
} from '@opencord/contracts';
import { Button, Icon, RadioGroup, Select, Switch, TextArea, TextField } from '@opencord/ui';
import { useRef, useState } from 'react';
import { ServerIcon } from '../../components/ServerIcon';
import { bannerImage } from '../../lib/images';
import { BANNER_GRADIENTS, BANNER_LABEL, useBannerStyle, useServerImageUrl } from '../../lib/serverBanner';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { Section } from '../settings/SettingsModal';
import { GifDialog } from '../settings/ProfileEditor';
import './server-profile.css';

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

/** guarda o resumo devolvido pela API na lista de servidores e no detalhe aberto */
export const applyServer = (s: ServerSummary) =>
  useData.setState((st) => ({
    servers: st.servers.map((x) => (x.id === s.id ? s : x)),
    details: st.details[s.id] ? { ...st.details, [s.id]: { ...st.details[s.id]!, ...s } } : st.details,
  }));

const patchServer = async (id: string, body: Record<string, unknown>) =>
  applyServer(await api().request<ServerSummary>('PATCH', `/servers/${id}`, body));

/** Envia/remove uma imagem do servidor (faixa ou fundo do convite) com um botão de arquivo escondido. */
function useImageUpload(serverId: string, path: 'banner' | 'invite-background') {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const send = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/'))
      return useUi.getState().toast('error', 'Escolha uma imagem (PNG, JPEG, WebP ou GIF).');
    setBusy(true);
    try {
      applyServer(await api().upload<ServerSummary>(`/servers/${serverId}/${path}`, await bannerImage(file)));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    try {
      applyServer(await api().request<ServerSummary>('DELETE', `/servers/${serverId}/${path}`));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const field = (
    <input
      ref={input}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      hidden
      onChange={(e) => void send(e.target.files?.[0])}
    />
  );
  return { busy, field, pick: () => input.current?.click(), clear };
}

const sameTraits = (a: ServerTrait[], b: ServerTrait[]) =>
  a.length === b.length && a.every((t, i) => t.emoji === b[i]!.emoji && t.label === b[i]!.label);

/** Faixa, características e descrição, com a prévia do cartão do servidor ao lado. */
export function ServerProfileSection({ detail }: { detail: ServerDetail }) {
  const [color, setColor] = useState<string | null>(detail.bannerColor ?? null);
  const [traits, setTraits] = useState<ServerTrait[]>(detail.traits ?? []);
  const [description, setDescription] = useState(detail.description ?? '');
  const [busy, setBusy] = useState(false);
  const image = useImageUpload(detail.id, 'banner');
  const gifsOn = useData((s) => Boolean(s.instance?.gifs));
  const [gifOpen, setGifOpen] = useState(false);
  const [gifBusy, setGifBusy] = useState(false);
  // GIF do KLIPY para a faixa (ADR-0050): a API baixa e guarda uma cópia
  const sendGif = async (url: string) => {
    setGifOpen(false);
    setGifBusy(true);
    try {
      applyServer(await api().request<ServerSummary>('POST', `/servers/${detail.id}/banner/gif`, { url }));
    } catch (e) {
      toastError(e);
    } finally {
      setGifBusy(false);
    }
  };
  const banner = useBannerStyle(detail, { color });

  const cleanTraits = traits
    .filter((t) => t.label.trim())
    .map((t) => ({ emoji: t.emoji.trim(), label: t.label.trim() }));
  const dirty =
    color !== (detail.bannerColor ?? null) ||
    description.trim() !== (detail.description ?? '') ||
    !sameTraits(cleanTraits, detail.traits ?? []);

  const save = async () => {
    setBusy(true);
    try {
      await patchServer(detail.id, { bannerColor: color, traits: cleanTraits, description: description.trim() });
      setTraits(cleanTraits);
      useUi.getState().toast('success', 'Perfil do servidor salvo.');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setColor(detail.bannerColor ?? null);
    setTraits(detail.traits ?? []);
    setDescription(detail.description ?? '');
  };
  const setTrait = (i: number, patch: Partial<ServerTrait>) =>
    setTraits((list) => list.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  return (
    <Section
      title="Perfil do servidor"
      description="Como o servidor aparece no convite e no topo da lista de canais. Tudo aqui vale para qualquer servidor."
    >
      <div className="sp-layout">
        <div className="sp-form">
          <div className="sp-field">
            <span className="oc-label">Faixa</span>
            <div className="sp-swatches" role="radiogroup" aria-label="Cor da faixa">
              <button
                type="button"
                role="radio"
                aria-checked={color === null}
                aria-label="Sem faixa"
                data-tip="Sem faixa"
                className="sp-swatch sp-swatch-none"
                onClick={() => setColor(null)}
              >
                <Icon name="close" size={16} />
              </button>
              {SERVER_BANNER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={BANNER_LABEL[c]}
                  data-tip={BANNER_LABEL[c]}
                  className="sp-swatch"
                  style={{ background: BANNER_GRADIENTS[c] }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <div className="form-actions">
              {image.field}
              <Button size="sm" variant="secondary" icon="upload" disabled={image.busy} onClick={image.pick}>
                {detail.bannerKey ? 'Trocar imagem da faixa' : 'Usar uma imagem'}
              </Button>
              {gifsOn && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="image"
                  disabled={image.busy || gifBusy}
                  onClick={() => setGifOpen(true)}
                >
                  {gifBusy ? 'Baixando GIF…' : 'Escolher GIF'}
                </Button>
              )}
              {detail.bannerKey && (
                <Button size="sm" variant="ghost" disabled={image.busy} onClick={() => void image.clear()}>
                  Remover imagem
                </Button>
              )}
            </div>
            <span className="muted small">
              {detail.bannerKey
                ? 'Com imagem, ela aparece no lugar da cor. GIF animado também vale.'
                : 'PNG, JPEG, WebP ou GIF animado, até 4 MB. A imagem já fica salva ao enviar.'}
            </span>
          </div>

          {gifOpen && (
            <GifDialog
              title="GIF para a faixa do servidor"
              note="O OpenCord guarda uma cópia do GIF: ele continua aparecendo mesmo se sair do KLIPY."
              onClose={() => setGifOpen(false)}
              onPick={(url) => void sendGif(url)}
            />
          )}

          <div className="sp-field">
            <span className="oc-label">Características</span>
            <span className="muted small">Até 5, com um emoji cada (ex.: 🎮 Jogos, 🇧🇷 Brasil).</span>
            <ul className="sp-traits">
              {traits.map((t, i) => (
                <li key={i} className="sp-trait-row">
                  <TextField
                    aria-label={`Emoji da característica ${i + 1}`}
                    fieldClassName="sp-trait-emoji"
                    value={t.emoji}
                    placeholder="✨"
                    maxLength={16}
                    onChange={(e) => setTrait(i, { emoji: e.target.value })}
                  />
                  <TextField
                    aria-label={`Característica ${i + 1}`}
                    fieldClassName="sp-trait-label"
                    value={t.label}
                    placeholder="Ex.: Jogos"
                    maxLength={24}
                    onChange={(e) => setTrait(i, { label: e.target.value })}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remover característica ${i + 1}`}
                    data-tip="Remover"
                    onClick={() => setTraits((list) => list.filter((_, j) => j !== i))}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
            {traits.length < 5 && (
              <Button
                size="sm"
                variant="ghost"
                icon="plus"
                onClick={() => setTraits((list) => [...list, { emoji: '', label: '' }])}
              >
                Adicionar característica
              </Button>
            )}
          </div>

          <TextArea
            label="Descrição"
            value={description}
            maxLength={300}
            rows={4}
            placeholder="Conte do que é o servidor e quem é bem-vindo."
            hint={`${description.length}/300`}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className="form-actions">
            <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>
              Salvar perfil
            </Button>
            {dirty && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={reset}>
                Desfazer
              </Button>
            )}
          </div>
        </div>

        <figure className="sp-preview" aria-label="Prévia do cartão do servidor">
          <div className="sp-preview-banner" style={banner ?? undefined} data-empty={banner ? undefined : 'true'} />
          <div className="sp-preview-body">
            <span className="sp-preview-icon">
              <ServerIcon name={detail.name} iconKey={detail.iconKey} />
            </span>
            <strong className="sp-preview-name">{detail.name}</strong>
            <span className="muted small">
              {detail.members.length} {detail.members.length === 1 ? 'membro' : 'membros'}
            </span>
            {description.trim() && <p className="sp-preview-desc">{description.trim()}</p>}
            {cleanTraits.length > 0 && (
              <ul className="sp-preview-traits">
                {cleanTraits.map((t, i) => (
                  <li key={i}>
                    {t.emoji && <span aria-hidden>{t.emoji}</span>} {t.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <figcaption className="muted small">Prévia</figcaption>
        </figure>
      </div>
    </Section>
  );
}

/** Canal de ausentes (ADR-0049): quem fica parado em voz pelo limite vai para ele (app para computador). */
function AfkSection({ detail }: { detail: ServerDetail }) {
  const voice = detail.channels.filter((c) => c.kind === 'voice' && !c.roomHub && !c.temporary);
  const save = (patch: { afkChannelId?: string | null; afkTimeoutSec?: number }) =>
    patchServer(detail.id, patch).catch(toastError);
  const fmtLimit = (sec: number) => (sec < 3600 ? `${sec / 60} ${sec === 60 ? 'minuto' : 'minutos'}` : '1 hora');
  return (
    <Section
      title="Canal de ausentes"
      description="Quem ficar numa chamada sem mexer no teclado e no mouse (e sem falar) pelo tempo do limite vai sozinho para este canal. Neste canal ninguém fala, liga câmera ou transmite: o microfone fica desligado para todo mundo que estiver nele. A mudança automática vale para quem usa o app para computador."
    >
      <div className="afk-row">
        <Select<string>
          label="Canal de ausentes"
          value={detail.afkChannelId ?? 'none'}
          onChange={(v) => void save({ afkChannelId: v === 'none' ? null : v })}
          options={[
            { value: 'none', label: 'Nenhum (não move ninguém)' },
            ...voice.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Select<string>
          label="Limite de ausência"
          value={String(detail.afkTimeoutSec ?? 300)}
          onChange={(v) => void save({ afkTimeoutSec: Number(v) })}
          options={AFK_TIMEOUTS.map((t) => ({ value: String(t), label: fmtLimit(t) }))}
        />
      </div>
    </Section>
  );
}

/** Engajamento: mensagens do sistema, notificação padrão, ausentes e fundo do convite. */
export function EngagementTab({ detail }: { detail: ServerDetail }) {
  const text = detail.channels.filter((c) => c.kind === 'text');
  const save = (patch: Record<string, unknown>) => patchServer(detail.id, patch).catch(toastError);
  const inviteBg = useImageUpload(detail.id, 'invite-background');
  const inviteUrl = useServerImageUrl('invite-backgrounds', detail.inviteBgKey);

  return (
    <>
      <Section title="Mensagens do sistema" description="O OpenCord avisa neste canal quando alguém entra no servidor.">
        <Select<string>
          label="Canal das mensagens do sistema"
          value={detail.systemChannelId ?? 'none'}
          onChange={(v) => void save({ systemChannelId: v === 'none' ? null : v })}
          options={[
            { value: 'none', label: 'Nenhum (sem mensagens do sistema)' },
            ...text.map((c) => ({ value: c.id, label: `# ${c.name}` })),
          ]}
        />
        <Switch
          label="Dar boas-vindas a quem entra"
          description={
            detail.systemChannelId
              ? 'Uma mensagem com uma frase aleatória mencionando a pessoa nova.'
              : 'Escolha um canal acima para ligar.'
          }
          checked={!!detail.welcomeEnabled && !!detail.systemChannelId}
          disabled={!detail.systemChannelId}
          onChange={(v) => void save({ welcomeEnabled: v })}
        />
      </Section>

      <Section
        title="Notificação padrão"
        description="Vale para todos os membros do servidor. Quem não quiser os avisos pode ficar em Não perturbe."
      >
        <RadioGroup<'all' | 'mentions'>
          label="Notificação padrão"
          hideLabel
          value={detail.defaultNotify ?? 'mentions'}
          onChange={(v) => void save({ defaultNotify: v })}
          options={[
            {
              value: 'mentions',
              label: 'Só menções',
              description: 'Avisa quando alguém menciona a pessoa ou @everyone.',
            },
            {
              value: 'all',
              label: 'Todas as mensagens',
              description: 'Avisa a cada mensagem nova. Bom para servidores pequenos.',
            },
          ]}
        />
      </Section>

      <AfkSection detail={detail} />

      <Section
        title="Fundo do convite"
        description="Aparece atrás do cartão quando alguém abre um convite para este servidor."
      >
        <div className="wallpaper-row">
          {inviteUrl ? (
            <img className="wallpaper-preview" src={inviteUrl} alt="Fundo do convite atual" />
          ) : (
            <div className="wallpaper-preview wallpaper-empty">
              <Icon name="image" size={22} />
            </div>
          )}
          <div className="form-actions">
            {inviteBg.field}
            <Button size="sm" variant="secondary" disabled={inviteBg.busy} onClick={inviteBg.pick}>
              {inviteUrl ? 'Trocar fundo' : 'Escolher fundo'}
            </Button>
            {inviteUrl && (
              <Button size="sm" variant="ghost" disabled={inviteBg.busy} onClick={() => void inviteBg.clear()}>
                Remover
              </Button>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}
