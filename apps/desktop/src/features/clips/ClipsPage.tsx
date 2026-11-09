/**
 * Página de clipes: todos os clipes salvos neste computador, agrupados por jogo, com uma barra à esquerda para filtrar
 * por jogo, e os clipes salvos na conta (ADR-0057), que aparecem em qualquer aparelho. Clicar num clipe abre o
 * visualizador (que fica por cima da página).
 */
import type { AccountClip } from '@opencord/contracts';
import { Button, Icon } from '@opencord/ui';
import { useEffect, useMemo, useState } from 'react';
import { bridge } from '../../lib/bridge';
import { useClips } from '../../store/clips';
import { useUi } from '../../store/ui';
import { asLocal, cloudOf, useAccountClips } from './account';
import { clipTitle } from './ClipViewer';
import { groupClips } from './groups';

const PAGE = 6;
/** filtro da barra: os clipes da conta */
const ACCOUNT = '\u0000conta';
const gb = (n: number) => `${(n / 1024 ** 3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;

const ago = (t: number) => {
  const d = Math.max(0, Date.now() - t);
  const min = Math.round(d / 60_000);
  if (min < 60) return min <= 1 ? 'agora' : `${min} min atrás`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h atrás`;
  const days = Math.round(h / 24);
  return days === 1 ? 'ontem' : `${days} d atrás`;
};
const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function ClipsPage({ onClose }: { onClose: () => void }) {
  const library = useClips((s) => s.library);
  const viewing = useClips((s) => s.viewing);
  const [filter, setFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const account = useAccountClips();
  useEffect(() => {
    void useClips.getState().loadLibrary();
    void useAccountClips.getState().load();
  }, []);
  // Esc fecha a página (com um clipe aberto, o Esc é do visualizador)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useClips.getState().viewing) onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const groups = useMemo(() => groupClips(library), [library]);
  const cloudOnly = filter === ACCOUNT;
  const shown = cloudOnly
    ? groupClips(account.clips.map(asLocal))
    : filter
      ? groups.filter((g) => g.key === filter)
      : groups;
  // no navegador não há clipes do computador: a página mostra os da conta
  const showAccount = cloudOnly || !bridge;

  return (
    <div className="clips-page-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="clips-page" role="dialog" aria-modal={viewing ? undefined : 'true'} aria-label="Clipes">
        <nav className="clips-rail" aria-label="Filtrar clipes por jogo">
          <button
            type="button"
            className="clips-rail-item"
            aria-pressed={filter === null}
            aria-label="Todos os clipes"
            data-tip="Todos os clipes"
            onClick={() => setFilter(null)}
          >
            <Icon name="home" size={20} />
          </button>
          {account.loaded && (
            <button
              type="button"
              className="clips-rail-item"
              aria-pressed={showAccount}
              aria-label="Clipes salvos na conta"
              data-tip={`Na conta · ${account.clips.length}`}
              onClick={() => setFilter(ACCOUNT)}
            >
              <Icon name="cloud" size={20} />
            </button>
          )}
          <span className="clips-rail-sep" aria-hidden />
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              className="clips-rail-item"
              aria-pressed={filter === g.key}
              aria-label={g.game ?? 'Sem jogo'}
              data-tip={`${g.game ?? 'Sem jogo'} · ${g.clips.length}`}
              onClick={() => setFilter(g.key)}
            >
              {g.icon ? <img src={g.icon} alt="" draggable={false} /> : <Icon name="film" size={18} />}
            </button>
          ))}
          <span className="spacer" />
          <button
            type="button"
            className="clips-rail-item"
            aria-label="Configurações de clipes"
            data-tip="Configurações de clipes"
            onClick={() => {
              onClose();
              useUi.getState().openModal({ kind: 'settings', tab: 'games' });
            }}
          >
            <Icon name="settings" size={18} />
          </button>
        </nav>

        <div className="clips-main">
          <header className="clips-head">
            <h2>Clipes</h2>
            <span className="spacer" />
            {bridge && library[0] && (
              <Button
                size="sm"
                variant="ghost"
                icon="folder"
                onClick={() => void bridge?.clips.reveal(library[0]!.file)}
              >
                Abrir a pasta
              </Button>
            )}
            <button type="button" className="icon-btn" aria-label="Fechar" data-tip="Fechar (Esc)" onClick={onClose}>
              <Icon name="close" />
            </button>
          </header>

          <div className="clips-scroll">
            {showAccount ? (
              <>
                <h3 className="clips-title">Na conta</h3>
                <p className="muted small clips-account-note">
                  {account.clips.length
                    ? `${account.clips.length} de ${account.maxClips} clipes · ${gb(account.usedBytes)} de ${gb(account.maxBytes)}. Eles aparecem em qualquer aparelho em que você entrar; os marcados com estrela ficam no seu perfil.`
                    : bridge
                      ? 'Nenhum clipe na conta ainda. Abra um clipe e escolha "Salvar na conta" para vê-lo em qualquer aparelho e poder destacá-lo no perfil.'
                      : 'Nenhum clipe na conta ainda. No app para computador, abra um clipe e escolha "Salvar na conta".'}
                </p>
              </>
            ) : null}
            {!showAccount && library.length === 0 ? (
              <div className="clips-empty">
                <Icon name="film" size={32} />
                <p>Nenhum clipe ainda.</p>
                <p className="muted small">
                  Com um jogo aberto, aperte o atalho de salvar clipe (Configurações → Atalhos) e os últimos segundos
                  aparecem aqui.
                </p>
              </div>
            ) : !shown.length ? null : (
              <>
                {!showAccount && (
                  <h3 className="clips-title">{filter ? (shown[0]?.game ?? 'Sem jogo') : 'Clipes recentes'}</h3>
                )}
                {shown.map((g) => {
                  const open = expanded[g.key] || filter !== null || !bridge;
                  const list = open ? g.clips : g.clips.slice(0, PAGE);
                  return (
                    <section key={g.key} className="clips-group" aria-label={g.game ?? 'Sem jogo'}>
                      <header className="clips-group-head">
                        <span className="clips-group-icon">
                          {g.icon ? <img src={g.icon} alt="" draggable={false} /> : <Icon name="film" size={18} />}
                        </span>
                        <span className="clips-group-names">
                          <strong className="truncate">{g.game ?? 'Sem jogo'}</strong>
                          <span className="muted small">
                            {g.clips.length} {g.clips.length === 1 ? 'clipe' : 'clipes'} · último{' '}
                            {ago(g.clips[0]!.createdAt)}
                          </span>
                        </span>
                      </header>
                      <ul className="clips-grid">
                        {list.map((c) => (
                          <li key={c.file}>
                            <button
                              type="button"
                              className="clips-card"
                              aria-label={`Abrir ${clipTitle(c)}`}
                              onClick={() => useClips.getState().open(c)}
                            >
                              {c.thumb ? (
                                <img src={c.thumb} alt="" draggable={false} />
                              ) : (
                                <span className="clips-card-empty">
                                  <Icon name="film" size={28} />
                                </span>
                              )}
                              <CloudMark
                                clip={cloudOf(account.clips, c)}
                                uploading={account.uploading[Math.round(c.createdAt)]}
                              />
                              <span className="clips-card-info">
                                <span className="clips-card-title truncate">
                                  <Icon name="record" size={14} /> {clipTitle(c)}
                                </span>
                                <span className="clips-card-meta">
                                  <span>{ago(c.createdAt)}</span>
                                  <span>{dur(c.durationMs)}</span>
                                </span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {!open && g.clips.length > PAGE && (
                        <div className="clips-more">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setExpanded((x) => ({ ...x, [g.key]: true }))}
                          >
                            Ver mais ({g.clips.length - PAGE})
                          </Button>
                        </div>
                      )}
                    </section>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** selo no cartão: na conta (com estrela se está no perfil) ou enviando */
function CloudMark({ clip, uploading }: { clip: AccountClip | undefined; uploading: number | undefined }) {
  if (uploading !== undefined)
    return (
      <span className="clips-card-cloud" aria-label="Enviando para a conta">
        <Icon name="cloud-upload" size={14} /> {Math.round(uploading * 100)}%
      </span>
    );
  if (!clip) return null;
  return (
    <span className="clips-card-cloud" aria-label={clip.featured ? 'Na conta e no perfil' : 'Na conta'}>
      <Icon name="cloud" size={14} />
      {clip.featured && <Icon name="star" size={14} />}
    </span>
  );
}
