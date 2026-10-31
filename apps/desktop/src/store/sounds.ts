import type { SoundEffect } from '@opencord/contracts';
import { create } from 'zustand';
import { useData } from './data';
import { api, describeError, useSession } from './session';
import { useUi } from './ui';

/**
 * Efeitos sonoros (ADR-0016): sons de todos os meus servidores (tocáveis em qualquer chamada), agrupados por servidor, arquivos em cache e reprodução local quando alguém na minha
 * chamada toca um som. Volume e "silenciar efeitos" são só meus (lembrados neste computador).
 */
interface SoundsStore {
  byServer: Record<string, SoundEffect[]>;
  volume: number;
  muted: boolean;
  /** quantas vezes eu toquei cada som (para "Utilizados com frequência") */
  usage: Record<string, number>;
  /** quantos efeitos de outras pessoas tocaram aqui (diagnóstico dos testes; o app de teste roda mudo) */
  heard: number;
  /** se a lista de todos os servidores já veio (o painel mostra todos) */
  loadedAll: boolean;
  load(serverId: string): Promise<void>;
  /** sons de todos os meus servidores */
  loadAll(): Promise<void>;
  play(channelId: string, sound: SoundEffect): Promise<void>;
  /** alguém na chamada tocou (o som pode ser de outro servidor): toca aqui, se não estou ensurdecido nem silenciei */
  hear(soundId: string, volume: number): Promise<void>;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
}

const read = <T>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* vale só nesta sessão */
  }
};

/** arquivo de cada som como URL local (baixado uma vez) */
const files = new Map<string, Promise<string>>();
function fileUrl(soundId: string): Promise<string> {
  let p = files.get(soundId);
  if (!p) {
    p = api()
      .blob(`/sounds/${soundId}/file`)
      .then((b) => URL.createObjectURL(b));
    p.catch(() => files.delete(soundId));
    files.set(soundId, p);
  }
  return p;
}

async function playLocal(sound: Pick<SoundEffect, 'id' | 'volume'>, localVolume: number) {
  const url = await fileUrl(sound.id);
  const el = new Audio(url);
  el.volume = Math.max(0, Math.min(1, sound.volume * localVolume));
  // pelo dispositivo de saída escolhido em Configurações → Voz e vídeo
  const out = useData.getState().settings?.audio.outputDeviceId;
  const sink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (out && sink.setSinkId) await sink.setSinkId(out).catch(() => undefined);
  await el.play().catch(() => undefined);
}

export const useSounds = create<SoundsStore>()((set, get) => ({
  byServer: {},
  volume: read('oc-sound-volume', 0.8),
  muted: read('oc-sound-muted', false),
  usage: read('oc-sound-usage', {} as Record<string, number>),
  heard: 0,
  loadedAll: false,
  async loadAll() {
    try {
      const list = await api().request<SoundEffect[]>('GET', '/sounds');
      const byServer: Record<string, SoundEffect[]> = {};
      for (const s of list) (byServer[s.serverId] ??= []).push(s);
      set({ byServer, loadedAll: true });
    } catch {
      /* sem conexão: fica o que já havia */
    }
  },
  async load(serverId) {
    try {
      const list = await api().request<SoundEffect[]>('GET', `/servers/${serverId}/sounds`);
      set((s) => ({ byServer: { ...s.byServer, [serverId]: list } }));
    } catch {
      /* sem acesso ou sem conexão */
    }
  },
  async play(channelId, sound) {
    const rt = useSession.getState().realtime;
    if (!rt) return;
    try {
      await rt.command('sound:play', { channelId, soundId: sound.id });
      const usage = { ...get().usage, [sound.id]: (get().usage[sound.id] ?? 0) + 1 };
      set({ usage });
      write('oc-sound-usage', usage);
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    }
  },
  async hear(soundId, soundVolume) {
    const { muted, volume } = get();
    const { useVoice } = await import('./voice');
    if (muted || useVoice.getState().selfDeaf) return;
    set((s) => ({ heard: s.heard + 1 }));
    await playLocal({ id: soundId, volume: soundVolume }, volume).catch(() => undefined);
  },
  setVolume(v) {
    set({ volume: v });
    write('oc-sound-volume', v);
  },
  setMuted(m) {
    set({ muted: m });
    write('oc-sound-muted', m);
  },
}));

/** Prévia (só para mim), usada no envio e na lista das configurações. */
export async function previewSound(sound: SoundEffect) {
  await playLocal(sound, useSounds.getState().volume);
}
