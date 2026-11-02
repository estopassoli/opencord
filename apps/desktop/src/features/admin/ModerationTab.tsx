import {
  hasPermission,
  Permission,
  type ModerationCase,
  type ServerDetail,
  type ServerSummary,
} from '@opencord/contracts';
import { Button, RadioGroup, TextArea } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { useData } from '../../store/data';
import { api, describeError, useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { Section } from '../settings/SettingsModal';
import { ModerationCasesList } from './ModerationCases';

type Filter = 'open' | 'all';

/**
 * Configurações do servidor › Moderação (ADR-0036): regras que a IA considera (quem gerencia o servidor) e a fila
 * de envios retidos (quem modera): aprovar publica, reprovar descarta e pode punir.
 */
export function ModerationTab({ detail }: { detail: ServerDetail }) {
  const aiOn = useData((s) => s.instance?.aiModeration ?? false);
  const canManage = hasPermission(detail.myPermissions, Permission.MANAGE_SERVER);
  const [rules, setRules] = useState(detail.aiRules ?? '');
  const [saving, setSaving] = useState(false);
  const [cases, setCases] = useState<ModerationCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const realtime = useSession((s) => s.realtime);

  useEffect(() => {
    let cancelled = false;
    api()
      .request<ModerationCase[]>('GET', `/servers/${detail.id}/moderation/cases?limit=100`)
      .then((list) => !cancelled && setCases(list))
      .catch((e: unknown) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [detail.id]);

  // casos novos e decisões de outros moderadores enquanto a aba está aberta
  useEffect(() => {
    if (!realtime) return;
    const upsert = (c: ModerationCase) => {
      if (c.serverId !== detail.id) return;
      setCases((cur) => (cur ? [c, ...cur.filter((x) => x.id !== c.id)] : cur));
    };
    const offA = realtime.on('moderation:case:created', upsert);
    const offB = realtime.on('moderation:case:resolved', upsert);
    return () => {
      offA();
      offB();
    };
  }, [realtime, detail.id]);

  const saveRules = async () => {
    setSaving(true);
    try {
      const s = await api().request<ServerSummary>('PATCH', `/servers/${detail.id}`, { aiRules: rules.trim() || null });
      useData.setState((st) => ({
        servers: st.servers.map((x) => (x.id === s.id ? s : x)),
        details: st.details[s.id] ? { ...st.details, [s.id]: { ...st.details[s.id]!, ...s } } : st.details,
      }));
      useUi.getState().toast('success', 'Regras salvas.');
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const shown = (cases ?? []).filter((c) => filter === 'all' || c.status === 'pending' || c.status === 'blocked');
  const onReviewed = (c: ModerationCase) => setCases((cur) => (cur ? cur.map((x) => (x.id === c.id ? c : x)) : cur));

  return (
    <>
      {!aiOn && (
        <p className="muted">
          A moderação por IA está desligada nesta instância. Quando ligada, toda mensagem e anexo passam por ela antes
          de aparecer.
        </p>
      )}
      {canManage && (
        <Section
          title="Regras do servidor para a IA"
          description="Além das regras gerais (nudez, ódio, ameaças, golpes…), a IA segue o que você escrever aqui. Ex.: sem spoiler de série, sem política, só português."
        >
          <TextArea
            label="Regras"
            rows={4}
            maxLength={2000}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            placeholder="Uma regra por linha."
          />
          <div className="form-actions">
            <Button disabled={saving || rules === (detail.aiRules ?? '')} onClick={() => void saveRules()}>
              Salvar regras
            </Button>
          </div>
        </Section>
      )}
      <Section
        title="Envios retidos"
        description="O que a IA bloqueou ou deixou em dúvida. Aprovar publica a mensagem como estava; reprovar descarta e pode castigar, expulsar ou banir."
      >
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
          <ModerationCasesList cases={shown} onReviewed={onReviewed} empty="Nada retido. Tudo em ordem." />
        )}
      </Section>
    </>
  );
}
