/**
 * Gravação da chamada na interface (ADR-0023): botão nos controles, selo "GRAVANDO" no cabeçalho do palco para todos,
 * confirmação antes de começar e a lista de gravações prontas (24 h) para baixar.
 */
import type { CallRecording } from '@opencord/contracts';
import { Button, Icon } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Tooltip } from '../../components/Tooltip';
import { useData } from '../../store/data';
import { recordingSupported, useRecording } from '../../store/recording';
import { useVoice } from '../../store/voice';

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
};

function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

const nameOf = (userId: string) => {
  const d = useData.getState();
  if (d.me?.id === userId) return 'você';
  for (const s of Object.values(d.details)) {
    const m = s.members.find((x) => x.user.id === userId);
    if (m) return m.nickname ?? m.user.displayName;
  }
  return 'alguém';
};

/** Carrega o estado da gravação do canal ao abrir o palco. */
export function useRecordingLoad(channelId: string) {
  useEffect(() => {
    void useRecording.getState().load(channelId);
  }, [channelId]);
}

/** Selo vermelho no cabeçalho do palco: todos na chamada sabem que está sendo gravada. */
export function RecordingBadge({ channelId }: { channelId: string }) {
  const active = useRecording((s) => s.active[channelId] ?? null);
  const now = useNow(Boolean(active));
  if (!active) return null;
  const by = nameOf(active.userId);
  return (
    <span
      className="rec-badge"
      role="status"
      data-tip={`Esta chamada está sendo gravada por ${by}. A gravação fica disponível para baixar por 24 horas.`}
    >
      <span className="rec-dot" aria-hidden />
      GRAVANDO {clock(now - new Date(active.startedAt).getTime())}
    </span>
  );
}

/** Botão "Gravações" com as gravações prontas do canal (24 h). */
export function RecordingsButton({ channelId }: { channelId: string }) {
  const ready = useRecording((s) => s.ready[channelId]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  if (!ready?.length) return null;
  return (
    <div className="popover-anchor" ref={ref}>
      <Tooltip label="Gravações desta chamada (24 h)">
        <button
          className="icon-btn rec-list-btn"
          aria-label={`Gravações (${ready.length})`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="film" size={18} />
          <span className="small">{ready.length}</span>
        </button>
      </Tooltip>
      {open && (
        <div className="rec-list" role="dialog" aria-label="Gravações da chamada">
          <p className="muted small">Cada gravação fica disponível por 24 horas e depois é apagada do servidor.</p>
          <ul>
            {ready.map((r) => (
              <RecordingRow key={r.id} r={r} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RecordingRow({ r }: { r: CallRecording }) {
  const meId = useData((d) => d.me?.id);
  const left = new Date(r.expiresAt).getTime() - Date.now();
  const hours = Math.max(1, Math.round(left / 3_600_000));
  const started = new Date(r.startedAt);
  return (
    <li>
      <span className="rec-row-names">
        <strong>
          {started.toLocaleDateString('pt-BR')} às{' '}
          {started.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </strong>
        <span className="muted small">
          {clock(r.durationMs)} · {(r.sizeBytes / 1024 / 1024).toFixed(0)} MB · por {r.createdBy.displayName} · some em{' '}
          {hours} h
        </span>
      </span>
      <Button size="sm" icon="download" onClick={() => void useRecording.getState().download(r)}>
        Baixar
      </Button>
      {r.createdBy.id === meId && (
        <button
          className="icon-btn"
          aria-label="Apagar gravação agora"
          data-tip="Apagar agora"
          onClick={() => void useRecording.getState().remove(r)}
        >
          <Icon name="trash" size={16} />
        </button>
      )}
    </li>
  );
}

/** Botão de gravar nos controles da chamada (com confirmação antes de começar). */
export function RecordButton() {
  const channelId = useVoice((v) => v.machine.channelId);
  const mine = useRecording((s) => s.mine);
  const stopping = useRecording((s) => s.stopping);
  const other = useRecording((s) => (channelId ? s.active[channelId] : null));
  const [confirm, setConfirm] = useState(false);
  if (!channelId) return null;
  const recordingHere = Boolean(mine && mine.channelId === channelId);
  const busyByOther = Boolean(other && !recordingHere);
  const label = recordingHere
    ? stopping
      ? 'Encerrando a gravação…'
      : 'Parar de gravar'
    : busyByOther
      ? 'Outra pessoa já está gravando'
      : 'Gravar a chamada';
  return (
    <>
      <Tooltip label={label}>
        <button
          className="call-btn rec-btn"
          aria-label={label}
          aria-pressed={recordingHere}
          disabled={busyByOther || stopping}
          data-recording={recordingHere ? 'true' : undefined}
          onClick={() => (recordingHere ? void useRecording.getState().stop() : setConfirm(true))}
        >
          <Icon name="record" />
        </button>
      </Tooltip>
      {confirm && <ConfirmRecord onClose={() => setConfirm(false)} />}
    </>
  );
}

function ConfirmRecord({ onClose }: { onClose: () => void }) {
  const supported = recordingSupported();
  return (
    <Dialog
      title="Gravar a chamada?"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            icon="record"
            disabled={!supported}
            onClick={() => {
              onClose();
              void useRecording.getState().start();
            }}
          >
            Começar a gravar
          </Button>
        </>
      }
    >
      <div className="rec-confirm">
        <p>
          Todos na chamada verão o aviso <strong>GRAVANDO</strong> enquanto a gravação durar. Entram as vozes, as
          câmeras e as transmissões de tela, como aparecem na chamada.
        </p>
        <p className="muted small">
          A gravação é montada no seu computador e enviada ao servidor durante a chamada. Ao terminar, quem tem acesso a
          este canal pode baixá-la por 24 horas; depois ela é apagada do servidor. Limite de 4 horas. Sair da chamada
          encerra a gravação.
        </p>
        {!supported && <p className="form-error">Este computador não consegue gravar (sem WebCodecs).</p>}
      </div>
    </Dialog>
  );
}
