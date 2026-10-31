/**
 * Registro de erros da janela (tela "Algo deu errado", erros não tratados): `crash-log.txt` na pasta de dados do app,
 * para diagnosticar depois. Só mensagem, pilha e onde aconteceu; nunca conteúdo de mensagens ou tokens.
 */
import { app } from 'electron';
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ErrorReport } from '../shared/ipc';

const MAX_BYTES = 256 * 1024;
const file = () => path.join(app.getPath('userData'), 'crash-log.txt');

export function logRendererError(r: ErrorReport) {
  try {
    const f = file();
    // arquivo cheio: o anterior vira .old e começa outro
    if (existsSync(f) && statSync(f).size > MAX_BYTES) renameSync(f, `${f}.old`);
    const lines = [
      `--- ${new Date().toISOString()} · v${app.getVersion()} · ${r.where}`,
      r.message,
      r.stack ?? '',
      r.componentStack ? `componentes:${r.componentStack}` : '',
      '',
    ];
    appendFileSync(f, lines.filter((l, i) => l || i === lines.length - 1).join('\n'));
  } catch {
    /* sem como gravar: segue */
  }
}

export const crashLogPath = file;
