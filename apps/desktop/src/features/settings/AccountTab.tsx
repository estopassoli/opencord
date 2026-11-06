import { askConfirm } from '../../components/AskDialog';
import type { Me } from '@opencord/contracts';
import { Button, TextField } from '@opencord/ui';
import { useState, type FormEvent } from 'react';
import { useData } from '../../store/data';
import { api, describeError, useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { PrivacySection } from '../legal/PrivacySection';
import { SecuritySection } from './SecuritySection';
import { AvatarPicker } from './AvatarPicker';
import { Section } from './Section';

// ---------------------------------------------------------------------------
// Minha conta
// ---------------------------------------------------------------------------

/** Sair (quem entrou só com apelido confirma antes: perde o apelido neste dispositivo). */
export async function confirmLogout(me: Me) {
  if (
    me.hasAccount ||
    (await askConfirm(`Você perde o acesso ao apelido "${me.displayName}" neste dispositivo.`, {
      title: 'Sair',
      confirmLabel: 'Sair',
      danger: true,
    }))
  )
    void useSession.getState().logout();
}

/** Transforma a identidade só com apelido em conta (mesmo usuário, servidores e histórico). */
function ClaimAccount() {
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setError('A senha precisa ter pelo menos 10 caracteres.');
    if (password !== confirmPw) return setError('As senhas não conferem.');
    setBusy(true);
    setError(null);
    try {
      const updated = await api().request<Me>('POST', '/auth/claim', {
        password,
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      useData.setState((s) => ({ me: s.me ? { ...s.me, ...updated } : updated }));
      useUi
        .getState()
        .toast('success', 'Conta criada. Agora você pode entrar de qualquer computador com seu apelido e senha.');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Criar conta (opcional)"
      description="Mantém o mesmo apelido, servidores e histórico, e permite entrar de outros computadores."
    >
      <form className="form" onSubmit={(e) => void submit(e)}>
        <div className="field-row">
          <TextField
            label="Senha"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
            maxLength={256}
          />
          <TextField
            label="Confirmar senha"
            type="password"
            autoComplete="new-password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            required
            minLength={10}
            maxLength={256}
          />
        </div>
        <TextField
          label="E-mail (opcional)"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" size="sm" disabled={busy}>
            Criar conta
          </Button>
        </div>
      </form>
    </Section>
  );
}

export function AccountTab() {
  const me = useData((s) => s.me);
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  if (!me) return null;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (name.length < 2) return setNameError('O apelido precisa de ao menos 2 caracteres.');
    setSavingName(true);
    setNameError(null);
    try {
      const updated = await api().request<Me>('PATCH', '/me', { displayName: name });
      useData.setState((s) => ({ me: s.me ? { ...s.me, ...updated } : updated }));
      useUi.getState().toast('success', 'Apelido atualizado.');
    } catch (err) {
      setNameError(describeError(err));
    } finally {
      setSavingName(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 10) return setPwError('A nova senha precisa ter pelo menos 10 caracteres.');
    if (newPassword !== confirmPassword) return setPwError('As senhas não conferem.');
    setSavingPw(true);
    setPwError(null);
    try {
      await api().request('POST', '/auth/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      useUi.getState().toast('success', 'Senha alterada.');
    } catch (err) {
      setPwError(describeError(err));
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <>
      <Section title="Perfil">
        <AvatarPicker me={me} />
        <dl className="settings-kv">
          <dt>Usuário</dt>
          <dd>@{me.username}</dd>
          {me.email && (
            <>
              <dt>E-mail</dt>
              <dd>{me.email}</dd>
            </>
          )}
        </dl>
        <form className="form" onSubmit={(e) => void saveName(e)}>
          <TextField
            label="Apelido"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            minLength={2}
            maxLength={32}
          />
          {nameError && (
            <p className="form-error" role="alert">
              {nameError}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" size="sm" disabled={savingName || displayName.trim() === me.displayName}>
              Salvar
            </Button>
          </div>
        </form>
      </Section>

      {!me.hasAccount && <ClaimAccount />}

      {me.hasAccount && (
        <Section title="Alterar senha" description="Mínimo de 10 caracteres.">
          <form className="form" onSubmit={(e) => void changePassword(e)}>
            <TextField
              label="Senha atual"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              maxLength={256}
            />
            <div className="field-row">
              <TextField
                label="Nova senha"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={10}
                maxLength={256}
              />
              <TextField
                label="Confirmar nova senha"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={10}
                maxLength={256}
              />
            </div>
            {pwError && (
              <p className="form-error" role="alert">
                {pwError}
              </p>
            )}
            <div className="form-actions">
              <Button type="submit" size="sm" disabled={savingPw}>
                Alterar senha
              </Button>
            </div>
          </form>
        </Section>
      )}

      <SecuritySection me={me} Section={Section} />

      <PrivacySection me={me} Section={Section} />

      <Section
        title="Sessão"
        description={
          me.hasAccount
            ? undefined
            : 'Você entrou só com apelido: sua identidade fica neste computador. Crie uma conta acima para não perder o apelido ao sair.'
        }
      >
        <Button variant="danger" size="sm" onClick={() => void confirmLogout(me)}>
          Sair
        </Button>
      </Section>
    </>
  );
}
