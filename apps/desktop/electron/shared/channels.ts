/** Nomes de canais IPC (sem dependências: importável pelo preload com sandbox). */
export const IPC = {
  captureListSources: 'capture:list-sources',
  captureSelect: 'capture:select',
  secureGet: 'secure:get',
  secureSet: 'secure:set',
  secureDelete: 'secure:delete',
  notify: 'notify:show',
  shortcutsSet: 'shortcuts:set',
  windowFlash: 'window:flash',
  windowFocus: 'window:focus',
  badgeSet: 'badge:set',
  appInfo: 'app:info',
  openExternal: 'app:open-external',
  trayVoiceState: 'tray:voice-state',
  // eventos main → renderer
  evShortcut: 'ev:shortcut',
  evNotificationClick: 'ev:notification-click',
  evPowerResume: 'ev:power-resume',
  evTrayAction: 'ev:tray-action',
} as const;
