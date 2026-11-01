// Inter (SIL OFL 1.1), embutida localmente: a CSP do app não permite fontes externas.
import '@fontsource-variable/inter';
// Sora (SIL OFL 1.1), local: fonte de display do layout Vidro
import '@fontsource-variable/sora';
import '@opencord/ui/tokens.css';
import '@opencord/ui/icon.css';
import '@opencord/ui/forms.css';
import './styles/app.css';
import './styles/motion.css';
import './styles/mobile.css';
import './styles/server-folders.css';
import './features/clips/clips.css';
import './features/vidro/vidro.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadImportedFonts } from './lib/fonts';
import { soundLog } from './lib/sounds';
import { useVoice } from './store/voice';
import { useSounds } from './store/sounds';
import { capturePendingInvite } from './lib/invite';
import { applyRememberedAppearance } from './lib/appearance-boot';

// link de convite aberto no navegador: guarda o código antes da primeira tela (o login já o mostra)
capturePendingInvite();
// tema escolhido da última vez, antes de as configurações chegarem (sem piscar no escuro padrão)
applyRememberedAppearance();

// Diagnóstico somente leitura para suporte/E2E (não expõe tokens nem conteúdo).
(window as unknown as { __opencordSoundsHeard: () => number }).__opencordSoundsHeard = () => useSounds.getState().heard;
(window as unknown as { __opencordClips: () => unknown }).__opencordClips = () =>
  import('./store/clips').then((m) => m.clipsDiag());
(window as unknown as { __opencordDiag: () => unknown }).__opencordDiag = () => {
  const v = useVoice.getState();
  return (
    v
      .engine()
      ?.diagnostics()
      .then((d) => ({ machine: v.machine.status, stream: v.stream.status, media: d })) ?? { machine: v.machine.status }
  );
};

(window as unknown as { __opencordSounds: () => string[] }).__opencordSounds = () => [...soundLog];

// fontes importadas pelo usuário (só deste PC); não bloqueia a renderização
void loadImportedFonts();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
