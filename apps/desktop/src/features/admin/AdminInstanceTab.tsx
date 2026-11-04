import { ANNOUNCEMENT_TONES, type AdminInstanceConfig, type InstanceAnnouncement } from '@opencord/contracts';
import { Button, Icon, RadioGroup, Select, Switch, TextArea, TextField } from '@opencord/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../store/session';
import { useUi } from '../../store/ui';
import { Card, Facts, Loading, MB, Pill, fmtDateTime, toastError } from './adminKit';

const TONE_LABEL: Record<InstanceAnnouncement['tone'], string> = {
  info: 'Informação',
  warning: 'Atenção',
  success: 'Novidade boa',
};

/** Instância: cadastro, aviso em faixa, limite de upload e contato de privacidade, em cartões. */
export function AdminInstanceTab() {
  const [cfg, setCfg] = useState<AdminInstanceConfig | null>(null);
  const [text, setText] = useState('');
  const [tone, setTone] = useState<InstanceAnnouncement['tone']>('info');
  const [uploadMb, setUploadMb] = useState<number | null>(null);
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (c: AdminInstanceConfig) => {
    setCfg(c);
    setContact(c.privacyContact ?? '');
    setText(c.announcement?.text ?? '');
    setTone(c.announcement?.tone ?? 'info');
    setUploadMb(c.uploadOverrideBytes ? Math.round(c.uploadOverrideBytes / MB) : null);
  };
  useEffect(() => {
    void api().request<AdminInstanceConfig>('GET', '/admin/instance').then(apply, toastError);
  }, []);

  const save = async (patch: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      apply(await api().request<AdminInstanceConfig>('PATCH', '/admin/instance', patch));
      useUi.getState().toast('success', ok);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return <Loading rows={4} />;
  const envMb = Math.floor(cfg.uploadEnvMaxBytes / MB);
  const uploadOptions = [
    { value: '0', label: `Padrão do servidor (${envMb} MB)` },
    ...[5, 10, 25, 50, 100, 250, 500].filter((n) => n < envMb).map((n) => ({ value: String(n), label: `${n} MB` })),
  ];

  const publish = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    void save({ announcement: { text: text.trim(), tone } }, 'Aviso publicado para todos.');
  };

  return (
    <div className="adm-stack">
      <div className="adm-grid">
        <Card className="adm-span-4" title="Resumo">
          <Facts
            items={[
              {
                label: 'Cadastros',
                value: cfg.registrationOpen ? 'Abertos' : 'Fechados',
                tone: cfg.registrationOpen ? 'success' : 'warning',
              },
              {
                label: 'Aviso para todos',
                value: cfg.announcement ? 'No ar' : 'Nenhum',
                tone: cfg.announcement ? 'brand' : undefined,
              },
              { label: 'Limite de upload', value: `${uploadMb ?? envMb} MB` },
              { label: 'Contato de privacidade', value: cfg.privacyContact ? 'Definido' : 'Só o GitHub' },
              { label: 'Última alteração', value: cfg.updatedAt ? fmtDateTime(cfg.updatedAt) : '—' },
            ]}
          />
        </Card>

        <Card
          className="adm-span-8"
          title="Cadastro"
          sub="Quem já tem conta continua entrando mesmo com os cadastros fechados."
          actions={
            <Pill tone={cfg.registrationOpen ? 'success' : 'warning'}>
              {cfg.registrationOpen ? 'aberto' : 'fechado'}
            </Pill>
          }
        >
          <Switch
            label="Novos cadastros abertos"
            description="Desligado: ninguém novo entra (nem com conta, nem só com apelido)."
            checked={cfg.registrationOpen}
            disabled={busy}
            onChange={(v) => void save({ registrationOpen: v }, v ? 'Cadastros abertos.' : 'Cadastros fechados.')}
          />
        </Card>

        <Card
          className="adm-span-8"
          title="Aviso para todos"
          sub="Aparece numa faixa no topo do app de todo mundo, na hora. Cada pessoa pode dispensar."
          actions={cfg.announcement ? <Pill tone="brand">no ar</Pill> : undefined}
        >
          <form className="form" onSubmit={publish}>
            <TextArea
              label="Texto"
              rows={3}
              maxLength={280}
              placeholder="Ex.: Manutenção hoje às 23h, a voz pode cair por alguns minutos."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <RadioGroup<InstanceAnnouncement['tone']>
              label="Tipo"
              value={tone}
              onChange={setTone}
              options={ANNOUNCEMENT_TONES.map((t) => ({ value: t, label: TONE_LABEL[t] }))}
            />
            {text.trim() && (
              <div className="instance-banner instance-banner-preview" data-tone={tone} aria-label="Prévia do aviso">
                <Icon name={tone === 'warning' ? 'warning' : tone === 'success' ? 'check' : 'bell'} size={16} />
                <span>{text.trim()}</span>
              </div>
            )}
            <div className="form-actions">
              {cfg.announcement && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void save({ announcement: null }, 'Aviso removido.')}
                >
                  Remover aviso
                </Button>
              )}
              <Button type="submit" disabled={busy || !text.trim()}>
                {cfg.announcement ? 'Atualizar aviso' : 'Publicar aviso'}
              </Button>
            </div>
          </form>
        </Card>

        <div className="adm-span-4 adm-stack">
          <Card
            title="Limite de upload"
            sub={`Tamanho máximo de cada anexo. O servidor permite até ${envMb} MB; aqui dá para reduzir.`}
          >
            <Select<string>
              aria-label="Limite de upload"
              value={String(uploadMb ?? 0)}
              onChange={(raw) => {
                const v = Number(raw);
                void save({ uploadMaxBytes: v ? v * MB : null }, v ? `Limite de upload: ${v} MB.` : 'Limite padrão.');
              }}
              options={uploadOptions}
            />
          </Card>
          <Card
            title="Contato para privacidade"
            sub="Aparece nos Termos e na Política de privacidade para pedidos sobre dados pessoais (LGPD). Vazio: só o canal do projeto no GitHub."
          >
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                void save({ privacyContact: contact.trim() || null }, 'Contato salvo.');
              }}
            >
              <TextField
                aria-label="Contato"
                placeholder="privacidade@exemplo.com"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                maxLength={254}
              />
              <div className="form-actions">
                <Button type="submit" size="sm" disabled={busy || contact.trim() === (cfg.privacyContact ?? '')}>
                  Salvar
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
