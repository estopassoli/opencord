import { nativeImage, type NativeImage } from 'electron';
import logo16 from '../../resources/icons/16.png';
import logo32 from '../../resources/icons/32.png';
import logo64 from '../../resources/icons/64.png';
import logo256 from '../../resources/icons/256.png';
import { renderBadge } from './logo';

/** Ícones do OpenCord a partir do logotipo oficial (resources/opencord-logo.png), embutidos como data URL. */
let cache: { app?: NativeImage; tray?: NativeImage; badge?: NativeImage } = {};

export function appIcon(): NativeImage {
  return (cache.app ??= nativeImage.createFromDataURL(logo256));
}

export function trayIcon(): NativeImage {
  if (!cache.tray) {
    const img = nativeImage.createFromDataURL(logo16);
    img.addRepresentation({ scaleFactor: 2, dataURL: logo32 });
    img.addRepresentation({ scaleFactor: 4, dataURL: logo64 });
    cache.tray = img;
  }
  return cache.tray;
}

/** Ponto vermelho de "não lidas" sobreposto ao ícone da barra de tarefas (gerado por código). */
export function badgeIcon(): NativeImage {
  return (cache.badge ??= nativeImage.createFromBuffer(renderBadge(16)));
}

export function resetIconCache() {
  cache = {};
}
