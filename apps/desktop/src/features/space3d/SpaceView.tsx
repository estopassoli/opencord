/**
 * Espaço 3D na chamada (ADR-0055): a cena ocupa o palco; por cima, a barra (telão, editar, sair), as dicas de
 * controle e, no modo edição, o painel do editor.
 */
import {
  generateSpace,
  isMatchZone,
  matchPhase,
  SPACE_ITEM_KINDS,
  SPACE_ITEM_LABELS,
  SPACE_THEME_LABELS,
  SPACE_THEMES,
  SPORT_LABELS,
  type SpaceTheme,
  type SportZone,
} from '@opencord/contracts';
import { Button, Icon, Select, Slider } from '@opencord/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { askConfirm } from '../../components/AskDialog';
import { useActivity } from '../../store/activity';
import { useData } from '../../store/data';
import { useMusic } from '../../store/music';
import { useSession } from '../../store/session';
import { canEditSpace, useSpace } from '../../store/space';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import type { BotLevel } from './bots/level';
import { botMatchPhase } from './bots/match';
import { botIn, useAllDuels, useBotPlay } from './bots/store';
import { SpaceEditor } from './editor';
import { SpaceScene, type ScreenSource } from './scene';
import { setSfxDeafened } from './sfx';
import { DuelHud, rematchDuel, useDuelScene } from './DuelHud';
import { Binding, ControlsPanel, GameMenu, LockHint, LockStrip, type MenuTab } from './GameHud';
import {
  BigCountdown,
  HeldScoreboard,
  LiveRegion,
  MatchEnd,
  MatchPanel,
  MatchScore,
  PointBanner,
  RaceEnd,
  useRace,
} from './MatchHud';
import { TelaoSource, useTelaoPlayer } from './Telao';
import { TutorialHud, useTutorial } from './TutorialHud';
import { tutorialKey } from './tutorial';
import './space3d.css';

const SWATCHES = [
  '#e05a5a',
  '#f08a3c',
  '#f2c94c',
  '#4fbf6a',
  '#2f9e9e',
  '#3f8fe0',
  '#6a5ae0',
  '#b36ae0',
  '#f06ab0',
  '#e8e1cf',
  '#8a8f96',
  '#3b2f2a',
];

/**
 * Jogar / Revanche / Nova corrida da zona (menu, tela de fim e o atalho de revanche). Arenas com partida: o servidor
 * abre a contagem e, no meio de uma partida, nada muda. Sinuca: zera e arruma a mesa. Corrida: nova largada.
 */
function playZone(zone: number, scene: SpaceScene | null) {
  const st = useSpace.getState();
  // contra o bot: a partida é local (Revanche com o mesmo bot)
  if (botIn(zone)) {
    const m = useBotPlay.getState().match;
    if (m && zone !== 7) {
      const ph = botMatchPhase(m, Date.now());
      if (ph === 'countdown' || ph === 'playing') return;
    }
    useBotPlay.getState().rematch();
    scene?.newMatch();
    return;
  }
  if (zone === 7) {
    void st.startRace();
    return;
  }
  if (isMatchZone(zone)) {
    const ph = matchPhase(st.session?.matches?.[String(zone)], Date.now());
    if (ph === 'countdown' || ph === 'playing') return;
    void st.startMatch(zone);
  } else if (zone === 6) void st.resetScore(zone);
  else return;
  scene?.newMatch();
}

/** estou correndo agora (largada no meu relógio, sem ter chegado e com a prova aberta)? */
function racingNow(meId: string | undefined): boolean {
  const st = useSpace.getState();
  const vsBot = useBotPlay.getState().race;
  if (vsBot) return st.zone === 7 && !vsBot.closed && !vsBot.results.some((r) => r.userId === meId);
  const race = st.session?.race;
  if (st.zone !== 7 || st.raceLocalStart === null || !race || race.closed) return false;
  return !race.results.some((r) => r.userId === meId) && !(race.dnf ?? []).includes(meId ?? '');
}

/** corrida que nunca fechou (ninguém chegou): depois disso o atalho pode largar outra */
const RACE_STALE_MS = 5 * 60_000;

/** atalho de revanche (R): só quando não há partida valendo (antes de começar ou depois do fim) */
function rematchKey(meId: string | undefined, scene: SpaceScene | null) {
  const st = useSpace.getState();
  const zone = st.zone;
  if (zone === 0) {
    rematchDuel(meId);
    return;
  }
  if (zone === 7) {
    const vsBot = useBotPlay.getState().race;
    if (vsBot) {
      if (vsBot.closed) playZone(7, scene);
      return;
    }
    // uma tecla não pode largar de novo por cima de quem ainda está correndo (o menu continua podendo)
    const race = st.session?.race;
    const stale = race ? Date.now() - race.startAt > RACE_STALE_MS : true;
    if (!racingNow(meId) && (!race || race.closed || stale)) playZone(7, scene);
    return;
  }
  if (isMatchZone(zone)) playZone(zone, scene);
}

export function SpaceView({ channelId, serverId }: { channelId: string; serverId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SpaceScene | null>(null);
  const [scene, setScene] = useState<SpaceScene | null>(null);
  const space = useSpace((s) => s.spaces[serverId]);
  const editing = useSpace((s) => s.editing);
  const me = useData((s) => s.me);
  // a lista da voz é estável entre mudanças; derivar aqui (um seletor que cria objetos novos a cada leitura
  // faz o React re-renderizar sem parar — erro #185)
  const voiceParticipants = useVoice((s) => s.participants);
  // ensurdecido: o som do jogo cala junto
  const deafened = useVoice((s) => s.selfDeaf);
  useEffect(() => setSfxDeafened(deafened), [deafened]);
  const participants = useMemo(
    () =>
      voiceParticipants.map((p) => ({ identity: p.identity, name: p.name, speaking: p.speaking, isLocal: p.isLocal })),
    [voiceParticipants],
  );
  const [slow, setSlow] = useState(false);
  const [prompt, setPrompt] = useState<{ label: string; action: 'interact' | 'primary' } | null>(null);
  /** estado do jogo que não é ação (sinuca: de quem é a vez) */
  const [status, setStatus] = useState<string | null>(null);
  /** placar segurado (Tab) */
  const [tabBoard, setTabBoard] = useState(false);
  const [charge, setCharge] = useState<number | null>(null);
  /** faixa verde do arremesso (rules.goodBand: encolhe com a distância e com marcador perto) */
  const [band, setBand] = useState<{ lo: number; hi: number } | null>(null);
  const [aimLocked, setAimLocked] = useState(false);
  /** cursor solto pelo botão do meio (sem menu) */
  const [cursorFree, setCursorFree] = useState(false);
  /** o sistema não deixou prender o mouse: joga arrastando; a pausa abre pelo botão */
  const [noLock, setNoLock] = useState(false);
  const [paused, setPaused] = useState(false);
  /** aba pedida para o menu (o botão Jogos da barra abre direto nos jogos); null = a da zona */
  const [menuTab, setMenuTab] = useState<MenuTab | null>(null);
  /** Esc fechou o menu com o mouse solto: fica só a faixa "voltar ao jogo" até um clique prender o mouse */
  const [dismissed, setDismissed] = useState(false);
  /** o menu foi pedido de propósito (Esc com o mouse solto, botão Jogos): abre mesmo no x1 e na corrida */
  const [forced, setForced] = useState(false);
  /** o mouse foi solto para usar um menu do jogo (telão, música): não é pausa */
  const menuFree = useRef(false);
  const screenMenu = useSpace((s) => s.screenMenu);
  const musicOpen = useMusic((m) => m.open);
  const [, forceRender] = useState(0);
  // fechou o menu (escolheu ou clicou fora): volta a prender o mouse na visão
  useEffect(() => {
    if (!menuFree.current || screenMenu || musicOpen) return;
    menuFree.current = false;
    sceneRef.current?.lockPointer();
    forceRender((n) => n + 1);
  }, [screenMenu, musicOpen]);
  const allDuels = useAllDuels();
  const myFight = useMemo(
    () =>
      Object.values(allDuels).find(
        (d) => (d.status === 'countdown' || d.status === 'fighting') && (d.a === me?.id || d.b === me?.id),
      ),
    [allDuels, me?.id],
  );
  const fighting = Boolean(myFight);
  const [race, setRace] = useState<{ lap: number; item: boolean; boost: boolean; speed: number } | null>(null);
  const zone = useSpace((s) => s.zone);
  const botRace = useBotPlay((s) => s.race);
  const racing = useSpace((s) => s.zone === 7 && (s.raceLocalStart !== null || !!botRace) && racingNow(me?.id));
  // menu do jogo: aparece com o mouse solto (Esc) ou, sem trava, pela Pausa — nunca no editor nem nos menus do telão.
  // No x1 e na corrida o mouse solto não abre o menu (cobriria a luta): só a faixa; Esc de novo abre.
  const loose = !editing && !noLock && !aimLocked && !menuFree.current && !screenMenu;
  const menuOpen = !editing && (noLock ? paused : loose && (forced || (!dismissed && !fighting && !racing)));
  const strip = loose && !menuOpen;
  useEffect(() => {
    if (!aimLocked) return;
    setDismissed(false);
    setForced(false);
    setMenuTab(null);
  }, [aimLocked]);
  const hasMatch = zone !== 0 || Boolean(myFight);
  const closeMenu = () => {
    // Esc não conta como gesto: o navegador não deixa prender o mouse agora; a faixa pede o clique
    if (noLock) setPaused(false);
    else {
      setDismissed(true);
      setForced(false);
    }
    setMenuTab(null);
    host.current?.focus({ preventScroll: true });
  };
  // Esc com o menu fechado e o mouse solto (faixa na tela): abre o menu
  const escState = useRef({ menuOpen, loose, noLock, cursorFree });
  escState.current = { menuOpen, loose, noLock, cursorFree };
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target !== el) return;
      const st = escState.current;
      if (st.menuOpen) return;
      if (st.cursorFree) {
        // cursor solto pelo botão do meio: Esc abre o menu como de costume
        menuFree.current = false;
        setCursorFree(false);
        setForced(true);
        setDismissed(false);
      } else if (st.noLock) setPaused(true);
      else if (st.loose) {
        setForced(true);
        setDismissed(false);
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);
  const [counts, setCounts] = useState<Record<number, number>>({});
  useEffect(() => {
    if (!menuOpen) return;
    const read = () => setCounts(sceneRef.current?.zoneCounts() ?? {});
    read();
    const t = window.setInterval(read, 1000);
    return () => window.clearInterval(t);
  }, [menuOpen]);
  const resume = () => {
    setPaused(false);
    setMenuTab(null);
    setForced(false);
    if (noLock) {
      // sem trava até agora: Continuar tenta prender o mouse de novo
      setNoLock(false);
      sceneRef.current?.retryLock();
    } else sceneRef.current?.lockPointer();
    host.current?.focus({ preventScroll: true });
  };
  const toggles = useSpace((s) => s.session?.toggles);

  // a cena nasce uma vez por chamada; ambiente, pessoas e telão chegam depois
  useEffect(() => {
    const el = host.current;
    if (!el || !me) return;
    const s = new SpaceScene(el, me.id, me.displayName, {
      audioLevel: (id) => useVoice.getState().engine()?.audioLevel(id) ?? 0,
      sendPose: (p) => useSession.getState().realtime?.sendVolatile('space:move', { channelId, ...p }),
      setGain: (id, g) => useVoice.getState().engine()?.setSpatialGain(id, g),
      onFps: (fps) => setSlow(fps < 24),
      onPrompt: (p) => setPrompt(p),
      onStatus: (t) => setStatus(t),
      onScoreboard: (held) => setTabBoard(held),
      onRematch: () => rematchKey(me.id, sceneRef.current),
      onHelp: () => useTutorial.getState().togglePanel(),
      onFreeCursor: () => {
        // cursor solto pelo botão do meio: nada de menu, só a faixa (clique volta ao jogo)
        menuFree.current = true;
        setCursorFree(true);
        if (document.pointerLockElement) document.exitPointerLock();
      },
      onCharge: (c, b) => {
        setCharge(c);
        setBand(b ?? null);
      },
      onAimLock: (locked) => {
        setAimLocked(locked);
        // voltou a prender o mouse (clicou na cena): o menu do telão fecha
        if (locked) {
          menuFree.current = false;
          setCursorFree(false);
          if (useSpace.getState().screenMenu) useSpace.getState().setScreenMenu(false);
        }
      },
      onLockFailed: () => {
        setNoLock(true);
        setPaused(false);
        useUi
          .getState()
          .toast('info', 'Não foi possível prender o mouse na visão: arraste com o mouse para olhar em volta.');
      },
      sendPool: (m) => useSession.getState().realtime?.sendVolatile('space:pool', { channelId, ...m }),
      onRace: setRace,
      onRaceFinish: (ms) => void useSpace.getState().finishRace(ms),
      sendBall: (z, b) => useSession.getState().realtime?.sendVolatile('space:ball', { channelId, zone: z, ...b }),
      onScore: (z, side, points, by, teams) => useSpace.getState().score(z, side, points, by, teams),
      onPunch: (strong) => {
        const d = Object.values(useSpace.getState().duels).find(
          (x) => x.status === 'fighting' && (x.a === me.id || x.b === me.id),
        );
        if (d) useSpace.getState().punch(d.id, strong);
      },
      onAcceptKey: () => {
        const d = Object.values(useSpace.getState().duels).find((x) => x.status === 'pending' && x.b === me.id);
        if (!d) return false;
        void useSpace.getState().answerDuel(d.id, true);
        return true;
      },
      onAction: (i) => {
        if (i.kind === 'toggle') void useSpace.getState().toggle(i.itemId, !i.on);
        else if (i.kind === 'duel') void useSpace.getState().challenge(i.itemId);
        else if (i.kind === 'screen') {
          // menu precisa do cursor: solta o mouse da visão (sem abrir a pausa) até escolher
          menuFree.current = true;
          if (document.pointerLockElement) document.exitPointerLock();
          useSpace.getState().setScreenMenu(true);
        } else if (i.kind === 'music') {
          menuFree.current = true;
          if (document.pointerLockElement) document.exitPointerLock();
          const m = useMusic.getState();
          if (m.state) m.join(true);
          else m.setOpen(true);
        }
      },
    });
    sceneRef.current = s;
    setScene(s);
    // quem abriu o espaço acabou de clicar: tenta já prender o mouse na visão (sem gesto, o aviso pede um clique)
    s.lockPointer(false);
    useSpace.setState({ ballListener: (b) => s.remoteBall(b), poolListener: (m) => s.remotePool(m) });
    el.focus({ preventScroll: true });
    return () => {
      s.dispose();
      useBotPlay.getState().stop();
      useSpace.setState({ ballListener: null, poolListener: null });
      useVoice.getState().engine()?.clearSpatialGains();
      sceneRef.current = null;
      setScene(null);
    };
  }, [channelId, me]);

  useEffect(() => {
    if (scene && space && !editing) scene.setLayout(space.layout, true);
  }, [scene, space, editing]);

  useEffect(() => {
    scene?.setParticipants(participants);
  }, [scene, participants]);

  useEffect(() => {
    scene?.setToggles(toggles ?? {});
  }, [scene, toggles]);

  const team = useSpace((s) => s.team);
  useEffect(() => {
    scene?.setZone(zone as 0 | SportZone, useSpace.getState().team);
    host.current?.focus({ preventScroll: true });
  }, [scene, zone]);
  useEffect(() => {
    scene?.setTeam(team);
  }, [scene, team]);
  // treino contra bot: o bot entra na cena da zona dele; trocar de zona tira o bot
  const bot = useBotPlay((s) => s.bot);
  useEffect(() => {
    scene?.setBot(bot);
  }, [scene, bot, zone]);
  useEffect(() => {
    const b = useBotPlay.getState().bot;
    if (b && b.zone !== zone) useBotPlay.getState().stop();
  }, [zone]);
  const botNotice = useBotPlay((s) => s.notice);
  useEffect(() => {
    if (!botNotice) return;
    useUi.getState().toast('info', botNotice);
    useBotPlay.setState({ notice: null });
  }, [botNotice]);

  const serverRaceStart = useSpace((s) => s.raceLocalStart);
  const serverLaps = useSpace((s) => s.session?.race?.laps ?? 3);
  const raceLocalStart = botRace ? botRace.startAt : serverRaceStart;
  const raceLaps = botRace ? botRace.laps : serverLaps;
  useEffect(() => {
    scene?.setRace(raceLocalStart, raceLaps);
  }, [scene, raceLocalStart, raceLaps, zone]);

  useDuelScene(scene);

  // partida da arena (P2): a cena sabe a fase para travar o saque na contagem e sacar sozinho em jogo
  const match = useSpace((s) => s.session?.matches?.[String(zone)]);
  const matchGo = useSpace((s) => s.matchLocalStart[String(zone)]);
  const botMatch = useBotPlay((s) => (s.match?.zone === zone ? s.match : null));
  useEffect(() => {
    if (!scene) return;
    if (botMatch) {
      // contra o bot: a fase local (a contagem vira jogo no VAI)
      const left = botMatch.goAt - Date.now();
      scene.setMatch(botMatchPhase(botMatch, Date.now()));
      if (botMatch.phase !== 'countdown' || left <= 0) return;
      const t = setTimeout(() => scene.setMatch('playing'), left);
      return () => clearTimeout(t);
    }
    if (!isMatchZone(zone) || !match) return scene.setMatch(null);
    const phase = matchPhase(match, Date.now());
    if (match.phase !== 'countdown') return scene.setMatch(phase);
    // contagem: vira "em jogo" no VAI (no meu relógio, como a largada da corrida)
    const left = (matchGo ?? Date.now()) - Date.now();
    if (left <= 0) return scene.setMatch('playing');
    scene.setMatch('countdown');
    const t = setTimeout(() => scene.setMatch('playing'), left);
    return () => clearTimeout(t);
  }, [scene, zone, match, matchGo, botMatch]);

  const matchCountdownAt = botMatch
    ? botMatch.phase === 'countdown'
      ? botMatch.goAt
      : null
    : match?.phase === 'countdown'
      ? (matchGo ?? null)
      : null;

  /** chama o bot no nível (null tira): a partida contra ele começa com a contagem */
  const pickBot = (level: BotLevel | null) => {
    const st = useBotPlay.getState();
    if (!level || !me) {
      st.stop();
      return;
    }
    st.start({
      zone,
      level,
      me: me.id,
      team: useSpace.getState().team,
      ...(zone === 0 && sceneRef.current ? { ring: sceneRef.current.botRingSpot() } : {}),
    });
    sceneRef.current?.newMatch();
    resume();
  };

  const onSource = useCallback((src: ScreenSource) => sceneRef.current?.setScreen(src), []);
  // muda quando a cena nasce: o alvo do tutorial chega nela mesmo se o passo começou antes
  const onTarget = useCallback(
    (t: Parameters<SpaceScene['setTutorialTarget']>[0]) => scene?.setTutorialTarget(t),
    [scene],
  );
  const controlsOpen = useTutorial((t) => t.learned.panel);

  return (
    <div className="space3d">
      <div className="space3d-host" ref={host} aria-label="Espaço 3D. Use W, A, S e D para andar." />
      <TelaoSource onSource={onSource} />
      {!editing && zone === 0 && <TelaoControls />}
      <SpaceBar
        serverId={serverId}
        onGames={() => {
          setMenuTab('games');
          if (noLock) setPaused(true);
          else {
            setForced(true);
            setDismissed(false);
            if (document.pointerLockElement) document.exitPointerLock();
          }
        }}
      />
      <LiveRegion />
      {!editing && zone === 0 && <DuelHud aimLocked={aimLocked} />}
      {!editing && zone !== 0 && zone !== 7 && (
        <SportHud zone={zone as SportZone} charge={charge} band={band} status={status} />
      )}
      {!editing && zone !== 0 && zone !== 7 && !menuOpen && (
        <MatchEnd
          zone={zone as SportZone}
          onRematch={() => playZone(zone, sceneRef.current)}
          onLeave={() => useSpace.getState().setZone(0)}
        />
      )}
      {!editing && zone !== 0 && <PointBanner bus={scene?.events ?? null} zone={zone} />}
      {!editing && zone !== 0 && zone !== 7 && <BigCountdown goAt={matchCountdownAt} sound />}
      {!editing && zone === 7 && <RaceHud hud={race} />}
      {!editing && zone === 7 && !menuOpen && <RaceEnd onAgain={() => playZone(7, sceneRef.current)} />}
      {!editing && tabBoard && zone !== 0 && !menuOpen && <HeldScoreboard zone={zone} />}
      {!editing && !menuOpen && prompt && (
        <button
          className="space3d-prompt"
          onClick={() => {
            sceneRef.current?.interact();
            host.current?.focus({ preventScroll: true });
          }}
        >
          <Binding action={prompt.action} /> {prompt.label}
        </button>
      )}
      {!editing && me && (
        <TutorialHud
          game={tutorialKey(zone, fighting)}
          events={scene?.events ?? null}
          inputs={scene?.inputs ?? null}
          me={me.id}
          team={team}
          hidden={menuOpen}
          onTarget={onTarget}
        />
      )}
      {!editing && !menuOpen && (
        <ControlsPanel
          zone={zone}
          fighting={fighting}
          open={controlsOpen}
          onToggle={() => useTutorial.getState().togglePanel()}
        />
      )}
      {!editing && aimLocked && <LockHint fighting={fighting} />}
      {strip && <LockStrip />}
      {cursorFree && !aimLocked && !editing && !menuOpen && <LockStrip free />}
      {menuOpen && (
        <GameMenu
          tab={menuTab ?? (hasMatch ? 'match' : 'games')}
          zone={zone}
          counts={counts}
          place={space ? SPACE_THEME_LABELS[space.layout.theme] : ''}
          match={
            <MatchPanel
              zone={zone}
              fight={myFight ? { duelId: myFight.id } : null}
              others={Math.max(0, (counts[zone] ?? 1) - 1)}
              onBot={pickBot}
              onPlay={() => {
                playZone(zone, sceneRef.current);
                resume();
              }}
            />
          }
          onResume={resume}
          onHowTo={() => {
            useTutorial.getState().restart(tutorialKey(zone, fighting));
            resume();
          }}
          onClose={closeMenu}
          onPick={(z) => {
            if (z !== zone) useSpace.getState().setZone(z);
            resume();
          }}
          onLeave={() => useSpace.getState().close()}
        />
      )}
      {!editing && noLock && !paused && (
        <button className="space3d-gbtn space3d-pausebtn" onClick={() => setPaused(true)}>
          Pausa
        </button>
      )}
      {slow && !editing && (
        <p className="space3d-slow">O espaço está pesado neste computador: feche-o enquanto joga.</p>
      )}
      {editing && scene && space && <EditorPanel scene={scene} serverId={serverId} />}
      {!space && <div className="space3d-loading">Carregando o espaço…</div>}
    </div>
  );
}

function SpaceBar({ serverId, onGames }: { serverId: string; onGames: () => void }) {
  const editing = useSpace((s) => s.editing);
  const screen = useSpace((s) => s.session?.screen ?? null);
  const theme = useSpace((s) => s.spaces[serverId]?.layout.theme);
  const canEdit = useData(() => canEditSpace(serverId));
  const menu = useSpace((s) => s.screenMenu);
  const setMenu = (v: boolean | ((m: boolean) => boolean)) =>
    useSpace.getState().setScreenMenu(typeof v === 'function' ? v(useSpace.getState().screenMenu) : v);
  const voiceParticipants = useVoice((s) => s.participants);
  const streamers = useMemo(
    () => voiceParticipants.filter((p) => p.hasScreen).map((p) => ({ id: p.identity, name: p.name })),
    [voiceParticipants],
  );
  const activity = useActivity((a) => a.state);

  const pick = (s: Parameters<ReturnType<typeof useSpace.getState>['setScreen']>[0]) => {
    setMenu(false);
    void useSpace.getState().setScreen(s);
  };
  const current =
    screen?.kind === 'stream'
      ? `Live de ${streamers.find((s) => s.id === screen.userId)?.name ?? 'alguém'}`
      : screen?.kind === 'activity'
        ? (activity?.title ?? 'Vídeo do Assistir juntos')
        : 'Nada no telão';

  const zone = useSpace((s) => s.zone);
  if (editing) return null;
  return (
    <div className="space3d-bar">
      <span className="space3d-title">
        <Icon name="activities" size={16} /> Espaço 3D
        {theme && <span className="muted small">{SPACE_THEME_LABELS[theme]}</span>}
      </span>
      <Button size="sm" variant="secondary" icon="gamepad" onClick={onGames}>
        {zone ? SPORT_LABELS[zone as SportZone] : 'Jogos'}
      </Button>
      {zone === 0 && (
        <div className="space3d-menu-wrap">
          <Button size="sm" variant="secondary" icon="screen" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            Telão: {current}
          </Button>
          {menu && (
            <ul className="space3d-menu" role="menu">
              <li>
                <button role="menuitem" onClick={() => pick(null)}>
                  Nada
                </button>
              </li>
              {streamers.map((s) => (
                <li key={s.id}>
                  <button role="menuitem" onClick={() => pick({ kind: 'stream', userId: s.id })}>
                    <Icon name="screen" size={16} /> Live de {s.name}
                  </button>
                </li>
              ))}
              <li>
                {activity ? (
                  <button role="menuitem" onClick={() => pick({ kind: 'activity' })}>
                    <Icon name="play" size={16} /> {activity.title ?? 'Vídeo do Assistir juntos'}
                  </button>
                ) : (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      void useSpace.getState().setScreen({ kind: 'activity' });
                      useUi.getState().openModal({ kind: 'watch-together' });
                    }}
                  >
                    <Icon name="play" size={16} /> Escolher um vídeo do YouTube…
                  </button>
                )}
              </li>
              {!streamers.length && <li className="muted small space3d-menu-note">Ninguém está ao vivo na chamada.</li>}
            </ul>
          )}
        </div>
      )}
      <span className="space3d-spacer" />
      {canEdit && zone === 0 && (
        <Button size="sm" variant="secondary" icon="edit" onClick={() => useSpace.getState().setEditing(true)}>
          Editar espaço
        </Button>
      )}
      <Button size="sm" variant="ghost" icon="close" onClick={() => useSpace.getState().close()}>
        Sair do espaço
      </Button>
    </div>
  );
}

function EditorPanel({ scene, serverId }: { scene: SpaceScene; serverId: string }) {
  const space = useSpace((s) => s.spaces[serverId])!;
  const [, bump] = useState(0);
  const [ed] = useState(() => new SpaceEditor(scene, space.layout, () => bump((n) => n + 1)));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    scene.setMode('edit');
    return () => {
      ed.dispose();
      scene.setMode('play');
    };
  }, [scene, ed]);

  const d = ed.draft;
  const sel = ed.selection;
  const item = sel?.kind === 'item' ? d.items.find((i) => i.id === sel.id) : undefined;
  const wall = sel?.kind === 'wall' ? d.walls[sel.index] : undefined;
  const leave = async () => {
    if (
      ed.dirty &&
      !(await askConfirm('As mudanças que você fez no espaço serão perdidas.', {
        title: 'Sair sem salvar?',
        confirmLabel: 'Sair sem salvar',
        danger: true,
      }))
    )
      return;
    scene.setLayout(space.layout, true);
    useSpace.getState().setEditing(false);
  };
  const save = async () => {
    setSaving(true);
    const ok = await useSpace.getState().save(serverId, ed.draft, space.revision);
    setSaving(false);
    if (ok) useSpace.getState().setEditing(false);
  };

  return (
    <aside className="space3d-editor" aria-label="Editor do espaço">
      <header>
        <strong>Editar espaço</strong>
        <span className="muted small">
          Um clique seleciona e arrastar move. R gira, Delete apaga, Ctrl+Z desfaz. Botão direito ou WASD movem a
          câmera.
        </span>
      </header>

      <div className="space3d-tools" role="group" aria-label="Ferramenta">
        <button aria-pressed={ed.tool === 'select'} onClick={() => ed.setTool('select')}>
          <Icon name="cursor" size={16} active={ed.tool === 'select'} /> Selecionar
        </button>
        <button aria-pressed={ed.tool === 'wall'} onClick={() => ed.setTool('wall')}>
          <Icon name="edit" size={16} active={ed.tool === 'wall'} /> Desenhar parede
        </button>
        <button disabled={!ed.canUndo} onClick={() => ed.undo()} aria-label="Desfazer">
          <Icon name="refresh" size={16} /> Desfazer
        </button>
      </div>

      {item && (
        <section className="space3d-section">
          <h4>{SPACE_ITEM_LABELS[item.kind]}</h4>
          <div className="space3d-row">
            <Button size="sm" variant="secondary" onClick={() => ed.rotateSelected(-Math.PI / 4)}>
              Girar ⟲
            </Button>
            <Button size="sm" variant="secondary" onClick={() => ed.rotateSelected(Math.PI / 4)}>
              Girar ⟳
            </Button>
            <Button size="sm" variant="secondary" icon="copy" onClick={() => ed.duplicate()}>
              Duplicar
            </Button>
            <Button size="sm" variant="danger" icon="trash" onClick={() => ed.removeSelected()}>
              Apagar
            </Button>
          </div>
          <Swatches value={item.color ?? null} onChange={(c) => ed.recolorSelected(c)} label="Cor" />
        </section>
      )}
      {wall && (
        <section className="space3d-section">
          <h4>Parede</h4>
          <Slider
            label="Altura"
            min={0.5}
            max={6}
            step={0.1}
            value={wall.h}
            format={(v) => `${v.toFixed(1)} m`}
            onChange={(v) => ed.setWallHeight(Math.round(v * 10) / 10)}
          />
          <Button size="sm" variant="danger" icon="trash" onClick={() => ed.removeSelected()}>
            Apagar parede
          </Button>
        </section>
      )}

      <section className="space3d-section">
        <h4>Colocar</h4>
        <div className="space3d-catalog">
          {SPACE_ITEM_KINDS.map((k) => (
            <button key={k} onClick={() => ed.addItem(k)}>
              {SPACE_ITEM_LABELS[k]}
            </button>
          ))}
        </div>
        <span className="muted small">A peça aparece no centro da câmera.</span>
      </section>

      <section className="space3d-section">
        <h4>Ambiente</h4>
        <Select<SpaceTheme>
          label="Tema"
          value={d.theme}
          options={SPACE_THEMES.map((t) => ({ value: t, label: SPACE_THEME_LABELS[t] }))}
          onChange={(t) => ed.setLook({ theme: t })}
        />
        <Slider
          label="Largura"
          min={8}
          max={60}
          step={2}
          value={d.width}
          format={(v) => `${v} m`}
          onChange={(v) => ed.setSize(v, d.depth)}
        />
        <Slider
          label="Profundidade"
          min={8}
          max={60}
          step={2}
          value={d.depth}
          format={(v) => `${v} m`}
          onChange={(v) => ed.setSize(d.width, v)}
        />
        <Swatches value={d.floorColor} onChange={(c) => ed.setLook({ floorColor: c })} label="Piso" />
        <Swatches value={d.wallColor} onChange={(c) => ed.setLook({ wallColor: c })} label="Paredes" />
        <div className="space3d-row">
          <Button size="sm" variant="secondary" onClick={() => ed.setSpawnHere()}>
            Entrada aqui
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="refresh"
            onClick={() => ed.replace(generateSpace(`${serverId}:${Date.now()}`))}
          >
            Gerar outro
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void askConfirm('A edição salva será apagada e o espaço volta ao ambiente gerado para o servidor.', {
                title: 'Restaurar o original?',
                confirmLabel: 'Restaurar',
                danger: true,
              }).then(async (ok) => {
                if (!ok) return;
                await useSpace.getState().reset(serverId);
                useSpace.getState().setEditing(false);
              })
            }
          >
            Restaurar original
          </Button>
        </div>
      </section>

      <footer>
        <Button variant="ghost" onClick={() => void leave()}>
          Cancelar
        </Button>
        <Button icon="check" disabled={saving || !ed.dirty} onClick={() => void save()}>
          {saving ? 'Salvando…' : 'Salvar para todos'}
        </Button>
      </footer>
    </aside>
  );
}

function Swatches({ value, onChange, label }: { value: string | null; onChange: (c: string) => void; label: string }) {
  return (
    <div className="space3d-swatches" role="radiogroup" aria-label={label}>
      <span className="small">{label}</span>
      <div>
        {SWATCHES.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={value === c}
            aria-label={c}
            style={{ background: c }}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </div>
  );
}

const fmtTime = (sec: number) => {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

/** Controles do que está no telão: vídeo do YouTube (grupo ou só para mim) ou volume da live. */
function TelaoControls() {
  const screen = useSpace((s) => s.session?.screen ?? null);
  const activity = useActivity((a) => a.state);
  const meId = useData((s) => s.me?.id);
  const p = useTelaoPlayer();
  const liveVolume = useVoice((v) => (screen?.kind === 'stream' ? (v.screenVolume[screen.userId] ?? 1) : 1));
  const ownerName = useVoice((v) =>
    activity ? (v.participants.find((x) => x.identity === activity.startedBy)?.name ?? 'quem pôs o vídeo') : '',
  );
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubTimer = useRef<number | undefined>(undefined);
  // a posição do grupo anda sozinha: redesenha a barra 2x por segundo
  const [, tick] = useState(0);
  useEffect(() => {
    if (screen?.kind !== 'activity') return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [screen?.kind]);

  if (screen?.kind === 'stream') {
    const muted = liveVolume === 0;
    return (
      <div className="space3d-player" role="group" aria-label="Som da live no telão">
        <button
          className="space3d-pbtn"
          aria-label={muted ? 'Ativar som da live' : 'Silenciar a live'}
          data-tip={muted ? 'Ativar som' : 'Silenciar'}
          onClick={() => useVoice.getState().setScreenVolume(screen.userId, muted ? 1 : 0)}
        >
          <Icon name={muted ? 'speaker-off' : 'speaker'} size={18} />
        </button>
        <div className="space3d-pvol">
          <Slider
            aria-label="Volume da live"
            min={0}
            max={200}
            value={Math.round(liveVolume * 100)}
            format={(v) => `${v}%`}
            onChange={(v) => useVoice.getState().setScreenVolume(screen.userId, v / 100)}
          />
        </div>
      </div>
    );
  }
  if (screen?.kind !== 'activity' || !activity) return null;

  const owner = activity.startedBy === meId;
  const groupPausedForMe = !owner && !activity.playing;
  const playing = owner ? activity.playing : activity.playing && !p.localPaused;
  const position = scrub ?? (p.localPaused ? p.currentTime : useActivity.getState().expectedPosition());
  const duration = p.duration || 0;
  const seek = (to: number) =>
    void useActivity.getState().control('seek', Math.max(0, duration ? Math.min(duration - 1, to) : to));
  const toggle = () => {
    if (groupPausedForMe) return;
    if (owner)
      void useActivity
        .getState()
        .control(activity.playing ? 'pause' : 'play', useActivity.getState().expectedPosition());
    else p.set({ localPaused: !p.localPaused });
  };
  const toggleLabel = owner
    ? activity.playing
      ? 'Pausar para todos'
      : 'Tocar para todos'
    : groupPausedForMe
      ? `Pausado por ${ownerName}`
      : p.localPaused
        ? 'Voltar a assistir (alcança o grupo)'
        : 'Pausar só para você';

  return (
    <div className="space3d-player" role="group" aria-label="Controles do vídeo no telão">
      <button
        className="space3d-pbtn"
        aria-label={toggleLabel}
        data-tip={toggleLabel}
        disabled={groupPausedForMe}
        onClick={toggle}
      >
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      {owner && (
        <>
          <button
            className="space3d-pbtn space3d-ptext"
            aria-label="Voltar 10 segundos"
            onClick={() => seek(position - 10)}
          >
            −10 s
          </button>
          <button
            className="space3d-pbtn space3d-ptext"
            aria-label="Avançar 10 segundos"
            onClick={() => seek(position + 10)}
          >
            +10 s
          </button>
        </>
      )}
      <span className="space3d-ptime">{fmtTime(position)}</span>
      <div className="space3d-pbar">
        <Slider
          aria-label={owner ? 'Posição do vídeo (para todos)' : 'Posição do vídeo'}
          min={0}
          max={Math.max(1, Math.round(duration))}
          value={Math.min(Math.round(position), Math.max(1, Math.round(duration)))}
          format={fmtTime}
          disabled={!owner || !duration}
          onChange={(v) => {
            // pula quando a pessoa para de arrastar (não manda um comando por pixel)
            setScrub(v);
            window.clearTimeout(scrubTimer.current);
            scrubTimer.current = window.setTimeout(() => {
              seek(v);
              setScrub(null);
            }, 350);
          }}
        />
      </div>
      <span className="space3d-ptime">{duration ? fmtTime(duration) : '--:--'}</span>
      <button
        className="space3d-pbtn"
        aria-label={p.muted || p.volume === 0 ? 'Ativar som' : 'Silenciar'}
        data-tip={p.muted || p.volume === 0 ? 'Ativar som' : 'Silenciar'}
        onClick={() => p.set({ muted: !p.muted })}
      >
        <Icon name={p.muted || p.volume === 0 ? 'speaker-off' : 'speaker'} size={18} />
      </button>
      <div className="space3d-pvol">
        <Slider
          aria-label="Volume do vídeo (só para você)"
          min={0}
          max={100}
          value={p.muted ? 0 : p.volume}
          format={(v) => `${v}%`}
          onChange={(v) => p.set({ volume: v, muted: false })}
        />
      </div>
      <button
        className="space3d-pbtn space3d-ptext"
        aria-pressed={p.captions}
        aria-label={p.captions ? 'Desligar legendas' : 'Ligar legendas'}
        data-tip={p.captions ? 'Desligar legendas' : 'Ligar legendas'}
        onClick={() => p.set({ captions: !p.captions })}
      >
        Legendas
      </button>
    </div>
  );
}

/** Placar da arena (azul ataca para um lado, vermelho para o outro), força do arremesso e como jogar. */
const TARGET: Record<SportZone, [string, string]> = {
  1: ['a cesta vermelha', 'a cesta azul'],
  2: ['o gol vermelho', 'o gol azul'],
  3: ['o lado vermelho', 'o lado azul'],
  4: ['o lado vermelho', 'o lado azul'],
  5: ['o lado vermelho da mesa', 'o lado azul da mesa'],
  6: ['', ''],
  7: ['', ''],
};

function SportHud({
  zone,
  charge,
  band,
  status,
}: {
  zone: SportZone;
  charge: number | null;
  band: { lo: number; hi: number } | null;
  /** selo fixo de estado (sinuca: de quem é a vez) */
  status: string | null;
}) {
  const team = useSpace((s) => s.team);
  const sweet = charge !== null && !!band && charge >= band.lo && charge <= band.hi;
  return (
    <>
      <div className="space3d-game" role="region" aria-label={SPORT_LABELS[zone]}>
        <div className="space3d-game-title">{SPORT_LABELS[zone]}</div>
        <MatchScore zone={zone} />
        {zone === 6 && status && (
          <span className="space3d-status" data-mine={status === 'Sua vez' ? 'true' : undefined}>
            {status}
          </span>
        )}
        <div className="space3d-myteam-line" data-team={team}>
          <span>
            Você: <strong>{team === 'a' ? 'Azul' : 'Vermelho'}</strong>
            {zone === 6 ? ' · encaçapou, joga de novo' : ` · ataque ${TARGET[zone][team === 'a' ? 0 : 1]}`}
          </span>
        </div>
        <div className="space3d-game-hint">
          <span>
            <kbd>Esc</kbd> partida e times
          </span>
          <span>
            <Binding action="scoreboard" hold /> placar
          </span>
        </div>
      </div>
      {charge !== null && (
        <div
          className="space3d-charge"
          role="meter"
          aria-label="Força"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(charge * 100)}
        >
          {zone === 1 && band && (
            <span
              className="space3d-charge-sweet"
              style={{ left: `${band.lo * 100}%`, width: `${(band.hi - band.lo) * 100}%` }}
            />
          )}
          <span
            className="space3d-charge-fill"
            data-sweet={zone === 1 && sweet ? 'true' : undefined}
            style={{ width: `${charge * 100}%` }}
          />
        </div>
      )}
    </>
  );
}

const fmtRace = (ms: number) => {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = ((t % 60000) / 1000).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

/**
 * Corrida: contagem grande, volta, tempo, velocidade e turbo guardado (com a tecla da Ação). O cronômetro fica fora
 * da região viva; o fim (pódio e DNF) é o RaceEnd. Jogar / Nova corrida ficam no menu (Esta partida) e no atalho.
 */
function RaceHud({ hud }: { hud: { lap: number; item: boolean; boost: boolean; speed: number } | null }) {
  const race = useRace();
  const botStart = useBotPlay((s) => s.race?.startAt ?? null);
  const serverStart = useSpace((s) => s.raceLocalStart);
  const localStart = botStart ?? serverStart;
  const meId = useData((s) => s.me?.id);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();
  const running = localStart !== null && now >= localStart;
  const mine = race?.results.find((r) => r.userId === meId);
  const out = Boolean(race?.closed) || (race?.dnf ?? []).includes(meId ?? '');
  return (
    <>
      <BigCountdown goAt={localStart} />
      <div className="space3d-score">
        {running && !mine && !out ? (
          <>
            <span>
              Volta <strong>{hud?.lap ?? 1}</strong>/{race?.laps ?? 3}
            </span>
            <span className="space3d-ptime">{fmtRace(now - localStart)}</span>
            <span className="space3d-ptime">{hud?.speed ?? 0} km/h</span>
            {hud?.boost && <strong className="space3d-boost">TURBO</strong>}
            {hud?.item && !hud.boost && (
              <span className="space3d-item">
                <Binding action="primary" /> turbo guardado
              </span>
            )}
          </>
        ) : localStart !== null && now < localStart ? (
          <span>Prepare-se: acelere no VAI</span>
        ) : (
          <span className="space3d-game-hint">
            {race ? 'Corrida encerrada para você' : 'Ninguém correndo ainda'}
            {(!race || race.closed) && (
              <>
                {' · '}
                <span>
                  <Binding action="rematch" /> {race ? 'nova corrida' : 'jogar'}
                </span>
              </>
            )}
          </span>
        )}
      </div>
    </>
  );
}
