import type { UserSettings } from '@opencord/contracts';
import { bridge } from '../lib/bridge';
import { accentTokens, FONT_STACK_FALLBACK } from '../lib/theme';
import { api } from './session';
import { useData } from './data';
import { useUi } from './ui';

/** Aplica efeitos colaterais das configurações: tema, movimento, fonte e atalhos globais. */
export function applySettingsSideEffects(s: UserSettings) {
  const root = document.documentElement;
  root.dataset.theme = s.appearance.theme;
  root.dataset.motion =
    s.appearance.reducedMotion === 'system' ? '' : s.appearance.reducedMotion === 'on' ? 'reduced' : 'full';
  root.dataset.density = s.appearance.compact ? 'compact' : 'cozy';
  root.style.fontSize = `${Math.round(16 * s.appearance.fontScale)}px`;
  applyAppearanceTokens(s.appearance);
  if (bridge) {
    void bridge
      .setShortcuts({
        toggleMute: s.keybinds.toggleMute,
        toggleDeafen: s.keybinds.toggleDeafen,
        pushToTalkToggle: s.audio.inputMode === 'ptt' ? s.keybinds.pushToTalk : null,
      })
      .then((r) => {
        if (r.failed.length)
          useUi.getState().toast('error', `Atalho já em uso por outro aplicativo: ${r.failed.join(', ')}`);
      })
      .catch(() => useUi.getState().toast('error', 'Atalho inválido.'));
  }
  void import('./voice').then(({ useVoice }) => useVoice.getState().applySettings(s));
}

/** Cor de destaque, tom de fundo, cantos e fonte: viram variáveis CSS no :root. */
export function applyAppearanceTokens(a: UserSettings['appearance']) {
  const root = document.documentElement;
  root.dataset.surface = a.surface;
  root.style.setProperty('--radius-scale', String(a.radiusScale));
  if (a.fontFamily.trim()) root.style.setProperty('--font', `"${a.fontFamily.trim()}", ${FONT_STACK_FALLBACK}`);
  else root.style.removeProperty('--font');
  // a superfície depende de tema/tom recém-aplicados: lê o valor computado
  const surface = getComputedStyle(root).getPropertyValue('--chat').trim() || '#24262c';
  const t = accentTokens(a.accent, surface, a.theme === 'dark');
  root.style.setProperty('--brand', t.brand);
  root.style.setProperty('--brand-hover', t.brandHover);
  root.style.setProperty('--text-on-brand', t.textOnBrand);
  root.style.setProperty('--brand-text', t.brandText);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Atualiza localmente na hora e persiste no servidor com debounce. */
export function updateSettings(mutate: (s: UserSettings) => UserSettings) {
  const cur = useData.getState().settings;
  if (!cur) return;
  const next = mutate(cur);
  useData.setState({ settings: next });
  applySettingsSideEffects(next);
  pending = next;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    pending = null;
    api()
      .request('PUT', '/me/settings', next)
      .catch(() => useUi.getState().toast('error', 'Não foi possível salvar as configurações.'));
  }, 500);
}

let pending: UserSettings | null = null;

/**
 * Envia na hora o que ainda está no debounce. Chamado ao descarregar a página (fechar/sair do app):
 * `keepalive` deixa a requisição terminar depois que o renderer some, e não há espera assíncrona
 * por token aqui (o access token atual vale por até 15 min).
 */
export function flushSettings() {
  if (!pending || !saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const body = JSON.stringify(pending);
  pending = null;
  try {
    const client = api();
    const token = client.accessToken;
    if (!token) return;
    void fetch(`${client.baseUrl.replace(/\/+$/, '')}/me/settings`, {
      method: 'PUT',
      keepalive: true,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body,
    }).catch(() => undefined);
  } catch {
    /* sem sessão: nada a salvar */
  }
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flushSettings);
