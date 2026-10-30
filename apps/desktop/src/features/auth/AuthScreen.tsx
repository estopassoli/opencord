import type { InstanceInfo } from '@opencord/contracts';
import { Button, Icon, TextField } from '@opencord/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiClient, normalizeServerUrl } from '../../lib/api';
import { isDesktop, secrets } from '../../lib/bridge';
import { DEFAULT_SERVER_URL } from '../../lib/config';
import { pendingInvite } from '../../lib/invite';
import { describeError, useSession } from '../../store/session';

type Mode = 'nickname' | 'login' | 'register';

const WHERE = isDesktop ? 'neste computador' : 'neste navegador';

const TITLES: Record<Mode, [string, string]> = {
  nickname: ['Entrar só com apelido', `Sem senha: seus dados ficam salvos só ${WHERE}.`],
  login: ['', 'Use seu apelido (ou e-mail) e senha.'],
  register: ['Criar conta', 'Com conta você entra de qualquer computador com o mesmo apelido.'],
};

/**
 * Entrada (ADR-0007): pede apelido/e-mail e senha; sem endereço do servidor (vem do build ou do último usado).
 * Conta continua opcional: o link "Utilizar apenas apelido" entra sem senha, com os dados só neste dispositivo.
 */
export function AuthScreen() {
  // quem chega por um link de convite provavelmente não tem conta: começa pelo "só apelido"
  const [mode, setMode] = useState<Mode>(() => (pendingInvite() ? 'nickname' : 'login'));
  const [serverUrl, setServerUrl] = useState('');
  const [nickname, setNickname] = useState('');
  const [login, setLogin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [instance, setInstance] = useState<InstanceInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void secrets.get('serverUrl').then((u) => setServerUrl(u || DEFAULT_SERVER_URL));
  }, []);

  // descobre nome da instância e se exige código de acesso
  useEffect(() => {
    if (!serverUrl) return;
    let cancelled = false;
    let url: string;
    try {
      url = normalizeServerUrl(serverUrl);
    } catch {
      return;
    }
    new ApiClient(url).instance().then(
      (i) => !cancelled && setInstance(i),
      () => !cancelled && setInstance(null),
    );
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  // cadastros fechados pelo super admin (ADR-0020): só entrar com a conta que já existe
  const closed = instance !== null && instance.registrationOpen === false;
  const guestDisabled = closed || (instance !== null && !instance.guestJoin);
  const effective: Mode = closed ? 'login' : guestDisabled && mode === 'nickname' ? 'login' : mode;
  const needsCode = Boolean(instance?.requiresAccessCode) && effective !== 'login';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = useSession.getState();
      const code = accessCode || undefined;
      if (effective === 'nickname') await s.join(serverUrl, nickname, code);
      else if (effective === 'login') await s.login(serverUrl, login, password);
      else await s.register(serverUrl, { nickname, password, email: email.trim() || undefined, accessCode: code });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setPassword('');
  };

  const [title, subtitle] = TITLES[effective];

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit} aria-describedby={error ? 'auth-error' : undefined}>
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden />
          <h1>{title || `Entrar no ${instance?.name ?? 'OpenCord'}`}</h1>
          {pendingInvite() && <p className="auth-invite">Você recebeu um convite. Entre para aceitar.</p>}
          <p className="muted">{subtitle}</p>
        </div>

        {effective === 'login' ? (
          <TextField
            label="Apelido ou e-mail"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
            minLength={2}
            maxLength={254}
            autoFocus
            autoComplete="username"
          />
        ) : (
          <TextField
            label="Apelido"
            hint={effective === 'nickname' ? `Fica salvo ${WHERE}.` : undefined}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            required
            minLength={2}
            maxLength={32}
            autoFocus
            autoComplete="nickname"
          />
        )}

        {effective !== 'nickname' && (
          <TextField
            label="Senha"
            hint={effective === 'register' ? 'Mínimo de 10 caracteres.' : undefined}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={effective === 'register' ? 10 : 1}
            autoComplete={effective === 'register' ? 'new-password' : 'current-password'}
          />
        )}

        {effective === 'register' && (
          <TextField
            label="E-mail (opcional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            autoComplete="email"
          />
        )}

        {needsCode && (
          <TextField
            label="Código de acesso"
            hint="Peça o código a quem administra o servidor."
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
            required
            maxLength={128}
            type="password"
            autoComplete="off"
          />
        )}

        {error && (
          <p id="auth-error" className="form-error" role="alert">
            <Icon name="warning" size={16} /> {error}
          </p>
        )}

        <Button type="submit" size="lg" block disabled={busy}>
          {busy ? 'Aguarde…' : effective === 'register' ? 'Criar conta e entrar' : 'Entrar'}
        </Button>

        <p className="auth-switch auth-links">
          {effective !== 'login' && (
            <button type="button" className="link-btn" onClick={() => go('login')}>
              Já tenho conta
            </button>
          )}
          {effective !== 'register' && !closed && (
            <button type="button" className="link-btn" onClick={() => go('register')}>
              Criar conta
            </button>
          )}
        </p>
        {closed && <p className="muted small auth-switch">Novos cadastros estão fechados no momento.</p>}
        {effective !== 'nickname' && !guestDisabled && (
          <p className="auth-switch auth-links">
            <button type="button" className="link-btn" onClick={() => go('nickname')}>
              Utilizar apenas apelido (dados ficam {WHERE})
            </button>
          </p>
        )}
      </form>
    </main>
  );
}
