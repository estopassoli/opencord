import type { BoardCard, BoardColumn } from '@opencord/contracts';
import { create } from 'zustand';
import { api, describeError } from './session';
import { useUi } from './ui';

/**
 * Quadros kanban (ADR-0017): cards por quadro, carregados ao abrir e mantidos pelos eventos `board:card:*`
 * (só chegam para quem vê o quadro). Mover é otimista: o card muda na hora e volta se a API recusar.
 */
interface BoardsStore {
  byBoard: Record<string, BoardCard[]>;
  load(boardId: string): Promise<void>;
  upsert(card: BoardCard): void;
  remove(boardId: string, cardId: string): void;
  move(card: BoardCard, column: BoardColumn, position?: number): Promise<void>;
  update(card: BoardCard, patch: { title?: string; body?: string }): Promise<void>;
  create(boardId: string, title: string, body: string): Promise<void>;
  destroy(card: BoardCard): Promise<void>;
}

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

export const useBoards = create<BoardsStore>()((set, get) => ({
  byBoard: {},
  async load(boardId) {
    try {
      const cards = await api().request<BoardCard[]>('GET', `/channels/${boardId}/cards`);
      set((s) => ({ byBoard: { ...s.byBoard, [boardId]: cards } }));
    } catch (e) {
      toastError(e);
    }
  },
  upsert(card) {
    set((s) => {
      const list = s.byBoard[card.boardId];
      if (!list) return s; // quadro ainda não aberto: carrega tudo ao abrir
      const next = list.some((c) => c.id === card.id)
        ? list.map((c) => (c.id === card.id ? card : c))
        : [...list, card];
      return { byBoard: { ...s.byBoard, [card.boardId]: next } };
    });
  },
  remove(boardId, cardId) {
    set((s) => {
      const list = s.byBoard[boardId];
      return list ? { byBoard: { ...s.byBoard, [boardId]: list.filter((c) => c.id !== cardId) } } : s;
    });
  },
  async move(card, column, position) {
    const before = card;
    get().upsert({ ...card, column, position: position ?? Number.NEGATIVE_INFINITY });
    try {
      get().upsert(
        await api().request<BoardCard>('PATCH', `/cards/${card.id}`, {
          column,
          ...(position !== undefined ? { position } : {}),
        }),
      );
    } catch (e) {
      get().upsert(before);
      toastError(e);
    }
  },
  async update(card, patch) {
    try {
      get().upsert(await api().request<BoardCard>('PATCH', `/cards/${card.id}`, patch));
    } catch (e) {
      toastError(e);
    }
  },
  async create(boardId, title, body) {
    try {
      get().upsert(await api().request<BoardCard>('POST', `/channels/${boardId}/cards`, { title, body }));
    } catch (e) {
      toastError(e);
    }
  },
  async destroy(card) {
    get().remove(card.boardId, card.id);
    try {
      await api().request('DELETE', `/cards/${card.id}`);
    } catch (e) {
      get().upsert(card);
      toastError(e);
    }
  },
}));
