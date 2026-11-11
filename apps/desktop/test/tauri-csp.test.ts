import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const csp = (file: string) => /content="(default-src[^"]*)"/.exec(readFileSync(file, 'utf8'))?.[1];

describe('app em Tauri (ADR-0062)', () => {
  it('a página usa a mesma CSP do Electron (sem data:/blob: no connect-src, os sons do gunfight não carregavam)', () => {
    const electron = csp(join(__dirname, '../index.html'));
    const tauri = csp(join(__dirname, '../../desktop-tauri/index.html'));
    expect(electron).toBeTruthy();
    expect(tauri).toBe(electron);
  });
});
