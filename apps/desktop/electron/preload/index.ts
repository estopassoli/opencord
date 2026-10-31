/**
 * Preload com sandbox: expõe apenas `window.opencord` com métodos fixos.
 * Nenhum objeto do Electron/Node (ipcRenderer, event) chega ao renderer.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/channels';
import type { OpenCordBridge } from '../shared/ipc';

const EVENT_CHANNELS = {
  shortcut: IPC.evShortcut,
  'notification-click': IPC.evNotificationClick,
  'power-resume': IPC.evPowerResume,
  'tray-action': IPC.evTrayAction,
  update: IPC.evUpdate,
  'window-state': IPC.evWindowState,
  game: IPC.evGame,
} as const;

const bridge: OpenCordBridge = {
  capture: {
    listSources: () => ipcRenderer.invoke(IPC.captureListSources),
    select: (args) => ipcRenderer.invoke(IPC.captureSelect, args),
  },
  secure: {
    get: (key) => ipcRenderer.invoke(IPC.secureGet, key),
    set: (key, value) => ipcRenderer.invoke(IPC.secureSet, key, value),
    delete: (key) => ipcRenderer.invoke(IPC.secureDelete, key),
  },
  notify: (args) => ipcRenderer.invoke(IPC.notify, args),
  setShortcuts: (args) => ipcRenderer.invoke(IPC.shortcutsSet, args),
  flashFrame: () => ipcRenderer.invoke(IPC.windowFlash),
  focusWindow: () => ipcRenderer.invoke(IPC.windowFocus),
  windowControl: (action) => ipcRenderer.invoke(IPC.windowControl, action),
  windowState: () => ipcRenderer.invoke(IPC.windowState),
  setBadge: (count) => ipcRenderer.invoke(IPC.badgeSet, count),
  setTrayVoiceState: (state) => ipcRenderer.invoke(IPC.trayVoiceState, state),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  prefs: {
    get: () => ipcRenderer.invoke(IPC.prefsGet),
    set: (prefs) => ipcRenderer.invoke(IPC.prefsSet, prefs),
  },
  relaunch: () => ipcRenderer.invoke(IPC.appRelaunch),
  clips: {
    prepareCapture: () => ipcRenderer.invoke(IPC.clipsPrepare),
    save: (args) => ipcRenderer.invoke(IPC.clipsSave, args),
    reveal: (path) => ipcRenderer.invoke(IPC.clipsReveal, path),
    list: () => ipcRenderer.invoke(IPC.clipsList),
    read: (path) => ipcRenderer.invoke(IPC.clipsRead, path),
    remove: (path) => ipcRenderer.invoke(IPC.clipsRemove, path),
    copy: (path) => ipcRenderer.invoke(IPC.clipsCopy, path),
    exportFile: (args) => ipcRenderer.invoke(IPC.clipsExport, args),
    dir: () => ipcRenderer.invoke(IPC.clipsDir),
    chooseDir: () => ipcRenderer.invoke(IPC.clipsChooseDir),
  },
  games: {
    configure: (args) => ipcRenderer.invoke(IPC.gamesConfigure, args),
    processes: () => ipcRenderer.invoke(IPC.gamesProcesses),
    current: () => ipcRenderer.invoke(IPC.gamesCurrent),
  },
  updates: {
    status: () => ipcRenderer.invoke(IPC.updateStatus),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
  },
  on: ((event: keyof typeof EVENT_CHANNELS, cb: (arg: unknown) => void) => {
    const channel = EVENT_CHANNELS[event];
    if (!channel) throw new Error('evento desconhecido');
    const listener = (_e: IpcRendererEvent, arg: unknown) => cb(arg);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }) as OpenCordBridge['on'],
};

contextBridge.exposeInMainWorld('opencord', bridge);
