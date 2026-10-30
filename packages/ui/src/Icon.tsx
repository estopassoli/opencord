import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  AddCircleIcon,
  Alert02Icon,
  AppWindowIcon,
  ArrowDown01Icon,
  ArrowExpand01Icon,
  ArrowRight01Icon,
  ArrowTurnBackwardIcon,
  ArrowUp01Icon,
  AtIcon,
  Attachment01Icon,
  AudioWave01Icon,
  BellOffIcon,
  CallEnd01Icon,
  Cancel01Icon,
  CheckmarkBadge01Icon,
  ComputerIcon,
  Copy01Icon,
  DashboardSquare01Icon,
  Delete02Icon,
  Download01Icon,
  Film01Icon,
  Folder01Icon,
  FullScreenIcon,
  HashtagIcon,
  Home01Icon,
  InboxIcon,
  Link01Icon,
  LockIcon,
  Logout01Icon,
  Mail01Icon,
  Megaphone01Icon,
  Menu01Icon,
  Message01Icon,
  MessageMultiple01Icon,
  Mic01Icon,
  MicOff01Icon,
  Minimize01Icon,
  Moon02Icon,
  MoreHorizontalIcon,
  Notification01Icon,
  PauseIcon,
  PencilEdit01Icon,
  PlayIcon,
  PlusSignIcon,
  Refresh01Icon,
  Search01Icon,
  SentIcon,
  ServerStack01Icon,
  Settings01Icon,
  ShapesIcon,
  Shield01Icon,
  SignalFull01Icon,
  SmileIcon,
  SquareArrowDownLeftIcon,
  SquareArrowUpRightIcon,
  StopIcon,
  Sun03Icon,
  Tick02Icon,
  UnavailableIcon,
  Upload01Icon,
  UserAdd01Icon,
  UserCircleIcon,
  UserGroupIcon,
  UserMultipleIcon,
  UserRemove01Icon,
  Video01Icon,
  VideoOffIcon,
  ViewIcon,
  ViewOffIcon,
  VolumeHighIcon,
  VolumeOffIcon,
  Wifi01Icon,
} from '@hugeicons/core-free-icons';

/**
 * Ícones do app: Hugeicons (conjunto gratuito, MIT, estilo contorno arredondado), pedido do mantenedor.
 * O conjunto gratuito não tem variante sólida: no hover/foco e nos estados ativos (aria-pressed, aria-current…)
 * o traço engrossa suavemente (ver icon.css), respeitando "reduzir movimento".
 */
const ICONS = {
  hashtag: HashtagIcon,
  speaker: VolumeHighIcon,
  'speaker-off': VolumeOffIcon,
  microphone: Mic01Icon,
  camera: Video01Icon,
  'camera-off': VideoOffIcon,
  screen: ComputerIcon,
  settings: Settings01Icon,
  users: UserMultipleIcon,
  group: UserGroupIcon,
  plus: PlusSignIcon,
  'plus-circle': AddCircleIcon,
  hangup: CallEnd01Icon,
  emoji: SmileIcon,
  attach: Attachment01Icon,
  reply: ArrowTurnBackwardIcon,
  edit: PencilEdit01Icon,
  trash: Delete02Icon,
  close: Cancel01Icon,
  bell: Notification01Icon,
  'bell-off': BellOffIcon,
  chats: MessageMultiple01Icon,
  chat: Message01Icon,
  signal: SignalFull01Icon,
  maximize: FullScreenIcon,
  minimize: Minimize01Icon,
  grid: DashboardSquare01Icon,
  spotlight: ArrowExpand01Icon,
  lock: LockIcon,
  'chevron-down': ArrowDown01Icon,
  'chevron-up': ArrowUp01Icon,
  film: Film01Icon,
  pause: PauseIcon,
  activities: ShapesIcon,
  popout: SquareArrowUpRightIcon,
  popin: SquareArrowDownLeftIcon,
  window: AppWindowIcon,
  'chevron-right': ArrowRight01Icon,
  mail: Mail01Icon,
  logout: Logout01Icon,
  shield: Shield01Icon,
  verified: CheckmarkBadge01Icon,
  soundboard: Megaphone01Icon,
  noise: AudioWave01Icon,
  user: UserCircleIcon,
  link: Link01Icon,
  more: MoreHorizontalIcon,
  search: Search01Icon,
  eye: ViewIcon,
  'eye-off': ViewOffIcon,
  block: UnavailableIcon,
  'user-plus': UserAdd01Icon,
  'user-minus': UserRemove01Icon,
  check: Tick02Icon,
  warning: Alert02Icon,
  inbox: InboxIcon,
  wifi: Wifi01Icon,
  home: Home01Icon,
  send: SentIcon,
  refresh: Refresh01Icon,
  stop: StopIcon,
  play: PlayIcon,
  copy: Copy01Icon,
  moon: Moon02Icon,
  sun: Sun03Icon,
  folder: Folder01Icon,
  server: ServerStack01Icon,
  download: Download01Icon,
  upload: Upload01Icon,
  menu: Menu01Icon,
  'at-symbol': AtIcon,
} satisfies Record<string, IconSvgElement>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps {
  name: IconName;
  size?: number;
  /** Força o traço de destaque (estado ativo fora de um elemento interativo). */
  active?: boolean;
  /** Estado "desligado": o microfone tem ícone próprio; os demais ganham um traço diagonal. */
  slashed?: boolean;
  /** Rótulo acessível; sem ele o ícone é decorativo (aria-hidden). */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 20, active, slashed, label, className }: IconProps) {
  const ownOff = slashed && name === 'microphone';
  const icon = ownOff ? MicOff01Icon : ICONS[name];
  return (
    <span
      className={className ? `oc-icon ${className}` : 'oc-icon'}
      style={{ ['--oc-icon-size' as string]: `${size}px` }}
      data-active={active ? 'true' : undefined}
      data-slashed={slashed && !ownOff ? 'true' : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <HugeiconsIcon icon={icon} size={size} strokeWidth={1.5} aria-hidden focusable={false} />
    </span>
  );
}
