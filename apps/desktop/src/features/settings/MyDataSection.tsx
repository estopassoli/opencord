import { askConfirm } from '../../components/AskDialog';
import { USERNAME_CHANGE_DAYS, type Me } from '@opencord/contracts';
import { Button, TextField } from '@opencord/ui';
import { useState, type FormEvent } from 'react';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { Section } from './Section';

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Perfil › Meus dados: o @ (troca uma vez a cada 30 dias), o e-mail e o apelido. */
export function MyDataSection({ me }: { me: Me }) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState(false);
  const [username, setUsername] = useState(me.username);
  const [savingUser, setSavingUser] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const nextChange = me.usernameChangeAvailableAt;

  const apply = (updated: Me) => useData.setState((s) => ({ me: s.me ? { ...s.me, ...updated } : updated }));

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (name.length < 2) return setNameError('O apelido precisa de ao menos 2 caracteres.');
    setSavingName(true);
    setNameError(null);
    try {
      apply(await api().request<Me>('PATCH', '/me', { displayName: name }));
      useUi.getState().toast('success', 'Apelido atualizado.');
    } catch (err) {
      setNameError(describeError(err));
    } finally {
      setSavingName(false);
    }
  };

  const saveUsername = async (e: FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    if (u === me.username) return setEditingUser(false);
    if (!/^[a-z0-9_.]{2,32}$/.test(u)) return setUserError('Use de 2 a 32 letras minúsculas, números, "_" ou ".".');
    if (
      !(await askConfirm(
        `Seu @ passa a ser @${u}. Depois disso, você só poderá trocar de novo daqui a ${USERNAME_CHANGE_DAYS} dias.`,
        { title: 'Trocar o @', confirmLabel: 'Trocar' },
      ))
    )
      return;
    setSavingUser(true);
    setUserError(null);
    try {
      apply(await api().request<Me>('PATCH', '/me', { username: u }));
      setEditingUser(false);
      useUi.getState().toast('success', `Seu @ agora é @${u}.`);
    } catch (err) {
      setUserError(describeError(err));
    } finally {
      setSavingUser(false);
    }
  };

  return (
    <Section title="Meus dados" description="Seu @, e-mail e apelido.">
      {editingUser ? (
        <form className="form" onSubmit={(e) => void saveUsername(e)}>
          <TextField
            label="Usuário"
            value={username}
            // o @ só aceita minúsculas: converte enquanto digita
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/^@/, ''))}
            autoFocus
            required
            minLength={2}
            maxLength={32}
            hint={`Letras minúsculas, números, "_" ou ".". Dá para trocar uma vez a cada ${USERNAME_CHANGE_DAYS} dias.`}
          />
          {userError && (
            <p className="form-error" role="alert">
              {userError}
            </p>
          )}
          <div className="form-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingUser(false);
                setUsername(me.username);
                setUserError(null);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={savingUser || username.trim() === me.username}>
              Salvar @
            </Button>
          </div>
        </form>
      ) : (
        <div className="mydata-row">
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
          <span className="mydata-user-action">
            <Button size="sm" variant="secondary" disabled={Boolean(nextChange)} onClick={() => setEditingUser(true)}>
              Trocar @
            </Button>
            <span className="muted small">
              {nextChange
                ? `Próxima troca liberada em ${dateLabel(nextChange)}.`
                : `Uma vez a cada ${USERNAME_CHANGE_DAYS} dias.`}
            </span>
          </span>
        </div>
      )}
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
            Salvar apelido
          </Button>
        </div>
      </form>
    </Section>
  );
}
