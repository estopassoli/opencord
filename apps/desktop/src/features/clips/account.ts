/**
 * Clipes na conta (ADR-0057): o clipe do computador sobe para a conta (vídeo em partes + miniatura) e aparece em
 * qualquer aparelho em que a pessoa entrar. Até 6 ficam em destaque no perfil.
 */
import {
  CLIP_FEATURED_MAX,
  type AccountClip,
  type AccountClipsResponse,
  type Attachment,
  type CreateAccountClipRequest,
} from '@opencord/contracts';
import { create } from 'zustand';
import type { ClipInfo } from '../../../electron/shared/ipc';
import { api } from '../../store/session';

/** Sobe o vídeo em partes de 8 MB (até 1 GB) e devolve o anexo. */
export async function uploadLarge(data: Blob, name: string, onProgress: (p: number) => void): Promise<Attachment> {
  const a = api();
  const { id, partBytes } = await a.request<{ id: string; partBytes: number }>('POST', '/attachments/large', {
    name,
    size: data.size,
  });
  try {
    const parts = Math.ceil(data.size / partBytes);
    for (let n = 1; n <= parts; n++) {
      const chunk = data.slice((n - 1) * partBytes, n * partBytes);
      for (let attempt = 0; ; attempt++) {
        try {
          await a.upload(`/attachments/large/${id}/parts`, new File([chunk], `parte-${n}`), { n: String(n) });
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
      onProgress(n / parts);
    }
    return (await a.request<{ attachment: Attachment }>('POST', `/attachments/large/${id}/complete`)).attachment;
  } catch (e) {
    await a.request('POST', `/attachments/large/${id}/abort`).catch(() => undefined);
    throw e;
  }
}

/** prefixo do `file` de um clipe que só existe na conta (aberto no visualizador sem arquivo local) */
export const CLOUD_PREFIX = 'conta:';
export const isCloudOnly = (c: Pick<ClipInfo, 'file'>) => c.file.startsWith(CLOUD_PREFIX);
export const cloudIdOf = (c: Pick<ClipInfo, 'file'>) => (isCloudOnly(c) ? c.file.slice(CLOUD_PREFIX.length) : null);

/** o clipe da conta no formato da biblioteca (para a grade e o visualizador) */
export function asLocal(c: AccountClip): ClipInfo {
  return {
    file: `${CLOUD_PREFIX}${c.id}`,
    name: c.title,
    game: c.game,
    icon: null,
    steamAppId: null,
    createdAt: c.recordedAt,
    durationMs: c.durationMs,
    sizeBytes: c.sizeBytes,
    thumb: c.thumbUrl,
  };
}

interface AccountClipsState {
  loaded: boolean;
  clips: AccountClip[];
  usedBytes: number;
  maxBytes: number;
  maxClips: number;
  /** envio em andamento, por `createdAt` do clipe local (0–1) */
  uploading: Record<number, number>;
  load(): Promise<void>;
  save(local: ClipInfo, data: Blob, title: string): Promise<AccountClip>;
  setFeatured(id: string, on: boolean): Promise<void>;
  remove(id: string): Promise<void>;
}

export const useAccountClips = create<AccountClipsState>()((set, get) => ({
  loaded: false,
  clips: [],
  usedBytes: 0,
  maxBytes: 0,
  maxClips: 0,
  uploading: {},
  async load() {
    try {
      const r = await api().request<AccountClipsResponse>('GET', '/me/clips');
      set({ loaded: true, clips: r.clips, usedBytes: r.usedBytes, maxBytes: r.maxBytes, maxClips: r.maxClips });
    } catch {
      // API antiga (sem a rota) ou sem conexão: só os clipes do computador
      set({ loaded: true });
    }
  },
  async save(local, data, title) {
    const key = local.createdAt;
    const s = get();
    if (s.maxBytes && s.usedBytes + data.size > s.maxBytes)
      throw new Error('Sem espaço para clipes na conta. Apague algum clipe salvo na conta para enviar este.');
    if (s.maxClips && s.clips.length >= s.maxClips)
      throw new Error(`A conta guarda até ${s.maxClips} clipes. Apague algum para enviar este.`);
    const progress = (p: number) => set((x) => ({ uploading: { ...x.uploading, [key]: p } }));
    progress(0);
    try {
      const video = await uploadLarge(data, `${local.name || 'clipe'}.mp4`, (p) => progress(p * 0.97));
      let thumbId: string | null = null;
      if (local.thumb) {
        const blob = await (await fetch(local.thumb)).blob().catch(() => null);
        if (blob) {
          const up = await api()
            .upload<{ attachment: Attachment }>('/attachments', new File([blob], 'miniatura.jpg', { type: blob.type }))
            .catch(() => null);
          thumbId = up?.attachment.id ?? null;
        }
      }
      const body: CreateAccountClipRequest = {
        videoId: video.id,
        thumbId,
        title,
        game: local.game,
        durationMs: Math.round(local.durationMs),
        recordedAt: Math.round(local.createdAt),
      };
      const clip = await api().request<AccountClip>('POST', '/me/clips', body);
      set((x) => ({
        clips: [clip, ...x.clips].sort((a, b) => b.recordedAt - a.recordedAt),
        usedBytes: x.usedBytes + clip.sizeBytes,
      }));
      return clip;
    } finally {
      set((x) => {
        const { [key]: _done, ...rest } = x.uploading;
        return { uploading: rest };
      });
    }
  },
  async setFeatured(id, on) {
    if (on && get().clips.filter((c) => c.featured).length >= CLIP_FEATURED_MAX)
      throw new Error(`O perfil destaca até ${CLIP_FEATURED_MAX} clipes. Tire o destaque de algum antes.`);
    const clip = await api().request<AccountClip>('PATCH', `/me/clips/${id}`, { featured: on });
    set((x) => ({ clips: x.clips.map((c) => (c.id === id ? clip : c)) }));
  },
  async remove(id) {
    await api().request('DELETE', `/me/clips/${id}`);
    set((x) => {
      const gone = x.clips.find((c) => c.id === id);
      return { clips: x.clips.filter((c) => c.id !== id), usedBytes: x.usedBytes - (gone?.sizeBytes ?? 0) };
    });
  },
}));

/** o clipe da conta que é este arquivo do computador (mesmo instante de gravação) */
export function cloudOf(clips: AccountClip[], local: Pick<ClipInfo, 'createdAt' | 'file'>): AccountClip | undefined {
  const id = cloudIdOf(local);
  return id ? clips.find((c) => c.id === id) : clips.find((c) => c.recordedAt === Math.round(local.createdAt));
}
