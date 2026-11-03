import { Button, Checkbox } from '@opencord/ui';
import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { useData } from '../../store/data';
import { api, describeError, useSession } from '../../store/session';
import { LegalDialog, type LegalKind } from './LegalDialog';

/**
 * Quem já tinha conta antes dos Termos/Política (ADR-0039) aceita uma vez antes de seguir. Sem fechar: ou aceita,
 * ou sai. Não aparece para bots nem para quem já aceitou (`me.termsAccepted`).
 */
export function TermsGate() {
  const pending = useData((s) => s.me !== null && s.me.termsAccepted === false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<LegalKind | null>(null);
  if (!pending) return null;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api().request('POST', '/me/accept-terms');
      useData.setState((s) => ({ me: s.me ? { ...s.me, termsAccepted: true } : s.me }));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        title="Termos de uso e privacidade"
        onClose={() => undefined}
        actions={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => void useSession.getState().logout()}>
              Sair
            </Button>
            <Button disabled={!checked || busy} onClick={() => void accept()}>
              Aceitar e continuar
            </Button>
          </>
        }
      >
        <p className="terms-gate">
          Publicamos os Termos de uso e a Política de privacidade, que explicam o que guardamos sobre você, por quanto
          tempo, a moderação automática e como baixar ou excluir seus dados. Para continuar, leia e aceite.
        </p>
        <p className="legal-links">
          <button type="button" className="link-btn" onClick={() => setOpen('termos')}>
            Termos de uso
          </button>
          <button type="button" className="link-btn" onClick={() => setOpen('privacidade')}>
            Política de privacidade
          </button>
        </p>
        <Checkbox
          checked={checked}
          onChange={setChecked}
          label="Tenho 13 anos ou mais e aceito os Termos de uso e a Política de privacidade"
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </Dialog>
      {open && <LegalDialog kind={open} onClose={() => setOpen(null)} />}
    </>
  );
}
