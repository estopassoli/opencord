import type { IconName } from '@opencord/ui';

/**
 * Linha do tempo de novidades (tela "Novidades" da página inicial). Mais nova primeiro.
 * Ao lançar algo que o usuário perceba, acrescente uma entrada aqui (texto para quem usa, não mensagem de commit).
 */
export type ChangeKind = 'novo' | 'melhoria' | 'correção';

export interface ChangeEntry {
  /** AAAA-MM-DD */
  date: string;
  /** HH:MM (opcional, para ordenar entradas do mesmo dia) */
  time?: string;
  kind: ChangeKind;
  icon: IconName;
  title: string;
  body: string;
}

export const CHANGELOG: ChangeEntry[] = [
  {
    date: '2026-10-29',
    time: '19:15',
    kind: 'novo',
    icon: 'speaker',
    title: 'Volume da transmissão no botão direito',
    body: 'Clique com o botão direito numa live para ajustar o volume dela (só para você), silenciar, abrir em nova janela ou parar de assistir.',
  },
  {
    date: '2026-10-29',
    time: '19:10',
    kind: 'correção',
    icon: 'screen',
    title: 'Ver a live dos outros enquanto você transmite',
    body: 'As outras transmissões aparecem na faixa de baixo; um clique assiste e coloca em destaque.',
  },
  {
    date: '2026-10-29',
    time: '18:55',
    kind: 'novo',
    icon: 'bell',
    title: 'Novidades na tela inicial',
    body: 'Esta linha do tempo: o que entrou no OpenCord, em ordem. O app abre aqui.',
  },
  {
    date: '2026-10-29',
    time: '18:49',
    kind: 'novo',
    icon: 'activities',
    title: 'Atividades na chamada: Assistir juntos (YouTube)',
    body: 'Botão Atividades na chamada. Cole um link do YouTube e todos assistem sincronizados, cada um no player oficial: tocar, pausar e pular valem para o grupo.',
  },
  {
    date: '2026-10-29',
    time: '18:30',
    kind: 'melhoria',
    icon: 'download',
    title: 'Atualização em um clique',
    body: 'Ao clicar em "Atualização pronta" o app fecha, mostra só o progresso e reabre na versão nova, sem assistente de instalação.',
  },
  {
    date: '2026-10-29',
    time: '18:13',
    kind: 'novo',
    icon: 'upload',
    title: 'Importar servidor do Discord',
    body: 'Criar servidor → Importar do Discord: cole o link do modelo do servidor e traga categorias, canais, cargos e permissões.',
  },
  {
    date: '2026-10-29',
    time: '18:06',
    kind: 'novo',
    icon: 'folder',
    title: 'Criar categoria e menu na lista de canais',
    body: 'Botão direito no espaço livre da lista de canais: criar canal, criar categoria, expandir ou recolher todas.',
  },
  {
    date: '2026-10-29',
    time: '18:04',
    kind: 'correção',
    icon: 'chevron-down',
    title: 'Categorias recolhem de verdade',
    body: 'Recolher uma categoria esconde também os canais de voz, e o estado fica salvo.',
  },
  {
    date: '2026-10-29',
    time: '18:00',
    kind: 'correção',
    icon: 'maximize',
    title: 'Arrastar a janela pela barra inteira',
    body: 'A barra de título arrasta (e desmaximiza) também à esquerda do título.',
  },
  {
    date: '2026-10-29',
    time: '17:47',
    kind: 'melhoria',
    icon: 'refresh',
    title: 'Atualizações chegam mais rápido',
    body: 'O app verifica a cada 20 minutos e ao voltar para a janela; há "Verificar atualizações" em Configurações → Sobre.',
  },
  {
    date: '2026-10-29',
    time: '17:40',
    kind: 'novo',
    icon: 'speaker',
    title: 'Efeitos sonoros',
    body: 'Sons próprios ao entrar e sair da voz, quando alguém entra, ao mutar, na transmissão e em mensagens. Volume em Notificações.',
  },
  {
    date: '2026-10-29',
    time: '17:31',
    kind: 'novo',
    icon: 'popout',
    title: 'Transmissão em janela separada e seletor novo',
    body: 'Abra a live numa janela própria, oculte os membros para deixar só a transmissão e escolha o que transmitir em miniaturas grandes.',
  },
  {
    date: '2026-10-29',
    time: '16:58',
    kind: 'melhoria',
    icon: 'screen',
    title: 'Live pela placa de vídeo',
    body: 'O H.264 da transmissão passou a ser codificado pela GPU (NVENC e afins), com mais bitrate em cenas pesadas e áudio sempre junto.',
  },
  {
    date: '2026-10-29',
    time: '16:29',
    kind: 'correção',
    icon: 'eye',
    title: 'A live parou de piscar',
    body: 'O vídeo não é mais reconectado a cada fala ou mute na chamada.',
  },
  {
    date: '2026-10-29',
    time: '16:03',
    kind: 'novo',
    icon: 'download',
    title: 'Atualização automática',
    body: 'O app de Windows avisa quando há versão nova, baixa sozinho e mostra "Atualização pronta" na barra de título.',
  },
  {
    date: '2026-10-29',
    time: '15:37',
    kind: 'novo',
    icon: 'users',
    title: 'Perfil e menu nas pessoas da voz',
    body: 'Clique em quem está na voz para ver o perfil; botão direito para volume, silenciar só para você e moderação.',
  },
  {
    date: '2026-10-29',
    time: '15:29',
    kind: 'novo',
    icon: 'microphone',
    title: 'Supressão de ruído forte',
    body: 'O microfone passa pelo RNNoise: some barulho de casa, ventilador e teclado.',
  },
  {
    date: '2026-10-29',
    time: '15:03',
    kind: 'correção',
    icon: 'speaker',
    title: 'Ouvir quem está na chamada',
    body: 'O áudio das outras pessoas passou a tocar em todas as plataformas.',
  },
  {
    date: '2026-10-29',
    time: '14:36',
    kind: 'novo',
    icon: 'download',
    title: 'Apps para Windows, macOS e Linux',
    body: 'Instaladores para as três plataformas no botão de download.',
  },
  {
    date: '2026-10-29',
    time: '14:06',
    kind: 'novo',
    icon: 'menu',
    title: 'OpenCord no celular',
    body: 'O app no navegador se adapta ao celular, com gavetas de canais e membros.',
  },
  {
    date: '2026-10-29',
    time: '06:15',
    kind: 'novo',
    icon: 'server',
    title: 'OpenCord nasce',
    body: 'Servidores abertos, canais de texto, mensagens diretas, chamadas de voz com vídeo, transmissão de tela com áudio (Go Live), aparência personalizável e entrada só com apelido.',
  },
];
