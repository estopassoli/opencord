# Créditos dos modelos de armas

Os arquivos `ak47.glb`, `kar98k.glb`, `l115.glb`, `m4.glb`, `m9.glb`, `mp5.glb` e `mp7.glb` vêm do pacote
**Ultimate Low Poly Guns** (OpenGameArt), modelos de **TastyTony**, publicado por **Pichuliru**, sob a licença
[Creative Commons Attribution 4.0 (CC-BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

Modificações: convertidos para glTF binário no Blender, com escala, origem, materiais e ossos (pente, ferrolho,
alavanca, ferrolho girando, ferrolho da pistola) ajustados para as animações do gunfight.

O karambit e a baioneta M9 são modelados em código (`gunfight/models.ts`) e não vêm do pacote.

## Modelos Low Poly de TastyTony (Sketchfab)

Os arquivos abaixo são modelos de **TastyTony** (<https://sketchfab.com/TastyTony>) publicados no Sketchfab sob a
licença [Creative Commons Attribution 4.0 (CC-BY 4.0)](https://creativecommons.org/licenses/by/4.0/):

| Arquivo | Modelo |
| --- | --- |
| `rs9.glb` | [Low-Poly Haenel RS9](https://sketchfab.com/3d-models/low-poly-haenel-rs9-fec05d9d9ab440779e1b4be1fae2f2d9) |
| `msmc.glb` | [Low-Poly MSMC](https://sketchfab.com/3d-models/low-poly-msmc-8a7d4411c9524d1cbf0e2a7b56a5f097) |
| `mcx.glb` | [Low-Poly Sig MCX](https://sketchfab.com/3d-models/low-poly-sig-mcx-9a6f000c43644afe900669b6e7202378) |
| `scarl.glb` | [Low-Poly FN SCAR-L](https://sketchfab.com/3d-models/low-poly-fn-scar-l-b1e821e1e3464bdca3b34531c06f2952) |
| `mpx.glb` | [Low-Poly Sig MPX](https://sketchfab.com/3d-models/low-poly-sig-mpx-ac70a5fcfff348168d6f3ea2919522c7) |
| `automag3.glb` | [Low-Poly AMT Automag III](https://sketchfab.com/3d-models/low-poly-amt-automag-iii-5590aeae56ff4ae4ac8916f7ffef21fa) |
| `aks74u.glb` | [Low-Poly AKS-74U](https://sketchfab.com/3d-models/low-poly-aks-74u-4fc741a30b20477ea748f5d2837ac0b4) |
| `pdw.glb` | [Low-Poly Knight's Armament Company PDW](https://sketchfab.com/3d-models/low-poly-knights-armament-company-pdw-35067fc405144b86997c25a4d02f088f) |
| `sv98.glb` | [Low-Poly SV-98](https://sketchfab.com/3d-models/low-poly-sv-98-70b2eaf52c364e8a82093496097083fc) |
| `ballista.glb` | [Low-Poly FN Ballista](https://sketchfab.com/3d-models/low-poly-fn-ballista-a48cabe2de924953bf6c21bd27c20972) |
| `bfr.glb` | [Low-Poly Magnum Research BFR](https://sketchfab.com/3d-models/low-poly-magnum-research-bfr-01ebdd81370844efbbbeeb65ee07bb13) |
| `stg44.glb` | [Low-Poly StG 44](https://sketchfab.com/3d-models/low-poly-stg-44-ce9664cceafd4db4ac85ce8da874c687) |
| `rhino.glb` | [Low-Poly Chiappa Rhino](https://sketchfab.com/3d-models/low-poly-chiappa-rhino-e62c1611e0d14f839aac4100313e859d) |
| `m200.glb` | [Low-Poly CheyTac M200](https://sketchfab.com/3d-models/low-poly-cheytac-m200-5c9c318d77cc41a38323006b7aa07b1b) |
| `deagle.glb` | [Low-Poly Desert Eagle](https://sketchfab.com/3d-models/low-poly-desert-eagle-b81da261345f4462b2c4412352162287) |

Modificações (`apps/desktop/scripts/guns-build.py`, Blender): escala em metros (a Automag III com escala por eixo),
pose de descanso aplicada, esqueleto trocado por peças rígidas (pente, cartuchos, ferrolho, ferrolho da pistola,
alavanca, tambor, alça e massa, mira e empunhadura de fábrica), marca do gatilho, materiais sem textura.

A atribuição também aparece no app, no menu "Esta partida" do gunfight.

## Braços da primeira pessoa

`../arms.glb` (manga, luva sem dedos e mão com esqueleto de dedos) vem do **fps arms (rigged only)** de **para**
(OpenGameArt, <https://opengameart.org/content/fps-arms-rigged-only>), licença
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — sem atribuição obrigatória, registrada por cortesia.
Modificações (`apps/desktop/scripts/arms-build.py`): esqueleto limpo, escala em metros, braço, antebraço e falanges
esticados, manga e luva feitas a partir da malha, uma subdivisão.
