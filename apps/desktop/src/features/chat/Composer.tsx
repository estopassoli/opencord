import type { Attachment } from '@opencord/contracts';
import { Icon, TextArea } from '@opencord/ui';
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { useData, useMessages, type TargetKey } from '../../store/data';
import { api, describeError, markTargetRead, useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { sendMessage, type ChatTarget } from './ChatView';
import { CreatePollDialog } from './Poll';
import { openContextMenu } from '../../components/ContextMenu';
import { fmt } from './VoiceNote';

/** limite de uma mensagem de voz */
const VOICE_MAX_S = 5 * 60;

interface Upload {
  id: string;
  file: File;
  status: 'uploading' | 'done' | 'error';
  attachment?: Attachment;
  error?: string;
}

export function Composer({
  target,
  targetKey,
  placeholder,
  canAttach,
}: {
  target: ChatTarget;
  targetKey: TargetKey;
  placeholder: string;
  canAttach: boolean;
}) {
  const draft = useUi((s) => s.drafts[targetKey] ?? '');
  const [pollOpen, setPollOpen] = useState(false);
  const replyToId = useUi((s) => s.replyTo[targetKey] ?? null);
  const replyTo = useMessages((s) =>
    replyToId ? s.timelines[targetKey]?.messages.find((m) => m.id === replyToId) : undefined,
  );
  const [uploads, setUploads] = useState<Upload[]>([]);
  // mensagem de voz: gravando (segundos) ou enviando
  const [rec, setRec] = useState<{ seconds: number } | 'sending' | null>(null);
  const recorder = useRef<{
    mr: MediaRecorder;
    stream: MediaStream;
    chunks: Blob[];
    timer: ReturnType<typeof setInterval>;
  } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const typingSent = useRef(0);

  useEffect(() => {
    input.current?.focus();
  }, [targetKey, replyToId]);

  // altura automática
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [draft]);

  const setDraft = (t: string) => useUi.getState().setDraft(targetKey, t);
  const rtTarget = target.channelId
    ? { channelId: target.channelId }
    : { conversationId: target.conversationId as string };

  const typing = () => {
    const now = Date.now();
    if (now - typingSent.current < 5000) return;
    typingSent.current = now;
    void useSession
      .getState()
      .realtime?.command('chat:typing:start', rtTarget)
      .catch(() => undefined);
  };

  const addFiles = (files: FileList | File[]) => {
    if (!canAttach) return;
    for (const file of Array.from(files).slice(0, 10)) {
      const id = crypto.randomUUID();
      setUploads((u) => [...u, { id, file, status: 'uploading' }]);
      api()
        .upload<{ attachment: Attachment }>('/attachments', file)
        .then(
          (r) =>
            setUploads((u) => u.map((x) => (x.id === id ? { ...x, status: 'done', attachment: r.attachment } : x))),
          (e: unknown) =>
            setUploads((u) => u.map((x) => (x.id === id ? { ...x, status: 'error', error: describeError(e) } : x))),
        );
    }
  };

  const send = () => {
    const body = draft.trim();
    if (uploads.some((u) => u.status === 'uploading'))
      return useUi.getState().toast('info', 'Aguarde o envio dos anexos.');
    const attachmentIds = uploads
      .filter((u) => u.status === 'done' && u.attachment)
      .map((u) => (u.attachment as Attachment).id);
    if (!body && !attachmentIds.length) return;
    if (body.length > 4000) return useUi.getState().toast('error', 'Mensagem muito longa (máx. 4000 caracteres).');
    void sendMessage(
      targetKey,
      target,
      crypto.randomUUID(),
      body,
      replyToId ?? undefined,
      attachmentIds.length ? attachmentIds : undefined,
    );
    setDraft('');
    setUploads([]);
    useUi.getState().setReplyTo(targetKey, null);
    typingSent.current = 0;
    void useSession
      .getState()
      .realtime?.command('chat:typing:stop', rtTarget)
      .catch(() => undefined);
  };

  const stopRecorder = () => {
    const r = recorder.current;
    recorder.current = null;
    if (!r) return null;
    clearInterval(r.timer);
    for (const t of r.stream.getTracks()) t.stop();
    return r;
  };
  useEffect(() => () => void stopRecorder(), []);

  const finishVoice = async (send: boolean) => {
    const r = stopRecorder();
    if (!r) return;
    if (!send) {
      setRec(null);
      return;
    }
    setRec('sending');
    const done = new Promise<void>((resolve) => {
      r.mr.onstop = () => resolve();
    });
    if (r.mr.state !== 'inactive') r.mr.stop();
    await done;
    const blob = new Blob(r.chunks, { type: 'audio/webm' });
    if (blob.size < 1000) {
      setRec(null);
      useUi.getState().toast('info', 'Gravação curta demais.');
      return;
    }
    try {
      const file = new File([blob], 'Mensagem de voz.webm', { type: 'audio/webm' });
      const up = await api().upload<{ attachment: Attachment }>('/attachments', file);
      void sendMessage(targetKey, target, crypto.randomUUID(), '', replyToId ?? undefined, [up.attachment.id]);
      useUi.getState().setReplyTo(targetKey, null);
    } catch (e) {
      useUi.getState().toast('error', `Não deu para enviar a mensagem de voz: ${describeError(e)}`);
    } finally {
      setRec(null);
    }
  };

  const startVoice = async () => {
    if (rec || !canAttach) return;
    const audio = useData.getState().settings?.audio;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: audio?.echoCancellation ?? true,
          noiseSuppression: audio?.noiseSuppression ?? true,
          autoGainControl: audio?.autoGainControl ?? true,
          ...(audio?.inputDeviceId ? { deviceId: audio.inputDeviceId } : {}),
        },
      });
    } catch {
      useUi.getState().toast('error', 'Não deu para usar o microfone.');
      return;
    }
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 48_000 });
    const timer = setInterval(() => {
      setRec((cur) => {
        if (!cur || cur === 'sending') return cur;
        if (cur.seconds + 1 >= VOICE_MAX_S) void finishVoice(true);
        return { seconds: cur.seconds + 1 };
      });
    }, 1000);
    const r = { mr, stream, chunks: [] as Blob[], timer };
    mr.ondataavailable = (e) => {
      if (e.data.size) r.chunks.push(e.data);
    };
    recorder.current = r;
    mr.start(250);
    setRec({ seconds: 0 });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      if (replyToId) useUi.getState().setReplyTo(targetKey, null);
      // Esc com o composer focado marca o canal como lido
      else void markTargetRead(targetKey);
    } else if (e.key === 'ArrowUp' && !draft) {
      // seta para cima no composer vazio: editar a última mensagem própria
      const me = useData.getState().me?.id;
      const last = [...(useMessages.getState().get(targetKey).messages ?? [])]
        .reverse()
        .find((m) => m.author.id === me && !m.deleted);
      if (last) {
        e.preventDefault();
        useUi.getState().setEditing(last.id);
      }
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    if (e.clipboardData.files.length) {
      e.preventDefault();
      addFiles(e.clipboardData.files);
    }
  };
  const onDrop = (e: DragEvent) => {
    if (e.dataTransfer.files.length) {
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className="composer" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {replyTo && (
        <div className="composer-reply">
          <span>
            Respondendo a <strong>{replyTo.author.displayName}</strong>
          </span>
          <button
            className="icon-btn icon-btn-sm"
            aria-label="Cancelar resposta"
            onClick={() => useUi.getState().setReplyTo(targetKey, null)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {uploads.length > 0 && (
        <ul className="composer-uploads" aria-label="Anexos">
          {uploads.map((u) => (
            <li key={u.id} className="upload-chip" data-status={u.status} data-tip={u.error}>
              <Icon name={u.status === 'error' ? 'warning' : 'attach'} size={14} />
              <span className="truncate">{u.file.name}</span>
              <span className="small muted">
                {u.status === 'uploading' ? 'enviando…' : u.status === 'error' ? 'falhou' : ''}
              </span>
              <button
                className="icon-btn icon-btn-sm"
                aria-label={`Remover ${u.file.name}`}
                onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {rec ? (
        <div className="composer-row composer-rec" aria-live="polite">
          <span className="rec-dot" aria-hidden />
          <span className="rec-time">
            {rec === 'sending' ? 'Enviando…' : `Gravando ${fmt(rec.seconds)} / ${fmt(VOICE_MAX_S)}`}
          </span>
          <span className="spacer" />
          <button
            className="icon-btn"
            aria-label="Descartar gravação"
            data-tip="Descartar"
            disabled={rec === 'sending'}
            onClick={() => void finishVoice(false)}
          >
            <Icon name="trash" />
          </button>
          <button
            className="icon-btn"
            aria-label="Enviar mensagem de voz"
            data-tip="Enviar"
            disabled={rec === 'sending'}
            onClick={() => void finishVoice(true)}
          >
            <Icon name="send" />
          </button>
        </div>
      ) : (
        <div className="composer-row">
          <button
            className="icon-btn"
            aria-label="Anexar arquivo ou criar enquete"
            aria-haspopup="menu"
            data-tip="Anexar ou criar enquete"
            onClick={(e) =>
              openContextMenu(
                e,
                [
                  ...(canAttach
                    ? [{ label: 'Enviar arquivo', icon: 'attach' as const, onSelect: () => fileInput.current?.click() }]
                    : []),
                  { label: 'Criar enquete', icon: 'poll' as const, onSelect: () => setPollOpen(true) },
                ],
                'Adicionar à mensagem',
              )
            }
          >
            <Icon name="plus-circle" />
          </button>
          {pollOpen && <CreatePollDialog target={target} onClose={() => setPollOpen(false)} />}
          {canAttach && (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </>
          )}
          <TextArea
            bare
            ref={input}
            rows={1}
            value={draft}
            placeholder={placeholder}
            aria-label={placeholder}
            maxLength={4000}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value) typing();
            }}
            onKeyDown={onKey}
            onPaste={onPaste}
          />
          {canAttach && !draft.trim() && !uploads.length && typeof MediaRecorder !== 'undefined' ? (
            <button
              className="icon-btn"
              aria-label="Gravar mensagem de voz"
              data-tip="Gravar mensagem de voz"
              onClick={() => void startVoice()}
            >
              <Icon name="microphone" />
            </button>
          ) : (
            <button
              className="icon-btn"
              aria-label="Enviar"
              data-tip="Enviar (Enter)"
              onClick={send}
              disabled={!draft.trim() && !uploads.some((u) => u.status === 'done')}
            >
              <Icon name="send" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
