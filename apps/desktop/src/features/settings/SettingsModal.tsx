import type { Me, UserSettings } from '@opencord/contracts';
import { Avatar, Icon, STATUS_LABEL, TextField, type IconName } from '@opencord/ui';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { bridge } from '../../lib/bridge';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import './settings.css';
import '../admin/admin.css';
import '../admin/server-settings.css';
import { Tooltip } from '../../components/Tooltip';
import { BotsTab } from './BotsTab';
import { GamesTab } from './GamesTab';
import { ProfileTab } from './ProfileTab';
import { AccountTab, confirmLogout } from './AccountTab';
import { VoiceTab } from './VoiceTab';
import { KeybindsTab } from './KeybindsTab';
import { AppearanceTab } from './AppearanceTab';
import { NotificationsTab } from './NotificationsTab';
import { StreamerTab } from './StreamerTab';
import { AboutTab, HardwareAcceleration } from './AboutTab';

// ---------------------------------------------------------------------------
// Modal de configurações do usuário
// ---------------------------------------------------------------------------

type UserTab =
  | 'account'
  | 'profile'
  | 'voice'
  | 'games'
  | 'apps'
  | 'keybinds'
  | 'appearance'
  | 'notifications'
  | 'streamer'
  | 'about';

interface UserNavItem {
  id: UserTab;
  label: string;
  icon: IconName;
  description: string;
  /** palavras extras para a busca da barra lateral */
  keywords: string;
}

const USER_GROUPS: { label: string; items: UserNavItem[] }[] = [
  {
    label: 'Você',
    items: [
      {
        id: 'account',
        label: 'Minha conta',
        icon: 'user',
        description: 'Senha, e-mail, verificação em duas etapas, privacidade e sessão.',
        keywords: 'email senha 2fa segurança privacidade sair sessão',
      },
      {
        id: 'profile',
        label: 'Perfil',
        icon: 'image',
        description: 'Foto, faixa, cores e bio, e seus dados: @, e-mail e apelido.',
        keywords: 'foto avatar banner faixa bio cor cartão nome usuário arroba apelido email dados',
      },
    ],
  },
  {
    label: 'App',
    items: [
      {
        id: 'voice',
        label: 'Voz e vídeo',
        icon: 'microphone',
        description: 'Microfone, alto-falante, câmera, supressão de ruído e qualidade da transmissão.',
        keywords: 'microfone áudio som câmera ruído eco transmissão go live qualidade codec ptt',
      },
      {
        id: 'games',
        label: 'Jogos',
        icon: 'gamepad',
        description: 'Jogos detectados, overlay no jogo e clipes.',
        keywords: 'jogo overlay clipe gravação atividade',
      },
      {
        id: 'keybinds',
        label: 'Atalhos',
        icon: 'keyboard',
        description: 'Teclas para mutar, ensurdecer, falar e clipar, mesmo com o app em segundo plano.',
        keywords: 'teclado tecla atalho push to talk ptt mutar',
      },
      {
        id: 'appearance',
        label: 'Aparência',
        icon: 'sun',
        description: 'Tema, layout, fontes, tamanho, sons e movimento.',
        keywords: 'tema cor escuro claro fonte layout vidro densidade sons animação movimento',
      },
      {
        id: 'notifications',
        label: 'Notificações',
        icon: 'bell',
        description: 'Quando o app avisa você, palavras-chave, silenciados, lembretes e sons.',
        keywords: 'aviso som menção notificação palavra chave silenciar silenciado lembrete lembrar',
      },
      {
        id: 'streamer',
        label: 'Modo streamer',
        icon: 'screen',
        description: 'Esconde dados pessoais e convites enquanto você transmite.',
        keywords: 'live obs twitch transmissão esconder email convite privacidade',
      },
      {
        id: 'apps',
        label: 'Aplicativos',
        icon: 'grid',
        description: 'Bots e aplicativos que você criou ou autorizou.',
        keywords: 'bot aplicativo token integração',
      },
    ],
  },
  {
    label: 'Sistema',
    items: [
      {
        id: 'about',
        label: 'Sobre e desempenho',
        icon: 'settings',
        description: 'Versão, atualizações, aceleração por placa de vídeo e uso de memória.',
        keywords: 'versão atualização gpu placa de vídeo memória desempenho',
      },
    ],
  },
];
const USER_ITEMS = USER_GROUPS.flatMap((g) => g.items);

const isUserTab = (v: unknown): v is UserTab => USER_ITEMS.some((t) => t.id === v);
const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useData((s) => s.settings);
  const me = useData((s) => s.me);
  if (!settings || !me) return null;
  return (
    <Dialog title="Configurações do usuário" onClose={onClose} fullscreen hideClose className="adm-dialog srv-dialog">
      <UserSettingsDashboard settings={settings} me={me} onClose={onClose} />
    </Dialog>
  );
}

/** Configurações do usuário no formato do painel admin: barra lateral com busca, topo com descrição, seções em cartões. */
function UserSettingsDashboard({ settings, me, onClose }: { settings: UserSettings; me: Me; onClose: () => void }) {
  const initial = useUi((s) => (s.modal?.kind === 'settings' ? s.modal.tab : undefined));
  const [tab, setTab] = useState<UserTab>(isUserTab(initial) ? initial : 'account');
  const [query, setQuery] = useState('');
  const myStatus = useData((s) => s.myStatus);
  const contentRef = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    bridge
      ?.appInfo()
      .then((i) => !cancelled && setVersion(i.version))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // o <dialog> foca o primeiro botão ao abrir; o foco vai para a seção aberta
  const initialTab = useRef(tab);
  useEffect(() => {
    const t = setTimeout(() => document.getElementById(`usr-nav-${initialTab.current}`)?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const q = fold(query.trim());
  const groups = USER_GROUPS.map((g) => ({
    ...g,
    items: q ? g.items.filter((it) => fold(`${it.label} ${it.description} ${it.keywords}`).includes(q)) : g.items,
  })).filter((g) => g.items.length > 0);
  const visible = groups.flatMap((g) => g.items);
  const current = USER_ITEMS.find((i) => i.id === tab) ?? USER_ITEMS[0]!;
  const group = USER_GROUPS.find((g) => g.items.includes(current))?.label;

  const goTab = (t: UserTab) => {
    setTab(t);
    contentRef.current?.scrollTo({ top: 0 });
  };

  /** ↑/↓/Home/End entre as seções visíveis da barra lateral */
  const onNavKey = (e: KeyboardEvent<HTMLElement>) => {
    const i = visible.findIndex((t) => t.id === current.id);
    const next =
      e.key === 'ArrowDown'
        ? visible[(i + 1) % visible.length]
        : e.key === 'ArrowUp'
          ? visible[(i - 1 + visible.length) % visible.length]
          : e.key === 'Home'
            ? visible[0]
            : e.key === 'End'
              ? visible[visible.length - 1]
              : null;
    if (!next) return;
    e.preventDefault();
    goTab(next.id);
    document.getElementById(`usr-nav-${next.id}`)?.focus();
  };

  return (
    <div className="adm-shell usr-shell">
      <aside className="adm-side">
        <div className="usr-hero">
          <Avatar id={me.id} name={me.displayName} size={44} status={myStatus} />
          <span className="usr-hero-text">
            <strong className="truncate">{me.displayName}</strong>
            <span className="muted small truncate">
              {me.hasAccount ? STATUS_LABEL[myStatus] : 'Entrou só com apelido'}
            </span>
          </span>
          <Tooltip label="Editar perfil" side="bottom">
            <button type="button" className="icon-btn" aria-label="Editar perfil" onClick={() => goTab('profile')}>
              <Icon name="edit" size={16} />
            </button>
          </Tooltip>
        </div>
        <TextField
          aria-label="Buscar nas configurações"
          type="search"
          leadingIcon="search"
          placeholder="Buscar configuração"
          fieldClassName="usr-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter abre o primeiro resultado
            if (e.key === 'Enter' && visible[0]) {
              e.preventDefault();
              goTab(visible[0].id);
            }
          }}
        />
        <nav className="adm-nav" aria-label="Seções das configurações" onKeyDown={onNavKey}>
          {groups.map((g) => (
            <div key={g.label} className="adm-nav-group">
              <p className="adm-nav-label">{g.label}</p>
              <ul>
                {g.items.map((it) => {
                  const on = it.id === current.id;
                  return (
                    <li key={it.id}>
                      <button
                        id={`usr-nav-${it.id}`}
                        type="button"
                        className="adm-nav-item"
                        aria-current={on ? 'page' : undefined}
                        onClick={() => goTab(it.id)}
                      >
                        <Icon name={it.icon} size={18} active={on} />
                        <span className="adm-nav-text">{it.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {groups.length === 0 && <p className="muted small usr-empty">Nada encontrado para “{query.trim()}”.</p>}
        </nav>
        <div className="adm-side-foot usr-foot">
          <span className="muted small">{version ? `OpenCord ${version}` : 'OpenCord'}</span>
          <button type="button" className="usr-logout" onClick={() => void confirmLogout(me)}>
            <Icon name="logout" size={16} />
            Sair
          </button>
        </div>
      </aside>

      <div className="adm-main">
        <header className="adm-top">
          <div className="adm-top-titles">
            <p className="adm-crumb">Configurações{group ? ` · ${group}` : ''}</p>
            <h2>{current.label}</h2>
            <p className="muted small adm-top-desc">{current.description}</p>
          </div>
          <div className="adm-top-actions">
            <Tooltip label="Fechar (Esc)" side="bottom">
              <button type="button" className="adm-close" aria-label="Fechar configurações (Esc)" onClick={onClose}>
                <Icon name="close" size={18} />
              </button>
            </Tooltip>
          </div>
        </header>
        <div className="adm-content" ref={contentRef} aria-label={current.label} role="region">
          <div className="adm-content-inner srv-content usr-content" key={current.id}>
            {current.id === 'account' && <AccountTab />}
            {current.id === 'profile' && <ProfileTab />}
            {current.id === 'voice' && <VoiceTab settings={settings} />}
            {current.id === 'games' && <GamesTab settings={settings} />}
            {current.id === 'apps' && <BotsTab />}
            {current.id === 'keybinds' && <KeybindsTab settings={settings} />}
            {current.id === 'appearance' && <AppearanceTab settings={settings} />}
            {current.id === 'notifications' && <NotificationsTab settings={settings} />}
            {current.id === 'streamer' && <StreamerTab settings={settings} />}
            {current.id === 'about' && (
              <>
                <AboutTab />
                <HardwareAcceleration />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
