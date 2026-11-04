/**
 * Configurações → Minha conta → Segurança (ADR-0046): verificação em duas etapas (app autenticador + códigos de
 * recuperação) e aparelhos conectados, com "sair deste aparelho" e "sair de todos os outros".
 */
import {
  describeDevice,
  type Me,
  type SessionInfo,
  type TwoFactorRecoveryCodes,
  type TwoFactorSetupResponse,
} from '@opencord/contracts';
import { Button, Icon, TextField } from '@opencord/ui';
import { toDataURL } from 'qrcode';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { askConfirm } from '../../components/AskDialog';
import { Dialog } from '../../components/Dialog';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';

type SectionComp = (p: { title: string; description?: ReactNode; children: ReactNode }) => ReactNode;

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));
const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const setTwoFactor = (on: boolean) => useData.setState((s) => (s.me ? { me: { ...s.me, twoFactorEnabled: on } } : {}));

export function SecuritySection({ me, Section }: { me: Me; Section: SectionComp }) {
  return (
    <>
      <TwoFactor me={me} Section={Section} />
      <Devices Section={Section} />
    </>
  );
}

function TwoFactor({ me, Section }: { me: Me; Section: SectionComp }) {
  const [dialog, setDialog] = useState<'enable' | 'disable' | 'codes' | null>(null);
  return (
    <Section
      title="Verificação em duas etapas"
      description="Além da senha, o login pede um código do app autenticador do seu celular (Google Authenticator, Microsoft Authenticator, Authy, 2FAS…)."
    >
      {!me.hasAccount ? (
        <p className="muted small">Crie uma conta com senha acima para poder ligar.</p>
      ) : me.twoFactorEnabled ? (
        <div className="security-row">
          <span className="security-status" data-on="true">
            <Icon name="shield" size={18} /> Ligada
          </span>
          <span className="spacer" />
          <Button size="sm" variant="ghost" onClick={() => setDialog('codes')}>
            Novos códigos de recuperação
          </Button>
          <Button size="sm" variant="danger" onClick={() => setDialog('disable')}>
            Desligar
          </Button>
        </div>
      ) : (
        <div className="security-row">
          <span className="security-status">
            <Icon name="shield" size={18} /> Desligada
          </span>
          <span className="spacer" />
          <Button size="sm" onClick={() => setDialog('enable')}>
            Ligar
          </Button>
        </div>
      )}
      {dialog === 'enable' && <EnableDialog onClose={() => setDialog(null)} />}
      {(dialog === 'disable' || dialog === 'codes') && <ConfirmDialog mode={dialog} onClose={() => setDialog(null)} />}
    </Section>
  );
}

function EnableDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<TwoFactorSetupResponse | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api().request<TwoFactorSetupResponse>('POST', '/me/2fa/setup', { password });
      setSetup(r);
      setQr(await toDataURL(r.otpauthUrl, { margin: 1, width: 200, errorCorrectionLevel: 'M' }));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api().request<TwoFactorRecoveryCodes>('POST', '/me/2fa/enable', { code });
      setCodes(r.recoveryCodes);
      setTwoFactor(true);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  if (codes) return <RecoveryCodes codes={codes} onClose={onClose} />;

  return (
    <Dialog title="Ligar a verificação em duas etapas" onClose={onClose}>
      {!setup ? (
        <form className="form" onSubmit={(e) => void start(e)}>
          <p className="muted">Confirme a sua senha para começar.</p>
          <TextField
            label="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            autoComplete="current-password"
          />
          <div className="form-actions">
            <span className="spacer" />
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !password}>
              Continuar
            </Button>
          </div>
        </form>
      ) : (
        <form className="form" onSubmit={(e) => void confirm(e)}>
          <p>1. No app autenticador, adicione uma conta lendo este QR code:</p>
          <div className="security-qr">
            {qr && <img src={qr} alt="QR code para o app autenticador" width={200} height={200} />}
          </div>
          <p className="muted small">
            Sem câmera? Digite a chave: <code className="security-secret">{setup.secret}</code>
          </p>
          <p>2. Digite o código de 6 dígitos que aparece no app:</p>
          <TextField
            label="Código"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            minLength={6}
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
          />
          <div className="form-actions">
            <span className="spacer" />
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || code.trim().length !== 6}>
              Ligar
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** desligar ou gerar novos códigos: os dois pedem senha + código */
function ConfirmDialog({ mode, onClose }: { mode: 'disable' | 'codes'; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'disable') {
        await api().request('POST', '/me/2fa/disable', { password, code });
        setTwoFactor(false);
        useUi.getState().toast('success', 'Verificação em duas etapas desligada.');
        onClose();
      } else {
        const r = await api().request<TwoFactorRecoveryCodes>('POST', '/me/2fa/recovery-codes', { password, code });
        setCodes(r.recoveryCodes);
      }
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  if (codes) return <RecoveryCodes codes={codes} onClose={onClose} />;
  return (
    <Dialog
      title={mode === 'disable' ? 'Desligar a verificação em duas etapas' : 'Novos códigos de recuperação'}
      onClose={onClose}
    >
      <form className="form" onSubmit={(e) => void submit(e)}>
        {mode === 'codes' && <p className="muted">Os códigos antigos deixam de valer.</p>}
        <TextField
          label="Senha"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
          autoComplete="current-password"
        />
        <TextField
          label="Código do app ou de recuperação"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          minLength={6}
          maxLength={16}
          autoComplete="one-time-code"
        />
        <div className="form-actions">
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant={mode === 'disable' ? 'danger' : 'primary'}
            disabled={busy || !password || code.trim().length < 6}
          >
            {mode === 'disable' ? 'Desligar' : 'Gerar códigos'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RecoveryCodes({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const text = `Códigos de recuperação do OpenCord (cada um vale uma vez):\n\n${codes.join('\n')}\n`;
  const download = () => {
    const href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = href;
    a.download = 'opencord-codigos-de-recuperacao.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };
  return (
    <Dialog title="Guarde os códigos de recuperação" onClose={onClose}>
      <div className="form">
        <p>
          Se perder o celular, cada código abaixo entra no lugar do código do app <strong>uma vez</strong>. Eles não
          aparecem de novo: baixe ou copie agora e guarde num lugar seguro.
        </p>
        <ul className="security-codes">
          {codes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <div className="form-actions">
          <Button variant="ghost" icon="copy" onClick={() => void navigator.clipboard.writeText(text)}>
            Copiar
          </Button>
          <Button variant="ghost" icon="download" onClick={download}>
            Baixar
          </Button>
          <span className="spacer" />
          <Button onClick={onClose}>Já guardei</Button>
        </div>
      </div>
    </Dialog>
  );
}

function Devices({ Section }: { Section: SectionComp }) {
  const [list, setList] = useState<SessionInfo[] | null>(null);
  const load = useCallback(() => api().request<SessionInfo[]>('GET', '/me/sessions').then(setList, toastError), []);
  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (s: SessionInfo) => {
    if (
      !(await askConfirm(`${describeDevice(s.userAgent)} sai da sua conta.`, {
        title: 'Sair deste aparelho',
        confirmLabel: 'Sair',
        danger: true,
      }))
    )
      return;
    try {
      await api().request('DELETE', `/me/sessions/${s.id}`);
      await load();
    } catch (e) {
      toastError(e);
    }
  };

  const revokeOthers = async () => {
    if (
      !(await askConfirm('Todos os outros aparelhos saem da sua conta; este continua conectado.', {
        title: 'Sair de todos os outros aparelhos',
        confirmLabel: 'Sair dos outros',
        danger: true,
      }))
    )
      return;
    try {
      const r = await api().request<{ revoked: number }>('POST', '/me/sessions/revoke-others');
      useUi
        .getState()
        .toast('success', r.revoked ? `${r.revoked} aparelho(s) desconectado(s).` : 'Nenhum outro aparelho.');
      await load();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Section
      title="Aparelhos conectados"
      description="Onde a sua conta está logada agora. Não reconhece algum? Tire o aparelho e troque a senha."
    >
      {!list ? (
        <p className="muted">Carregando…</p>
      ) : (
        <>
          <ul className="security-devices">
            {list.map((s) => (
              <li key={s.id}>
                <Icon name={/android|iphone|ipad/i.test(s.userAgent ?? '') ? 'smartphone' : 'window'} size={22} />
                <span className="security-device-names">
                  <strong className="truncate">
                    {describeDevice(s.userAgent)}
                    {s.current && (
                      <span className="admin-pill" data-tone="brand">
                        este aparelho
                      </span>
                    )}
                  </strong>
                  <span className="muted small truncate">
                    {s.ip ? `IP ${s.ip} · ` : ''}desde {fmt(s.createdAt)} · ativo em {fmt(s.lastActiveAt)}
                  </span>
                </span>
                {!s.current && (
                  <Button size="sm" variant="ghost" onClick={() => void revoke(s)}>
                    Sair
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {list.length > 1 && (
            <Button size="sm" variant="danger" onClick={() => void revokeOthers()}>
              Sair de todos os outros aparelhos
            </Button>
          )}
        </>
      )}
    </Section>
  );
}
