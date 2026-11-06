/**
 * Configurações do servidor › Convites (ADR-0050): pausar a entrada por convite, criar convite com validade e limite de
 * usos, e a lista dos convites (quem criou, usos, quando vence) com apagar.
 */
import {
  INVITE_MAX_AGES,
  INVITE_MAX_USES,
  type Invite,
  type ServerDetail,
  type ServerInvite,
} from '@opencord/contracts';
import { Avatar, Button, Icon, Select, Switch } from '@opencord/ui';
import { useCallback, useEffect, useState } from 'react';
import { askConfirm } from '../../components/AskDialog';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { Section } from '../settings/Section';
import { applyServer } from './ServerProfile';

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

const AGE_LABEL: Record<number, string> = {
  1800: '30 minutos',
  3600: '1 hora',
  21600: '6 horas',
  43200: '12 horas',
  86400: '1 dia',
  604800: '7 dias',
};

/** "vence em 3 h", "vencido", "nunca" */
function expiryLabel(iso: string | null): string {
  if (!iso) return 'Nunca';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Vencido';
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `Em ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `Em ${h} h`;
  return `Em ${Math.round(h / 24)} dias`;
}

const spent = (i: ServerInvite) =>
  (i.expiresAt !== null && new Date(i.expiresAt).getTime() <= Date.now()) ||
  (i.maxUses !== null && i.uses >= i.maxUses);

export function InvitesTab({ detail }: { detail: ServerDetail }) {
  const [invites, setInvites] = useState<ServerInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [age, setAge] = useState('0');
  const [uses, setUses] = useState('0');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Invite | null>(null);

  const load = useCallback(
    () =>
      api()
        .request<ServerInvite[]>('GET', `/servers/${detail.id}/invites`)
        .then(setInvites, (e: unknown) => setError(describeError(e))),
    [detail.id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const togglePause = async (paused: boolean) => {
    try {
      applyServer(await api().request('PATCH', `/servers/${detail.id}`, { invitesPaused: paused }));
    } catch (e) {
      toastError(e);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const maxAgeSec = Number(age) || null;
      const maxUses = Number(uses) || null;
      const inv = await api().request<Invite>('POST', `/servers/${detail.id}/invites`, { maxAgeSec, maxUses });
      setCreated(inv);
      await load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const copy = (i: Invite) => {
    void navigator.clipboard.writeText(i.url ?? i.code);
    useUi.getState().toast('success', 'Convite copiado.');
  };

  const remove = async (i: ServerInvite) => {
    if (
      !(await askConfirm(`O convite ${i.code} para de funcionar na hora. Quem já entrou continua no servidor.`, {
        title: 'Apagar convite',
        confirmLabel: 'Apagar',
        danger: true,
      }))
    )
      return;
    try {
      await api().request('DELETE', `/invites/${i.code}`);
      setInvites((list) => list?.filter((x) => x.code !== i.code) ?? list);
      if (created?.code === i.code) setCreated(null);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <>
      <Section title="Entrada por convite">
        <Switch
          label="Pausar convites"
          description="Enquanto estiver ligado, nenhum convite funciona. Quem já é membro não é afetado."
          checked={!!detail.invitesPaused}
          onChange={(v) => void togglePause(v)}
        />
      </Section>

      <Section title="Criar convite" description="Escolha por quanto tempo o link vale e quantas pessoas podem usar.">
        <div className="afk-row">
          <Select<string>
            label="Vence depois de"
            value={age}
            onChange={setAge}
            options={[
              { value: '0', label: 'Nunca' },
              ...INVITE_MAX_AGES.map((s) => ({ value: String(s), label: AGE_LABEL[s] ?? `${s} s` })),
            ]}
          />
          <Select<string>
            label="Número máximo de usos"
            value={uses}
            onChange={setUses}
            options={[
              { value: '0', label: 'Sem limite' },
              ...INVITE_MAX_USES.map((n) => ({ value: String(n), label: n === 1 ? '1 uso' : `${n} usos` })),
            ]}
          />
        </div>
        <div className="form-actions">
          <Button size="sm" icon="link" disabled={busy} onClick={() => void create()}>
            Criar convite
          </Button>
          {created && (
            <Button size="sm" variant="secondary" icon="copy" onClick={() => copy(created)}>
              Copiar {created.code}
            </Button>
          )}
        </div>
      </Section>

      <Section title="Convites do servidor">
        {error ? (
          <p className="form-error">{error}</p>
        ) : !invites ? (
          <p className="muted">Carregando…</p>
        ) : invites.length === 0 ? (
          <p className="muted">Nenhum convite criado ainda.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Criado por</th>
                  <th scope="col">Código</th>
                  <th scope="col">Usos</th>
                  <th scope="col">Vence</th>
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.code} data-spent={spent(i) ? 'true' : undefined}>
                    <td>
                      <span className="admin-cell-user">
                        {i.creator ? (
                          <>
                            <Avatar id={i.creator.id} name={i.creator.displayName} size={24} />
                            <span className="truncate">{i.creator.displayName}</span>
                          </>
                        ) : (
                          <span className="muted">Conta removida</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <code>{i.code}</code>
                    </td>
                    <td className="nowrap">{i.maxUses ? `${i.uses} / ${i.maxUses}` : i.uses}</td>
                    <td className="nowrap">{expiryLabel(i.expiresAt)}</td>
                    <td className="cell-actions">
                      {!spent(i) && (
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Copiar o convite ${i.code}`}
                          data-tip="Copiar"
                          onClick={() => copy(i)}
                        >
                          <Icon name="copy" size={16} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-btn danger"
                        aria-label={`Apagar o convite ${i.code}`}
                        data-tip="Apagar"
                        onClick={() => void remove(i)}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
