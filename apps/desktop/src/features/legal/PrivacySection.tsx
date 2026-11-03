import type { Me } from '@opencord/contracts';
import { Button, TextField } from '@opencord/ui';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { api, describeError, useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { LegalDialog, type LegalKind } from './LegalDialog';

/** Baixa o JSON com tudo o que a instância guarda sobre a pessoa (GET /me/export). */
export async function downloadMyData(): Promise<void> {
  const blob = await api().blob('/me/export');
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `opencord-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** Configurações → Conta → Privacidade e dados (ADR-0039): ler os textos, baixar os dados, excluir a conta. */
export function PrivacySection({
  me,
  Section,
}: {
  me: Me;
  Section: (p: { title: string; description?: ReactNode; children: ReactNode }) => ReactNode;
}) {
  const [open, setOpen] = useState<LegalKind | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const exportData = async () => {
    setExporting(true);
    try {
      await downloadMyData();
      useUi.getState().toast('success', 'Arquivo com os seus dados gerado.');
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Section
        title="Privacidade e dados"
        description="O que guardamos sobre você, por quanto tempo e seus direitos estão na Política de privacidade."
      >
        <p className="legal-links">
          <button type="button" className="link-btn" onClick={() => setOpen('termos')}>
            Termos de uso
          </button>
          <button type="button" className="link-btn" onClick={() => setOpen('privacidade')}>
            Política de privacidade
          </button>
        </p>
        <div className="form-actions legal-actions">
          <Button variant="secondary" size="sm" icon="download" disabled={exporting} onClick={() => void exportData()}>
            {exporting ? 'Gerando…' : 'Baixar meus dados'}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>
            Excluir conta
          </Button>
        </div>
      </Section>
      {open && <LegalDialog kind={open} onClose={() => setOpen(null)} />}
      {deleting && <DeleteAccountDialog me={me} onClose={() => setDeleting(false)} />}
    </>
  );
}

function DeleteAccountDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = confirm.trim().toUpperCase() === 'EXCLUIR' && (!me.hasAccount || password.length > 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await api().request('POST', '/me/delete', me.hasAccount ? { password } : {});
      useUi.getState().toast('success', 'Conta excluída.');
      await useSession.getState().logout();
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Excluir conta" onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <p>
          Isso apaga na hora suas sessões, arquivos enviados, foto, amizades, bloqueios, configurações e bots. Suas
          mensagens continuam nas conversas dos outros, assinadas "Usuário removido". Servidores que você possui passam
          ao membro mais antigo; sem outro membro, são excluídos. <strong>Não dá para desfazer.</strong>
        </p>
        {me.hasAccount && (
          <TextField
            label="Sua senha"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={256}
          />
        )}
        <TextField
          label="Digite EXCLUIR para confirmar"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="off"
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" disabled={!ready || busy}>
            {busy ? 'Excluindo…' : 'Excluir minha conta'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
