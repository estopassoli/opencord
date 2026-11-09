# Memória — Iara Monteiro (som)

_Acrescente aprendizados curtos e datados. Não apague o que outros escreveram._

- 2026-11-09: time criado a pedido do mantenedor ("ainda está muito amador"). Primeira rodada: revisar o mundo 3D e refatorar os minigames para ficarem imersivos e autoexplicativos.
- 2026-11-09: o espaço 3D não tem nenhum efeito (0 AudioContext em features/space3d). Já existe sintetizador em `apps/desktop/src/lib/sounds.ts` (sink de saída, curva 0.35*vol², anti-rajada, `soundLog` p/ E2E): reaproveitar o mesmo AudioContext/sink no `sfx.ts` do jogo.
- 2026-11-09: armadilha — `sportplay.ts:221` só processa eventos da bola com a autoridade (`if (this.mine)`); som tem que sair do evento local de TODOS, ponto continua só da autoridade.
- 2026-11-09: `stepBall` (sports.ts) não emite evento de muro/tabela/aro/trave e `stepPool` (pool.ts) não emite choque bola-bola/tabela; quem assiste a sinuca só copia posições (derivar caçapa da troca `in` 0→1).
- 2026-11-09: corrida já gera eventos `boost`/`item` em race.ts, mas `scene.ts:332` só usa `lap`. Ducking pode usar `SceneParticipant.speaking` que a cena já recebe; distância pela mesma `spaceVoiceGain`.
- 2026-11-09: ADR-0055 descartou panorâmica/HRTF só para a voz; panorâmica leve nos efeitos exige adendo no ADR + DECISIONS.
- 2026-11-09 (P6): `store/voice` puxa o LiveKit e o supressor de ruído (AudioWorkletNode) e quebra o vitest num arquivo sem mocks: não importe em `sfx.ts`; o ensurdecido entra por `setSfxDeafened` chamado do SpaceView.
- 2026-11-09 (P6): mixagem é pura e testável (`sfxMix` ≤ 0,25·vol²); o ducking é aplicado no disparo (sons < 2 s), sem nó de ducking no grafo. Voz × efeito: só os efeitos têm panorâmica (±0,5).
- 2026-11-09 (P6): `SUPERSEDES` resolve eventos que saem juntos no mesmo quadro (lap+finalLap, punch+ko, count+go) sem mexer na ordem de emissão da cena. Motor da moto precisa parar no `visibilitychange` (sem rAF ninguém chama `listen`).
- 2026-11-09 (P6): `spaceVoiceGain(Infinity)` devolve 1 (voz de quem não está no espaço fica normal); para efeito de outra zona o filtro é por `zone`, não pela distância.
- 2026-11-09 (P6): ficou de fora pulo/aterrissar/sentar/passos e o "ding" ao concluir passo do tutorial (dá para ouvir `useTutorial.active.step`). Audição real nunca feita por agente: pendente com o mantenedor.
