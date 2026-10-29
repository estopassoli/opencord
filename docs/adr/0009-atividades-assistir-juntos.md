# ADR-0009 — Atividades na chamada: "Assistir juntos" (YouTube)

- Status: aceito (2026-10-29)
- Decisores: mantenedor

## Contexto
O mantenedor quer "Apps" dentro da chamada de voz; o primeiro é assistir a um vídeo do YouTube junto com quem está
na chamada. Restrições do projeto: mídia só pela SFU (LiveKit), Socket.IO só para sinalização/estado, nada de
infraestrutura nova sem justificativa, tudo self-hostable.

## Decisão
- **O vídeo não passa pelo OpenCord.** Cada pessoa toca no **player oficial embutido do YouTube**
  (`youtube.com/embed`, sem a API JS externa: controle por `postMessage`). O OpenCord sincroniza só o **estado**:
  vídeo, tocando/pausado, posição no instante `updatedAt` (relógio do servidor) e revisão.
- Estado no **Redis** (`activity:<channelId>`, TTL 6 h), comandos com ACK pelo Socket.IO
  (`activity:get|youtube:start|youtube:control|stop`), evento `activity:state`/`activity:ended` para a sala do servidor
  (indicador na barra lateral). Só **quem está na chamada** vê e controla. Chamada vazia encerra a atividade.
- O player fica **sem controles do YouTube**; play/pausa/pulo vêm da barra do OpenCord e viram ações do grupo.
  O player de cada um só **segue** o estado (corrige desvio > 2 s, sem anunciar nada). Assim um anúncio que aparece
  só para alguém não mexe na sessão dos outros; quando acaba, a pessoa vai para o ponto do grupo.
- **Anúncios não são bloqueados** (termos do YouTube; risco de o player embutido ser recusado). Quem tem Premium
  logado no YouTube (no navegador; no app, futura janela de login) não vê anúncios. O app **não lê cookies de outros
  navegadores** (seria extrair credenciais de outro programa).
- Título/canal pelo **oEmbed público** (sem chave). **Pesquisa** só com `YOUTUBE_API_KEY` (YouTube Data API v3,
  cota grátis ~100 buscas/dia); sem a chave, só por link.
- App desktop: CSP `frame-src` para o YouTube e `Referer: https://opencord.pro/` só nas requisições do embed
  (páginas `file://` não enviam Referer e o YouTube recusa o player sem ele — "erro 153").

## Alternativas descartadas
- Retransmitir o vídeo pelo Go Live/SFU: qualidade menor, banda do servidor e do anfitrião; continua disponível
  manualmente (transmitir uma aba).
- Controles nativos do YouTube com detecção de pulos: confundia anúncios com ações e propagava saltos errados.
- Carregar `youtube.com/iframe_api`: exigiria liberar script externo na CSP.

## Consequências
- Cada espectador precisa alcançar o YouTube; vídeos com incorporação desativada pelo dono não tocam.
- Sincronia boa para assistir (± 2 s), não para sincronia de áudio perfeita.
- Novas atividades seguem o mesmo modelo (estado no Redis + comandos com ACK, mídia de terceiros no cliente).
