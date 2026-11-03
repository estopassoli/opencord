# ADR-0041: Catálogo do Spotify na música da chamada

Status: Accepted (pedido do mantenedor, 2026-11-03)

## Contexto
O mantenedor pediu Spotify nas atividades: pesquisar músicas e playlists e tocar direto na call, oferecendo uma conta
Premium para tocar para todos. Isso não foi feito: os termos do Spotify proíbem tocar de uma fonte para vários
ouvintes ao mesmo tempo, o áudio tem DRM, e o "ouvir junto" com a conta de cada um exige Premium de todos e, em 2026,
a Web API limita apps fora de empresas grandes a poucos usuários. Escolha do mantenedor: Spotify como catálogo e
cada faixa tocada pelo correspondente no player oficial da música da chamada (ADR-0014).

Também pedido e recusado: esconder o player e fazer a interface idêntica à do Spotify. O player oficial continua
visível no modo expandido (termos da API do YouTube; o modo minimizado segue a revisão da ADR-0014). A interface fica no
visual do OpenCord, com o crédito do Spotify exigido pelas diretrizes de marca dele (capas, nomes, "Conteúdo do
Spotify", "Abrir no Spotify"). Os textos não citam a origem do áudio.

## Decisão
- `SpotifyService` (API): token por client credentials (`SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET`), pesquisa
  `GET /activities/spotify/search` (faixas, álbuns, playlists, mercado BR) e faixas de um link (`track`, `album`,
  `playlist`, até a vaga da fila, paginando).
- `music:add` aceita `spotify: { kind, id }`; o app lê os links (`parseSpotifyLink`: open.spotify.com com
  `intl-xx`/`embed`, e `spotify:kind:id`) e, sem link, pesquisa.
- A faixa entra na fila com `spotify` (capa, artistas, álbum, duração, link) e `videoId` nulo. O correspondente é
  resolvido só para a atual e a próxima (`MusicService.resolveAhead`, antes de publicar): busca na Data API do YouTube
  (`search` + `videos` para a duração), nota por duração, título, artista e canal oficial; versões ao vivo, cover e
  remix perdem pontos; nota baixa = sem correspondente. Cache no Redis: 30 dias para o achado, 1 dia para "sem".
- Sem correspondente: `unavailable: true`, a fila mostra "Não foi possível tocar esta faixa" e pula para a próxima;
  `jump` para ela é recusado.
- `InstanceInfo.spotify` liga a pesquisa no app só com as chaves do Spotify e a do YouTube.

## Consequências
- Cota da Data API do YouTube (10 mil unidades por dia por padrão): cada faixa nova custa ~101 unidades, cerca de
  100 faixas novas por dia; repetidas saem do cache. Falha de cota não grava "sem correspondente" (tenta depois).
- A correspondência pode trazer outra gravação da mesma música; a nota mínima evita tocar coisa diferente.
- Sem migração: estado no Redis, como a fila de música.
- O crédito usa texto e link; o logotipo oficial do Spotify (arquivos da página de marca deles) pode substituir o
  ícone genérico quando o mantenedor baixar os arquivos.

## Evidências (2026-11-03)
- `apps/api/test/spotify-music.int.test.ts` 4/4 com stubs do Spotify e do YouTube: pesquisa, playlist com faixa sem
  correspondente marcada e pulada, só a atual e a próxima resolvidas, cache sem nova busca, álbum com capa, link
  inexistente recusado, nota do candidato (canal oficial vence ao vivo; duração muito diferente é descartada).
  Suíte 208/208; contratos 23/23 (`parseSpotifyLink`); desktop typecheck/lint/unit 209/209.
- Não validado com as chaves reais nem visualmente no app (sem chaves locais).
