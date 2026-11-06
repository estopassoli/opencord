/**
 * Configurações do servidor → Slack (ADR-0033): liga um canal de texto a um canal do Slack; as mensagens passam
 * nos dois sentidos com o nome de quem escreveu. Sem app do Slack na instância, só explica como configurar.
 */
import type { ServerDetail, SlackChannel, SlackLink, SlackStatus } from '@opencord/contracts';
import { Button, Icon, Select } from '@opencord/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { askConfirm } from '../../components/AskDialog';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { Section } from '../settings/Section';

export function SlackTab({ detail }: { detail: ServerDetail }) {
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [channels, setChannels] = useState<SlackChannel[] | null>(null);
  const [list, setList] = useState<SlackLink[] | null>(null);
  const [channelId, setChannelId] = useState('');
  const [slackChannelId, setSlackChannelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const texts = detail.channels.filter((c) => c.kind === 'text');
  const channelName = (id: string) => detail.channels.find((c) => c.id === id)?.name ?? '?';

  useEffect(() => {
    void api()
      .request<SlackStatus>('GET', '/integrations/slack/status')
      .then(
        (s) => {
          setStatus(s);
          if (!s.configured) return;
          void api()
            .request<SlackChannel[]>('GET', '/integrations/slack/channels')
            .then(setChannels, (e: unknown) => setError(describeError(e)));
        },
        (e: unknown) => setError(describeError(e)),
      );
    void api()
      .request<SlackLink[]>('GET', `/servers/${detail.id}/slack-links`)
      .then(setList, (e: unknown) => setError(describeError(e)));
  }, [detail.id]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!channelId || !slackChannelId) return setError('Escolha os dois canais.');
    setBusy(true);
    setError(null);
    try {
      const l = await api().request<SlackLink>('POST', `/servers/${detail.id}/slack-links`, {
        channelId,
        slackChannelId,
      });
      setList((cur) => [...(cur ?? []), l]);
      setChannelId('');
      setSlackChannelId('');
      useUi.getState().toast('success', 'Canais ligados.');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (l: SlackLink) => {
    if (
      !(await askConfirm(`#${channelName(l.channelId)} e #${l.slackChannelName} param de se espelhar.`, {
        title: 'Desligar do Slack',
        confirmLabel: 'Desligar',
        danger: true,
      }))
    )
      return;
    void api()
      .request('DELETE', `/slack-links/${l.id}`)
      .then(
        () => setList((cur) => cur?.filter((x) => x.id !== l.id) ?? null),
        (err: unknown) => useUi.getState().toast('error', describeError(err)),
      );
  };

  if (status && !status.configured) {
    return (
      <Section title="Slack" description="Esta instância ainda não tem um app do Slack.">
        <p className="small">
          Quem administra o servidor da API configura <code>SLACK_BOT_TOKEN</code> e <code>SLACK_SIGNING_SECRET</code>;
          o passo a passo está em <code>docs/SLACK.md</code>.
        </p>
      </Section>
    );
  }

  return (
    <>
      <Section
        title="Ligar canais"
        description={
          status?.team
            ? `Workspace: ${status.team}. O que for escrito num canal aparece no outro, com o nome de quem escreveu.`
            : 'O que for escrito num canal aparece no outro, com o nome de quem escreveu.'
        }
      >
        <form className="form webhook-form" onSubmit={create}>
          <Select<string>
            label="Canal daqui"
            placeholder="Escolher canal"
            value={channelId}
            onChange={setChannelId}
            options={texts.map((c) => ({ value: c.id, label: `#${c.name}` }))}
          />
          <Select<string>
            label="Canal do Slack"
            placeholder={channels ? 'Escolher canal' : 'Carregando…'}
            value={slackChannelId}
            onChange={setSlackChannelId}
            options={(channels ?? []).map((c) => ({ value: c.id, label: `#${c.name}` }))}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={busy || !channelId || !slackChannelId}>
              Ligar
            </Button>
          </div>
        </form>
      </Section>
      <Section title={list ? `Canais ligados (${list.length})` : 'Canais ligados'}>
        {!list && !error && <p className="muted small">Carregando…</p>}
        {list?.length === 0 && <p className="muted small">Nenhum canal ligado ainda.</p>}
        <ul className="webhook-list">
          {list?.map((l) => (
            <li key={l.id} className="webhook-item">
              <Icon name="link" size={18} />
              <div className="webhook-main">
                <strong className="truncate">
                  #{channelName(l.channelId)} ↔ #{l.slackChannelName}
                </strong>
                <span className="muted small truncate">Slack</span>
              </div>
              <button
                className="icon-btn"
                aria-label={`Desligar #${channelName(l.channelId)} do Slack`}
                data-tip="Desligar"
                onClick={() => void remove(l)}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
