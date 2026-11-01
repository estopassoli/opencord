/**
 * Layout Vidro (redesign em teste): um fundo vivo em three.js e, flutuando sobre ele, três lâminas de vidro —
 * navegação (servidores + canais + painel do usuário), conteúdo e a lateral (membros, perfil, thread, amigos). As
 * telas do meio são as mesmas do layout clássico; aqui muda a casca: vidro, luz que acompanha o ponteiro e parallax.
 * No celular cai no layout clássico (gavetas).
 */
import { useEffect, useRef } from 'react';
import { ContextMenuHost } from '../../components/ContextMenu';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { InstanceBanner } from '../../components/InstanceBanner';
import { useIsMobile } from '../../lib/media';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { BoardView } from '../board/BoardView';
import { ChatView } from '../chat/ChatView';
import { MediaViewer } from '../chat/MediaViewer';
import { ThreadPanel } from '../chat/ThreadPanel';
import { ClipViewer } from '../clips/ClipViewer';
import { DmSidebar } from '../home/DmSidebar';
import { HomeView } from '../home/HomeView';
import { NewsView } from '../home/NewsView';
import { AppShell, useShellBehavior } from '../shell/AppShell';
import { ChannelSidebar } from '../shell/ChannelSidebar';
import { ConnectionBanner } from '../shell/ConnectionBanner';
import { DmProfilePanel, useDmPeer } from '../shell/DmProfilePanel';
import { FriendsPanel } from '../shell/FriendsPanel';
import { MemberList } from '../shell/MemberList';
import { Modals } from '../shell/Modals';
import { ServerRail } from '../shell/ServerRail';
import { TitleBar } from '../shell/TitleBar';
import { UserDock } from '../shell/UserDock';
import { MusicPlayer } from '../voice/MusicPlayer';
import { PopoutPortal } from '../voice/popout';
import { PopoutStage, VoiceStage } from '../voice/VoiceStage';
import { Backdrop } from './Backdrop';
import { startReducedMotionWatch } from './parallax';

export function VidroShell() {
  const mobile = useIsMobile();
  return mobile ? <AppShell /> : <VidroDesktop />;
}

function VidroDesktop() {
  const view = useUi((s) => s.view);
  const showMembers = useUi((s) => s.showMembers);
  const thread = useUi((s) => s.thread);
  const dmProfileOpen = useUi((s) => s.dmProfile);
  const dmPeer = useDmPeer(view.kind === 'dm' ? view.conversationId : null);
  const dmProfileShown = dmProfileOpen && Boolean(dmPeer);
  const detail = useData((s) => (view.kind === 'server' ? s.details[view.serverId] : undefined));
  const sidebarWidth = useData((s) => Math.max(s.settings?.sidebarWidth ?? 300, 300));
  const myCall = useVoice((v) => v.machine.channelId);
  const popped = useUi((s) => s.poppedStream);
  const shell = useRef<HTMLDivElement>(null);
  useShellBehavior();
  useEffect(() => startReducedMotionWatch(), []);

  const channel = view.kind === 'server' ? detail?.channels.find((c) => c.id === view.channelId) : undefined;
  const sideOpen =
    (view.kind === 'server' && channel?.kind === 'text' && showMembers) || view.kind === 'dm' || Boolean(thread);

  return (
    <div
      className="vidro-shell"
      ref={shell}
      data-side={sideOpen ? 'open' : undefined}
      style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` }}
    >
      <a className="skip-link" href="#main-content">
        Pular para o conteúdo
      </a>
      <Backdrop />
      <TitleBar />
      <div className="vidro-panel vidro-nav" style={{ ['--i' as string]: 0 }}>
        <ErrorBoundary area="a lista de servidores">
          <ServerRail />
        </ErrorBoundary>
        <aside className="sidebar" aria-label={view.kind === 'server' ? 'Canais' : 'Conversas'}>
          <ErrorBoundary area="a lista de canais">
            {view.kind === 'server' ? <ChannelSidebar serverId={view.serverId} /> : <DmSidebar />}
          </ErrorBoundary>
        </aside>
        <ErrorBoundary area="o painel do usuário">
          <UserDock />
        </ErrorBoundary>
      </div>
      <main id="main-content" className="content vidro-panel vidro-main" tabIndex={-1} style={{ ['--i' as string]: 1 }}>
        <InstanceBanner />
        <ConnectionBanner />
        <ErrorBoundary
          area="esta tela"
          key={`${view.kind}-${view.kind === 'server' ? view.channelId : view.kind === 'dm' ? view.conversationId : ''}`}
        >
          <div className="vidro-view" key={view.kind === 'server' ? view.channelId : view.kind}>
            {view.kind === 'home' && (view.tab === 'news' ? <NewsView /> : <HomeView />)}
            {view.kind === 'dm' && (
              <ChatView key={view.conversationId} target={{ conversationId: view.conversationId }} />
            )}
            {view.kind === 'server' && channel?.kind === 'text' && (
              <ChatView key={channel.id} target={{ channelId: channel.id }} />
            )}
            {view.kind === 'server' && channel?.kind === 'board' && <BoardView key={channel.id} channel={channel} />}
            {view.kind === 'server' && channel?.kind === 'voice' && (
              <VoiceStage channelId={channel.id} serverId={view.serverId} />
            )}
            {view.kind === 'server' && !channel && (
              <div className="empty-state">
                <p>Nenhum canal disponível.</p>
              </div>
            )}
          </div>
        </ErrorBoundary>
        <ErrorBoundary area="o player de música">
          <MusicPlayer onStage={channel?.kind === 'voice' && channel.id === myCall} />
        </ErrorBoundary>
      </main>
      {sideOpen && (
        <div className="vidro-panel vidro-side" style={{ ['--i' as string]: 2 }}>
          {view.kind === 'dm' && <DmProfilePanel conversationId={view.conversationId} />}
          {view.kind === 'dm' && <FriendsPanel forceCompact={dmProfileShown} />}
          {thread && (
            <ErrorBoundary area="a thread">
              <ThreadPanel thread={thread} />
            </ErrorBoundary>
          )}
          {view.kind === 'server' && channel?.kind === 'text' && showMembers && (
            <ErrorBoundary area="a lista de membros">
              <MemberList serverId={view.serverId} />
            </ErrorBoundary>
          )}
        </div>
      )}
      <ErrorBoundary area="esta janela">
        <Modals />
      </ErrorBoundary>
      <ErrorBoundary area="o visualizador">
        <MediaViewer />
        <ClipViewer />
      </ErrorBoundary>
      <ContextMenuHost />
      {popped && (
        <PopoutPortal key={popped}>
          <PopoutStage />
        </PopoutPortal>
      )}
    </div>
  );
}
