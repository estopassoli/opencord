/**
 * Aparência dos perfis (ADR-0048): bio, banner e cores, carregados quando um cartão de perfil abre
 * (GET /users/:id/profile) e guardados em memória. `user:updated` não traz isso; o cartão recarrega ao abrir.
 */
import type { ProfileAppearance, UserProfile } from '@opencord/contracts';
import { create } from 'zustand';
import { api } from './session';

export const EMPTY_APPEARANCE: ProfileAppearance = { bio: '', bannerKey: null, bannerUrl: null, colors: null };

interface ProfilesState {
  byId: Record<string, ProfileAppearance>;
  load(userId: string): Promise<void>;
  set(userId: string, a: ProfileAppearance): void;
}

export const useProfiles = create<ProfilesState>()((set) => ({
  byId: {},
  async load(userId) {
    try {
      const p = await api().request<UserProfile>('GET', `/users/${userId}/profile`);
      set((s) => ({ byId: { ...s.byId, [userId]: p.appearance ?? EMPTY_APPEARANCE } }));
    } catch {
      // sem vínculo (404) ou API antiga: o cartão fica sem banner/bio
    }
  },
  set: (userId, a) => set((s) => ({ byId: { ...s.byId, [userId]: a } })),
}));
