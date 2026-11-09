import type { AccountClip } from '@opencord/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProfileClips } from '../src/components/ProfileClips';
import { asLocal, cloudIdOf, cloudOf, isCloudOnly } from '../src/features/clips/account';
import { useUi } from '../src/store/ui';

const clip = (over: Partial<AccountClip> = {}): AccountClip => ({
  id: '0190a000-0000-7000-8000-000000000001',
  title: 'Clipe de 8 de nov., 23:30',
  game: 'Jogo X',
  durationMs: 65_000,
  sizeBytes: 1000,
  width: 1920,
  height: 1080,
  recordedAt: 1_700_000_000_123,
  featured: true,
  url: 'https://api.test/attachments/x/download',
  thumbUrl: null,
  ...over,
});

describe('clipes na conta', () => {
  it('liga o clipe da conta ao arquivo do computador pelo instante da gravação', () => {
    const c = clip();
    const local = { file: 'C:/Videos/a.mp4', createdAt: 1_700_000_000_123.4 };
    expect(cloudOf([c], local)?.id).toBe(c.id);
    expect(cloudOf([c], { ...local, createdAt: 5 })).toBeUndefined();
    const only = asLocal(c);
    expect(isCloudOnly(only)).toBe(true);
    expect(cloudIdOf(only)).toBe(c.id);
    expect(cloudOf([c], only)?.id).toBe(c.id);
  });

  it('o perfil mostra os destaques e abre o vídeo no visualizador', () => {
    render(<ProfileClips clips={[clip()]} owner={{ id: 'u1', displayName: 'Ana' }} />);
    expect(screen.getByText('Clipes em destaque')).toBeTruthy();
    expect(screen.getByText('1:05')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Jogo X/ }));
    const media = useUi.getState().media;
    expect(media?.items[0]).toMatchObject({ mime: 'video/mp4', authorName: 'Ana' });
  });

  it('sem destaques, nada aparece', () => {
    const { container } = render(<ProfileClips clips={[]} owner={{ id: 'u1', displayName: 'Ana' }} />);
    expect(container.innerHTML).toBe('');
  });
});
