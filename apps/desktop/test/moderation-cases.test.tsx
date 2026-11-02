import type { ModerationCase } from '@opencord/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../src/lib/api';
import { ModerationCasesList } from '../src/features/admin/ModerationCases';
import { useSession } from '../src/store/session';
import { useUi } from '../src/store/ui';

const user = { id: 'u1', username: 'bruno', displayName: 'Bruno', avatarKey: null };
const base: ModerationCase = {
  id: 'c1',
  serverId: 's1',
  server: { id: 's1', name: 'Turma' },
  channelId: 'ch1',
  channelName: 'geral',
  conversationId: null,
  author: user,
  body: 'olha isso aqui',
  attachments: [
    { id: 'a1', originalName: 'foto.png', mime: 'image/png', sizeBytes: 10, url: 'https://x/a1', width: 3, height: 2 },
  ],
  verdict: 'review',
  category: 'assedio',
  reason: 'Pode ser assédio; contexto ambíguo.',
  status: 'pending',
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  publishedMessageId: null,
  createdAt: '2026-11-02T20:00:00.000Z',
};

describe('ModerationCasesList (fila da moderação por IA)', () => {
  const request = vi.fn();
  beforeEach(() => {
    request.mockReset();
    useSession.setState({ api: { request } as unknown as ApiClient });
    useUi.setState({ toasts: [] });
  });
  afterEach(() => useSession.setState({ api: null }));

  it('mostra autor, canal, categoria, motivo, texto e a prévia da imagem; sem tooltip nativo', () => {
    const { container } = render(<ModerationCasesList cases={[base]} onReviewed={() => undefined} empty="nada" />);
    expect(screen.getByText('Bruno')).toBeTruthy();
    expect(screen.getByText(/#geral/)).toBeTruthy();
    expect(screen.getByText('Assédio:')).toBeTruthy();
    expect(screen.getByText(/contexto ambíguo/)).toBeTruthy();
    expect(screen.getByText('olha isso aqui')).toBeTruthy();
    expect(container.querySelector('.mod-thumbs img')?.getAttribute('src')).toBe('https://x/a1');
    expect(screen.getByText('Aguardando revisão')).toBeTruthy();
    expect(container.querySelector('[title]')).toBeNull();
  });

  it('aprovar chama a revisão e substitui o caso pelo devolvido', async () => {
    const approved = { ...base, status: 'approved' as const, reviewedBy: user, publishedMessageId: 'm1' };
    request.mockResolvedValueOnce(approved);
    const onReviewed = vi.fn();
    render(<ModerationCasesList cases={[base]} onReviewed={onReviewed} empty="nada" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Aprovar e publicar' }));
    });
    expect(request).toHaveBeenCalledWith('POST', '/moderation/cases/c1/review', { decision: 'approve' });
    expect(onReviewed).toHaveBeenCalledWith(approved);
  });

  it('reprovar abre motivo + punição e envia o castigo escolhido', async () => {
    request.mockResolvedValueOnce({ ...base, status: 'rejected' });
    const onReviewed = vi.fn();
    render(<ModerationCasesList cases={[base]} onReviewed={onReviewed} empty="nada" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reprovar…' }));
    fireEvent.change(screen.getByLabelText('Motivo (a pessoa vê)'), { target: { value: 'ofensa direta' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar reprovação' }));
    });
    expect(request).toHaveBeenCalledWith('POST', '/moderation/cases/c1/review', {
      decision: 'reject',
      note: 'ofensa direta',
      punishment: null,
    });
    expect(onReviewed).toHaveBeenCalled();
  });

  it('caso já decidido não mostra botões e diz quem decidiu', () => {
    render(
      <ModerationCasesList
        cases={[{ ...base, status: 'rejected', reviewedBy: user, reviewNote: 'não cola', reviewedAt: base.createdAt }]}
        onReviewed={() => undefined}
        empty="nada"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Aprovar e publicar' })).toBeNull();
    expect(screen.getByText(/Reprovado por Bruno/)).toBeTruthy();
    expect(screen.getByText(/não cola/)).toBeTruthy();
  });

  it('lista vazia mostra o texto de vazio', () => {
    render(<ModerationCasesList cases={[]} onReviewed={() => undefined} empty="Nada retido." />);
    expect(screen.getByText('Nada retido.')).toBeTruthy();
  });
});
