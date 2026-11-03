import type { InstanceInfo } from '@opencord/contracts';
import { Button } from '@opencord/ui';
import { Dialog } from '../../components/Dialog';
import { useData } from '../../store/data';
import { PrivacyPolicy, TermsOfUse } from './legalText';

export type LegalKind = 'termos' | 'privacidade';

export const LEGAL_TITLE: Record<LegalKind, string> = {
  termos: 'Termos de uso',
  privacidade: 'Política de privacidade',
};

/** Termos ou Política dentro do app (ADR-0039). `instance` vem da tela de entrada; depois do login, do store. */
export function LegalDialog({
  kind,
  instance,
  onClose,
}: {
  kind: LegalKind;
  instance?: InstanceInfo | null;
  onClose: () => void;
}) {
  const fromStore = useData((s) => s.instance);
  const info = instance ?? fromStore;
  const props = { instanceName: info?.name ?? 'OpenCord', contact: info?.privacyContact ?? null };
  return (
    <Dialog
      title={LEGAL_TITLE[kind]}
      onClose={onClose}
      wide
      actions={
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      {kind === 'termos' ? <TermsOfUse {...props} /> : <PrivacyPolicy {...props} />}
    </Dialog>
  );
}
