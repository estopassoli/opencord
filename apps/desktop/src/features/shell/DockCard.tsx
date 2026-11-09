/**
 * Cartão do usuário no painel de baixo: clicar na própria foto/nome mostra o seu perfil (banner, foto, balão de status,
 * bio, insígnias) e, embaixo, as ações da conta: editar perfil, status, status personalizado, insígnias, configurações,
 * copiar ID e sair.
 */
import type { PresenceStatus } from '@opencord/contracts';
import { Icon, STATUS_LABEL } from '@opencord/ui';
import { askConfirm } from '../../components/AskDialog';
import { useEffect, useRef, useState } from 'react';
import { ProfileCardHead, profileThemeVars } from '../../components/ProfileCardView';
import { ProfileBadges } from '../../components/UserBadges';
import { useData } from '../../store/data';
import { ProfileClips } from '../../components/ProfileClips';
import { EMPTY_APPEARANCE, useProfiles } from '../../store/profiles';
import { useSession } from '../../store/session';
import { useUi } from '../../store/ui';

type Settable = Exclude<PresenceStatus, 'offline'>;
const STATUSES: Settable[] = ['online', 'idle', 'dnd', 'invisible'];
const HINT: Partial<Record<Settable, string>> = {
  dnd: 'Sem sons nem notificações',
  invisible: 'Aparece offline, mas você usa tudo normalmente',
};

export function DockCard({
  onClose,
  setStatus,
  editText,
  clearText,
  autoIdle,
  toggleAutoIdle,
}: {
  onClose: () => void;
  setStatus: (s: Settable) => void;
  editText: () => void;
  clearText: () => void;
  autoIdle: boolean;
  toggleAutoIdle: () => void;
}) {
  const me = useData((s) => s.me);
  const myStatus = useData((s) => s.myStatus);
  const myText = useData((s) => s.myStatusText);
  const appearance = useProfiles((s) => (me ? s.byId[me.id] : undefined)) ?? EMPTY_APPEARANCE;
  const clips = useProfiles((s) => (me ? s.clipsById[me.id] : undefined));
  const [statusOpen, setStatusOpen] = useState(false);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (me) void useProfiles.getState().load(me.id);
  }, [me]);

  // fecha com Esc ou clique fora (o botão do painel alterna sozinho)
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (card.current?.contains(t) || t.closest('.user-dock-id')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  if (!me) return null;
  const openProfileEditor = () => {
    onClose();
    useUi.getState().openModal({ kind: 'settings', tab: 'profile' });
  };
  const shown: Settable = myStatus;

  return (
    <div
      ref={card}
      className="dock-card profile-preview"
      role="dialog"
      aria-label="Sua conta"
      data-themed={appearance.colors ? 'true' : undefined}
      style={profileThemeVars(appearance.colors)}
    >
      <ProfileCardHead
        user={me}
        appearance={appearance}
        status={shown === 'invisible' ? 'offline' : shown}
        name={me.displayName}
        subtitle={`@${me.username}`}
        statusEditor={
          <button
            type="button"
            className="pc-status pc-inline-edit"
            data-empty={myText ? undefined : 'true'}
            aria-label={myText ? 'Editar status personalizado' : 'Definir status personalizado'}
            onClick={editText}
          >
            {myText || (
              <>
                <Icon name="plus-circle" size={14} /> O que você está fazendo?
              </>
            )}
          </button>
        }
      />
      <ProfileBadges userId={me.id} fallback={me.badges} verified={me.verified || undefined} />
      <ProfileClips clips={clips} owner={me} />

      <ul className="dock-card-menu" role="menu">
        <li role="none">
          <button role="menuitem" onClick={openProfileEditor}>
            <Icon name="edit" size={18} /> <span>Editar perfil</span>
          </button>
        </li>
        <li role="none">
          <button role="menuitem" aria-expanded={statusOpen} onClick={() => setStatusOpen((o) => !o)}>
            <span className="oc-status-dot" data-status={shown === 'invisible' ? 'offline' : shown} aria-hidden />
            <span>{STATUS_LABEL[shown]}</span>
            <Icon name={statusOpen ? 'chevron-up' : 'chevron-down'} size={16} className="dock-card-chevron" />
          </button>
        </li>
        {statusOpen && (
          <li role="none" className="dock-card-sub">
            <ul role="group" aria-label="Status">
              {STATUSES.map((s) => (
                <li key={s} role="none">
                  <button role="menuitemradio" aria-checked={shown === s} onClick={() => setStatus(s)}>
                    <span className="oc-status-dot" data-status={s === 'invisible' ? 'offline' : s} aria-hidden />
                    <span className="dock-card-texts">
                      <span>{STATUS_LABEL[s]}</span>
                      {HINT[s] && <span className="muted small">{HINT[s]}</span>}
                    </span>
                    {shown === s && <Icon name="check" size={16} className="dock-card-chevron" />}
                  </button>
                </li>
              ))}
              <li role="none">
                <button role="menuitemcheckbox" aria-checked={autoIdle} onClick={toggleAutoIdle}>
                  {autoIdle ? <Icon name="check" size={16} /> : <span className="menu-blank" aria-hidden />}
                  <span>Ausente após 10 min parado</span>
                </button>
              </li>
            </ul>
          </li>
        )}
        {myText && (
          <li role="none">
            <button role="menuitem" onClick={clearText}>
              <Icon name="close" size={18} /> <span>Limpar status personalizado</span>
            </button>
          </li>
        )}
        <li role="none">
          <button role="menuitem" onClick={openProfileEditor}>
            <Icon name="star" size={18} /> <span>Insígnias em destaque</span>
          </button>
        </li>
        {/* no navegador a página mostra os clipes salvos na conta (ADR-0057) */}
        <li role="none">
          <button
            role="menuitem"
            onClick={() => {
              onClose();
              useUi.getState().openModal({ kind: 'clips' });
            }}
          >
            <Icon name="film" size={18} /> <span>Clipes</span>
          </button>
        </li>
      </ul>

      <ul className="dock-card-menu" role="menu">
        <li role="none">
          <button
            role="menuitem"
            onClick={() => {
              onClose();
              useUi.getState().openModal({ kind: 'settings' });
            }}
          >
            <Icon name="settings" size={18} /> <span>Configurações</span>
          </button>
        </li>
        <li role="none">
          <button
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(me.id);
              useUi.getState().toast('success', 'ID copiado.');
              onClose();
            }}
          >
            <Icon name="copy" size={18} /> <span>Copiar ID do usuário</span>
          </button>
        </li>
        <li role="none">
          <button
            role="menuitem"
            className="danger-text"
            onClick={async () => {
              onClose();
              // só com apelido, a identidade fica neste aparelho: sair é perdê-la
              if (
                !me.hasAccount &&
                !(await askConfirm('Você entrou só com apelido: ao sair, esse apelido e os seus dados não voltam.', {
                  title: 'Sair da conta',
                  confirmLabel: 'Sair mesmo assim',
                  danger: true,
                }))
              )
                return;
              void useSession.getState().logout();
            }}
          >
            <Icon name="logout" size={18} /> <span>Sair da conta</span>
          </button>
        </li>
      </ul>
    </div>
  );
}
