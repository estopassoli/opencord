import { useEffect } from 'react';
import { bridge } from '../../lib/bridge';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { ChatView } from '../chat/ChatView';
import { HomeView } from '../home/HomeView';
import { DmSidebar } from '../home/DmSidebar';
import { ContextMenuHost } from '../../components/ContextMenu';
import { Modals } from './Modals';
import { ChannelSidebar } from './ChannelSidebar';
import { MemberList } from './MemberList';
import { ServerRail } from './ServerRail';
import { TitleBar } from './TitleBar';
import { UserDock } from './UserDock';
import { VoiceStage } from '../voice/VoiceStage';
import { ConnectionBanner } from './ConnectionBanner';

/** Layout: rail de servidores | sidebar (canais/DMs + dock) | conteúdo | membros. Cada região rola de forma independente. */
export function AppShell() {
  const view = useUi((s) => s.view);
  const showMembers = useUi((s) => s.showMembers);
  const detail = useData((s) => (view.kind === 'server' ? s.details[view.serverId] : undefined));
  const sidebarWidth = useData((s) => Math.max(s.settings?.sidebarWidth ?? 300, 300));
  const unreadTotal = useData((s) =>
    Object.values(s.unread).reduce((n, u) => n + u.mentionCount + (u.conversationId ? u.unreadCount : 0), 0),
  );

  // canal padrão ao abrir um servidor: último visitado ou primeiro canal de texto visível
  useEffect(() => {
    if (view.kind !== 'server' || view.channelId || !detail) return;
    const last = useUi.getState().lastChannel[view.serverId];
    const ch =
      detail.channels.find((c) => c.id === last) ??
      detail.channels.filter((c) => c.kind === 'text').sort((a, b) => a.position - b.position)[0];
    if (ch) useUi.getState().go({ kind: 'server', serverId: view.serverId, channelId: ch.id });
  }, [view, detail]);

  useEffect(() => {
    void bridge?.setBadge(unreadTotal).catch(() => undefined);
  }, [unreadTotal]);

  // Atalhos globais da janela: Ctrl+K abre o seletor rápido.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useUi
          .getState()
          .openModal(useUi.getState().modal?.kind === 'quick-switcher' ? null : { kind: 'quick-switcher' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Push-to-talk com a janela em foco (tecla configurada); blur fecha o microfone por segurança.
  useEffect(() => {
    const key = () => useData.getState().settings?.keybinds.pushToTalk;
    const isPtt = (e: KeyboardEvent) =>
      useData.getState().settings?.audio.inputMode === 'ptt' && key() && e.code === key();
    const down = (e: KeyboardEvent) => {
      if (isPtt(e) && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement))
        useVoice.getState().setPtt(true);
    };
    const up = (e: KeyboardEvent) => {
      if (isPtt(e)) useVoice.getState().setPtt(false);
    };
    const blur = () => {
      if (useData.getState().settings?.audio.inputMode === 'ptt') useVoice.getState().setPtt(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const channel = view.kind === 'server' ? detail?.channels.find((c) => c.id === view.channelId) : undefined;

  return (
    <div className="shell" style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` }}>
      <a className="skip-link" href="#main-content">
        Pular para o conteúdo
      </a>
      <TitleBar />
      <ServerRail />
      <aside className="sidebar" aria-label={view.kind === 'server' ? 'Canais' : 'Conversas'}>
        {view.kind === 'server' ? <ChannelSidebar serverId={view.serverId} /> : <DmSidebar />}
      </aside>
      {/* painel do usuário/voz flutua sobre o rodapé do rail + sidebar */}
      <UserDock />
      <main id="main-content" className="content" tabIndex={-1}>
        <ConnectionBanner />
        {view.kind === 'home' && <HomeView />}
        {view.kind === 'dm' && <ChatView key={view.conversationId} target={{ conversationId: view.conversationId }} />}
        {view.kind === 'server' && channel?.kind === 'text' && (
          <ChatView key={channel.id} target={{ channelId: channel.id }} />
        )}
        {view.kind === 'server' && channel?.kind === 'voice' && (
          <VoiceStage channelId={channel.id} serverId={view.serverId} />
        )}
        {view.kind === 'server' && !channel && (
          <div className="empty-state">
            <p>Nenhum canal disponível.</p>
          </div>
        )}
      </main>
      {view.kind === 'server' && showMembers && channel?.kind === 'text' && <MemberList serverId={view.serverId} />}
      <Modals />
      <ContextMenuHost />
    </div>
  );
}
