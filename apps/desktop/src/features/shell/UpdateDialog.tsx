/**
 * Antes de atualizar: diálogo com o que entrou na versão nova (novidades publicadas junto com o instalador,
 * GET /downloads/desktop/notes) e a escolha entre atualizar agora ou depois.
 */
import { Button } from '@opencord/ui';
import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../../electron/shared/ipc';
import { Dialog } from '../../components/Dialog';
import { bridge } from '../../lib/bridge';
import { api } from '../../store/session';
import { useVoice } from '../../store/voice';
import type { ChangeKind } from '../home/changelog';
import { KIND_LABEL, keyOf, knownEntries, newEntries, type Note } from './updateNotes';

export function UpdateDialog({
  status,
  onClose,
}: {
  status: Extract<UpdateStatus, { state: 'ready' | 'available' }>;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const inCall = useVoice((v) => v.machine.status !== 'disconnected');
  useEffect(() => {
    void api()
      .request<{ entries: Note[] }>('GET', '/downloads/desktop/notes', undefined, { auth: false })
      .then(async (r) => {
        const { mine, known } = await knownEntries();
        setNotes(newEntries(r.entries, mine, known));
      })
      .catch(() => setNotes([]));
  }, []);
  const ready = status.state === 'ready';
  return (
    <Dialog
      title={`Atualização ${status.version}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {ready ? 'Depois' : 'Cancelar'}
          </Button>
          <Button
            icon="download"
            onClick={() => {
              onClose();
              void bridge?.updates.install();
            }}
          >
            {ready ? 'Reiniciar e atualizar agora' : 'Baixar'}
          </Button>
        </>
      }
    >
      <div className="update-dialog">
        {notes === null ? (
          <p className="muted">Carregando as novidades…</p>
        ) : notes.length ? (
          <>
            <p className="muted small">O que entrou nesta versão:</p>
            <ol className="update-notes">
              {notes.map((n) => (
                <li key={`${keyOf(n)}-${n.title}`} data-kind={n.kind as ChangeKind}>
                  <span className="timeline-kind">{KIND_LABEL[n.kind] ?? n.kind}</span>
                  <strong>{n.title}</strong>
                  <p className="small">{n.body}</p>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="muted">Correções e melhorias.</p>
        )}
        <p className="update-warn small">
          {ready
            ? `Agora: fecha e abre o OpenCord de novo${inCall ? ' e encerra a chamada' : ''}, em alguns segundos. ` +
              'Se preferir, ela é instalada sozinha quando você fechar o OpenCord ou ficar um tempo longe do ' +
              'computador — nunca durante uma chamada.'
            : 'O instalador da versão nova será baixado pelo navegador.'}
        </p>
      </div>
    </Dialog>
  );
}
