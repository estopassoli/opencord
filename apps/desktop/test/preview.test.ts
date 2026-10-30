import { describe, expect, it } from 'vitest';
import { isJpeg } from '../src/voice/preview';

describe('isJpeg', () => {
  it('aceita só bytes com a assinatura JPEG', () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]))).toBe(false);
    expect(isJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
  });
});
