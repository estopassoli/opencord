// Inter (SIL OFL 1.1), embutida localmente: a CSP do app não permite fontes externas.
import '@fontsource-variable/inter';
import '@opencord/ui/tokens.css';
import '@opencord/ui/icon.css';
import '@opencord/ui/forms.css';
import './styles/app.css';
import './styles/motion.css';
import './styles/mobile.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadImportedFonts } from './lib/fonts';
import { soundLog } from './lib/sounds';
import { useVoice } from './store/voice';

// Diagnóstico somente leitura para suporte/E2E (não expõe tokens nem conteúdo).
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
