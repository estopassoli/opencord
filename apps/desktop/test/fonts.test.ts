import { describe, expect, it } from 'vitest';
import { faceFromFileName, familyFromFileName, sniffFontFormat } from '../src/lib/fonts';

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe('fontes importadas', () => {
  it('reconhece o formato pelos bytes, não pela extensão', () => {
    expect(sniffFontFormat(ascii('wOF2xxxx'))).toBe('woff2');
    expect(sniffFontFormat(ascii('wOFFxxxx'))).toBe('woff');
    expect(sniffFontFormat(ascii('OTTOxxxx'))).toBe('opentype');
    expect(sniffFontFormat(bytes(0, 1, 0, 0, 9))).toBe('truetype');
    expect(sniffFontFormat(ascii('<svg'))).toBeNull();
    expect(sniffFontFormat(ascii('PK'))).toBeNull();
  });

  it.each([
    ['MinhaFonte-Regular.ttf', '400', 'normal'],
    ['ggsansbold.woff2', '700', 'normal'],
    ['ggsansbolditalic.woff2', '700', 'italic'],
    ['ggsansextrabold.woff2', '800', 'normal'],
    ['Fonte-SemiBoldItalic.otf', '600', 'italic'],
    ['Fonte_Medium.woff', '500', 'normal'],
    ['Fonte-ExtraLight.ttf', '200', 'normal'],
    ['Fonte-Light.ttf', '300', 'normal'],
    ['Fonte-Black.ttf', '900', 'normal'],
  ])('%s → peso %s, %s', (name, weight, style) => {
    expect(faceFromFileName(name)).toEqual({ weight, style });
  });

  it('sugere o nome da família sem peso/estilo', () => {
    expect(familyFromFileName('ggsansbolditalic.woff2')).toBe('ggsans');
    expect(familyFromFileName('Minha Fonte-SemiBold.ttf')).toBe('Minha Fonte');
    expect(familyFromFileName('Regular.ttf')).toBe('Fonte importada');
  });
});
