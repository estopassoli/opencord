import { Icon } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { MobileNavButton } from '../../components/MobileNavButton';
import { bridge } from '../../lib/bridge';
import { CHANGELOG, type ChangeEntry, type ChangeKind } from './changelog';

const KIND_LABEL: Record<ChangeKind, string> = { novo: 'Novo', melhoria: 'Melhoria', correção: 'Correção' };

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Tela inicial "Novidades": linha do tempo do que entrou no OpenCord (dados em changelog.ts). */
export function NewsView() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void bridge?.appInfo().then(
      (i) => setVersion(i.version),
      () => undefined,
    );
  }, []);

  const days = new Map<string, ChangeEntry[]>();
  for (const e of CHANGELOG) days.set(e.date, [...(days.get(e.date) ?? []), e]);

  return (
    <section className="home news" aria-labelledby="news-title">
      <header className="chat-header">
        <MobileNavButton />
        <Icon name="bell" size={22} />
        <h2 id="news-title">Novidades</h2>
        <span className="spacer" />
        {version && <span className="muted small">Você está na versão {version}</span>}
      </header>
      <div className="news-body">
        <p className="muted news-intro">O que entrou no OpenCord, do mais novo para o mais antigo.</p>
        {[...days].map(([date, entries]) => (
          <section key={date} className="news-day" aria-label={dayLabel(date)}>
            <h3 className="news-date">{dayLabel(date)}</h3>
            <ol className="timeline">
              {entries.map((e) => (
                <li key={`${e.date}-${e.time ?? ''}-${e.title}`} className="timeline-item" data-kind={e.kind}>
                  <span className="timeline-dot" aria-hidden="true">
                    <Icon name={e.icon} size={16} />
                  </span>
                  <div className="timeline-card">
                    <div className="timeline-meta">
                      <span className="timeline-kind">{KIND_LABEL[e.kind]}</span>
                      {e.time && <time className="muted small">{e.time}</time>}
                    </div>
                    <h4>{e.title}</h4>
                    <p>{e.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}
