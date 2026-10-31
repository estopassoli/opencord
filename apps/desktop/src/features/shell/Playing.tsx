/**
 * "Jogando agora" (ADR-0021): o jogo de cada pessoa, detectado pelo app dela. Linha curta (painel do usuário, lista de
 * membros, voz) e o cartão com capa, tempo de jogo e o atalho para a página da Steam.
 */
import type { PlayingGame } from '@opencord/contracts';
import { Button, Icon } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { bridge } from '../../lib/bridge';
import { useData } from '../../store/data';
import { useGames } from '../../store/games';

/** Jogo que a pessoa está jogando, como eu vejo (o meu vem direto do detector, mesmo invisível). */
export function usePlaying(userId: string | undefined): PlayingGame | null {
  const meId = useData((d) => d.me?.id);
  const show = useData((d) => d.settings?.games.showPlaying !== false);
  const mine = useGames((g) => g.mine);
  const theirs = useData((d) => (userId ? d.games[userId] : undefined));
  const offline = useData((d) => (userId ? d.presence[userId] === 'offline' : true));
  if (!userId) return null;
  if (userId === meId) return mine && show ? mine : null;
  return theirs && !offline ? theirs : null;
}

/** "35:29" ou "1:02:03" desde o início, atualizado a cada segundo. */
export function useElapsed(startedAt: number | undefined): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return '';
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Linha "🎮 Path of Exile 2" (painel do usuário, lista de membros). */
export function GameLine({ userId, className }: { userId: string; className?: string }) {
  const game = usePlaying(userId);
  if (!game) return null;
  return (
    <span className={`game-line truncate ${className ?? ''}`}>
      <Icon name="gamepad" size={13} />
      <span className="truncate">{game.name}</span>
    </span>
  );
}

/** Ícone de controle ao lado de quem está jogando (lista da voz). */
export function GameBadge({ userId }: { userId: string }) {
  const game = usePlaying(userId);
  if (!game) return null;
  return <Icon name="gamepad" size={14} label={`Jogando ${game.name}`} className="game-badge" />;
}

function GameArt({ game }: { game: PlayingGame }) {
  const [failed, setFailed] = useState(false);
  if (game.steamAppId && !failed)
    return (
      <img
        className="playing-art"
        src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steamAppId}/capsule_184x69.jpg`}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
      />
    );
  return (
    <span className="playing-art playing-art-icon" aria-hidden>
      <Icon name="gamepad" size={22} />
    </span>
  );
}

/** Seção "Jogando agora" do cartão de perfil. */
export function PlayingNow({ userId }: { userId: string }) {
  const game = usePlaying(userId);
  const elapsed = useElapsed(game?.startedAt);
  if (!game) return null;
  const steam = game.steamAppId ? `https://store.steampowered.com/app/${game.steamAppId}` : null;
  return (
    <section className="playing" aria-label="Jogando agora">
      <h4 className="playing-title">Jogando agora</h4>
      <div className="playing-row">
        <GameArt game={game} />
        <span className="playing-names">
          <strong className="truncate">{game.name}</strong>
          <span className="playing-time small">
            <Icon name="gamepad" size={12} /> {elapsed}
          </span>
        </span>
      </div>
      {steam && (
        <Button
          size="sm"
          variant="secondary"
          className="playing-steam"
          onClick={() => (bridge ? void bridge.openExternal(steam) : window.open(steam, '_blank', 'noopener'))}
        >
          Ver na Steam
        </Button>
      )}
    </section>
  );
}
