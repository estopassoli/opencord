# Pegada e recoil, rodada 2: teste da Rita (QA), 2026-11-09

Teste com pessoas e em Windows real: PENDENTE. Sondas e quadros em `scratchpad/rita-pr4/` (porta 5590).

## Checks (apps/desktop)
- `npx prettier --check src/features/space3d`: ok (antes e depois da correção)
- `npx tsc --noEmit -p .`: ok
- `npx eslint src test`: ok
- `npx vitest run`: 69 arquivos, 518 testes, todos passando

## Recuo medido (60 qps, `rc60.txt`; subida máxima da mira na rajada)
| Arma | quadril | mirando | agachado | tranco da vista | coice da arma (1ª p.) |
|---|---|---|---|---|---|
| M4 | 11,6° | 7,0° | 5,7° | 0,2° | 1,2 cm |
| AK-47 | 16,0° | 9,8° | 8,3° | 0,3° | 1,5 cm |
| MP7 | 8,2° | 4,6° | 4,2° | 0,1° | 0,7 cm |
| MP5 | 6,8° | 4,1° | 3,5° | 0,2° | 0,9 cm |
| L115 | 3,4° | 2,3° | 1,7° | 3,4° | 5,5 cm, sobe 7,3° |
| M200 | 4,3° | 2,5° | 2,2° | 3,9° | 5,9 cm |
| Kar98k | 3,3° | 2,2° | 1,6° | 2,9° | 4,5 cm |
| M9 | 2,1° | 1,3° | 1,2° | 0,4° | 1,2 cm, sobe 3,9° |
| Desert Eagle | 6,4° | 3,6° | 3,4° | 2,1° | 2,5 cm, sobe 10,2° |

Volta parcial por arma (`frac` 0,75–0,9). Impactos (`rc/plot_ads.png.png`): M4 sobe reto e puxa um pouco para a
direita no fim. AK faz o S, MP7 e MP5 sobem pouco, pistolas ficam juntas.

## Bom (visto nos quadros)
- Pegada na 1ª pessoa das 11 armas: indicador no gatilho, mão direita fechada no punho, karambit reversa com o dedo na
  argola, baioneta normal. Pistola com as duas mãos.
- Coice da L115 no quadril sobe e vem para trás, sem atravessar a câmera. Na luneta, os impactos ficam no retículo.
- Recargas da M4, L115, Desert Eagle e Kar98k: a mão vai ao pente, os cartuchos só aparecem com o pente fora.
  Ferrolho com a mão direita.
- Corrida tática e slide sem mão solta. Selo "Protegido" fora da mira.
- 3ª pessoa: coronha no ombro e mão esquerda no guarda-mão (fuzil, SMG e sniper). Pistola com as duas mãos.

## Corrigido por mim
- **Marca de tiro de perto parecia um adesivo de alvo** (`gunfight/fx.ts`, `markTexture`): o anel claro tinha opacidade
  igual (0,45) e borda seca. Agora some aos poucos (0,42 → 0,22 → 0), e o furo fica um pouco menor. Conferido em
  `z_mark.jpg` (antes) e `z_mark2.jpg` (depois).

## Ainda errado / aberto
1. **Média, pegada 3ª pessoa:** mirando, a arma fica na altura do peito, não sobe ao rosto. Fuzis e pistolas
   aparecem ~25 cm abaixo dos olhos, então de fora mal dá para saber se a pessoa mira (`SHOULDER_PT` y 0,96 no
   `holdGun`). Proposta (Téo): subir a coronha/pistola para perto da bochecha (y ≈ altura do queixo) e baixar a cabeça.
2. **Baixa, pegada 1ª pessoa:** no quadril, a mão esquerda no guarda-mão quase não aparece (só a ponta do polegar
   atrás do cano, nas M4, AK, MP7, MP5 e L115). Com a arma translúcida, os dedos não envolvem o guarda-mão.
3. **Baixa, recoil:** mirando, a Desert Eagle subiu só ~1,5° nos impactos em 6 tiros, porque volta entre os cliques.
   A câmera sobe 3,6°. Pede playtest para ver se o "alto e lento" se sente.
4. **Pendente de pessoas:** se o padrão de cada arma se aprende, a sensação do coice e se o bot "fácil" é justo. No
   `m4`, o bot matou a pessoa parada em ~6 s.
