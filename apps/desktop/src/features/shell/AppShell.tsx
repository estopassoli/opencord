import { useEffect } from 'react';
import { bridge } from '../../lib/bridge';
import { useIsMobile } from '../../lib/media';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { ChatView } from '../chat/ChatView';
import { HomeView } from '../home/HomeView';
import { NewsView } from '../home/NewsView';
import { DmSidebar } from '../home/DmSidebar';
import { ContextMenuHost } from '../../components/ContextMenu';
import { Modals } from './Modals';
import { ChannelSidebar } from './ChannelSidebar';
import { MemberList } from './MemberList';
import { ServerRail } from './ServerRail';
import { TitleBar } from './TitleBar';
import { UserDock } from './UserDock';
import { PopoutStage, VoiceStage } from '../voice/VoiceStage';
import { PopoutPortal } from '../voice/popout';
import { MediaViewer } from '../chat/MediaViewer';
import { ConnectionBanner } from './ConnectionBanner';

/** Layout: rail de servidores | sidebar (canais/DMs + dock) | conteúdo | membros. Cada região rola de forma independente. */
export function AppShell() {
  const view = useUi((s) => s.view);
  const showMembers = useUi((s) => s.showMembers);
  const panel = useUi((s) => s.panel);
  const mobile = useIsMobile();
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
    if (ch) useUi.getState().go({ kind: 'server', serverId: view.serverId, channelId: ch.id }, { keepPanel: true });
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

  // Celular: Esc fecha a gaveta; deslizar da borda esquerda abre a navegação, deslizar para o lado fecha.
  useEffect(() => {
    if (!mobile) {
      useUi.getState().setPanel('none');
      return;
    }
    let start: { x: number; y: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const from = start.x;
      start = null;
      if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.7) return; // rolagem vertical não conta
      const ui = useUi.getState();
      if (ui.modal) return;
      if (ui.panel === 'none') {
        if (dx > 0 && from < 32) ui.setPanel('nav');
        else if (dx < 0 && from > innerWidth - 32 && ui.view.kind === 'server') ui.setPanel('members');
      } else if ((ui.panel === 'nav' && dx < 0) || (ui.panel === 'members' && dx > 0)) ui.setPanel('none');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useUi.getState().panel !== 'none' && !useUi.getState().modal)
        useUi.getState().setPanel('none');
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('keydown', onKey);
    };
  }, [mobile]);

  const channel = view.kind === 'server' ? detail?.channels.find((c) => c.id === view.channelId) : undefined;
  // fora da tela no celular = fora da ordem de foco e da árvore de acessibilidade
  const off = (p: typeof panel) => mobile && panel !== p;

  // transmissão desanexada: renderizada aqui para seguir viva ao navegar para outros canais
  const popped = useUi((st) => st.poppedStream);
  return (
    <div
      className="shell"
      data-panel={mobile ? panel : undefined}
      style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` }}
    >
      <a className="skip-link" href="#main-content">
        Pular para o conteúdo
      </a>
      <TitleBar />
      <div className="slot" id="mobile-nav" inert={off('nav')}>
        <ServerRail />
        <aside className="sidebar" aria-label={view.kind === 'server' ? 'Canais' : 'Conversas'}>
          {view.kind === 'server' ? <ChannelSidebar serverId={view.serverId} /> : <DmSidebar />}
        </aside>
        {/* painel do usuário/voz flutua sobre o rodapé do rail + sidebar */}
        <UserDock />
      </div>
      {mobile && panel !== 'none' && (
        <button className="mobile-scrim" aria-label="Fechar painel" onClick={() => useUi.getState().setPanel('none')} />
      )}
      <main id="main-content" className="content" tabIndex={-1} inert={mobile && panel !== 'none'}>
        <ConnectionBanner />
        {view.kind === 'home' && (view.tab === 'news' ? <NewsView /> : <HomeView />)}
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
      {view.kind === 'server' && channel?.kind === 'text' && (mobile || showMembers) && (
        <div className="slot" inert={off('members')}>
          <MemberList serverId={view.serverId} />
        </div>
      )}
      <Modals />
      <MediaViewer />
      <ContextMenuHost />
      {popped && (
        <PopoutPortal key={popped}>
          <PopoutStage />
        </PopoutPortal>
      )}
    </div>
  );
}
