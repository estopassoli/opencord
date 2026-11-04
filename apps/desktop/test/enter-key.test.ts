import { afterEach, describe, expect, it, vi } from 'vitest';
import { enterSends, TOUCH_KEYBOARD_QUERY } from '../src/lib/media';

const mockMedia = (touch: boolean) =>
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q: string) =>
      ({
        matches: touch && q === TOUCH_KEYBOARD_QUERY,
        media: q,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );

describe('Enter no composer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('com mouse e teclado físico, Enter envia', () => {
    mockMedia(false);
    expect(enterSends()).toBe(true);
  });

  it('no celular (toque, sem hover), Enter pula linha', () => {
    mockMedia(true);
    expect(enterSends()).toBe(false);
  });
});
