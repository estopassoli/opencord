import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Pedido do usuário: nenhum controle nativo/"vanilla" na UI — tudo pelo kit de @opencord/ui
 * (Select, Slider, Switch, Checkbox, RadioGroup, ColorSwatches, TextField, TextArea, Button).
 * Exceção única: <input type="file" hidden>, necessário para abrir o seletor de arquivos do sistema.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : f.endsWith('.tsx') ? [p] : [];
  });
}

describe('sem controles nativos', () => {
  it('não usa select/option/textarea/input nativos nem botões .btn soltos', () => {
    const bad: string[] = [];
    for (const f of files(path.join(__dirname, '../src'))) {
      const src = readFileSync(f, 'utf8');
      const rel = path.relative(process.cwd(), f);
      for (const tag of ['<select', '<option', '<textarea']) if (src.includes(tag)) bad.push(`${rel}: ${tag}`);
      for (const m of src.matchAll(/<input\b[^>]*>/gs)) {
        if (!/type="file"/.test(m[0]) || !/\bhidden\b/.test(m[0]))
          bad.push(`${rel}: ${m[0].slice(0, 60).replace(/\s+/g, ' ')}`);
      }
      if (/className="btn[ "]/.test(src)) bad.push(`${rel}: className="btn …"`);
    }
    expect(bad).toEqual([]);
  });
});
