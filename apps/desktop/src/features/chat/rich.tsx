import { Fragment, useState, type ReactNode } from 'react';
import { bridge } from '../../lib/bridge';

/**
 * Markdown das mensagens, SEGURO (sem innerHTML: cada pedaço vira um elemento React, o resto é texto puro, então não
 * há XSS por construção). Parecido com o que se usa em chats:
 * - blocos: ```código``` (com linguagem opcional), # / ## / ### títulos, > citação, >>> citação até o fim, - ou *
 *   lista, 1. lista numerada, -# subtexto;
 * - no meio do texto: `código`, **negrito**, *itálico* ou _itálico_, __sublinhado__, ~~tachado~~, ||spoiler||,
 *   [texto](https://link), links http(s), menções <@id> e @everyone; \ escapa um caractere de formatação.
 */

const URL_END = /[.,;:!?)]+$/;
const INLINE = new RegExp(
  [
    /\\([*_~|`\\>#[\]()-])/.source, // 1 escape
    /```([^`]+?)```/.source, // 2 código (crases triplas numa linha)
    /``([^`]+?)``/.source, // 3 código com crases duplas
    /`([^`\n]+)`/.source, // 4 código
    /<@([0-9a-f-]{36})>/.source, // 5 menção
    /(@everyone)/.source, // 6
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)<>"']+)\)/.source, // 7, 8 link com texto
    /(https?:\/\/[^\s<>"']+)/.source, // 9 link
    /\*\*\*([^\n]+?)\*\*\*/.source, // 10 negrito + itálico
    /\*\*([^\n]+?)\*\*/.source, // 11 negrito
    /__([^\n]+?)__/.source, // 12 sublinhado
    /\*([^*\s](?:[^*\n]*?[^*\s])?)\*/.source, // 13 itálico
    String.raw`(?<![\p{L}\p{N}_])_([^_\s](?:[^_\n]*?[^_\s])?)_(?![\p{L}\p{N}_])`, // 14 itálico (não pega snake_case)
    /~~([^\n]+?)~~/.source, // 15 tachado
    /\|\|([^\n]+?)\|\|/.source, // 16 spoiler
  ].join('|'),
  'gu',
);

type NameOf = (id: string) => string;

function inline(text: string, nameOf: NameOf, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(INLINE.source, INLINE.flags);
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const k = `${key}.${i}`;
    let consumed = m[0].length;
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined || m[3] !== undefined || m[4] !== undefined)
      out.push(<code key={k}>{m[2] ?? m[3] ?? m[4]}</code>);
    else if (m[5])
      out.push(
        <span key={k} className="mention">
          @{nameOf(m[5])}
        </span>,
      );
    else if (m[6])
      out.push(
        <span key={k} className="mention">
          @everyone
        </span>,
      );
    else if (m[7] && m[8])
      out.push(
        <ExternalLink key={k} href={m[8]}>
          {inline(m[7], nameOf, k)}
        </ExternalLink>,
      );
    else if (m[9]) {
      // pontuação no fim fica fora do link
      const href = m[9].replace(URL_END, '');
      out.push(<ExternalLink key={k} href={href} />);
      consumed = href.length;
    } else if (m[10] !== undefined)
      out.push(
        <strong key={k}>
          <em>{inline(m[10], nameOf, k)}</em>
        </strong>,
      );
    else if (m[11] !== undefined) out.push(<strong key={k}>{inline(m[11], nameOf, k)}</strong>);
    else if (m[12] !== undefined) out.push(<u key={k}>{inline(m[12], nameOf, k)}</u>);
    else if (m[13] !== undefined || m[14] !== undefined)
      out.push(<em key={k}>{inline((m[13] ?? m[14])!, nameOf, k)}</em>);
    else if (m[15] !== undefined) out.push(<s key={k}>{inline(m[15], nameOf, k)}</s>);
    else if (m[16] !== undefined) out.push(<Spoiler key={k}>{inline(m[16], nameOf, k)}</Spoiler>);
    last = i + consumed;
    if (consumed < m[0].length) re.lastIndex = last;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((n, j) => (typeof n === 'string' ? <Fragment key={`${key}t${j}`}>{n}</Fragment> : n));
}

/** linhas seguidas de texto, com <br> entre elas */
function lines(ls: string[], nameOf: NameOf, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  ls.forEach((l, i) => {
    out.push(...inline(l, nameOf, `${key}-${i}`));
    if (i < ls.length - 1) out.push(<br key={`${key}-br${i}`} />);
  });
  return out;
}

export function renderRich(text: string, nameOf: NameOf): ReactNode[] {
  const out: ReactNode[] = [];
  const src = text.split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(<Fragment key={`p${out.length}`}>{lines(para, nameOf, `p${out.length}`)}</Fragment>);
    para = [];
  };
  // texto depois de um bloco começa em linha nova (blocos já ocupam a linha inteira)
  const block = (node: ReactNode) => {
    flush();
    out.push(node);
  };
  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const k = `b${i}`;
    // ```linguagem … ``` em várias linhas (na mesma linha, ```assim```, fica para o código do meio do texto)
    if (line.startsWith('```') && !line.slice(3).includes('```')) {
      const first = line.slice(3);
      const body: string[] = /^[\w+-]*\s*$/.test(first) ? [] : [first];
      let j = i + 1;
      for (; j < src.length && !src[j]!.trimEnd().endsWith('```'); j++) body.push(src[j]!);
      if (j < src.length) {
        const end = src[j]!.trimEnd().slice(0, -3);
        if (end) body.push(end);
      }
      block(
        <pre key={k} className="md-pre">
          <code>{body.join('\n')}</code>
        </pre>,
      );
      i = j;
      continue;
    }
    const h = /^(#{1,3}) (.+)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const Tag = (['h3', 'h4', 'h5'] as const)[level - 1]!;
      block(
        <Tag key={k} className={`md-h md-h${level}`}>
          {inline(h[2]!, nameOf, k)}
        </Tag>,
      );
      continue;
    }
    const sub = /^-# (.+)$/.exec(line);
    if (sub) {
      block(
        <small key={k} className="md-sub">
          {inline(sub[1]!, nameOf, k)}
        </small>,
      );
      continue;
    }
    if (line.startsWith('>>> ')) {
      block(
        <blockquote key={k} className="md-quote">
          {lines([line.slice(4), ...src.slice(i + 1)], nameOf, k)}
        </blockquote>,
      );
      break;
    }
    if (/^> /.test(line) || line === '>') {
      const q: string[] = [];
      let j = i;
      for (; j < src.length && (/^> /.test(src[j]!) || src[j] === '>'); j++) q.push(src[j]!.slice(2));
      block(
        <blockquote key={k} className="md-quote">
          {lines(q, nameOf, k)}
        </blockquote>,
      );
      i = j - 1;
      continue;
    }
    const ul = /^\s{0,3}[-*] (.+)$/;
    const ol = /^\s{0,3}(\d{1,3})[.)] (.+)$/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const re = ordered ? ol : ul;
      const items: string[] = [];
      let j = i;
      for (; j < src.length && re.test(src[j]!); j++) items.push(re.exec(src[j]!)![ordered ? 2 : 1]!);
      const start = ordered ? Number(ol.exec(line)![1]) : 1;
      const List = ordered ? 'ol' : 'ul';
      block(
        <List key={k} className="md-list" {...(ordered && start !== 1 ? { start } : {})}>
          {items.map((it, n) => (
            <li key={n}>{inline(it, nameOf, `${k}-${n}`)}</li>
          ))}
        </List>,
      );
      i = j - 1;
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

/** ||spoiler||: escondido até clicar (ou Enter/Espaço) */
function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      className="md-spoiler"
      data-shown={shown ? 'true' : undefined}
      role={shown ? undefined : 'button'}
      tabIndex={shown ? undefined : 0}
      aria-label={shown ? undefined : 'Spoiler: clique para mostrar'}
      onClick={() => setShown(true)}
      onKeyDown={(e) => {
        if (!shown && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          setShown(true);
        }
      }}
    >
      <span aria-hidden={!shown}>{children}</span>
    </span>
  );
}

function ExternalLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      rel="noreferrer noopener"
      target="_blank"
      // link com texto: mostra para onde vai antes de clicar
      {...(children ? { 'data-tip': href } : {})}
      onClick={(e) => {
        // no desktop, links externos abrem no navegador padrão após validação no main
        if (bridge) {
          e.preventDefault();
          void bridge.openExternal(href);
        }
      }}
    >
      {children ?? href}
    </a>
  );
}
