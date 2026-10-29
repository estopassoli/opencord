# OpenCord — Design System (Discord-like UX)

## Diretriz
Alta familiaridade com o Discord Desktop em estrutura, densidade, navegação e comportamento. Marca OpenCord e assets originais. Não reproduzir logo, wordmark, ícones proprietários ou ilustrações do Discord.

## Tokens iniciais (ajustáveis por contraste e testes)
```css
:root[data-theme="dark"] {
  --server-rail: #121318;
  --channel-sidebar: #1e1f26;
  --chat-background: #292a33;
  --surface-elevated: #34353f;
  --surface-interactive: #40414d;
  --brand: #5865f2;
  --text-primary: #f2f3f5;
  --text-secondary: #a7a9b4;
  --status-online: #43b581;
  --danger: #f23f43;
}
```
> **Atualização 2026-10-29 (ADR-0006):** `--brand` passou a `#127a73` (teal próprio) e as superfícies foram recalibradas. Os tokens vigentes estão em `packages/ui/src/tokens.css`; os valores acima são históricos.

Não copiar tokens internos de terceiros. Definir focus, hover, border, success, warning e muted semanticamente. Verificar WCAG AA para texto e controles.

## AppShell
Rail de servidores à esquerda (compacto); sidebar de canais; área central de chat/voz; painel de membros opcional; dock inferior de usuário e conexão. Cada região com scroll independente. Sidebar redimensionável e largura persistida.

## Componentes
`ServerRail`, `ServerIcon`, `ChannelSidebar`, `CategoryTree`, `TextChannelRow`, `VoiceChannelRow`, `MemberList`, `ChatMessage`, `MessageComposer`, `ReactionBar`, `VoiceDock`, `SpeakingAvatar`, `VideoGrid`, `StreamTile`, `StreamViewer`, `ScreenSourcePicker`, `ProfilePopover`, `SettingsNavigation`, `ContextMenu`, `Tooltip`, `Dialog`, `Toast`, `Skeleton`, `ErrorBoundary`.

## Interações
- Clique em canal de voz conecta; clique em canal de texto muda conteúdo sem sair da voz.
- Hover em mensagem revela ações; contexto por botão direito; menus posicionados e acessíveis.
- Rascunhos de mensagens preservados por canal.
- Atalho para mute/deafen e PTT; foco não pode interceptar hotkey global de forma insegura.
- Indicador de fala com debounce para evitar flicker; não depender só de cor.
- Estados: conectando, reconectando, sem permissão, stream encerrada, dispositivo ausente, offline.
- Animações 100–200ms, reduzidas com `prefers-reduced-motion`.

## Telas
Login/convite, Home/amigos, servidor/chat, canal de voz, video grid, Go Live source picker, stream viewer, DM, settings, administração de servidor.

## Critérios de aceite UI
Desktop 1280×720, 1920×1080 e 2560×1440; sem overflow inesperado; navegação por teclado; focus rings; contraste; visual compact/dark; sem cards estilo dashboard SaaS.
