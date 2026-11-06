-- Gerado por scripts/changelog-forum-sql.mjs (214 novidades). Não editar à mão.
\set ON_ERROR_STOP on
SELECT set_config('oc.pwhash', :'pwhash', false);
BEGIN;

CREATE TEMP TABLE oc_posts (id uuid, request_id uuid, created_at timestamptz, title text, body text) ON COMMIT DROP;
INSERT INTO oc_posts VALUES
('01a1b083-f380-7be2-b655-20c1339e96bd'::uuid, '7e2060a4-d526-5735-bccd-f8813a8e8029'::uuid, '2026-11-06T11:00:00.000Z'::timestamptz, 'Novidades também no fórum #novidades', '**Novo**
Tudo o que entra no OpenCord agora também é publicado pela conta @opencord no canal #novidades do servidor oficial, em formato de fórum: cada novidade é um post, e dá para responder, tirar dúvidas e reagir em cada uma.'),
('01a1b056-2cc0-7fdd-a5b1-6cdabc4e9f11'::uuid, '9ef522be-49e4-5b40-a3cd-04c9d688962f'::uuid, '2026-11-06T10:10:00.000Z'::timestamptz, 'Canal de fórum', '**Novo**
Crie um canal do tipo Fórum: cada post tem título e as respostas ficam penduradas nele, sem se misturar com outros assuntos. A lista mostra quantas respostas cada post tem e sobe para o topo o que está mais movimentado.'),
('01a1b04d-0500-7e7e-8485-965655600a44'::uuid, '0bd1a5f7-0efa-55c6-9313-10839996e314'::uuid, '2026-11-06T10:00:00.000Z'::timestamptz, 'Modo lento', '**Novo**
Quem gerencia o servidor pode ligar o modo lento num canal de texto ou fórum (de 5 segundos a 6 horas entre duas mensagens da mesma pessoa). Acima da caixa de mensagem aparece quanto falta para poder escrever de novo; moderadores não esperam.'),
('01a1b031-8dc0-7bc3-a73a-92b0d4da3600'::uuid, 'b31ec7cf-c106-56e3-b9bf-1b56a5fbc3ef'::uuid, '2026-11-06T09:30:00.000Z'::timestamptz, 'Atualização automática', '**Novo**
Quando sai uma versão nova, o OpenCord baixa e instala sozinho: ao fechar o app ou quando você fica um tempo longe do computador, nunca durante uma chamada ou com um jogo aberto. Se estava na bandeja, ele volta para a bandeja já atualizado. Quer na hora? Use "Reiniciar e atualizar agora". Antes de instalar, o app confere se o arquivo é o mesmo que o servidor publicou.'),
('01a1b028-6600-70cc-8410-359586fca835'::uuid, 'ae957003-9ffd-5d9d-affe-7557a371185e'::uuid, '2026-11-06T09:20:00.000Z'::timestamptz, 'Modo streamer', '**Novo**
Com Go Live ou com OBS, Streamlabs, XSplit ou Twitch Studio aberto, o OpenCord esconde seu e-mail, os códigos de convite e o texto das notificações (e, se você quiser, os sons de aviso). Dá para deixar sempre ligado ou desligado em Configurações → Modo streamer; um ícone na barra de cima mostra quando ele está ativo.'),
('01a1b01f-3e40-7352-a0a7-b09c50b2e766'::uuid, '346253b0-ae78-524f-b66e-cec86d8d1445'::uuid, '2026-11-06T09:10:00.000Z'::timestamptz, 'Lembretes de mensagem', '**Novo**
Clique direito numa mensagem → Lembrar-me: daqui a 20 minutos, 1 hora, 3 horas ou amanhã às 9h. Na hora, chega uma notificação com o atalho para a mensagem. Os lembretes ficam na sua conta e aparecem em Configurações → Notificações.'),
('01a1b016-1680-7b69-8e85-106ccf459430'::uuid, 'eaa63788-25a0-5f6d-aaf1-5a09a2a48ef4'::uuid, '2026-11-06T09:00:00.000Z'::timestamptz, 'Palavras-chave', '**Novo**
Escolha até 20 palavras (seu apelido, "raid", o nome do seu time) em Configurações → Notificações. Quando alguém escrever uma delas num canal que você vê, você é avisado como numa menção — sem ligar para acento ou maiúscula.'),
('01a1b00c-eec0-7f8a-950b-3369a8632e57'::uuid, '9d64815e-84fa-57fa-b887-d16e52046bdb'::uuid, '2026-11-06T08:50:00.000Z'::timestamptz, 'Silenciar servidor ou canal', '**Novo**
Clique direito num servidor ou canal → Silenciar por 15 minutos, 1 hora, 8 horas, 24 horas ou até reativar. Em Notificações, escolha também "todas as mensagens", "só @menções" ou "nada" só para você. Silenciado, ele para de avisar e sai do destaque (menções diretas ainda contam).'),
('01a1b003-c700-7708-83c8-a73ab41b02c2'::uuid, 'b2c2cbaa-f7c2-5f66-a0b0-859019c7af1c'::uuid, '2026-11-06T08:40:00.000Z'::timestamptz, 'Faixa de mensagens novas', '**Melhoria**
Ao abrir um canal com coisa nova, uma faixa no topo mostra quantas mensagens chegaram e desde quando: clique para ir até a primeira ou em "Marcar como lido". A linha "Novas" agora aparece mesmo quando a última que você leu já é antiga.'),
('01a1afdf-2800-7ac0-b760-d796c2711348'::uuid, '79b3933b-88d7-51c4-a14d-faddcd110a91'::uuid, '2026-11-06T08:00:00.000Z'::timestamptz, 'Overlay mais fácil de ler', '**Melhoria**
O fundo dos nomes e dos avisos no overlay do jogo ficou mais escuro, para ler melhor por cima de qualquer cena.'),
('01a1afcc-d880-7960-9368-d2e0fd36d9a1'::uuid, '93f846bb-ac7e-5971-bbf4-578bcd44ac75'::uuid, '2026-11-06T07:40:00.000Z'::timestamptz, 'Clipes não param no meio da partida', '**Correção**
Quando o jogo entra em tela cheia ou muda a resolução, a gravação dos clipes volta sozinha em poucos segundos em vez de parar até você trocar de jogo. Se a placa de vídeo falhar, o OpenCord recria a gravação (no processador, se precisar). E, se o clipe não sair, o aviso no jogo diz o motivo.'),
('01a1ac02-6300-7e20-8bf0-628e99e7bc30'::uuid, '1f995d41-a855-5b1d-b716-8433236d7bd4'::uuid, '2026-11-05T14:00:00.000Z'::timestamptz, 'Configurações do usuário com cara nova', '**Melhoria**
As configurações ganharam uma barra lateral com sua foto e status, seções com ícone agrupadas (Você, App e Sistema), busca para achar uma opção pelo nome e botão de sair no rodapé. Cada seção mostra no topo o que dá para fazer nela, e as opções ficam em cartões.'),
('01a1abe6-ebc0-7151-8f25-62a7c8024d80'::uuid, 'd6e63687-c5b7-5171-92ec-697eb495335b'::uuid, '2026-11-05T13:30:00.000Z'::timestamptz, 'Overlay no jogo mais discreto e completo', '**Correção**
O overlay por cima do jogo agora tem fundo translúcido (o jogo aparece por trás) e mostra o tempo da chamada, a foto de perfil e a cor do cargo de cada pessoa, além do mesmo apelido que aparece na lista de canais.'),
('01a1abcb-7480-7f2c-87e7-c672eaed8258'::uuid, '9a3e73bf-8407-59d0-ab66-645959436a5c'::uuid, '2026-11-05T13:00:00.000Z'::timestamptz, 'Esconder a lista de canais', '**Novo**
O botão ao lado de "Convidar pessoas" (ou o do pé da barra de servidores) esconde a lista de canais e deixa mais espaço para a chamada ou o chat. Com ela escondida, passar o mouse na barra de servidores abre, junto do ícone do servidor, quem está no seu canal de voz, com o tempo da chamada, os botões de microfone, áudio e sair, e "Mostrar canais" para trazer a lista de volta. No computador.'),
('01a1abaf-fd40-796b-ac48-a87d2a9e12d9'::uuid, 'ed9f23af-5c46-5af2-bf09-d4e343efac5c'::uuid, '2026-11-05T12:30:00.000Z'::timestamptz, 'Tempo da chamada nos canais de voz', '**Novo**
Canais de voz com gente mostram, ao lado do nome, há quanto tempo a chamada está rolando. O tempo conta desde que o canal deixou de estar vazio e não zera quando quem entrou primeiro sai: só recomeça quando todo mundo sai.'),
('01a1ab94-8600-77d8-a267-aa2af15d8dd1'::uuid, '0517cdd1-7bd1-5884-84cd-6a21c384f8f7'::uuid, '2026-11-05T12:00:00.000Z'::timestamptz, 'Microfone volta como estava ao sair do canal de ausentes', '**Melhoria**
O canal de ausentes desliga o microfone, mas agora o app lembra como ele estava antes. Ao ir para outro canal (ou sair da chamada), o microfone volta ligado se estava ligado, ou continua desligado se você já estava mudo.'),
('01a1ab79-0ec0-7023-a665-2db6d9b56f85'::uuid, '7b70ad50-1d0a-5cdf-8f6d-53c5ea999f2f'::uuid, '2026-11-05T11:30:00.000Z'::timestamptz, 'Menus de clique direito sempre dentro da janela', '**Correção**
Submenus como "Cargos" passavam da borda de baixo da janela quando o menu abria perto do fim da tela. Agora o submenu sobe o necessário para aparecer inteiro, e o menu principal também nunca fica cortado.'),
('01a1ab5d-9780-75c6-8194-f232b554f38e'::uuid, 'c37ad0ef-f853-534b-a49a-540108aea057'::uuid, '2026-11-05T11:00:00.000Z'::timestamptz, 'Canal de ausentes sem áudio', '**Melhoria**
No canal de ausentes ninguém fala, liga câmera ou transmite: o microfone fica desligado para todo mundo que estiver lá, inclusive para quem entrou por conta própria. Para voltar a falar, é só entrar em outro canal.'),
('01a1ab42-2040-769b-99bd-bb325a6d3302'::uuid, 'd6412b43-8f75-5ff1-abf0-0bdffb25aa1c'::uuid, '2026-11-05T10:30:00.000Z'::timestamptz, 'Arraste canais para reordenar', '**Novo**
Quem pode gerenciar canais agora arrasta um canal de texto ou de voz na lista para mudar a ordem. Soltar em outra categoria (ou no nome dela) leva o canal para lá. Uma linha mostra onde ele vai entrar, e todo mundo vê a nova ordem na hora. Por enquanto, só com mouse (no computador ou no navegador).'),
('01a1ab26-a900-7ac5-9f76-4ab30419b94d'::uuid, '0e2ab284-21af-5d73-80df-e5337bbf3ca9'::uuid, '2026-11-05T10:00:00.000Z'::timestamptz, 'Configurações do servidor com cara nova', '**Melhoria**
As configurações do servidor ganharam uma barra lateral com a imagem e o nome do servidor, seções com ícone e contadores (canais, emojis, membros e cargos), um topo que explica cada seção e o conteúdo organizado em cartões. No celular, as seções viram uma faixa de abas no alto.'),
('01a1aaef-ba80-7f64-b1fa-e548280d6ff3'::uuid, 'b484ea87-c07c-5aa9-9501-df8c7375aae2'::uuid, '2026-11-05T09:00:00.000Z'::timestamptz, 'Aba Canais redesenhada', '**Melhoria**
Em Configurações do servidor → Canais, a lista dos canais fica à esquerda, por categoria, com busca e marcas de privado, quadro kanban e criador de salas. Ao escolher um canal, o painel ao lado mostra nome, tópico, categoria, quadro e canal privado, com um só botão Salvar alterações e a exclusão separada. Clicar numa categoria permite renomear ou excluir. Canais, Membros, Convites e Registro de auditoria agora usam uma área mais larga.'),
('01a1aadd-6b00-732d-b3a6-e7b2f7e5cf85'::uuid, '440f1d6c-f2e1-5e62-b7f2-ba965443cd0d'::uuid, '2026-11-05T08:40:00.000Z'::timestamptz, 'GIF na imagem e na faixa do servidor', '**Melhoria**
Em Configurações do servidor → Perfil do servidor, o botão Escolher GIF abre o seletor de GIFs para a imagem do servidor e para a faixa. O OpenCord guarda uma cópia, então o GIF continua animado para todo mundo.'),
('01a1aacb-1b80-7a54-8832-9f1ace44762a'::uuid, '798cb23f-2a99-5d85-a76d-9639ce5bad7f'::uuid, '2026-11-05T08:20:00.000Z'::timestamptz, 'Bio e status no celular', '**Correção**
Ao editar a bio ou o status pelo celular, usar o tradutor, a área de transferência ou a voz do teclado não fecha mais o campo nem joga o texto para fora dele. O campo só fecha quando você toca fora, e o preenchimento automático do aparelho não aparece mais ali.'),
('01a1aab8-cc00-7eb6-975e-260e884e8473'::uuid, 'a7e936dd-bb5a-5c53-b821-00d62dcc5705'::uuid, '2026-11-05T08:00:00.000Z'::timestamptz, 'Emojis personalizados', '**Novo**
Cada servidor pode ter até 50 emojis próprios, animados também, de graça. Quem administra envia em Configurações do servidor → Emoji. No chat, escreva :nome: ou use o novo botão de emojis do campo de mensagem; dá para usar os emojis de qualquer servidor seu em qualquer conversa, e eles também aparecem nas reações.'),
('01a1aa9d-54c0-7ae2-aeff-3ab64d712091'::uuid, '37894169-ec8c-5cbc-a27b-4865fb70b11d'::uuid, '2026-11-05T07:30:00.000Z'::timestamptz, 'Convites com validade e membros em tabela', '**Melhoria**
Em Configurações do servidor, a nova aba Convites mostra todos os convites (quem criou, quantos usos, quando vence), deixa criar um convite que vence ou que só vale para algumas pessoas, apagar convites e pausar a entrada por convite. Membros virou uma tabela com busca, filtro por cargo, data de entrada e o convite que cada um usou; Banidos ganhou busca e o Registro de auditoria ganhou filtros por pessoa e tipo de ação.'),
('01a1aa81-dd80-7230-a96f-37e6998339ac'::uuid, '0b19dc9c-78ed-535b-a710-2865d24d32e2'::uuid, '2026-11-05T07:00:00.000Z'::timestamptz, 'Servidores com perfil, faixa e boas-vindas', '**Novo**
As configurações do servidor agora vêm agrupadas e ganharam a página Perfil do servidor: uma faixa (10 cores ou uma imagem, GIF animado também vale) que aparece no topo da lista de canais e no convite, até 5 características com emoji e uma descrição, com prévia ao vivo. Em Engajamento dá para escolher o canal das mensagens do sistema e dar boas-vindas a quem entra, definir se o servidor avisa só menções ou todas as mensagens, e colocar um fundo no convite. Tudo grátis, para qualquer servidor.'),
('01a1aa4a-ef00-7d07-b07c-6bd5574e8f25'::uuid, '4345e195-a949-51c7-822f-278c127b814d'::uuid, '2026-11-05T06:00:00.000Z'::timestamptz, 'Canal de ausentes', '**Novo**
Quem administra um servidor pode escolher um canal de ausentes e um limite (de 1 minuto a 1 hora) em Configurações do servidor. Quem ficar numa chamada sem mexer no computador e sem falar por esse tempo vai sozinho para lá, com o microfone silenciado. Vale para quem usa o app para computador.'),
('01a1aa38-9f80-7dc8-b014-fd97c10ca5a8'::uuid, '6cc6f79d-9665-5ad1-ba64-5c43a985275d'::uuid, '2026-11-05T05:40:00.000Z'::timestamptz, 'Janelas mais legíveis por cima da live', '**Melhoria**
Janelas, páginas e o visualizador de imagens agora desfocam o que fica atrás deles (a live, o chat, o fundo), e no visual Vidro a página de clipes, o cartão da conta, o seletor de GIFs e o seletor de cor ganharam o mesmo vidro desfocado dos outros menus.'),
('01a1aa26-5000-7d41-b876-32b448cba7af'::uuid, '9225bb48-32e6-53a9-9a1e-ec7617c2b1f5'::uuid, '2026-11-05T05:20:00.000Z'::timestamptz, 'Mais atalhos em quem está na chamada', '**Melhoria**
No botão direito em você mesmo na lista da chamada: silenciar o microfone, desativar o áudio e mudar o seu apelido neste servidor. No cartão de perfil, a chamada mostra também o servidor, e quem gerencia cargos tem um botão + para dar ou tirar cargos ali mesmo.'),
('01a1aa14-0080-7386-8637-eaf618bedb7e'::uuid, 'c3f8a102-4712-5880-807f-dd5b27a0fa49'::uuid, '2026-11-05T05:00:00.000Z'::timestamptz, 'Página de clipes', '**Novo**
Todos os seus clipes num lugar só, separados por jogo, com miniatura, data e duração. A barra à esquerda filtra por jogo, e clicar num clipe abre o editor de sempre. Abra pelo seu cartão de conta, no canto de baixo (só no app para computador).'),
('01a1aa01-b100-79d4-9c34-5430f0db5311'::uuid, 'a73b9957-99dc-5846-8f3d-ef605208a7c7'::uuid, '2026-11-05T04:40:00.000Z'::timestamptz, 'Sua conta num cartão', '**Novo**
Clique na sua foto ou no seu nome no canto de baixo: abre o seu cartão de perfil, com banner, bio e insígnias, e logo embaixo os atalhos da conta (editar perfil, mudar o status, escrever o status personalizado, insígnias em destaque, configurações, copiar ID e sair).'),
('01a1a9ef-6180-7d48-852e-9bba877ce43a'::uuid, 'c2871680-b08e-5449-942d-4e8987fe91ec'::uuid, '2026-11-05T04:20:00.000Z'::timestamptz, 'Editar perfil a um clique', '**Melhoria**
Clique com o botão direito no seu nome (na lista da chamada, de membros ou no chat) e escolha "Editar perfil", ou use o botão no seu cartão de perfil: o editor abre direto.'),
('01a1a9dd-1200-7aaa-a95e-bec3779f896b'::uuid, '4c0836bc-d80c-5fdb-a331-f8f795f2b921'::uuid, '2026-11-05T04:00:00.000Z'::timestamptz, 'Escolha suas insígnias em destaque', '**Novo**
Em Configurações → Perfil, escolha até 3 das suas insígnias para aparecer ao lado do seu nome no chat, na lista de membros e agora também na lista de quem está na chamada. As outras continuam no seu cartão de perfil.'),
('01a1a9c1-9ac0-72e1-9af8-7cbc15ad26d6'::uuid, '6a3e7212-7e6c-5957-b056-af2cbba8af3b'::uuid, '2026-11-05T03:30:00.000Z'::timestamptz, 'Zoom nas transmissões', '**Novo**
Na live em destaque (e em tela cheia ou na janela separada), use a roda do mouse para dar zoom bem no ponto que quer ver e arraste para movimentar a imagem. Para voltar ao normal, afaste o zoom, dê dois cliques ou use o botão no topo.'),
('01a1a9af-4b40-7119-a6b8-b526bff9a57d'::uuid, 'e94c1efd-8814-5ce3-9cac-fa27971a09fb'::uuid, '2026-11-05T03:10:00.000Z'::timestamptz, 'Atalhos para os efeitos sonoros', '**Novo**
Dois atalhos novos, que funcionam até com o jogo em tela cheia: Ctrl+Shift+X para parar os efeitos sonoros que estão tocando e Ctrl+Shift+B para silenciar ou trazer de volta os efeitos (só para você). Dá para trocar as teclas em Configurações → Atalhos.'),
('01a1a981-8480-70fa-92ca-ec767f9ed470'::uuid, 'fade2f0c-d8c7-5112-8783-0837ec9bf269'::uuid, '2026-11-05T02:20:00.000Z'::timestamptz, 'Aviso certo ao entrar em chamada por outro aparelho', '**Correção**
Se você está numa chamada no computador e entra em outra pelo celular (ou o contrário), o aparelho que sai agora avisa "Você entrou em uma chamada em outro aparelho", em vez de "removido da chamada".'),
('01a1a96f-3500-7f93-813e-83500b7b733f'::uuid, '1cefaa17-59a4-5f2d-b33b-883e569b3303'::uuid, '2026-11-05T02:00:00.000Z'::timestamptz, 'Fila de músicas longa cabe no player', '**Correção**
Com muitas músicas na fila, o player da chamada agora fica do tamanho da tela e só a lista rola por dentro. Antes, as últimas músicas apareciam sem fundo, por cima de quem estava ao vivo.'),
('01a1a953-bdc0-7f52-a331-01e0795ee2b8'::uuid, '28736bf6-0fa6-533e-824c-9a49774d28fa'::uuid, '2026-11-05T01:30:00.000Z'::timestamptz, 'Seu perfil do seu jeito', '**Novo**
Em Configurações → Perfil: coloque um banner (imagem ou GIF), escolha duas cores que pintam o seu cartão inteiro, escreva uma bio e use um GIF como foto. Também dá para voltar a uma das suas últimas fotos com um clique. A prévia ao lado mostra como os outros vão ver, e nada muda até você salvar.'),
('01a1a91c-cf40-78ed-a38c-b95bba3f790f'::uuid, '37b08461-51cd-56c0-b57b-2b10f3b919df'::uuid, '2026-11-05T00:30:00.000Z'::timestamptz, 'Código de acesso por e-mail', '**Novo**
Agora dá para confirmar o e-mail da conta e usar a verificação em duas etapas com um código que chega no seu e-mail, em vez do app autenticador. Quem tem e-mail confirmado também recebe por e-mail o aviso de acesso de aparelho novo. Tudo fica em Configurações → Minha conta.'),
('01a1a8e5-e0c0-7cdd-8b57-130971c600e6'::uuid, 'b612fed3-a4d2-5833-a6bf-a8ac642b464e'::uuid, '2026-11-04T23:30:00.000Z'::timestamptz, 'Mais segurança na sua conta', '**Novo**
Em Configurações → Minha conta: ligue a verificação em duas etapas com um app autenticador do celular (o login passa a pedir um código, e você guarda códigos de recuperação para emergências) e veja os aparelhos conectados, podendo tirar qualquer um. Quando a sua conta entrar de um aparelho novo, o OpenCord avisa por mensagem direta.'),
('01a1a8d3-9140-7db6-84af-93686dfffaf3'::uuid, 'f8090a20-7719-57a1-929b-ed8ed32f2962'::uuid, '2026-11-04T23:10:00.000Z'::timestamptz, 'Botões da barra de servidores no rodapé', '**Melhoria**
Criar servidor e Explorar servidores agora ficam fixos no pé da barra de servidores. A lista de servidores rola acima deles, então os botões estão sempre à mão, mesmo com muitos servidores.'),
('01a1a8c1-41c0-7e63-97f2-cbdc6875ef51'::uuid, '99cc6b7d-fd28-5d9e-a6fe-3e7d1785a710'::uuid, '2026-11-04T22:50:00.000Z'::timestamptz, 'Fechar conversas diretas', '**Novo**
Passe o mouse numa conversa da lista de mensagens diretas e clique no X, ou use "Fechar conversa" no botão direito, para tirá-la da sua lista. Nada é apagado e a outra pessoa não fica sabendo. Se chegar mensagem nova, ou se você abrir a conversa pelo perfil, ela volta.'),
('01a1a8ae-f240-7e3f-9acb-8816858a2785'::uuid, '00bb8d29-e6ec-534b-9fa0-5ae4299f16d5'::uuid, '2026-11-04T22:30:00.000Z'::timestamptz, 'Resposta às suas ideias', '**Novo**
Quando a equipe de um servidor decide não seguir com uma ideia que você mandou para o quadro, você recebe uma mensagem direta do OpenCord explicando, com o motivo quando houver. São avisos automáticos, então essa conversa não aceita respostas.'),
('01a1a878-03c0-7965-8d4c-b35679935897'::uuid, '20d2557e-0964-5909-a1a1-313931ea2675'::uuid, '2026-11-04T21:30:00.000Z'::timestamptz, 'GIFs no chat', '**Novo**
O botão GIF, ao lado do campo de mensagem, abre um seletor com busca, GIFs em alta e categorias. Clique para enviar, e toque na estrela para guardar nos Favoritos, que acompanham você em todos os aparelhos. No chat, o GIF aparece animado.'),
('01a1a841-1540-7e34-8228-2f7d8800257a'::uuid, 'fdad59e7-886b-5fdc-9ac7-638f64088a69'::uuid, '2026-11-04T20:30:00.000Z'::timestamptz, 'Pular linha pelo celular', '**Correção**
No celular, o Enter do teclado agora pula linha, e a mensagem vai pelo botão de enviar, como nos apps de mensagem. Ao editar uma mensagem no celular, aparecem os botões Salvar e Cancelar. No computador nada muda: Enter envia e Shift+Enter pula linha.'),
('01a1a80a-26c0-7ee7-839e-ff4a45cb0e31'::uuid, '09531504-9bfe-5c1e-9d04-7d1ec12e1fff'::uuid, '2026-11-04T19:30:00.000Z'::timestamptz, 'Insígnias no perfil', '**Novo**
Agora as pessoas podem ganhar insígnias da equipe do OpenCord. Elas aparecem ao lado do nome no chat e na lista de membros (passe o mouse para ver o nome) e todas ficam no cartão de perfil, junto com o selo de verificado.'),
('01a1a7c0-e8c0-7a2b-8e67-3c89317724a5'::uuid, '12aa99bd-ec37-57e4-9a52-56b7983e2c9e'::uuid, '2026-11-04T18:10:00.000Z'::timestamptz, 'Vidro desfocado de verdade', '**Correção**
No visual Vidro, menus de contexto, cartões de perfil, janelas e painéis voltaram a desfocar o que fica atrás deles. Antes o texto de trás aparecia nítido através do menu e atrapalhava a leitura.'),
('01a1a3e4-23c0-7f54-b0e9-e1dc6baff2c8'::uuid, 'bca2add9-c34a-545f-8b2d-036f75655ba8'::uuid, '2026-11-04T00:10:00.000Z'::timestamptz, 'Responder no privado', '**Novo**
Gostou (ou não) de algo que alguém escreveu num canal? Use "Responder no privado" no menu da mensagem: abre a conversa direta com a pessoa já marcando a mensagem dela. Na DM, a citação mostra de qual canal veio e leva até a mensagem original com um clique.'),
('01a1a30c-fda0-7398-ad84-c62cb01ebbe8'::uuid, 'c84ad204-7f62-5fcd-849e-e7ceffbe1cb8'::uuid, '2026-11-03T20:15:00.000Z'::timestamptz, 'Chat carrega sem pulos', '**Melhoria**
Enquanto as mensagens carregam, o chat mostra o formato delas em cinza em vez de um texto solto. As imagens já ocupam o tamanho certo antes de chegar e aparecem suavemente, sem empurrar a conversa nem aparecer quebradas no meio do caminho. Se uma imagem não puder ser carregada, aparece um aviso no lugar.'),
('01a1a25a-7680-7ebd-93a8-0a5c32d37812'::uuid, 'da377f79-e5be-5c10-a85e-40e20a4aec8d'::uuid, '2026-11-03T17:00:00.000Z'::timestamptz, 'Spotify na música da chamada', '**Novo**
Na atividade Música, agora dá para pesquisar músicas, álbuns e playlists do Spotify, ou colar um link do Spotify, e tocar na call para todo mundo, sem precisar de conta Premium. A fila mostra capa, artista e álbum, com o atalho "Abrir no Spotify". Se alguma faixa não puder ser tocada, ela aparece marcada na fila e a música segue para a próxima.'),
('01a1a208-10c0-75e2-99a8-dda14822c54a'::uuid, 'd9133d20-ef69-5175-8b56-61ea6aa15c0b'::uuid, '2026-11-03T15:30:00.000Z'::timestamptz, 'Salas privadas', '**Novo**
Agora dá para trancar a sua sala: no canal que cria salas, "Criar sala trancada…" abre uma sala onde só entra quem você convidar. Clique com o botão direito na sua sala para trancar ou destrancar, convidar pessoas, limitar as vagas, renomear ou remover alguém. Quem não foi convidado vê o cadeado e pode pedir para entrar, e você libera com um toque. E quem administra o servidor pode criar canais privados, visíveis só para os cargos e as pessoas escolhidos.'),
('01a1a1b5-ab00-7d99-8c5a-b00620bbd894'::uuid, 'db581994-19ec-5878-9d8c-285d5588e222'::uuid, '2026-11-03T14:00:00.000Z'::timestamptz, 'Moderação automática mais justa', '**Melhoria**
A moderação automática deixou de segurar mensagens por engano: links (inclusive convites do OpenCord) publicam na hora, cada mensagem é julgada pelo que ela diz e não pelo que outras pessoas falaram antes, e zoeira, palavrão e discussão passam. Em mensagens diretas nada fica retido para revisão; só o que é realmente grave é bloqueado.'),
('01a1a17e-bc80-777c-99d0-80e6251dcf07'::uuid, 'a31886be-ab36-5c16-a0f9-5db0dc844681'::uuid, '2026-11-03T13:00:00.000Z'::timestamptz, 'Seus dados, nas suas mãos', '**Novo**
Publicamos os Termos de uso e a Política de privacidade, que contam o que o OpenCord guarda sobre você, por quanto tempo, como funciona a moderação automática e com quem nada é compartilhado. Em Configurações → Conta → Privacidade e dados você baixa tudo o que existe sobre você num arquivo e, se quiser, exclui a conta na hora: sessões, arquivos, foto, amizades e configurações somem; suas mensagens ficam nas conversas dos outros como "Usuário removido". O cadastro passa a pedir a confirmação de 13 anos ou mais, e quem já tem conta aceita uma vez ao abrir o app.'),
('01a19eeb-8e80-755f-b941-c06d1dba1528'::uuid, 'feb08376-ee98-5e99-915e-46182695a4b4'::uuid, '2026-11-03T01:00:00.000Z'::timestamptz, 'Conjuntos de efeitos sonoros', '**Novo**
Os sons do app ganharam um jeito novo, mais de chat: notas redondas, duas subindo para entrar e descendo para sair, "ding" com cauda na mensagem. Em Configurações → Notificações dá para trocar por Clássico, Suave, Retrô (8 bits), Madeira (marimba), Telefone ou Discreto, e ouvir cada um (entrar, sair, alguém entrou, mutar, mensagem, live) antes de decidir. O volume dos efeitos agora começa em 100%.'),
('01a19ed0-1740-7b54-84b4-6692b8b3f444'::uuid, 'c108eb55-9504-5da2-a7f2-c42f918208c2'::uuid, '2026-11-03T00:30:00.000Z'::timestamptz, 'Chamadas privadas', '**Novo**
Agora dá para ligar direto numa conversa, a dois ou em grupo: o botão de telefone no topo da conversa começa a chamada, quem está do outro lado recebe o aviso com "Atender", e a chamada aparece em cima da conversa com voz, câmera e transmissão de tela. Quem entrar na conversa depois vê quem está na chamada e entra pelo botão.'),
('01a19eb4-a000-7612-a89d-5b0de8f30b02'::uuid, 'de98ce2c-fc22-577a-a2d4-fa8446387650'::uuid, '2026-11-03T00:00:00.000Z'::timestamptz, 'Moderação automática', '**Novo**
Mensagens e arquivos passam por uma IA antes de aparecer no canal. Conversa normal entre amigos passa na hora; conteúdo claramente proibido é barrado com o motivo; em dúvida, o envio fica retido e os moderadores do servidor decidem (você é avisado do resultado). Quem gerencia o servidor pode escrever regras próprias em Configurações do servidor → Moderação, onde também fica a fila de revisão.'),
('01a19e99-28c0-78cc-9865-544d354e6228'::uuid, '20e7a713-a2e8-5533-9111-e96f58c39f6f'::uuid, '2026-11-02T23:30:00.000Z'::timestamptz, 'Atalhos com qualquer tecla', '**Melhoria**
Os atalhos (silenciar, ensurdecer, salvar clipe e pressionar para falar) aceitam qualquer tecla do teclado: Insert, Page Down, End, Scroll Lock, Caps Lock, teclado numérico, setas, teclas de mídia e pontuação. Letras, números e pontuação continuam pedindo Ctrl, Alt ou Shift para não atrapalhar a digitação em outros programas; as demais valem sozinhas. A tecla de pressionar para falar também passou a valer fora da janela, como alternância, quando é uma dessas teclas.'),
('01a19e7d-b180-782d-8cbd-e598983b9587'::uuid, '5d47dd1c-83b1-5707-9a88-1a2c4f608654'::uuid, '2026-11-02T23:00:00.000Z'::timestamptz, 'Celular: chamada em segundo plano e caminho de volta', '**Correção**
No navegador do celular, ao minimizar o app a voz dos outros parava e o seu microfone ficava mudo: o sistema suspende os processadores de áudio da página. Agora o áudio vai direto ao alto-falante, o microfone fica sempre aberto (sem gate de voz) e a chamada aparece como mídia na tela de bloqueio, com botão de desligar. Ao voltar para o app o microfone reabre sozinho. E a tela "Entrar na chamada" ganhou o menu para voltar aos canais e servidores.'),
('01a19e62-3a40-7c15-9e4a-e0e042cbf739'::uuid, '8cffb8ee-9d1a-52fc-b090-ae20c8f0f181'::uuid, '2026-11-02T22:30:00.000Z'::timestamptz, 'Instale no celular', '**Novo**
A versão no navegador virou um app instalável: no Android, toque em "Instalar o OpenCord" na barra de servidores (ou em Configurações → Sobre) e ele vai para a tela inicial, abrindo em tela cheia; no iPhone, use Compartilhar → "Adicionar à Tela de Início". Sem rede, o app abre e avisa que está reconectando.'),
('01a19e46-c300-7ac2-9483-24b2655815a5'::uuid, 'fb3aaaec-b85e-588a-901d-189661af1d67'::uuid, '2026-11-02T22:00:00.000Z'::timestamptz, 'Celular: gavetas, listas e chamada arrumadas', '**Correção**
No layout Vidro, o menu de servidores e canais e a lista de membros ficavam transparentes no celular e o chat vazava por trás; agora são opacos. O painel do usuário não cobre mais o fim das listas. Na chamada, a barra de controles cabe na tela (saem o seletor de microfone, atividades, efeitos e gravação), a transmissão em destaque fica na proporção certa com os participantes em grade embaixo, e o cabeçalho mostra só o canal e o selo AO VIVO.'),
('01a19d34-1a80-7b4c-a26d-d358bc4ab7f6'::uuid, 'aab10049-48e0-50c6-9b16-2a6513ab9062'::uuid, '2026-11-02T17:00:00.000Z'::timestamptz, 'Entrar só com apelido em destaque', '**Melhoria**
Na tela de entrada, "Entrar só com apelido" virou um botão com o mesmo peso do Entrar, em vez de um link pequeno. Quem for só dar uma olhada não precisa procurar.'),
('01a19d18-a340-7d62-bc2c-a209e62f73d2'::uuid, 'e47cfe22-069a-5f62-a67e-0a48cc0d47f7'::uuid, '2026-11-02T16:30:00.000Z'::timestamptz, 'Banir e castigo', '**Novo**
Quem tem as permissões novas "Banir membros" e "Castigar membros" encontra no botão direito da pessoa: Banir… (com motivo e opção de apagar as mensagens recentes) e Castigo (1 min a 1 semana). Banido não volta por convite até ser desbanido; a lista fica em Configurações do servidor → Banidos. Em castigo, a pessoa não escreve, não reage nem entra em voz, e o composer avisa até quando.'),
('01a19d0f-7b80-74fd-abd4-202d7caa0a94'::uuid, '8cabf9c1-a53f-5199-af20-a051c4c2b18d'::uuid, '2026-11-02T16:20:00.000Z'::timestamptz, 'Comandos de barra com subcomandos e autocompletar; menu Apps', '**Novo**
Bots podem registrar /comando grupo subcomando, opções de cargo e menção, limites de valor e sugestões enquanto você digita (o popover pergunta ao bot). Comandos de contexto aparecem em "Apps" no botão direito de uma pessoa ou de uma mensagem. Comandos com permissão mínima só aparecem para quem pode usar.'),
('01a19d06-53c0-7d07-97a3-8e3e99d27614'::uuid, '2baee426-bba3-5b3f-8ffd-b71be9cb0bce'::uuid, '2026-11-02T16:10:00.000Z'::timestamptz, 'Bots com cartões, botões, menus e formulários', '**Novo**
Mensagens de bots podem trazer cartões ricos (barra colorida, campos, imagem, rodapé), botões, menus de escolha (inclusive de pessoas, cargos e canais) e abrir formulários. Os cartões "Só você vê" também aceitam botões. Tudo com teclado e leitor de tela.'),
('01a19cc6-3d80-7e64-9f32-a71c30b778fb'::uuid, '5a01dc68-6906-51b3-9a72-ec76dff31485'::uuid, '2026-11-02T15:00:00.000Z'::timestamptz, 'Selo alinhado ao nome no chat', '**Correção**
O selo de verificado no cabeçalho da mensagem estava colado no nome e fora do centro. Agora tem um respiro e fica alinhado na altura do texto.'),
('01a19cb3-ee00-77a9-9787-a0cb744adb49'::uuid, 'dfdcdaf0-f1a1-5c8f-b4b0-468458dc63cc'::uuid, '2026-11-02T14:40:00.000Z'::timestamptz, 'Card de servidores em comum no Vidro', '**Correção**
No painel de perfil da conversa direta, o bloco "servidores em comum" estava com a borda colada no texto e sem cantos arredondados no layout Vidro. Agora tem o mesmo acabamento do bloco "Membro desde".'),
('01a19caa-c640-779f-8ca8-12319f4b8225'::uuid, 'f98e4650-ec10-5606-a757-b169080dcc91'::uuid, '2026-11-02T14:30:00.000Z'::timestamptz, 'Selo de verificado em perfis', '**Novo**
Quem administra a instância pode dar o selo de verificado a qualquer pessoa pelo painel do super admin (menu da pessoa → Dar selo de verificado). O selo aparece na lista de membros, na voz, nas mensagens e no perfil. É só um selo: não muda permissões.'),
('01a19920-6700-7d0b-bea2-93bef60a9453'::uuid, 'f1474b78-f835-51c1-b370-20611bfbe797'::uuid, '2026-11-01T22:00:00.000Z'::timestamptz, 'Ponte com o Slack', '**Novo**
Configurações do servidor → Slack liga um canal de texto a um canal do Slack: o que é escrito num aparece no outro, com o nome de quem escreveu. Precisa de um app do Slack configurado na instância (passo a passo em docs/SLACK.md).'),
('01a19904-efc0-70ef-ad62-b578a17ddc63'::uuid, 'c39f865e-807e-5fb9-a198-8bae6c870aeb'::uuid, '2026-11-01T21:30:00.000Z'::timestamptz, 'Bots: crie o seu', '**Novo**
Configurações → Aplicativos cria bots com token próprio; quem gerencia um servidor adiciona o bot em Configurações do servidor → Bots. Bots registram comandos de barra (digite / no chat), recebem mensagens em tempo real e respondem, inclusive só para você. O SDK @opencord-chat/bot usa os mesmos nomes do discord.js, então portar um bot costuma ser trocar o import e o token (guia em docs/BOTS.md).'),
('01a198e9-7880-748a-a582-a95ac5186abb'::uuid, '187cea84-43b3-5401-9acd-29e0a7e7a616'::uuid, '2026-11-01T21:00:00.000Z'::timestamptz, 'Galeria de temas', '**Novo**
Configurações → Aparência → Tema virou uma galeria com 16 temas: os quatro escuros de antes (Grafite, Meia-noite, OLED, Ardósia), oito novos (Ártico, Oceano, Floresta, Lavanda, Rosé, Brasa, Café, Neon) e quatro claros (Claro, Papel, Névoa, Menta). Cada um vem com a sua cor de destaque, que continua ajustável. No visual Vidro, a aurora do fundo muda de cor junto, e os temas claros ganharam um vidro leitoso.'),
('01a198ce-0140-7b70-bee3-fb9e63a7702e'::uuid, 'd0990bf4-10e2-5960-9427-26607d2fbdc7'::uuid, '2026-11-01T20:30:00.000Z'::timestamptz, 'Vidro: a live não "pula" mais quando quem transmite fala', '**Correção**
No visual Vidro, o card da transmissão dava uma encolhida e voltava toda vez que a pessoa parava de falar: a pulsação de fala trocava a animação de entrada do card, que rodava de novo. A pulsação agora é só um brilho na borda, e o card fica parado.'),
('01a198b2-8a00-7b4e-83d7-83ef188980f5'::uuid, '6e45a225-48a4-5d60-92f7-f777310f71d8'::uuid, '2026-11-01T20:00:00.000Z'::timestamptz, 'Vidro: memória sob controle', '**Correção**
O reflexo da borda dos painéis que acompanhava o mouse fazia a memória do app subir cerca de 1 GB por minuto de uso (o navegador recriava as camadas a cada movimento). O reflexo agora é fixo; o resto do visual continua igual. Medido: memória estável em teste de 1 minuto com o mouse em movimento.'),
('01a1987b-9b80-7933-841e-110abc8d91c6'::uuid, 'a87d3d82-ab73-5aad-8702-ffa53d1ae402'::uuid, '2026-11-01T19:00:00.000Z'::timestamptz, 'Memória sob controle e visível', '**Melhoria**
O buffer dos clipes ganhou um teto de memória (768 MB): se a placa de vídeo parar de mandar quadros-chave, ele descarta o mais antigo em vez de crescer sem fim. E em Configurações → Sobre → Memória dá para ver quanto cada processo do app está usando, com "Copiar" para mandar o relatório.'),
('01a19844-ad00-74f7-ab3a-f00329dc7af8'::uuid, '7fbc85fe-fc4e-5145-84c3-22fc8733b22b'::uuid, '2026-11-01T18:00:00.000Z'::timestamptz, 'Vidro: configurações em lâminas e aurora sempre viva', '**Melhoria**
Cada seção das Configurações virou uma lâmina de vidro, com as linhas de dentro planas (a tabela do Sobre, o teste de microfone, os atalhos, a importação de fonte); as listas suspensas ficaram planas, com o item escolhido na cor do servidor. O fundo de luz não para mais com um jogo aberto: só desacelera um pouco. E a tela de configurações desfoca menos o fundo.'),
('01a19829-35c0-7fcc-b8e9-b6d23b1fb773'::uuid, '9da773b7-7c9b-5478-913d-26324727317b'::uuid, '2026-11-01T17:30:00.000Z'::timestamptz, 'Soundboard abre em cima do botão', '**Correção**
O painel de efeitos sonoros abria deslocado para a direita, cortado na borda da tela. Agora nasce logo acima do botão que você clicou.'),
('01a1980d-be80-7eee-984c-58f48bb2a412'::uuid, '23f49eeb-96c0-58ed-8426-f86e947d1c8f'::uuid, '2026-11-01T17:00:00.000Z'::timestamptz, 'Vidro com movimento', '**Melhoria**
Menus e popovers nascem do ponto onde você clicou, diálogos surgem com um leve zoom, avisos deslizam, mensagens novas entram com um deslize, cards e lives aparecem com escala, servidores crescem ao passar o mouse, botões afundam ao clicar e o selo AO VIVO pulsa. Tudo respeita "reduzir movimento" do sistema. E o menu que abria lá embaixo e empurrava o app para cima foi consertado.'),
('01a197d6-d000-7eab-993f-d4c37fe4a4bf'::uuid, '457cffd9-d9b7-5b7f-9dee-1bdc2aec9a77'::uuid, '2026-11-01T16:00:00.000Z'::timestamptz, 'Ajustes no visual Vidro', '**Correção**
Player de música, soundboard e popovers que ficavam transparentes ou escondidos atrás dos painéis; campos de texto respeitando os cantos arredondados escolhidos em Aparência; o papel de parede do servidor voltou a aparecer (por baixo do vidro do chat). A aba Jogos das configurações ficou mais curta: só o essencial, sem parágrafos.'),
('01a1979f-e180-737e-a3a0-39fd10335532'::uuid, 'f367b8ed-76dc-5ed6-b6b8-06cf371fe04b'::uuid, '2026-11-01T15:00:00.000Z'::timestamptz, 'Visual novo: Vidro', '**Novo**
O app ganhou uma cara nova. Um fundo de luz em movimento (na cor do servidor aberto, que respira quando alguém fala) e, por cima, painéis de vidro fosco com reflexo que acompanha o mouse. Tudo continua no mesmo lugar. Prefere o visual antigo? Configurações → Aparência → "Glassmorfismo" desliga (ou Ctrl+Alt+L). Com um jogo aberto o fundo fica parado para não gastar placa de vídeo.'),
('01a19716-8d40-7831-aa9b-335d321e21af'::uuid, 'de4f8444-4529-5274-99c4-e7bb204b9e28'::uuid, '2026-11-01T12:30:00.000Z'::timestamptz, 'Threads', '**Novo**
Uma mensagem com respostas mostra "N respostas · ver thread": abre um painel ao lado com a mensagem original, todas as respostas e uma caixa para responder ali mesmo. Botão direito → "Abrir thread" em qualquer mensagem. As respostas continuam aparecendo na conversa, como sempre.'),
('01a196fb-1600-77d5-a191-08838c45c398'::uuid, 'be84953a-e3db-5182-b623-0da38b400448'::uuid, '2026-11-01T12:00:00.000Z'::timestamptz, 'Colar texto e mandar arquivo pelo controle remoto', '**Melhoria**
Controlando o PC de alguém com teclado liberado, Ctrl+V cola o que está na sua área de transferência lá (até 12 mil caracteres). Soltar um arquivo em cima da live envia para a pasta Downloads/OpenCord da pessoa (até 25 MB), com barra de progresso; ela recebe um aviso com "Mostrar na pasta".'),
('01a1938c-2e00-7f28-aa3b-a50e1f3ccd7b'::uuid, '082c7bff-d126-540b-beb1-5b0d2c7ea048'::uuid, '2026-10-31T20:00:00.000Z'::timestamptz, 'Melhores momentos', '**Novo**
Logo abaixo de "Eventos", "Melhores momentos" junta os clipes e vídeos compartilhados no servidor e ranqueia pelas reações: cada pessoa conta uma vez por clipe. Pódio para os três primeiros da semana, do mês ou dos últimos 3 meses, e "Ir" leva até a mensagem.'),
('01a19370-b6c0-708a-b2b7-fd5d76d3b251'::uuid, 'a7929900-660a-5373-aa32-ecb2ba13cef1'::uuid, '2026-10-31T19:30:00.000Z'::timestamptz, 'Duas lives lado a lado', '**Novo**
Com uma live em destaque, clique com o botão direito em outra na faixa de baixo (ou no card dela) e escolha "Ver lado a lado": as duas dividem a tela. Bom para acompanhar a dupla no squad. "Fechar lado a lado" volta para uma só.'),
('01a19355-3f80-71f7-95c2-a8ee994f248a'::uuid, 'd82b9b3d-354f-5e89-99cd-a3afb87b704b'::uuid, '2026-10-31T19:00:00.000Z'::timestamptz, 'Cor e papel de parede do servidor', '**Novo**
Em Configurações do servidor → Visão geral, quem gerencia escolhe uma cor de destaque e um papel de parede para a conversa. Valem para todo mundo enquanto o servidor está aberto; ao sair, cada um volta para o próprio tema.'),
('01a19339-c840-7639-81f3-f9aebe2e8adf'::uuid, 'dada0e07-7b80-5927-8e1a-2c130efd2218'::uuid, '2026-10-31T18:30:00.000Z'::timestamptz, 'Webhooks: avisos de fora caem no canal', '**Novo**
Em Configurações do servidor → Webhooks, crie um link secreto para um canal de texto. Qualquer programa que fizer POST nele com {"content":"texto"} publica a mensagem ali, com o selo APP: servidor do jogo reiniciou, alguém abriu uma issue no GitHub, a live da Twitch começou. Funciona com o formato do Discord e do Slack, então os serviços que já mandam para eles mandam para o OpenCord.'),
('01a1931e-5100-701e-a55a-ed864776ec1d'::uuid, '6550cff9-8ef2-57ca-bd89-99fe05ccbfa5'::uuid, '2026-10-31T18:00:00.000Z'::timestamptz, 'Canal de voz que cria salas', '**Novo**
Ao criar um canal de voz (ou no botão direito de um que já existe), marque "Criador de salas temporárias". Quem entra nele ganha uma sala só sua, "Sala de Fulano", logo abaixo, com as mesmas permissões. Quando a última pessoa sai, a sala some sozinha. Bom para a turma se dividir sem encher o servidor de canais.'),
('01a19302-d9c0-77a1-87ac-b8746529c94a'::uuid, '63a28f79-dab8-5b70-a08a-747e633a2357'::uuid, '2026-10-31T17:30:00.000Z'::timestamptz, 'Eventos da turma', '**Novo**
No topo da lista de canais tem "Eventos": marque a próxima jogatina com dia, hora, canal de voz e descrição. Cada um responde "Vou" ou "Talvez", todo mundo vê quem confirmou, e quem confirmou recebe um lembrete 15 minutos antes e um aviso na hora com o botão "Entrar na chamada". Quem criou (ou gerencia canais) edita e apaga.'),
('01a192e7-6280-7466-bad7-846aaad519b0'::uuid, '07ff387d-be86-5d9b-9a3d-0fa630eae9f6'::uuid, '2026-10-31T17:00:00.000Z'::timestamptz, 'Overlay dentro do jogo', '**Novo**
Com um jogo aberto, uma janelinha transparente no canto do monitor mostra quem está na chamada (quem fala acende), se você está mudo ou surdo, e os avisos do app: clipe salvo, alguém pedindo para controlar seu PC. Ela não recebe clique, então não atrapalha o jogo. Liga/desliga e escolhe o canto em Configurações → Jogos. Em tela cheia exclusiva o jogo fica por cima; use janela sem borda.'),
('01a192cb-eb40-7dab-a9be-bebe662cc113'::uuid, '9effdd47-bc4e-546a-856c-e8f34a5ea9c2'::uuid, '2026-10-31T16:30:00.000Z'::timestamptz, 'Mensagens de voz', '**Novo**
Com a caixa de mensagem vazia, o botão de enviar vira um microfone: clique, fale (até 5 minutos) e envie. Quem recebe vê a forma de onda, ouve com um clique e pode avançar clicando na onda. Usa o mesmo microfone e a mesma supressão de ruído da chamada.'),
('01a192b0-7400-7f4f-9d4b-2884ad59962d'::uuid, 'f5d36540-812d-5557-a217-2c77e64c7033'::uuid, '2026-10-31T16:00:00.000Z'::timestamptz, 'Status personalizado e ausente automático', '**Novo**
Clique no seu nome no canto inferior esquerdo: "Definir status personalizado" escreve uma frase curta ("estudando, volto 22h") que aparece embaixo do seu nome para os amigos e nos servidores. E sem mexer no computador por 10 minutos o status vira "Ausente" sozinho, voltando a "Online" quando você mexe (dá para desligar no mesmo menu).'),
('01a19294-fcc0-7af1-9b63-751bc7cbaf56'::uuid, 'd8e30305-c7f2-561a-8994-36b59ab1cafb'::uuid, '2026-10-31T15:30:00.000Z'::timestamptz, 'Busca de mensagens', '**Novo**
A lupa no cabeçalho da conversa (ou Ctrl+F) procura por texto no canal, no servidor inteiro ou na conversa direta. Dá para filtrar por pessoa e por "Links", "Arquivos" ou "Imagens"; o nome dos arquivos também conta. Clique em "Ir" para chegar na mensagem.'),
('01a19279-8580-76a4-8ac6-e6b0f3543aa4'::uuid, '1faa0059-2f8a-5296-ba17-1f1342946aba'::uuid, '2026-10-31T15:00:00.000Z'::timestamptz, 'Controlar o computador de quem transmite', '**Novo**
Assistindo à live de alguém da chamada, clique em "Controlar o computador" (botão do card ou botão direito). A pessoa recebe um pedido e escolhe "Só o mouse" ou "Mouse e teclado". Enquanto durar, uma faixa no topo da tela dela mostra quem está controlando, com o botão "Parar"; Ctrl+Alt+Shift+S encerra na hora, de qualquer lado. Funciona com a live da tela inteira (sem cena) e só quem recebe o controle precisa estar no Windows. Janelas de administrador não recebem o controle.'),
('01a19242-9700-7a9a-ab54-adfb3b099356'::uuid, '94e2d06c-5b80-55ed-b41f-b7e9cdbd0772'::uuid, '2026-10-31T14:00:00.000Z'::timestamptz, 'Confirmações no visual do app', '**Melhoria**
Apagar um clipe, excluir uma mensagem, um canal ou um card, expulsar alguém, desfazer amizade e outras confirmações agora aparecem numa janela no tema do OpenCord, em vez da caixa cinza do Windows. Enter confirma e Esc cancela.'),
('01a19227-1fc0-712c-9fb7-d57d80990d06'::uuid, 'aa2dd940-321d-5a2c-b0ef-1d4a327a1d5c'::uuid, '2026-10-31T13:30:00.000Z'::timestamptz, 'Música tocando embaixo do canal de voz', '**Melhoria**
Embaixo do canal de voz aparece só a música da chamada, com o nome da faixa que está tocando (antes aparecia também o vídeo do "Assistir juntos"). Se o nome não cabe, ele rola da direita para a esquerda sem parar; com "reduzir movimento" ligado no sistema, fica parado e termina em "…".'),
('01a1920b-a880-76f1-ad29-72094faeffa3'::uuid, '5742a4e1-e886-598d-a473-9b5206e4d0ba'::uuid, '2026-10-31T13:00:00.000Z'::timestamptz, 'A live não leva mais as vozes da chamada', '**Correção**
Quem assistia a transmissão de alguém da chamada ouvia a voz de todo mundo junto com o som do jogo. Agora o OpenCord pede ao Windows o som de todos os programas menos o dele: vozes, efeitos sonoros e música da chamada ficam fora da live.'),
('01a191f0-3140-7e9d-a9ad-530a68dc7b38'::uuid, 'e0019eb7-2889-588e-b7a5-e5b71a268535'::uuid, '2026-10-31T12:30:00.000Z'::timestamptz, 'Clipes com o som de todas as saídas do fone', '**Novo**
Fones com duas saídas (como "Game" e "Chat"/"Voice") agora entram inteiros no clipe: cada saída de áudio do Windows vira uma trilha, junto com o seu microfone, as vozes da chamada e os efeitos sonoros. No visualizador do clipe dá para ligar e desligar cada uma. Escolha quais saídas gravar em Configurações → Jogos → Clipes.'),
('01a191d4-ba00-71f9-bfd4-b2b4f8b1ecce'::uuid, '913ca94f-3b2c-5535-91eb-57f2e171cf66'::uuid, '2026-10-31T12:00:00.000Z'::timestamptz, 'Efeitos sonoros de qualquer duração', '**Melhoria**
Os sons do painel de efeitos não têm mais limite de 10 s: envie o áudio inteiro ou corte o trecho que quiser (até uns 17 minutos). Enquanto algum som toca, o botão de parar no painel interrompe os sons para você.'),
('01a191b9-42c0-79ac-9192-86422e7a3978'::uuid, '0362b8ff-f674-5a21-a505-e08c454e3c83'::uuid, '2026-10-31T11:30:00.000Z'::timestamptz, 'Sua voz nos dois lados do fone nos clipes', '**Correção**
Com a supressão de ruído ligada e um microfone estéreo, a sua voz saía só do lado esquerdo nos clipes e nas gravações da chamada. Agora sai nos dois lados.'),
('01a1919d-cb80-7d20-88f5-c7df65f33db7'::uuid, 'adc0fec1-1495-5930-93c5-9433bef27029'::uuid, '2026-10-31T11:00:00.000Z'::timestamptz, 'Mais proteção para a sua conta', '**Melhoria**
Errar a senha muitas vezes de outro lugar não tranca mais a sua conta para você. Sair da conta também sai da chamada, e sessões encerradas param de receber mensagens em até um minuto. Quem não pode escrever num canal não aparece mais como "digitando".'),
('01a19182-5440-7070-8a11-6b0e2dd38091'::uuid, 'eab56aa5-80b2-537a-a81e-cdd898bcce91'::uuid, '2026-10-31T10:30:00.000Z'::timestamptz, 'Gravação da chamada em 1080p e lista de gravações visível', '**Correção**
A gravação agora sai em 1080p com bem mais qualidade, e as transmissões entram na qualidade alta (antes chegavam na versão mais baixa, porque a gravação não as mostrava na tela). Minimizar o app não pausa mais o vídeo gravado. A lista "Gravações" no topo da chamada não fica mais escondida atrás da transmissão.'),
('01a19174-98a0-7854-8d2e-9b2967b0e574'::uuid, 'b6271c8d-33a5-5141-9972-3fa30b6fbaac'::uuid, '2026-10-31T10:15:00.000Z'::timestamptz, 'Volume da transmissão lembrado e "Reconectar" ao abrir o app', '**Melhoria**
O volume que você escolhe para a transmissão de cada pessoa (botão direito na live) fica guardado neste computador e vale toda vez que você abrir a transmissão dela, mesmo depois de reiniciar o app. E se você fechar o OpenCord numa chamada, ao abrir de novo aparece "Você estava em …" com o botão Reconectar (some se você sair da chamada pelo botão ou depois de 12 horas).'),
('01a19166-dd00-7b42-9a75-1e21972c814d'::uuid, 'c78880fc-00a7-597a-b00b-2346492dc7c2'::uuid, '2026-10-31T10:00:00.000Z'::timestamptz, 'Erro não derruba mais o app inteiro, e dá para atualizar pela tela de erro', '**Melhoria**
Se uma parte do app der erro (uma mensagem, a lista de canais, a chamada…), só ela mostra um aviso com "Tentar de novo" e o resto continua funcionando. Na tela "Algo deu errado" agora há "Procurar atualização" e "Atualizar agora", que baixam a versão nova direto do servidor, sem precisar de outro instalador, e "Copiar detalhes". O menu do ícone do OpenCord perto do relógio também tem "Instalar atualização", que funciona mesmo com a janela travada. Os erros ficam registrados num arquivo para o suporte.'),
('01a19154-8d80-74e1-98ef-b41f640e1c18'::uuid, 'e39f5db2-e71c-5fd0-b371-542643999975'::uuid, '2026-10-31T09:40:00.000Z'::timestamptz, 'Lista da voz não corta mais nomes e ícones', '**Correção**
Quando alguém na chamada tinha vários selos (verificado, jogo, AO VIVO), a lista de quem está na voz ficava mais larga que a barra e cortava os ícones de todo mundo. Agora o nome encolhe e os selos ficam inteiros.'),
('01a1914b-65c0-712e-a61b-c081935348ef'::uuid, 'a8973479-4f65-5451-831c-9a29a3b34f7e'::uuid, '2026-10-31T09:30:00.000Z'::timestamptz, 'Revisão de segurança: permissões e moderação mais firmes', '**Correção**
Quem foi silenciado pela moderação continua sem microfone e sem efeitos sonoros mesmo saindo e voltando para a chamada. Canais de voz ocultos não mostram mais quem está neles para quem não os vê. Trocar a senha desconecta na hora as outras sessões abertas. Apagar uma mensagem também apaga o texto copiado para o quadro. Ligar um canal a um quadro passou a exigir "Gerenciar cargos" e acesso ao canal.'),
('01a19114-7740-77cb-99d0-015de8b40e09'::uuid, '4fead4b6-7959-5096-9067-97079196de61'::uuid, '2026-10-31T08:30:00.000Z'::timestamptz, 'App não quebra mais quando chega uma atualização', '**Correção**
Na versão anterior, a tela "Algo deu errado" aparecia assim que uma atualização ficava pronta, e não dava nem para atualizar. Corrigido.'),
('01a19106-bba0-771f-a14c-9546a27435bc'::uuid, 'f0fd4e77-9bac-54d4-9ddd-f0e9c5d4673f'::uuid, '2026-10-31T08:15:00.000Z'::timestamptz, 'Markdown nas mensagens', '**Novo**
Escreva # título (até ###), > citação, >>> citação longa, - lista, 1. lista numerada, ```bloco de código```, -# texto pequeno, **negrito**, *itálico*, __sublinhado__, ~~tachado~~, ||spoiler|| (clique para ver) e [texto](https://link). Use \ antes de um símbolo para escrevê-lo sem formatar.'),
('01a19102-27c0-79e5-a29d-2cc7ed18de04'::uuid, 'badc6ae0-ae02-53f5-89e4-39d2651ebf3b'::uuid, '2026-10-31T08:10:00.000Z'::timestamptz, 'Selecionar texto só nas mensagens', '**Correção**
Ctrl+A ou arrastar o mouse não pinta mais a interface inteira de azul: só o texto das mensagens e os campos de digitação podem ser selecionados.'),
('01a190eb-4460-7c4d-a9ef-2b76163fb7c6'::uuid, '057c4e2c-cc8b-5e34-b8fc-501ee97a0d97'::uuid, '2026-10-31T07:45:00.000Z'::timestamptz, 'Compartilhe clipes de até 1 GB e escolha o som', '**Novo**
No visualizador de clipes, "Compartilhar" envia o clipe (ou o corte) para uma conversa ou canal, mesmo que ele passe do limite normal de anexos, até 1 GB. Os clipes novos guardam o som do computador, a voz da chamada e os efeitos sonoros separados: em "Áudio" você silencia cada um, e a exportação e o compartilhamento seguem essa escolha.'),
('01a190cf-cd20-7f6a-b00e-0e195acda439'::uuid, '7ee42ea4-0730-52c1-8ae3-4e2899dded8a'::uuid, '2026-10-31T07:15:00.000Z'::timestamptz, 'Seus clipes: ver, cortar e exportar', '**Novo**
Salvar um clipe agora toca um som e ele aparece em miniatura no painel do usuário. Clique para abrir: assista, arraste as bordas da linha do tempo para cortar e exporte o trecho como vídeo ou só o áudio, copie o arquivo, mostre na pasta, apague ou mande o som para os efeitos sonoros do servidor. Em Configurações → Jogos você escolhe duração (15 s a 2 min), fps, resolução, qualidade e a pasta dos clipes.'),
('01a190b4-55e0-7217-9bb8-0e6f7156d40e'::uuid, '0a1ea3ac-815d-578b-b698-ccf73d81445c'::uuid, '2026-10-31T06:45:00.000Z'::timestamptz, 'Ícone do jogo de verdade', '**Melhoria**
Quem está jogando aparece com o ícone do próprio jogo (lido do programa do jogo no computador de quem joga) na lista da voz, na lista de membros, no painel do usuário e no perfil, no lugar do controle genérico.'),
('01a190a6-9a40-7467-b53e-4ee1aff39adc'::uuid, '596a8cf7-0043-59f1-9c9b-ab97ae67d5ec'::uuid, '2026-10-31T06:30:00.000Z'::timestamptz, 'Veja o que mudou antes de atualizar', '**Melhoria**
Ao clicar no botão de atualização, abre uma janela com as novidades da versão nova e você escolhe entre atualizar agora ou depois.'),
('01a1908b-2300-764c-8d21-0b21aa72b870'::uuid, 'd819b550-86bd-5f58-a62f-211390f79cc6'::uuid, '2026-10-31T06:00:00.000Z'::timestamptz, 'Grave a chamada e baixe por 24 horas', '**Novo**
Na chamada, o botão de gravar (ao lado de sair) grava vozes, câmeras e transmissões de tela. Todos na chamada veem o aviso GRAVANDO. Ao parar, a gravação fica em "Gravações", no topo da chamada, para quem tem acesso ao canal baixar em MP4 por 24 horas; depois ela é apagada do servidor sozinha.'),
('01a1906f-abc0-7a15-a3ec-7bbc138ce625'::uuid, 'd5bca866-0e4c-5cbd-bba4-1ebb0f82b377'::uuid, '2026-10-31T05:30:00.000Z'::timestamptz, 'Clipes do seu jogo com Shift+F10', '**Novo**
Com um jogo aberto, o OpenCord guarda os últimos 60 segundos da sua tela principal e do som do computador. Aperte Shift+F10 para salvar um vídeo em Vídeos\OpenCord. O atalho aparece no painel do usuário, junto com o nome do jogo. Dá para desligar ou trocar o atalho em Configurações → Jogos e Atalhos. Nada é enviado ao servidor.'),
('01a19038-bd40-7bc4-accd-e3317493a8ed'::uuid, '8f9717a2-b548-5d1c-94f9-79f242697958'::uuid, '2026-10-31T04:30:00.000Z'::timestamptz, 'Mostre o jogo que você está jogando', '**Novo**
O OpenCord reconhece o jogo aberto (todos os da Steam e os mais conhecidos fora dela) e mostra o nome dele embaixo do seu nome, na lista da voz e na lista de membros. No seu perfil aparece "Jogando agora", com o tempo de jogo e um botão para a página da Steam. Em Configurações → Jogos você esconde o jogo ou adiciona um que não foi reconhecido. Ficar invisível também esconde.'),
('01a18ff4-1320-7a00-86f3-819daced2f20'::uuid, '540b1c38-3755-5620-8f68-364b37332ce0'::uuid, '2026-10-31T03:15:00.000Z'::timestamptz, 'Música segue tocando ao sair da chamada na tela', '**Correção**
Ir para outro canal, servidor ou conversa pausava a música da chamada. Agora ela continua tocando e aparece minimizada no canto de cima; clique nela para voltar à chamada.'),
('01a18fef-7f40-764c-b237-3b37655f6ab1'::uuid, 'd5d2dc78-cfb7-5826-aab3-d6e8ca6be618'::uuid, '2026-10-31T03:10:00.000Z'::timestamptz, 'Organize a barra de servidores e crie pastas', '**Novo**
Arraste um servidor para mudar a ordem na barra. Solte um servidor em cima de outro para juntar os dois numa pasta, e arraste mais servidores para dentro dela. Clique na pasta para abrir ou fechar; com o botão direito você dá nome, escolhe a cor ou desfaz a pasta. A organização vale nos seus outros aparelhos também.'),
('01a18fe5-6d20-7519-9a22-e6102cbd2f47'::uuid, '50a071b1-5010-5eed-9e53-e87318278831'::uuid, '2026-10-31T02:59:00.000Z'::timestamptz, 'Todos adicionam músicas à fila', '**Melhoria**
Na música da chamada, qualquer pessoa agora pode colar um link e colocar músicas ou playlists no fim da fila. Tocar, pausar, pular, tirar da fila e encerrar continuam só com o DJ.'),
('01a18fe4-82c0-7e96-9f93-2301342ef9da'::uuid, 'ecf84f86-4c85-5db6-a0bc-35a276e775c1'::uuid, '2026-10-31T02:58:00.000Z'::timestamptz, 'Sons de todos os seus servidores em qualquer chamada', '**Melhoria**
O painel de efeitos sonoros agora mostra os sons de todos os servidores em que você está, separados por servidor, com atalhos na lateral. Dá para tocar um som de outro servidor na chamada em que você estiver, e todo mundo nela ouve. O volume dos efeitos abre num balão ao lado do botão do alto-falante.'),
('01a18fe1-c3a0-79a4-bb9f-3f4779db2661'::uuid, '8e2c9906-164f-5e8a-bc94-b366ce121775'::uuid, '2026-10-31T02:55:00.000Z'::timestamptz, 'Recorte o som antes de enviar', '**Novo**
Ao enviar um som, aparece a forma de onda do áudio com duas bordas para arrastar e escolher o trecho. O áudio pode ter mais de 10 s: você escolhe o pedaço de até 10 s que quer, ouve só ele e envia.'),
('01a18fdd-2fc0-74d9-8fea-3b25ae3569d8'::uuid, 'f21d851b-05f7-52f1-9e93-4f32985813c6'::uuid, '2026-10-31T02:50:00.000Z'::timestamptz, 'Selo de verificado do criador em todos os servidores', '**Correção**
O selo de verificado de quem criou o OpenCord aparecia só no servidor oficial. Agora ele aparece em qualquer servidor, na lista de membros e na lista de quem está na voz.'),
('01a18fd8-9be0-78eb-8073-38f894510706'::uuid, '2aeea498-1a7d-5d17-af92-a7ce89e3c697'::uuid, '2026-10-31T02:45:00.000Z'::timestamptz, 'Conversa se recupera sozinha quando o servidor reinicia', '**Correção**
Durante uma atualização do servidor, a conversa mostrava um erro técnico ("Unexpected token…") e ficava parada. Agora aparece um aviso claro e o app tenta carregar de novo sozinho a cada poucos segundos. A mensagem que falhou ao enviar também voltou a aparecer inteira, com o "Tentar novamente" ao lado do texto.'),
('01a18fbd-24a0-7a51-a8c7-ca9590c1dabc'::uuid, 'c5b8dd8b-3c1a-55a9-8535-266151b59020'::uuid, '2026-10-31T02:15:00.000Z'::timestamptz, 'Live em 1440p de verdade', '**Melhoria**
A qualidade 1440p 60 fps agora é usada quando a sua placa de vídeo codifica a live. Se o computador não tiver como codificar pela placa, a live desce sozinha para 1080p 60 fps em vez de travar.'),
('01a18faf-6900-7281-a6a4-1c903c085e75'::uuid, '7cf5afb2-208c-5c9b-b40c-d4b3bebfc401'::uuid, '2026-10-31T02:00:00.000Z'::timestamptz, 'Nick colorido também na voz', '**Melhoria**
Quem está numa sala de voz aparece com a cor do cargo, como na lista de membros. No servidor oficial, o criador do OpenCord aparece ali com o ícone de verificado.'),
('01a18fa1-ad60-756a-894b-9bf4ff6766cf'::uuid, 'f8da0405-7528-5ea6-9822-c500423ed068'::uuid, '2026-10-31T01:45:00.000Z'::timestamptz, 'Live a 60 fps de verdade', '**Melhoria**
A captura da tela perdia alguns quadros e a live ficava em torno de 57 fps. Agora ela acompanha o conteúdo de perto: cerca de 59,5 quadros por segundo diferentes chegam a quem assiste, com ou sem cena.'),
('01a18f93-f1c0-7494-94f2-cb7ca68b6247'::uuid, '3ffa1e5e-d497-54b4-8a7e-ddfe0ef6493e'::uuid, '2026-10-31T01:30:00.000Z'::timestamptz, 'Interface sem atraso com a aceleração de hardware', '**Correção**
Passar o mouse pelos canais e botões ficava atrasado com a aceleração de hardware ligada. A causa eram os botões de minimizar, maximizar e fechar do Windows desenhados por cima da barra do app; agora o próprio OpenCord desenha esses botões, e a interface responde na hora.'),
('01a18f86-3620-7a8c-a7fc-3fbd68471f87'::uuid, '91d24494-87b8-5932-a34c-4d026e5961fd'::uuid, '2026-10-31T01:15:00.000Z'::timestamptz, 'Lives voltam a usar a placa de vídeo', '**Correção**
O modo "Interface leve, lives na placa de vídeo" (Configurações → Desempenho) fazia o contrário do que dizia: a sua live e as que você assiste passavam a ser processadas pelo processador, com fps bem menor. Ele foi removido e quem o usava volta a "Placa de vídeo para tudo". O selo da live agora avisa se o vídeo estiver sem a placa de vídeo, e o diagnóstico copiado traz o histórico dos últimos 10 minutos.'),
('01a18f78-7a80-7f39-aa15-d7e851468387'::uuid, '2bba737f-f565-51c4-81ef-00fe12ebd0b3'::uuid, '2026-10-31T01:00:00.000Z'::timestamptz, 'Cargos por reação', '**Novo**
Quem gerencia cargos pode ligar emojis a cargos numa mensagem (botão direito → "Cargos por reação…"). Quem reage ganha o cargo, e quem tira a reação perde. Na mensagem aparecem botões com o emoji e o nome do cargo. No servidor OpenCord, escolha seus interesses em #escolha-seus-cargos.'),
('01a18f6a-bee0-773f-9045-a7faed177668'::uuid, 'b5a28cbc-4633-5df3-8924-08636178578e'::uuid, '2026-10-31T00:45:00.000Z'::timestamptz, 'Submenus não fecham mais no caminho', '**Correção**
Ao levar o mouse de um item com seta (como "Convidar para o servidor") até o submenu ao lado, ele fechava antes de você chegar. Agora fica aberto enquanto você atravessa.'),
('01a18f5d-0340-72de-87f0-4e4226636b46'::uuid, '161d7d31-dba9-51cf-bbef-3da9608acb5a'::uuid, '2026-10-31T00:30:00.000Z'::timestamptz, 'Menu das conversas diretas e apelido de amigo', '**Novo**
Clique com o botão direito numa conversa direta para fixá-la no topo da lista, ver o perfil, dar um apelido, convidar a pessoa para um servidor seu (o convite vai na conversa), desfazer a amizade ou bloquear. O apelido de amigo só você vê e aparece no lugar do nome em todo o OpenCord: conversas, mensagens, lista de membros e chamadas de todos os servidores. Também dá para dar apelido pelo menu da pessoa nos servidores e na lista de amigos.'),
('01a18f41-8c00-7a2e-883e-19ae64046f04'::uuid, 'e8359648-dcb0-5867-9931-ee2490f4af6f'::uuid, '2026-10-31T00:00:00.000Z'::timestamptz, 'Diagnóstico da live num clique', '**Melhoria**
Live travando ou com fps baixo? Clique no selo de qualidade da transmissão (quem transmite e quem assiste): o app mede 5 segundos e copia onde os quadros se perdem, da captura até a tela de quem assiste. Cole para quem estiver ajudando.'),
('01a18f41-8818-7411-b298-593b1612ea3a'::uuid, 'b35d1487-4e22-54bc-8c84-9daf331d857e'::uuid, '2026-10-30T23:59:59.000Z'::timestamptz, 'Música com DJ e playlists inteiras', '**Melhoria**
Quem começa a música na chamada vira o DJ, e só ele adiciona, pula, pausa ou encerra para todos. Quem ouve controla só o próprio player: volume, pausar só para si e voltar ao vivo. Se o DJ sai, quem está há mais tempo na chamada assume; se todos saem, a música para. Links de playlist do YouTube e do YouTube Music agora trazem a playlist inteira (até 100 músicas). Os mixes automáticos do YouTube (Mix e Rádio) também entram, com cerca de 25 músicas.'),
('01a18f26-14c0-765d-bd19-a045cfb69261'::uuid, '515cc519-7697-5c23-bdb8-03f58b22c0e7'::uuid, '2026-10-30T23:30:00.000Z'::timestamptz, 'Enquetes', '**Novo**
Crie enquetes em qualquer canal ou conversa pelo botão "+" ao lado da mensagem. São de 2 a 10 opções, com uma ou várias escolhas e prazo de 1 hora a 1 semana (ou sem prazo). O resultado aparece em barras depois que você vota, e quem criou a enquete pode encerrá-la antes do prazo.'),
('01a18f26-10d8-7874-b04e-e096cdea2a11'::uuid, '730cdc05-5f59-5954-bcbf-118c10a2044a'::uuid, '2026-10-30T23:29:59.000Z'::timestamptz, 'Mensagens fixadas', '**Novo**
Fixe mensagens importantes clicando com o botão direito nelas e escolhendo "Fixar mensagem". O alfinete no topo da conversa mostra todas as fixadas e leva até cada uma. Nas conversas diretas qualquer participante fixa; nos canais, quem pode gerenciar mensagens.'),
('01a18f0a-9d80-7818-a007-82a0f5c2ed73'::uuid, 'e353fa3e-384e-566e-a2fc-d21e8aa7b725'::uuid, '2026-10-30T23:00:00.000Z'::timestamptz, 'Quadros kanban e canal de relatos', '**Novo**
Servidores ganharam um novo tipo de canal: o quadro, com as colunas Novo, Em análise, Em andamento e Resolvido. É só arrastar os cards entre elas. Um canal de texto pode alimentar um quadro, e cada mensagem enviada nele vira um card. No servidor oficial, o que você relatar em #reportar-bugs chega direto ao quadro da equipe.'),
('01a18efc-e1e0-7bc4-b484-140c03ac4d2e'::uuid, '9d95ad4f-fe3e-5392-bda1-39d057810647'::uuid, '2026-10-30T22:45:00.000Z'::timestamptz, 'Criador no topo do servidor oficial', '**Melhoria**
Na lista de membros do servidor OpenCord, quem criou o projeto aparece sempre no topo, com o selo de verificado.'),
('01a18eef-2640-7b56-9bd5-4df53b830ff2'::uuid, 'fb1f1b56-94de-56ae-81ea-c954fab31dc8'::uuid, '2026-10-30T22:30:00.000Z'::timestamptz, 'Servidor oficial de casa nova', '**Melhoria**
O servidor OpenCord ganhou canais de boas-vindas, regras, anúncios e novidades, espaços para comunidade, ajuda, sugestões, bugs e jogos, e várias salas de voz. Todo mundo que entra no OpenCord já faz parte dele, e ele não pode mais ser deixado.'),
('01a18ee1-6aa0-7833-b971-e546f32b80cd'::uuid, '5688600d-669c-51c2-9cce-45582fb959db'::uuid, '2026-10-30T22:15:00.000Z'::timestamptz, 'Clique na câmera para ampliar', '**Melhoria**
Na chamada, clicar no quadro da câmera de alguém agora coloca a câmera em destaque, como acontece com as transmissões; as outras pessoas ficam na faixa embaixo. Clique de novo para voltar à grade. Pelo teclado, Enter ou Espaço.'),
('01a18ed3-af00-7ac2-8c5d-738e63bbf5c9'::uuid, '93f2b44d-1b8e-5b58-800c-34b215293204'::uuid, '2026-10-30T22:00:00.000Z'::timestamptz, 'Arraste pessoas para outra chamada', '**Novo**
Quem tem a permissão "Mover membros" pode arrastar alguém da lista de um canal de voz e soltar em outro: a pessoa troca de chamada na hora e recebe um aviso de quem a moveu. Também dá para fazer pelo botão direito, em "Mover para". Você também pode se arrastar para outro canal.'),
('01a18eb8-37c0-71f4-a04e-92db4f98c862'::uuid, 'bd05c2ad-7227-5a7d-b9ce-02b6ccd863fc'::uuid, '2026-10-30T21:30:00.000Z'::timestamptz, 'Menu da pessoa direto no card da chamada', '**Melhoria**
Clique com o botão direito no card de alguém na chamada para abrir o mesmo menu da lista do canal: perfil, mensagem, volume e silenciar só para você, cargos e as opções de moderação.'),
('01a18e9c-c080-778b-9004-316da691eadb'::uuid, '84760702-ab49-5f7b-b72f-34f1f0bb7496'::uuid, '2026-10-30T21:00:00.000Z'::timestamptz, 'Cenas na transmissão', '**Novo**
Monte cenas para a sua live: a tela com a sua câmera por cima, imagens e textos, posicionados e redimensionados à vontade. Escolha a cena em "Cena" ao transmitir e troque no meio da live pelo botão "Trocar de cena", sem encerrar a transmissão. As cenas ficam salvas neste computador.'),
('01a18e4a-5ac0-796d-b344-173a11e62876'::uuid, 'f600b956-4c7f-56aa-89e3-f779fd006ee9'::uuid, '2026-10-30T19:30:00.000Z'::timestamptz, 'Perfil completo e grupo a partir da conversa', '**Novo**
Abra o perfil completo de alguém (pelo cartão da pessoa ou pelo painel da conversa direta): desde quando está no OpenCord e é seu amigo, uma nota que só você vê, o que a pessoa está fazendo agora e os amigos e servidores em comum. No topo da conversa direta, "Adicionar amigos à conversa" cria um grupo com quem você escolher.'),
('01a18e13-6c40-7c0b-8754-412128d521c3'::uuid, 'f2eed240-bf6a-5a33-aa42-6ff9128ecaf9'::uuid, '2026-10-30T18:30:00.000Z'::timestamptz, 'Minimizar o player de música', '**Melhoria**
O player de música da chamada tem um botão para minimizar: fica só a capa, o nome e o tempo da música, sem parar de tocar. Um clique abre de novo.'),
('01a18e01-1cc0-762d-b79e-90ddeb1f6cac'::uuid, 'dfee0a1b-158a-58ee-8fe0-dc58d4fc38f3'::uuid, '2026-10-30T18:10:00.000Z'::timestamptz, 'Ícones novos', '**Melhoria**
Todos os ícones do app foram trocados por um conjunto novo, mais legível: ondas de áudio para a supressão de ruído, megafone para os efeitos sonoros, formas para as atividades e outros. Ao passar o mouse, o traço do ícone fica mais forte.'),
('01a18dea-3960-753a-9a18-aa431fd6e063'::uuid, 'dafbc824-ed5d-56de-b744-afd943b4c6b5'::uuid, '2026-10-30T17:45:00.000Z'::timestamptz, 'Dispositivo de áudio mantido ao reabrir', '**Correção**
Ao abrir o app e entrar numa chamada, as vozes voltavam a sair pelo dispositivo padrão do Windows, mesmo com outro escolhido. Agora saem sempre pelo dispositivo que você escolheu.'),
('01a18ddc-7dc0-7fd2-a1db-1e478727b81f'::uuid, '67540c1e-eb7f-521b-b0e4-28dc35a7291c'::uuid, '2026-10-30T17:30:00.000Z'::timestamptz, 'Painel da chamada reorganizado', '**Melhoria**
O cartão "Voz conectada" ganhou quatro botões: câmera, transmitir tela, atividades e efeitos sonoros. A supressão de ruído foi para o topo, ao lado do botão de sair, e a qualidade da conexão aparece ao passar o mouse no ícone de sinal.'),
('01a18dca-2e40-78f2-9987-38cb3da3ad93'::uuid, '582c8023-a256-55db-bb67-e6db33b58065'::uuid, '2026-10-30T17:10:00.000Z'::timestamptz, 'Painel de atividades arrumado', '**Melhoria**
Os cards de Assistir juntos e Música ocupam o painel todo, com a mesma altura e o texto em uma linha.'),
('01a18dc1-0680-7f29-b04d-e752f481bab9'::uuid, 'e9168c07-67aa-534f-ac55-9d09cfdedaf9'::uuid, '2026-10-30T17:00:00.000Z'::timestamptz, 'Efeitos sonoros', '**Novo**
Na chamada, o botão de efeitos sonoros abre o painel do servidor: clique num som e todos na chamada ouvem. Qualquer pessoa envia sons (MP3, OGG ou WAV de até 10 s) pelo "Adicionar som" ou em Configurações do servidor → Efeitos sonoros. O volume e o silenciar dos efeitos são só seus.'),
('01a18d6e-a0c0-7fa9-b972-adefd035908b'::uuid, '03a0e949-c074-5b2d-a31c-d5cd246ba3a0'::uuid, '2026-10-30T15:30:00.000Z'::timestamptz, 'Música na chamada', '**Novo**
Nova atividade "Música": cole links do YouTube ou do YouTube Music e todos na chamada ouvem juntos, com fila, anterior/próxima, barra de progresso e volume só seu. Qualquer pessoa da chamada adiciona e controla; quando uma música acaba, a próxima começa para todos.'),
('01a18d40-da00-705d-abf7-78843e86753f'::uuid, 'b3289634-10fb-5883-8a78-1670a0bd5543'::uuid, '2026-10-30T14:40:00.000Z'::timestamptz, 'Modo "Interface leve" para quem joga', '**Melhoria**
Em Configurações → Sobre → Desempenho há três opções: placa de vídeo para tudo, interface leve (o app é desenhado pelo processador e não disputa a placa de vídeo com o jogo, mas as lives continuam na placa de vídeo) e sem aceleração. Quem tinha desligado a aceleração continua sem.'),
('01a18d25-62c0-7d59-a5b9-ccacd7ed65b7'::uuid, 'ec8cc7a9-9d5a-59e1-b959-f28b7162632c'::uuid, '2026-10-30T14:10:00.000Z'::timestamptz, 'Dicas no visual do app', '**Melhoria**
As dicas que apareciam ao passar o mouse com o balão padrão do sistema (botões da live, do Assistir juntos, da conversa, status e outros) agora usam o mesmo balão escuro do resto do OpenCord, também pelo teclado.'),
('01a18d13-1340-7a88-a828-3c8a7767d56a'::uuid, '2d5069b0-ecd1-573b-9c44-1ef86dfa572e'::uuid, '2026-10-30T13:50:00.000Z'::timestamptz, 'Cartão do servidor na barra lateral', '**Novo**
Passe o mouse num servidor para ver a imagem e o nome dele e quem está em voz agora (com as fotos, o canal e o selo AO VIVO se alguém estiver transmitindo).'),
('01a18d00-c3c0-763a-b19c-85e4bc1111d2'::uuid, '140122de-4670-5a49-baeb-7738e4bcc7b5'::uuid, '2026-10-30T13:30:00.000Z'::timestamptz, 'Perfil ao lado da conversa direta', '**Novo**
Nas mensagens diretas, um painel mostra a pessoa: foto e status, onde ela está agora (em voz ou transmitindo; um clique leva ao canal), desde quando está no OpenCord e é sua amiga, e os servidores e amigos em comum. O botão de perfil no topo da conversa mostra ou esconde.'),
('01a18bee-1b40-713a-9855-2125bedc1688'::uuid, '8376f30f-4efd-5247-b0f4-c665210419a7'::uuid, '2026-10-30T08:30:00.000Z'::timestamptz, 'Aceleração de hardware', '**Novo**
Em Configurações → Sobre dá para desligar a aceleração de hardware, se o app piscar, ficar com a tela preta ou travar. Vale depois de reiniciar o app. Desligada, a sua live passa a ser codificada pelo processador.'),
('01a18bdb-cbc0-7b3a-a5fb-2aa86c41ab87'::uuid, 'e03ae097-39b6-593e-9d09-cacbb4b09ab7'::uuid, '2026-10-30T08:10:00.000Z'::timestamptz, 'Canal de voz com fundo animado', '**Melhoria**
Antes de entrar na chamada, o canal de voz mostra um gradiente que se move devagar, na cor de destaque escolhida em Aparência.'),
('01a18bc4-e860-7c4e-a2c0-489200e7ef08'::uuid, '87f52bbc-12cb-59a1-b2ff-38041044b511'::uuid, '2026-10-30T07:45:00.000Z'::timestamptz, 'Escolha o bitrate da sua live', '**Melhoria**
Na engrenagem do Transmitir (ou em Configurações → Voz e vídeo) dá para escolher leve, equilibrada ou máxima: em 1080p60, 8, 12 ou 20 Mbps. Se a sua live engasga para quem assiste, a sua internet de envio não dá conta: escolha uma opção menor. O padrão agora é a equilibrada.'),
('01a18bae-0500-715a-b4ca-17dd5fc2ac04'::uuid, 'ae6bd8fb-2667-5cae-b269-c9ec87efaf94'::uuid, '2026-10-30T07:20:00.000Z'::timestamptz, 'Prévia da live no perfil', '**Novo**
Clique em quem está AO VIVO na lista do canal para ver a prévia da transmissão. Um clique na prévia entra na chamada e abre a live.'),
('01a18ba9-7120-7c96-8415-f64840873fe0'::uuid, '06245b65-e1e0-520e-b83e-49e6c9b76da3'::uuid, '2026-10-30T07:15:00.000Z'::timestamptz, 'Ícone de câmera some ao desligar', '**Correção**
Depois de desligar a webcam, a lista do canal continuava mostrando a câmera ligada. Agora o ícone some na hora.'),
('01a18ba4-dd40-7d76-aea1-7d93c8b6e568'::uuid, '35ca9a23-e1c5-51a0-8971-fe5bcbbc3593'::uuid, '2026-10-30T07:10:00.000Z'::timestamptz, 'A live sai no FPS e na resolução escolhidos', '**Correção**
A transmissão não troca mais FPS nem resolução quando a cena pesa: 1080p 60 fps sai como 1080p 60 fps. O limite de bitrate subiu (até 20 Mbps em 1080p60 e 30 Mbps em 1440p60); se a internet de quem transmite não aguentar, a imagem perde um pouco de nitidez, mas não trava nem encolhe.'),
('01a18b9b-b580-7c0b-aeb0-bce7cebd1182'::uuid, 'c55b8dee-526b-539e-bbe8-10bb0abafe7d'::uuid, '2026-10-30T07:00:00.000Z'::timestamptz, 'Super admin e servidores verificados', '**Novo**
Quem administra o OpenCord vê todos os servidores em Explorar servidores e pode entrar em qualquer um para moderar (a entrada fica registrada e aparece para os membros). Servidores também podem ganhar o selo de verificado sem deixar de ser privados.'),
('01a18b92-8dc0-710b-ba10-8b9cc16e05c1'::uuid, '1b389ff3-a863-5ab3-b2a6-23a0e8af4cdf'::uuid, '2026-10-30T06:50:00.000Z'::timestamptz, 'Imagem do servidor redonda de novo', '**Correção**
A imagem do servidor na barra lateral ficava oval; agora preenche o botão certinho. O visualizador de imagens também não fica mais por baixo dos botões da janela.'),
('01a18b7b-aa60-7889-bee5-71d360952072'::uuid, '56f42fbd-5206-5333-a183-3336a4b39725'::uuid, '2026-10-30T06:25:00.000Z'::timestamptz, 'Cartão do convite', '**Novo**
Links de convite colados no Discord, WhatsApp e afins mostram um cartão com a imagem, o nome e os membros do servidor. Dentro do OpenCord, o link vira um cartão com o botão Entrar.'),
('01a18b6d-eec0-7819-8fcd-be35d1ee301f'::uuid, 'be22ccaa-724d-53b3-84c2-b44a2cf96dc5'::uuid, '2026-10-30T06:10:00.000Z'::timestamptz, 'Recortar a imagem antes de enviar', '**Melhoria**
Ao trocar a foto de perfil ou a imagem do servidor, escolha o enquadramento: arraste para posicionar e use o zoom (barra, roda do mouse ou +/−). GIF animado continua indo inteiro. A barra de título mostra a imagem do servidor aberto.'),
('01a18b60-3320-7679-8630-a16e7a40bca0'::uuid, 'fe4fdf72-bb9c-51d6-bea5-a16343ab9c4a'::uuid, '2026-10-30T05:55:00.000Z'::timestamptz, 'Live volta a capturar com fluidez', '**Correção**
Uma mudança da madrugada na captura da tela limitava a live a uns 12 FPS em cenas com movimento; foi desfeita e a captura volta a acompanhar a tela. Quem assiste também ganhou uma pequena folga no buffer, para perdas de pacote não virarem congelamentos de 1 segundo.'),
('01a18b4d-e3a0-76b5-8ebb-08381de6407c'::uuid, '498cc236-8955-51ce-a046-0f6b7664687a'::uuid, '2026-10-30T05:35:00.000Z'::timestamptz, 'Quem transmite vira uma bolha sobre a live', '**Melhoria**
Em vez de dois quadros (a live e o perfil), quem está transmitindo aparece só na própria live, com a foto numa bolha que acende quando a pessoa fala, mostra o mute e flutua de leve com o mouse.'),
('01a18b40-2800-7b30-946b-f60a5b422de0'::uuid, '6f539e7d-813e-50f1-9758-6c853aedf387'::uuid, '2026-10-30T05:20:00.000Z'::timestamptz, 'Amigos ao lado das mensagens diretas', '**Novo**
Nas conversas diretas, um painel à direita mostra quem está "Ativo agora" (em voz ou transmitindo) e quem está disponível; um clique abre a conversa. Dá para deixar só os avatares ou esconder pelo botão de pessoas no topo da conversa.'),
('01a18b32-6c60-76bb-84dc-c3f15b59156b'::uuid, '51aa5297-f31b-5f27-8ff4-41db2431f831'::uuid, '2026-10-30T05:05:00.000Z'::timestamptz, 'Visualizador de imagens nas conversas', '**Novo**
Clique numa imagem para abrir em tela grande: zoom (roda do mouse ou clique, arraste para mover), girar, baixar, abrir no navegador, copiar imagem ou link e ver detalhes. As setas ← → passam pelas imagens da conversa; Esc fecha. As imagens da mensagem também ficaram lado a lado, sem espaços estranhos.'),
('01a18b29-44a0-71a3-a651-4c24c1ee0dbe'::uuid, '8bcdd980-ea25-5988-bc81-b6d3cf8bf915'::uuid, '2026-10-30T04:55:00.000Z'::timestamptz, 'Lives gastam menos internet', '**Melhoria**
O teto da live em 1080p60 caiu de 12 para 8 Mbps (em 1440p60, de 18 para 12 Mbps). A imagem continua nítida em jogos, e quem assiste com internet mais fraca trava menos.'),
('01a18b24-b0c0-7384-836a-206f95b53269'::uuid, '0397cb0c-16af-5b4c-82b2-bfc99047d9f7'::uuid, '2026-10-30T04:50:00.000Z'::timestamptz, 'Configurações sem rolagem lateral', '**Correção**
Nomes longos de dispositivos de áudio são cortados com reticências em vez de alargar a tela de Voz e vídeo.'),
('01a18b1b-8900-7efe-b0c3-8fbff5cf4cd3'::uuid, 'd464438a-5fcd-5c35-8ce2-d5cd4c508ea8'::uuid, '2026-10-30T04:40:00.000Z'::timestamptz, 'Prévias das lives em "Em atividade"', '**Novo**
Na tela inicial, cada transmissão aparece com uma prévia da tela. Um clique entra na chamada e já abre a live em destaque.'),
('01a18b09-3980-7a3a-8f46-e1da3c6bbf21'::uuid, '4d53f6d0-e299-5d0f-916d-a3b756b4a3ab'::uuid, '2026-10-30T04:20:00.000Z'::timestamptz, 'Clique na live para destacar', '**Melhoria**
Na grade da chamada, um clique numa transmissão coloca ela em destaque (e começa a assistir, se ainda não estava); clicar de novo na live em destaque volta para a chamada inteira.'),
('01a18afb-7de0-7936-8e44-3e9996655ace'::uuid, '3999bdf4-2e92-589b-9bfe-8c7fdc33b5df'::uuid, '2026-10-30T04:05:00.000Z'::timestamptz, 'Live com jogo pesado: captura direto na GPU', '**Correção**
A captura da tela passa a entregar cada quadro direto na placa de vídeo, sem cópia intermediária. Com um jogo usando a GPU inteira, essa cópia ficava na fila e a live podia cair para poucos FPS.'),
('01a18af6-ea00-7e65-a9d1-c1efd1ecd782'::uuid, 'b1f15b5f-f6a3-5129-b69f-7ccc575508c3'::uuid, '2026-10-30T04:00:00.000Z'::timestamptz, 'Barra de servidores: selo e imagens alinhados', '**Correção**
O número de menções no botão de mensagens diretas não fica mais cortado, e servidores com imagem não mostram mais um aro colorido torto em volta.'),
('01a18ae9-2e60-7404-9b53-c66b891d4499'::uuid, '5f9ac9cc-5765-5248-b9b7-5cb0d7dabc97'::uuid, '2026-10-30T03:45:00.000Z'::timestamptz, 'Qualidade recebida no selo da live', '**Melhoria**
Quem assiste vê no selo da live a resolução, os FPS e os Mb/s que estão chegando; passe o mouse para ver perda de pacotes, travadas e o decoder.'),
('01a18adb-72c0-7f79-ba64-c29dcdd16027'::uuid, '393c4831-a82d-5496-afe3-096bf30fa6ac'::uuid, '2026-10-30T03:30:00.000Z'::timestamptz, 'Prévia da live nítida', '**Melhoria**
A prévia no card da live ficou nítida (com um leve desfoque) e é atualizada a cada 5 minutos; quem entra na chamada já recebe uma na hora.'),
('01a18ad6-dee0-762e-a581-fe3fddd6e02d'::uuid, '52b90567-7182-512c-b216-b5f49fc1059d'::uuid, '2026-10-30T03:25:00.000Z'::timestamptz, 'Lista de amigos repaginada', '**Melhoria**
Linhas maiores em ordem alfabética, o @usuário ao passar o mouse, o status escrito (ou o canal de voz em que a pessoa está) e um clique na linha abre a conversa. Remover e bloquear ficaram no menu "⋮" e no botão direito.'),
('01a18ac9-2340-7b4b-8a38-b0abcb56d230'::uuid, 'c5edb667-ff10-510d-8403-c8cd3f386489'::uuid, '2026-10-30T03:10:00.000Z'::timestamptz, 'Convite por link', '**Melhoria**
"Convidar pessoas" agora gera um link. Quem abrir entra pelo navegador, mesmo sem conta (só escolhe um apelido), e cai direto no convite do servidor.'),
('01a18ac4-8f60-79e8-bf6c-5b13349cc98a'::uuid, '41d7e579-ce4c-5726-8ce7-cd37b96a19e0'::uuid, '2026-10-30T03:05:00.000Z'::timestamptz, 'Nomes de dispositivos sem códigos', '**Correção**
Microfones e saídas de áudio aparecem sem o código do fabricante no fim do nome (ex.: "(046d:0b0b)").'),
('01a18abb-67a0-7d99-9efa-07435ae7d4d5'::uuid, '99256b01-2b75-5f4a-8e15-7660556eb8d5'::uuid, '2026-10-30T02:55:00.000Z'::timestamptz, 'Prévia das transmissões', '**Novo**
Antes de clicar em Assistir, o card da live mostra uma prévia da tela de quem transmite, atualizada a cada poucos segundos.'),
('01a18ab2-3fe0-7db0-aada-90b21a09f4fe'::uuid, '10df7c2c-377a-5fca-995f-5badd5fac795'::uuid, '2026-10-30T02:45:00.000Z'::timestamptz, 'Servidores privados com convite e OpenCord verificado', '**Novo**
Servidores que você cria agora são só seus até você convidar: use "Convidar pessoas" e envie o código; quem recebe cola em Explorar servidores → Tenho um convite. O servidor OpenCord continua aberto a todos e ganhou o selo de verificado.'),
('01a18a5f-da20-7805-8d32-e0e30898dba1'::uuid, '6f251a4a-8dde-5a20-919f-0f38708beff5'::uuid, '2026-10-30T01:15:00.000Z'::timestamptz, 'Envio de foto e imagem do servidor no servidor oficial', '**Correção**
O envio falhava com "não foi possível salvar a imagem" porque a pasta de arquivos do servidor não aceitava gravação. Corrigido na instalação do servidor.'),
('01a18a56-b260-7ea7-8d68-56f5e2fca88a'::uuid, 'e5a8dc3f-4f23-5efc-a4d9-9258d14b4872'::uuid, '2026-10-30T01:05:00.000Z'::timestamptz, 'Live mais estável com jogo pesado', '**Correção**
Com um jogo em tela cheia por cima, o Windows deixava o OpenCord em segundo plano e a live engasgava. Agora a captura e a codificação mantêm prioridade enquanto você transmite.'),
('01a18a4d-8aa0-726f-9a77-3dfe8f836639'::uuid, 'c1ba6c97-64e7-5d0c-beef-87bb71e71926'::uuid, '2026-10-30T00:55:00.000Z'::timestamptz, 'Quadros da chamada em galeria', '**Melhoria**
Cada pessoa vira um quadro 16:9 na cor dela, com a foto no centro e o nome embaixo; os quadros crescem para ocupar a tela e a última fileira fica centralizada.'),
('01a18a3f-cf00-7141-9426-ea3574f99f5e'::uuid, '12930748-445c-50f4-8bea-ce90ef010a58'::uuid, '2026-10-30T00:40:00.000Z'::timestamptz, 'Chamada mais leve durante a live', '**Melhoria**
A barra de controles da chamada não é mais redesenhada a cada atualização das estatísticas da transmissão.'),
('01a18a32-1360-7e8f-b5cc-4d1ae7db0e90'::uuid, 'eab854ec-7e18-531d-b4d7-221f327aa168'::uuid, '2026-10-30T00:25:00.000Z'::timestamptz, 'Foto de perfil em GIF animado', '**Melhoria**
GIFs de até 1 MB e 1024 px vão como estão e ficam animados no avatar; maiores viram imagem parada.'),
('01a18a28-eba0-7314-97e7-2f1f9270a69d'::uuid, 'ba23807c-6039-538b-88a4-44fcdfb9dd88'::uuid, '2026-10-30T00:15:00.000Z'::timestamptz, 'Seletor de transmissão sem clique acidental', '**Correção**
Enquanto a lista carrega aparecem cards de espera, e um clique dado enquanto os cards surgiam ou trocavam de aba não inicia mais a transmissão errada.'),
('01a18a1f-c3e0-73ba-b4dd-fd7ffb415f1a'::uuid, 'f10e4672-6b98-5389-8213-4b05fb419b8c'::uuid, '2026-10-30T00:05:00.000Z'::timestamptz, 'Imagem do servidor', '**Novo**
Em Configurações do servidor → Visão geral, quem gerencia o servidor envia uma imagem (recortada em quadrado); ela aparece na barra de servidores de todos na hora.'),
('01a18a16-9c20-712c-bf5f-66745e41a03b'::uuid, '0f2cc2f6-d42b-5361-8456-c26107e258f1'::uuid, '2026-10-29T23:55:00.000Z'::timestamptz, 'Atualizar sempre leva à versão mais nova', '**Correção**
Se saiu outra versão enquanto a atualização esperava o clique, o app baixa e instala direto a mais nova, em vez de pedir de novo logo depois.'),
('01a18a0d-7460-7d9c-94f2-61c3f79e0db0'::uuid, 'f788aec4-cd98-588c-aa95-37774621587b'::uuid, '2026-10-29T23:45:00.000Z'::timestamptz, 'Dar e tirar cargos pelo botão direito', '**Novo**
No menu de uma pessoa, "Cargos ›" lista os cargos do servidor com a cor de cada um; marque ou desmarque vários sem fechar o menu.'),
('01a189ff-b8c0-7773-8510-bdd2452285a4'::uuid, '04fce13a-b4eb-554a-9b9a-fafa51e95005'::uuid, '2026-10-29T23:30:00.000Z'::timestamptz, 'Foto de perfil', '**Novo**
Em Configurações → Minha conta: envie uma foto (recortada em quadrado) ou remova. Ela aparece para todos nos seus servidores na hora, e trocas de apelido também.'),
('01a189ed-6940-7c52-95b3-d34493c8e242'::uuid, '5c4fb877-ac69-518d-8cab-b4f1ac76df63'::uuid, '2026-10-29T23:10:00.000Z'::timestamptz, 'Ocultar/mostrar membros com animação', '**Melhoria**
A faixa de membros sob a live recolhe e aparece suavemente, e a transmissão cresce junto.'),
('01a189e8-d560-765a-9989-c9535115d92f'::uuid, 'b21e29cd-4eca-5bc2-9dff-187f1a5348bb'::uuid, '2026-10-29T23:05:00.000Z'::timestamptz, 'Card "Em atividade" redesenhado', '**Melhoria**
Mostra o servidor, o canal, quem está na chamada, quem está transmitindo e o vídeo em "Assistir juntos", com botão para entrar na chamada.'),
('01a189e4-4180-7dd8-bcab-d692492b1805'::uuid, '46b1a40a-a10d-5819-b1f8-4e8b560493fe'::uuid, '2026-10-29T23:00:00.000Z'::timestamptz, 'Caixa de mensagem no tom do tema', '**Correção**
A barra de escrever usava um cinza claro de botão; agora segue o tema escolhido, com borda sutil e destaque ao digitar.'),
('01a189db-19c0-70e9-b704-da12222ac5f6'::uuid, 'ed79fa66-3dfa-5f59-86ce-42bedceafadb'::uuid, '2026-10-29T22:50:00.000Z'::timestamptz, 'A live mostra a tela inteira', '**Correção**
Com os membros à mostra em janelas grandes, a parte de baixo da transmissão era cortada. Agora o quadro inteiro aparece, com faixas pretas quando a proporção não bate.'),
('01a189cd-5e20-7ada-b5cc-6be92c61b3b1'::uuid, '032ce785-3f3a-50a3-9ecd-96d0a2c59283'::uuid, '2026-10-29T22:35:00.000Z'::timestamptz, 'Assistir juntos: quem coloca o vídeo comanda', '**Melhoria**
Só quem colocou o vídeo toca, pausa, pula, troca e encerra para o grupo. Os outros ajustam o volume e pausam só para si; ao voltar, alcançam o dono. Se o dono sair, outra pessoa assume.'),
('01a189bb-0ea0-7468-8462-643c514d025e'::uuid, '8004f4d5-f176-58e9-86f4-0949e4f50aa6'::uuid, '2026-10-29T22:15:00.000Z'::timestamptz, 'Volume da transmissão no botão direito', '**Novo**
Clique com o botão direito numa live para ajustar o volume dela (só para você), silenciar, abrir em nova janela ou parar de assistir.'),
('01a189b6-7ac0-7623-b898-42cde269174e'::uuid, 'bb6c6e51-544e-5323-a50d-5897e5ac6bdf'::uuid, '2026-10-29T22:10:00.000Z'::timestamptz, 'Ver a live dos outros enquanto você transmite', '**Correção**
As outras transmissões aparecem na faixa de baixo; um clique assiste e coloca em destaque.'),
('01a189a8-bf20-7444-b880-9de613810417'::uuid, 'df66d536-62b4-5092-a6c0-a8ea235c995c'::uuid, '2026-10-29T21:55:00.000Z'::timestamptz, 'Novidades na tela inicial', '**Novo**
Esta linha do tempo: o que entrou no OpenCord, em ordem. O app abre aqui.'),
('01a189a3-40e0-749d-aeb7-8476cbf42127'::uuid, '73bda582-2f50-57fe-b037-9a5d677204c2'::uuid, '2026-10-29T21:49:00.000Z'::timestamptz, 'Atividades na chamada: Assistir juntos (YouTube)', '**Novo**
Botão Atividades na chamada. Cole um link do YouTube e todos assistem sincronizados, cada um no player oficial: tocar, pausar e pular valem para o grupo.'),
('01a18991-dbc0-75ee-80ca-21ae57bdeabe'::uuid, '1e8b1a19-4328-5a32-a6e9-973134f53f1d'::uuid, '2026-10-29T21:30:00.000Z'::timestamptz, 'Atualização em um clique', '**Melhoria**
Ao clicar em "Atualização pronta" o app fecha, mostra só o progresso e reabre na versão nova, sem assistente de instalação.'),
('01a18982-4b60-7ca7-90d7-113d075252d9'::uuid, '7f2e94f9-ed29-5592-8791-f81a7b48eefc'::uuid, '2026-10-29T21:13:00.000Z'::timestamptz, 'Importar servidor do Discord', '**Novo**
Criar servidor → Importar do Discord: cole o link do modelo do servidor e traga categorias, canais, cargos e permissões.'),
('01a1897b-e2c0-7088-b521-d7b4d271d62b'::uuid, '5048cf7c-1986-5c7a-bfc1-dfc0f1fb6b15'::uuid, '2026-10-29T21:06:00.000Z'::timestamptz, 'Criar categoria e menu na lista de canais', '**Novo**
Botão direito no espaço livre da lista de canais: criar canal, criar categoria, expandir ou recolher todas.'),
('01a1897a-0e00-7af0-8040-6e642b5b0c45'::uuid, '5c3c511b-4eeb-5e58-b3cb-897b8640b1ec'::uuid, '2026-10-29T21:04:00.000Z'::timestamptz, 'Categorias recolhem de verdade', '**Correção**
Recolher uma categoria esconde também os canais de voz, e o estado fica salvo.'),
('01a18976-6480-7f5d-afe1-93f661cc9aa9'::uuid, '59042ac9-e30e-53a5-a8cf-3c1eb6bccae1'::uuid, '2026-10-29T21:00:00.000Z'::timestamptz, 'Arrastar a janela pela barra inteira', '**Correção**
A barra de título arrasta (e desmaximiza) também à esquerda do título.'),
('01a1896a-7da0-7bb9-ada0-b635a452bc86'::uuid, '916535b0-ca5f-53fd-be47-18023cb82940'::uuid, '2026-10-29T20:47:00.000Z'::timestamptz, 'Atualizações chegam mais rápido', '**Melhoria**
O app verifica a cada 20 minutos e ao voltar para a janela; há "Verificar atualizações" em Configurações → Sobre.'),
('01a18964-1500-7473-b739-ba8390c3af97'::uuid, 'c1a29792-8784-5422-a849-fccd2568318b'::uuid, '2026-10-29T20:40:00.000Z'::timestamptz, 'Efeitos sonoros', '**Novo**
Sons próprios ao entrar e sair da voz, quando alguém entra, ao mutar, na transmissão e em mensagens. Volume em Notificações.'),
('01a1895b-d7a0-71f4-9611-56f8076c535d'::uuid, 'e5de495d-d46d-541e-8183-34ded39ee5ef'::uuid, '2026-10-29T20:31:00.000Z'::timestamptz, 'Transmissão em janela separada e seletor novo', '**Novo**
Abra a live numa janela própria, oculte os membros para deixar só a transmissão e escolha o que transmitir em miniaturas grandes.'),
('01a1893d-a140-71b2-8dcb-0d6ec2851705'::uuid, '0f82e152-db71-55a4-9abe-d2eab99879be'::uuid, '2026-10-29T19:58:00.000Z'::timestamptz, 'Live pela placa de vídeo', '**Melhoria**
O H.264 da transmissão passou a ser codificado pela GPU (NVENC e afins), com mais bitrate em cenas pesadas e áudio sempre junto.'),
('01a18923-1460-7090-a8d3-3cf48cc97d44'::uuid, '24e1e6a6-eaf4-5956-bb5c-b3891d4c722b'::uuid, '2026-10-29T19:29:00.000Z'::timestamptz, 'A live parou de piscar', '**Correção**
O vídeo não é mais reconectado a cada fala ou mute na chamada.'),
('01a1890b-46a0-73eb-ac9f-44fa04ee78fb'::uuid, '0fcbadbd-8c23-5799-a300-9f6f6fb84f4a'::uuid, '2026-10-29T19:03:00.000Z'::timestamptz, 'Atualização automática', '**Novo**
O app de Windows avisa quando há versão nova, baixa sozinho e mostra "Atualização pronta" na barra de título.'),
('01a188f3-78e0-715b-b015-0511fd3e91d5'::uuid, '387fa9c7-3d41-5f74-8505-e91208cf358c'::uuid, '2026-10-29T18:37:00.000Z'::timestamptz, 'Perfil e menu nas pessoas da voz', '**Novo**
Clique em quem está na voz para ver o perfil; botão direito para volume, silenciar só para você e moderação.'),
('01a188ec-25e0-7f81-ba5e-e05f52b2b966'::uuid, 'aac10997-c113-5f30-9f1d-d1f96afcee40'::uuid, '2026-10-29T18:29:00.000Z'::timestamptz, 'Supressão de ruído forte', '**Novo**
O microfone passa pelo RNNoise: some barulho de casa, ventilador e teclado.'),
('01a188d4-5820-7ba7-ac68-2ab2dc41625c'::uuid, '12515271-cdd4-5da9-9e32-b1b8e1423e5a'::uuid, '2026-10-29T18:03:00.000Z'::timestamptz, 'Ouvir quem está na chamada', '**Correção**
O áudio das outras pessoas passou a tocar em todas as plataformas.'),
('01a188bb-a000-7dc0-89fc-b85495afbf22'::uuid, 'c7094799-f528-5dc2-9815-389a0f4cd975'::uuid, '2026-10-29T17:36:00.000Z'::timestamptz, 'Apps para Windows, macOS e Linux', '**Novo**
Instaladores para as três plataformas no botão de download.'),
('01a188a0-28c0-75ce-854c-6be046fa8fd4'::uuid, '873d4897-a229-58b6-b085-4e536751a4cd'::uuid, '2026-10-29T17:06:00.000Z'::timestamptz, 'OpenCord no celular', '**Novo**
O app no navegador se adapta ao celular, com gavetas de canais e membros.'),
('01a186f0-f220-730e-8f68-a5f356856f50'::uuid, '21274eb1-6ca9-5ebb-80fb-32b37ad2c9fd'::uuid, '2026-10-29T09:15:00.000Z'::timestamptz, 'OpenCord nasce', '**Novo**
Servidores abertos, canais de texto, mensagens diretas, chamadas de voz com vídeo, transmissão de tela com áudio (Go Live), aparência personalizável e entrada só com apelido.');

DO $$
DECLARE
  v_server uuid;
  v_user uuid;
  v_channel uuid;
  v_kind text;
  v_msgs int;
  v_hash text := NULLIF(current_setting('oc.pwhash', true), '');
  v_added int;
BEGIN
  SELECT id INTO v_server FROM "Server" WHERE official ORDER BY "createdAt" LIMIT 1;
  IF v_server IS NULL THEN RAISE EXCEPTION 'nenhum servidor oficial'; END IF;

  -- conta @opencord: reaproveita se já for ela (mesmo e-mail); nunca toma o nome de outra pessoa
  SELECT id INTO v_user FROM "User" WHERE email = 'oficial@opencord.pro';
  IF v_user IS NULL THEN
    IF EXISTS (SELECT 1 FROM "User" WHERE username = 'opencord' OR "nickKey" = 'opencord') THEN
      RAISE EXCEPTION 'o nome opencord já pertence a outra conta';
    END IF;
    INSERT INTO "User" (id, email, username, "passwordHash", "displayName", "nickKey", "isInstanceAdmin", verified,
                        "emailVerifiedAt", "termsAcceptedAt")
    VALUES (gen_random_uuid(), 'oficial@opencord.pro', 'opencord', v_hash, 'OpenCord', 'opencord', true, true, now(), now())
    RETURNING id INTO v_user;
    RAISE NOTICE 'conta @opencord criada: %', v_user;
  ELSE
    UPDATE "User" SET "isInstanceAdmin" = true, verified = true WHERE id = v_user;
  END IF;
  INSERT INTO "ServerMember" ("serverId", "userId")
    SELECT id, v_user FROM "Server" WHERE official ON CONFLICT DO NOTHING;

  -- canal #novidades: usa o fórum que já existe, converte um canal de texto vazio ou cria um
  SELECT id, kind::text INTO v_channel, v_kind FROM "Channel"
    WHERE "serverId" = v_server AND lower(name) = 'novidades' AND kind IN ('text', 'forum')
    ORDER BY (kind = 'forum') DESC, position LIMIT 1;
  IF v_channel IS NULL THEN
    INSERT INTO "Channel" (id, "serverId", "categoryId", kind, name, topic, position)
    VALUES (gen_random_uuid(), v_server,
            (SELECT id FROM "Category" WHERE "serverId" = v_server ORDER BY position LIMIT 1),
            'forum', 'novidades', 'O que entrou no OpenCord, do mais novo para o mais antigo.',
            0)
    RETURNING id INTO v_channel;
    RAISE NOTICE 'canal #novidades criado: %', v_channel;
  ELSIF v_kind = 'text' THEN
    -- as mensagens antigas (as mesmas novidades, postadas como texto) saem da lista: apagadas do jeito normal
    -- ("deletedAt"), dá para voltar com UPDATE ... SET "deletedAt" = NULL
    UPDATE "Message" SET "deletedAt" = now()
      WHERE "channelId" = v_channel AND "deletedAt" IS NULL AND "authorId" <> v_user;
    GET DIAGNOSTICS v_msgs = ROW_COUNT;
    UPDATE "Channel" SET kind = 'forum', topic = COALESCE(topic, 'O que entrou no OpenCord, do mais novo para o mais antigo.')
      WHERE id = v_channel;
    RAISE NOTICE 'canal #novidades convertido para fórum (% mensagens antigas apagadas): %', v_msgs, v_channel;
  END IF;

  INSERT INTO "Message" (id, "authorId", "channelId", "requestId", body, mentions, title, "createdAt")
    SELECT id, v_user, v_channel, request_id, body, '{}', title, created_at FROM oc_posts
    ON CONFLICT ("authorId", "requestId") DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  RAISE NOTICE 'posts novos em #novidades: %', v_added;
END $$;

COMMIT;
