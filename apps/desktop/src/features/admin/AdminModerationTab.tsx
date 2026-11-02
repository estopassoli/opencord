import type { AdminInstanceConfig, ModerationCase } from '@opencord/contracts';
import { RadioGroup, Switch } from '@opencord/ui';
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
              label="Também em mensagens diretas"
              description="Desligado: só canais de servidor passam pela IA. As DMs retidas só o super admin revisa."
              checked={cfg.aiModerationDms}
              disabled={busy || !cfg.aiModerationEnabled}
              onChange={(v) => void save({ aiModerationDms: v }, v ? 'DMs incluídas.' : 'DMs fora da moderação.')}
            />
          </>
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
