import type { AdminInstanceConfig, DeviceBan, ModerationCase } from '@opencord/contracts';
import { Avatar, Button, RadioGroup, Switch } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { api, describeError, useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { Section } from '../settings/SettingsModal';
import { ModerationCasesList } from './ModerationCases';

type Filter = 'open' | 'all';

/** Painel admin › Moderação IA (ADR-0036): liga/desliga na instância, DMs, modelo em uso e a fila de todos os servidores. */
export function AdminModerationTab() {
  const [cfg, setCfg] = useState<AdminInstanceConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [cases, setCases] = useState<ModerationCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [bans, setBans] = useState<DeviceBan[] | null>(null);
  const realtime = useSession((s) => s.realtime);

  useEffect(() => {
    let cancelled = false;
    void api()
      .request<AdminInstanceConfig>('GET', '/admin/instance')
      .then((c) => !cancelled && setCfg(c))
      .catch((e: unknown) => !cancelled && setError(describeError(e)));
    void api()
      .request<ModerationCase[]>('GET', '/admin/moderation/cases?limit=100')
      .then((list) => !cancelled && setCases(list))
      .catch((e: unknown) => !cancelled && setError(describeError(e)));
    void api()
      .request<DeviceBan[]>('GET', '/admin/device-bans')
      .then((list) => !cancelled && setBans(list))
      .catch(() => !cancelled && setBans([]));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!realtime) return;
    const upsert = (c: ModerationCase) => setCases((cur) => (cur ? [c, ...cur.filter((x) => x.id !== c.id)] : cur));
    const offA = realtime.on('moderation:case:created', upsert);
    const offB = realtime.on('moderation:case:resolved', upsert);
    return () => {
      offA();
      offB();
    };
  }, [realtime]);

  const save = async (patch: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      setCfg(await api().request<AdminInstanceConfig>('PATCH', '/admin/instance', patch));
      useUi.getState().toast('success', ok);
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = (cases ?? []).filter((c) => filter === 'all' || c.status === 'pending' || c.status === 'blocked');
  const onReviewed = (c: ModerationCase) => setCases((cur) => (cur ? cur.map((x) => (x.id === c.id ? c : x)) : cur));

  return (
    <>
      <Section
        title="Moderação por IA"
        description="Toda mensagem e anexo passam pelo Claude antes de aparecer. Em dúvida, a IA retém e os moderadores do servidor decidem."
      >
        {!cfg ? (
          <p className="muted">Carregando…</p>
        ) : !cfg.aiModerationAvailable ? (
          <p className="muted">
            Sem chave da Anthropic no servidor (ANTHROPIC_API_KEY). Defina a variável e reinicie a API para ligar.
          </p>
        ) : (
          <>
            <Switch
              label="Ligada"
              description={`Modelo em uso: ${cfg.aiModerationModel ?? '—'}.`}
              checked={cfg.aiModerationEnabled}
              disabled={busy}
              onChange={(v) => void save({ aiModeration: v }, v ? 'Moderação ligada.' : 'Moderação desligada.')}
            />
            <Switch
              label="Bloquear automaticamente quem envia conteúdo grave"
              description="Pornografia, conteúdo sexual com menores ou violência gráfica com certeza alta: a conta é suspensa na hora, banida do servidor e derrubada. O caso continua na fila para um moderador rever; reativar a conta fica em Usuários."
              checked={cfg.aiAutoBlock}
              disabled={busy || !cfg.aiModerationEnabled}
              onChange={(v) =>
                void save({ aiAutoBlock: v }, v ? 'Bloqueio automático ligado.' : 'Bloqueio automático desligado.')
              }
            />
            <Switch
              label="Também bloquear o dispositivo"
              description="Impede novas entradas do mesmo aparelho: no app desktop pela impressão digital das placas de rede (hash dos MACs); no navegador pelo identificador do app e pelo IP. Reativar a conta libera o aparelho."
              checked={cfg.aiAutoBlockDevice}
              disabled={busy || !cfg.aiModerationEnabled || !cfg.aiAutoBlock}
              onChange={(v) =>
                void save({ aiAutoBlockDevice: v }, v ? 'Dispositivo entra no bloqueio.' : 'Só a conta é bloqueada.')
              }
            />
            <Switch
              label="Também em mensagens diretas"
              description="Desligado: só canais de servidor passam pela IA. As DMs retidas só o super admin revisa."
              checked={cfg.aiModerationDms}
              disabled={busy || !cfg.aiModerationEnabled}
              onChange={(v) => void save({ aiModerationDms: v }, v ? 'DMs incluídas.' : 'DMs fora da moderação.')}
            />
          </>
        )}
      </Section>
      <Section
        title="Dispositivos bloqueados"
        description="Aparelhos e IPs recusados em qualquer entrada. Reativar a conta da pessoa (Usuários) também remove os dela."
      >
        {!bans ? (
          <p className="muted">Carregando…</p>
        ) : bans.length === 0 ? (
          <p className="muted">Nenhum dispositivo bloqueado.</p>
        ) : (
          <ul className="admin-list" aria-label="Dispositivos bloqueados">
            {bans.map((b) => (
              <li key={b.id} className="admin-row">
                <div className="admin-row-main">
                  {b.user ? <Avatar id={b.user.id} name={b.user.displayName} size={28} /> : null}
                  <div className="admin-row-text">
                    <span className="truncate">
                      {b.kind === 'hardware'
                        ? 'Aparelho (hash dos MACs)'
                        : b.kind === 'device'
                          ? 'Identificador do app'
                          : 'IP'}{' '}
                      <code>{b.value}</code>
                    </span>
                    <span className="muted small truncate">
                      {b.user ? `de ${b.user.displayName} · ` : ''}
                      {b.reason ?? ''}
                    </span>
                  </div>
                  <div className="admin-row-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void api()
                          .request('DELETE', `/admin/device-bans/${b.id}`)
                          .then(() => setBans((cur) => (cur ? cur.filter((x) => x.id !== b.id) : cur)))
                          .catch((e: unknown) => useUi.getState().toast('error', describeError(e)))
                      }
                    >
                      Desbloquear
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Envios retidos em toda a instância">
        <RadioGroup<Filter>
          label="Mostrar"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Pendentes e bloqueados' },
            { value: 'all', label: 'Todos' },
          ]}
        />
        {error ? (
          <p className="form-error">{error}</p>
        ) : !cases ? (
          <p className="muted">Carregando…</p>
        ) : (
          <ModerationCasesList cases={shown} showServer onReviewed={onReviewed} empty="Nada retido." />
        )}
      </Section>
    </>
  );
}
