// Preload da janela do overlay (ADR-0027): só recebe o estado que o processo principal repassa.
import { contextBridge, ipcRenderer } from 'electron';
import type { OverlayState } from '../shared/overlay';

contextBridge.exposeInMainWorld('overlay', {
  onState(cb: (s: OverlayState) => void) {
    ipcRenderer.on('overlay:state', (_e, s: OverlayState) => cb(s));
  },
});
