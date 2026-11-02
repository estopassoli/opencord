import { Button, RadioGroup, TextField } from '@opencord/ui';
import { useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { BAN_DELETE_WINDOWS } from '../../lib/moderation';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';

type Window = (typeof BAN_DELETE_WINDOWS)[number]['id'];

/** Banir alguém do servidor (ADR-0034): motivo opcional e apagar as mensagens recentes da pessoa. */
export function BanDialog({ serverId, userId, onClose }: { serverId: string; userId: string; onClose: () => void }) {
  const member = useData((s) => s.details[serverId]?.members.find((m) => m.user.id === userId));
  const [reason, setReason] = useState('');
  const [win, setWin] = useState<Window>('none');
  const [busy, setBusy] = useState(false);
  const name = member?.nickname ?? member?.user.displayName ?? 'esta pessoa';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const seconds = BAN_DELETE_WINDOWS.find((w) => w.id === win)?.seconds ?? 0;
      await api().request('PUT', `/servers/${serverId}/bans/${userId}`, {
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        deleteMessageSeconds: seconds,
      });
      useData.getState().removeMember(serverId, userId);
      useUi.getState().toast('success', 'Membro banido.');
      onClose();
    } catch (err) {
      useUi.getState().toast('error', describeError(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Banir ${name}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" form="ban-form" type="submit" disabled={busy}>
            Banir
          </Button>
        </>
      }
    >
      <form id="ban-form" className="form" onSubmit={(e) => void submit(e)}>
        <p className="ask-message">{name} sai do servidor e não volta por convite até ser desbanido.</p>
        <TextField
          label="Motivo (opcional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="Só a moderação vê"
          autoFocus
        />
        <RadioGroup<Window>
          label="Apagar mensagens recentes"
          value={win}
          onChange={setWin}
          options={BAN_DELETE_WINDOWS.map((w) => ({ value: w.id, label: w.label }))}
        />
      </form>
    </Dialog>
  );
}
