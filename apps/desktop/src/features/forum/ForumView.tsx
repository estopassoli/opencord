/**
 * Canal de fórum (ADR-0052): lista de posts (título, quem abriu, trecho, respostas), do mais movimentado para o
 * menos. Abrir um post mostra a conversa dele no painel de thread, com a caixa para responder. "Novo post" pede
 * título e texto. Mensagem nova no canal (post ou resposta) atualiza a lista.
 */
import {
  FORUM_TITLE_MAX,
  hasPermission,
  Permission,
  type Channel,
  type ForumPost,
  type ForumPostPage,
} from '@opencord/contracts';
import { Avatar, Button, Icon, TextArea, TextField } from '@opencord/ui';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { EmojiButton } from '../../components/EmojiButton';
import { MobileNavButton } from '../../components/MobileNavButton';
import { nameFor } from '../../lib/names';
import { noteSent } from '../../lib/slowmode';
import { useMessages } from '../../store/data';
import { api, describeError, markTargetRead, useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { renderRich } from '../chat/rich';
import { ThreadPanel } from '../chat/ThreadPanel';
import { useIsMobile } from '../../lib/media';
import './forum.css';

const PAGE = 25;

function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `há ${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function ForumView({ channel }: { channel: Channel }) {
  const key = `c:${channel.id}` as const;
  const [posts, setPosts] = useState<ForumPost[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const thread = useUi((s) => s.thread);
  const canPost = hasPermission(channel.myPermissions, Permission.SEND_MESSAGES);
  const mobile = useIsMobile();

  const load = useCallback(async () => {
    try {
      const p = await api().request<ForumPostPage>('GET', `/channels/${channel.id}/posts?limit=${PAGE}`);
      setPosts(p.posts);
      setNextBefore(p.nextBefore);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [channel.id]);

  useEffect(() => {
    void load();
    // timeline vazio "carregado": posts e respostas que chegam ao vivo entram nele (a thread aberta acompanha)
    if (!useMessages.getState().timelines[key]?.loaded)
      useMessages.getState().setPage(key, { messages: [], nextBefore: null }, 'replace');
    void markTargetRead(key);
  }, [load, key]);

  // post ou resposta nova neste fórum: recarrega a primeira página (junta vários eventos seguidos)
  useEffect(() => {
    const rt = useSession.getState().realtime;
    if (!rt) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = rt.on('chat:message:created', (m) => {
      if (m.channelId !== channel.id) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => void load(), 400);
    });
    return () => {
      off();
      if (t) clearTimeout(t);
    };
  }, [channel.id, load]);

  const more = async () => {
    if (!nextBefore) return;
    try {
      const p = await api().request<ForumPostPage>(
        'GET',
        `/channels/${channel.id}/posts?limit=${PAGE}&before=${encodeURIComponent(nextBefore)}`,
      );
      setPosts((cur) => [...(cur ?? []), ...p.posts.filter((x) => !cur?.some((c) => c.message.id === x.message.id))]);
      setNextBefore(p.nextBefore);
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    }
  };

  const open = (p: ForumPost) => {
    // a thread procura a raiz no timeline do canal: põe o post lá antes de abrir
    useMessages.getState().upsert(p.message);
    useUi.getState().openThread(key, p.message.id);
  };

  // no celular não há painel ao lado: o post aberto ocupa a tela (o X da thread volta para a lista)
  if (mobile && thread?.key === key) return <ThreadPanel thread={thread} />;

  return (
    <section className="forum" aria-label={`Fórum ${channel.name}`}>
      <header className="chat-header">
        <MobileNavButton />
        <Icon name="chats" size={22} />
        <h2 className="truncate">{channel.name}</h2>
        {channel.topic && <span className="chat-topic truncate">{channel.topic}</span>}
        <span className="spacer" />
        {canPost && !composing && (
          <Button size="sm" icon="plus" onClick={() => setComposing(true)}>
            Novo post
          </Button>
        )}
      </header>
      <div className="forum-body">
        {composing && (
          <NewPost
            channel={channel}
            onDone={(posted) => {
              setComposing(false);
              if (posted) void load();
            }}
          />
        )}
        {channel.slowmodeSec > 0 && (
          <p className="muted small forum-slowmode">
            <Icon name="clock" size={14} /> Modo lento: uma mensagem a cada {formatSlowmode(channel.slowmodeSec)}.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}{' '}
            <button className="link-btn" onClick={() => void load()}>
              Tentar de novo
            </button>
          </p>
        )}
        {posts === null && !error && <p className="muted forum-empty">Carregando posts…</p>}
        {posts?.length === 0 && (
          <div className="forum-empty">
            <Icon name="chats" size={32} />
            <p>Nenhum post ainda.</p>
            {canPost && (
              <Button icon="plus" onClick={() => setComposing(true)}>
                Abrir o primeiro post
              </Button>
            )}
          </div>
        )}
        {posts && posts.length > 0 && (
          <ul className="forum-list" aria-label="Posts">
            {posts.map((p) => {
              const m = p.message;
              const author = nameFor(m.author.id, m.author.displayName);
              return (
                <li key={m.id}>
                  <button
                    className="forum-post"
                    aria-current={thread?.rootId === m.id ? 'true' : undefined}
                    onClick={() => open(p)}
                  >
                    <span className="forum-post-title">{m.title ?? 'Sem título'}</span>
                    <span className="forum-post-excerpt">
                      {renderRich(m.body.slice(0, 600), (id) => nameFor(id, 'alguém'))}
                    </span>
                    <span className="forum-post-meta">
                      <Avatar id={m.author.id} name={author} size={18} />
                      <span className="truncate">{author}</span>
                      <span aria-hidden>·</span>
                      <span>
                        <Icon name="chat" size={14} /> {m.replyCount} {m.replyCount === 1 ? 'resposta' : 'respostas'}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{ago(p.lastActivityAt)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {nextBefore && (
          <div className="forum-more">
            <Button variant="secondary" onClick={() => void more()}>
              Mostrar mais posts
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function NewPost({ channel, onDone }: { channel: Channel; onDone: (posted: boolean) => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api().request('POST', `/channels/${channel.id}/messages`, {
        requestId: crypto.randomUUID(),
        title: title.trim(),
        body: body.trim(),
      });
      noteSent(channel.id);
      onDone(true);
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <form className="forum-new" onSubmit={(e) => void submit(e)} aria-label="Novo post">
      <TextField
        ref={titleRef}
        label="Título"
        value={title}
        maxLength={FORUM_TITLE_MAX}
        placeholder="Sobre o que é o post?"
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="emoji-field">
        <TextArea
          ref={bodyRef}
          label="Mensagem"
          value={body}
          rows={4}
          maxLength={4000}
          placeholder="Conte os detalhes; as respostas ficam penduradas no post."
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(e);
            if (e.key === 'Escape') onDone(false);
          }}
        />
        <EmojiButton
          className="emoji-field-btn"
          target={bodyRef}
          value={body}
          onChange={setBody}
          serverId={channel.serverId}
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button variant="secondary" type="button" onClick={() => onDone(false)}>
          Cancelar
        </Button>
        <Button type="submit" icon="send" disabled={busy || !title.trim() || !body.trim()}>
          Publicar post
        </Button>
      </div>
    </form>
  );
}

/** "30 s", "5 min", "2 h" */
export function formatSlowmode(sec: number) {
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${Math.round(sec / 3600)} h`;
}
