import { Fragment, type ReactNode } from 'react';
import { bridge } from '../../lib/bridge';

/**
 * Formatação leve e SEGURA (sem innerHTML): `código`, **negrito**, *itálico*, links http(s) e menções <@id>.
 * Qualquer outro conteúdo é texto puro — elimina XSS por construção.
 */
const TOKEN = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(<@[0-9a-f-]{36}>)|(@everyone)|(https?:\/\/[^\s<>"']+)/gi;

export function renderRich(text: string, nameOf: (id: string) => string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = text.split('\n');
  lines.forEach((line, li) => {
    let last = 0;
    for (const m of line.matchAll(TOKEN)) {
      const i = m.index ?? 0;
      if (i > last) out.push(line.slice(last, i));
      const t = m[0];
      const k = `${li}-${i}`;
      if (m[1]) out.push(<code key={k}>{t.slice(1, -1)}</code>);
      else if (m[2]) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
      else if (m[3]) out.push(<em key={k}>{t.slice(1, -1)}</em>);
      else if (m[4])
        out.push(
          <span key={k} className="mention">
            @{nameOf(t.slice(2, -1))}
          </span>,
        );
      else if (m[5])
        out.push(
          <span key={k} className="mention">
            @everyone
          </span>,
        );
      else if (m[6]) out.push(<ExternalLink key={k} href={t.replace(/[.,;:!?)]+$/, '')} />);
      last = i + t.length;
      // pontuação final removida do link volta como texto
      if (m[6]) {
        const trimmed = t.length - t.replace(/[.,;:!?)]+$/, '').length;
        if (trimmed) out.push(t.slice(t.length - trimmed));
      }
    }
    if (last < line.length) out.push(line.slice(last));
    if (li < lines.length - 1) out.push(<br key={`br-${li}`} />);
  });
  return out.map((n, i) => (typeof n === 'string' ? <Fragment key={`t${i}`}>{n}</Fragment> : n));
}

function ExternalLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      rel="noreferrer noopener"
      target="_blank"
      onClick={(e) => {
        // no desktop, links externos abrem no navegador padrão após validação no main
        if (bridge) {
          e.preventDefault();
          void bridge.openExternal(href);
        }
      }}
    >
      {href}
    </a>
  );
}
