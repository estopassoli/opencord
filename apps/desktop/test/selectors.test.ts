import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guarda de regressão (bug real encontrado no E2E): no zustand v5, seletor que cria array/objeto novo
 * sem `useShallow` causa loop de renderização ("Maximum update depth"). Proíbe esses padrões no código.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('seletores zustand', () => {
  it('não derivam arrays/objetos novos sem useShallow', () => {
    const bad: string[] = [];
    const re =
      /use(Data|Voice|Ui|Messages|Session)\(\(s\) =>[^;\n]*(\.filter\(|\.map\(|\?\? \[\]|\?\? \{\}|Object\.(values|keys|entries)\([^)]*\)\.(filter|map))/;
    for (const f of files(path.join(__dirname, '../src'))) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (re.test(line) && !line.includes('useShallow')) bad.push(`${path.relative(process.cwd(), f)}:${i + 1}`);
        });
    }
    expect(bad).toEqual([]);
  });

  it('seletores de várias linhas não retornam objetos/arrays literais novos', () => {
    const bad: string[] = [];
    for (const f of files(path.join(__dirname, '../src'))) {
      const src = readFileSync(f, 'utf8');
      // captura o corpo de `useX((s) => { ... })` (sem useShallow) e procura `return {` / `return [`
      const re = /use(Data|Voice|Ui|Messages|Session)\(\(s\) => \{([\s\S]*?)\n {2}\}\);/g;
      for (const m of src.matchAll(re)) {
        if (/return \{|return \[|=> \(\{/.test(m[2] ?? ''))
          bad.push(`${path.relative(process.cwd(), f)}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
