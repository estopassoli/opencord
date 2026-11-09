# Pegada e recoil, rodada 1: teste da Rita (QA), 2026-11-09

## Checks (apps/desktop)
- **Antes e depois do meu ajuste:** prettier --check (space3d e testes), `tsc --noEmit -p .`, `eslint src test` e `vitest run` (69 arquivos, 512 testes) passam.
- **Teste manual com pessoas:** PENDENTE.

## Recoil medido (`rita-pr2/rc.cjs`, a 40 qps, subida máxima no quadril / mirando / agachado-mirando)
| Arma | Quadril | Mirando | Agachado | Fica 0,5 s depois de soltar | Coice 1ª pessoa |
|---|---|---|---|---|---|
| M4 | 11,6° | 7,0° | 5,7° | 2,6° | 1,2 cm, 1,4° |
| AK-47 | 17,1° | 10,5° | 8,9° | 4,4° | 1,5 cm, 2,0° |
| MP7 (40) | 8,2° | 4,6° | 4,2° | 1,7° | 0,7 cm, 0,9° |
| MP5 | 6,8° | 4,1° | 3,5° | 1,4° | 0,9 cm, 1,0° |
| L115 (5) | 3,4° | 2,3° | | 1,3° | 5,5 cm, 7,3° (tranco da vista 3,4°) |
| Kar98k (5) | 3,3° | 2,2° | | 1,2° | 4,5 cm, 6,3° |
| M9 (6) | 3,1° | 1,9° | | 0,6° | 1,2 cm, 3,9° |
| Desert Eagle (6) | 7,8° | 4,4° | | 3,1° | 2,5 cm, 10,2° |

- **Padrão mirando, tiro a tiro (sem dispersão):** fixo e aprendível.
  - AK: sobe ~1° por tiro nos 5 primeiros, vai para a esquerda até 1,7° no tiro 13 e depois serpenteia entre 0,9° e 1,5°. O "S de volta à direita" é pequeno e nunca cruza o centro.
  - M4: reta até o tiro 6, depois desce a ~0,8° para a direita.
  - SMG: baixas, com tremido no período 4 (MP7) e 5 (MP5).
- **Requisitos atendidos:** AK mais forte e mais lateral que a M4; SMG rápida e baixa; Deagle alta e lenta; M9 leve; sniper com coice forte e luneta subindo.

## O que vi nos quadros (folha e vídeo em `scratchpad/pegada-recoil-r1/`)
- **Bom:**
  - Pegada de punho com indicador no gatilho e mão de apoio no guarda-mão em toda arma longa.
  - Pistolas com as duas mãos, karambit reversa (golpe pesado agora com a mão fechada) e baioneta em martelo.
  - Recarga por pente-lâmina da Kar98k com a esquerda no guarda-mão.
  - 3ª pessoa com as mãos separadas: a esquerda fica a 3–5 cm do apoio e 17–26 cm da direita (antes ficavam juntas).
  - Pistolas na 3ª pessoa com os braços esticados.
- **Corrigi:** regressão do antebraço esquerdo.
  - **Defeito:** o antebraço tinha tamanho fixo (0,35 m), mas, no quadril, o pulso fica a 0,49–0,62 m do cotovelo. A ponta reta do antebraço aparecia solta no meio de baixo da tela (y≈520/540 na M4, AK, MP5, L115, M200 e Kar98k).
  - **Correção:** a manga estica até o cotovelo, que fica fora da tela, com teto de 2× (`viewmodel.ts` `placeArm`).
  - **Medida:** com `arm.cjs`, o vão caiu de 0,13–0,27 m para 0.

## Ainda errado (do mais grave ao menos)
1. **Média: cartuchos do modelo aparecem na mira de ferro.** Ficam dourados no meio de baixo da tela mirando (MP7, AK, M4) e por cima da M9 no quadril. São os ossos `bullet`/`bullets` dos .glb (M4, MP5, MP7), e na AK uma parte da própria malha. Esconder os ossos `bullet` fora da recarga (escala ~0) e conferir a recarga.
2. **Média: marcas de tiro pequenas e escuras.** Em parede escura, quase não aparecem: dá para ver o padrão, mas só de perto. Proposta: borda clara ou um pouco de poeira.
3. **Baixa: o selo "Protegido · atire para sair" fica logo abaixo da mira.** Cobre o alvo por 1,5 s.
4. **Baixa: antebraço continua um tubo grosso (0,043 m).** Fica mais grosso que o fuzil no quadril.
5. **Observação: Fácil matou a pessoa parada 2× em ~15 s no roteiro `sniper` (AK do Bot 2).** Como a pessoa não revida no roteiro, isso pode estar certo. Conferir com gente.
6. **Pendências que o Téo já listou:** a argola da karambit um pouco atrás do indicador e as pontas dos dedos na Kar98k.
