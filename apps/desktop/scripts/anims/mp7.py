# Animações de primeira pessoa do MP7 feitas à mão, quadro a quadro (ADR-0061). Roda no Blender sem interface:
#
#   blender -b --factory-startup -P apps/desktop/scripts/anims/mp7.py -- holds [variante...]  # pegadas (~15 min)
#   blender -b --factory-startup -P apps/desktop/scripts/anims/mp7.py -- bake       # assa os clipes e exporta
#   blender -b --factory-startup -P apps/desktop/scripts/anims/mp7.py -- bake --render DIR [clip...]
#
# Lê só arquivos do próprio repositório (os braços `assets/arms.glb`, a arma `assets/guns/mp7.glb` e o
# `gunfight/armsrig.ts`). Escreve:
# - `apps/desktop/scripts/anims/mp7-holds.json` (as pegadas encaixadas na malha);
# - `apps/desktop/src/features/space3d/assets/anims/mp7.glb` (só o esqueleto e os clipes);
# - `apps/desktop/src/features/space3d/gunfight/fpclips-mp7.ts` (a pose de quadril, os eventos e as pegadas por
#   acessório, para as camadas do jogo);
# - `<repo>/.anim-report/mp7.json` com a folga de cada falange até a arma em cada quadro (fora do git).
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))

import bpy  # noqa: E402

from fpanim import bake  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['bake']
mode = args[0]
bpy.ops.wm.read_factory_settings(use_empty=True)
if mode == 'holds':
    bake.fit_all(REPO, os.path.join(HERE, 'mp7-holds.json'), args[1:])
elif mode == 'retarget':
    # movimento de referência (CC BY 4.0): ANIM_SRC aponta a pasta com ak74m/model.glb e pistol/model.glb
    render = None
    rest = args[1:]
    if '--render' in rest:
        render = rest[rest.index('--render') + 1]
    bake.bake_retarget(REPO, os.path.join(HERE, 'mp7-holds.json'), os.environ['ANIM_SRC'], render)
else:
    render = None
    only = []
    rest = args[1:]
    if '--render' in rest:
        i = rest.index('--render')
        render = rest[i + 1]
        only = rest[i + 2:]
    bake.bake_all(REPO, os.path.join(HERE, 'mp7-holds.json'), render, only)
