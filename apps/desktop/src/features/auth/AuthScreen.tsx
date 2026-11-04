import type { InstanceInfo } from '@opencord/contracts';
import { Button, Checkbox, Icon, TextField } from '@opencord/ui';
import { useEffect, useState, type FormEvent, type MouseEvent } from 'react';
import { LegalDialog, type LegalKind } from '../legal/LegalDialog';
import { ApiClient, normalizeServerUrl } from '../../lib/api';
import { isDesktop, secrets } from '../../lib/bridge';
import { DEFAULT_SERVER_URL, FORCED_SERVER_URL } from '../../lib/config';
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
 * Conta continua opcional: o botão "Entrar só com apelido" (mesmo destaque do Entrar) entra sem senha, com os dados
 * só neste dispositivo.
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
  // aceite dos Termos/Política com a declaração de idade (ADR-0039): só nos cadastros, não no login
  const [accepted, setAccepted] = useState(false);
  // verificação em duas etapas (ADR-0046): a senha conferiu e falta o código
  const [ticket, setTicket] = useState<string | null>(null);
  const [via, setVia] = useState<{ method: 'totp' | 'email'; emailHint: string | null }>({
    method: 'totp',
    emailHint: null,
  });
  const [code, setCode] = useState('');
  const [legal, setLegal] = useState<LegalKind | null>(null);
  // os links ficam dentro do rótulo da caixa: sem isso o clique também marcava/desmarcava o aceite
  const openLegal = (e: MouseEvent, kind: LegalKind) => {
    e.stopPropagation();
    setLegal(kind);
  };

  useEffect(() => {
    void secrets.get('serverUrl').then((u) => setServerUrl(FORCED_SERVER_URL ?? (u || DEFAULT_SERVER_URL)));
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
  const signup = effective !== 'login';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (signup && !accepted) {
      setError(
        'Para continuar, confirme que tem 13 anos ou mais e aceita os Termos de uso e a Política de privacidade.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const s = useSession.getState();
      const code = accessCode || undefined;
      if (effective === 'nickname') await s.join(serverUrl, nickname, code);
      else if (effective === 'login') {
        const r = await s.login(serverUrl, login, password);
        if (r) {
          setTicket(r.twoFactorTicket);
          setVia({ method: r.method, emailHint: r.emailHint });
          setCode('');
        }
      } else await s.register(serverUrl, { nickname, password, email: email.trim() || undefined, accessCode: code });
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

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!ticket) return;
    setBusy(true);
    setError(null);
    try {
      await useSession.getState().loginTwoFactor(serverUrl, ticket, code);
    } catch (err) {
      const msg = describeError(err);
      setError(msg);
      // bilhete vencido ou tentativas esgotadas: volta para a senha
      if (/expirou|tentativas/.test(msg)) {
        setTicket(null);
        setPassword('');
      }
    } finally {
      setBusy(false);
    }
  }

  if (ticket)
    return (
      <main className="auth">
        <form className="auth-card" onSubmit={submitCode} aria-describedby={error ? 'auth-error' : undefined}>
          <div className="auth-brand">
            <span className="brand-mark" aria-hidden />
            <h1>Verificação em duas etapas</h1>
            <p className="muted">
              {via.method === 'email'
                ? `Mandamos um código de 6 dígitos para ${via.emailHint ?? 'o seu e-mail'}. Ele vale por 10 minutos.`
                : 'Abra o app autenticador e digite o código de 6 dígitos do OpenCord.'}
            </p>
          </div>
          <TextField
            label="Código"
            hint="Sem o celular? Use um dos seus códigos de recuperação."
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            minLength={6}
            maxLength={16}
            autoFocus
            autoComplete="one-time-code"
            inputMode="text"
          />
          {error && (
            <p id="auth-error" className="form-error" role="alert">
              <Icon name="warning" size={16} /> {error}
            </p>
          )}
          <Button type="submit" size="lg" block disabled={busy || code.trim().length < 6}>
            {busy ? 'Aguarde…' : 'Confirmar'}
          </Button>
          <p className="auth-switch auth-links">
            {via.method === 'email' && (
              <button
                type="button"
                className="link-btn"
                disabled={busy}
                onClick={() =>
                  void new ApiClient(normalizeServerUrl(serverUrl)).resendLoginCode(ticket).then(
                    () => setError(null),
                    (err: unknown) => setError(describeError(err)),
                  )
                }
              >
                Reenviar código
              </button>
            )}
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setTicket(null);
                setError(null);
                setPassword('');
              }}
            >
              Voltar
            </button>
          </p>
        </form>
      </main>
    );

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

        {signup && (
          <div className="auth-terms">
            <Checkbox
              checked={accepted}
              onChange={setAccepted}
              label={
                <>
                  Tenho 13 anos ou mais e aceito os{' '}
                  <button type="button" className="link-btn" onClick={(e) => openLegal(e, 'termos')}>
                    Termos de uso
                  </button>{' '}
                  e a{' '}
                  <button type="button" className="link-btn" onClick={(e) => openLegal(e, 'privacidade')}>
                    Política de privacidade
                  </button>
                </>
              }
            />
          </div>
        )}

        {error && (
          <p id="auth-error" className="form-error" role="alert">
            <Icon name="warning" size={16} /> {error}
          </p>
        )}

        <Button type="submit" size="lg" block disabled={busy || (signup && !accepted)}>
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
          <div className="auth-alt">
            <span className="auth-alt-or" aria-hidden="true">
              ou
            </span>
            <Button type="button" variant="secondary" size="lg" block onClick={() => go('nickname')}>
              Entrar só com apelido
            </Button>
            <p className="auth-switch">Sem senha: os dados ficam {WHERE}.</p>
          </div>
        )}
      </form>
      {legal && <LegalDialog kind={legal} instance={instance} onClose={() => setLegal(null)} />}
    </main>
  );
}
