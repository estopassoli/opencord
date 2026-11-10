"""Movimento de referência (CC BY 4.0): lê os braços animados de um .glb de terceiros e devolve, quadro a quadro (30
qps), as matrizes no espaço da câmera de cada osso que interessa — só números; nada do arquivo é executado (só o
importador de glTF do Blender; o .blend que vem junto nunca é aberto). O modelo e a arma dele não vão para o jogo.

Fonte usada: "AK-74M" e "Pistol" de LokitoBlu (https://sketchfab.com/martinezequielgorno), CC BY 4.0.
Os ossos: `<l|r>_upperarm`, `_forearm`, `_wrist`, `_<dedo>_low|mid|tip`, `_thumb_low|mid|tip`; a arma `Gun`/`Weapon`,
o pente `Magazine`/`Mag`, a alavanca `Slide`; a câmera é um objeto preso ao osso `cam_controller`.
"""
import re

import bpy
from mathutils import Matrix, Vector


def _base(n):
    return re.sub(r'_\d+$', '', n)


def load(path):
    before = set(bpy.data.objects)
    acts0 = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    # os clipes deste arquivo (o nome ganha ".001" se outro arquivo já trouxe um igual)
    acts = {re.sub(r'\.\d{3}$', '', a.name): a for a in bpy.data.actions if a not in acts0}
    arm = next(o for o in new if o.type == 'ARMATURE')
    cam = next(o for o in new if o.name.startswith('Camera'))
    names = {_base(b.name): b.name for b in arm.pose.bones}
    return {'arm': arm, 'cam': cam, 'names': names, 'objs': new, 'actions': acts}


def gun_points(src, bone_base):
    """vértices presos (peso > .5) ao osso pedido, no espaço desse osso em repouso"""
    arm = src['arm']
    bn = src['names'][bone_base]
    b = arm.data.bones[bn]
    inv = (arm.matrix_world @ b.matrix_local).inverted()
    pts = []
    for o in src['objs']:
        if o.type != 'MESH' or not o.vertex_groups:
            continue
        gi = o.vertex_groups.get(bn)
        if gi is None:
            continue
        for v in o.data.vertices:
            for g in v.groups:
                if g.group == gi.index and g.weight > 0.5:
                    pts.append(inv @ (o.matrix_world @ v.co))
    return pts


def sample(src, action, bones, fps=30):
    """[(t, {osso: matriz no espaço da câmera (unidades do arquivo)})] do clipe"""
    arm, cam = src['arm'], src['cam']
    act = src['actions'][action]
    arm.animation_data.action = act
    f0, f1 = act.frame_range
    sfps = bpy.context.scene.render.fps
    n = int(round((f1 - f0) / sfps * fps))
    out = []
    for i in range(n + 1):
        t = i / fps
        fr = f0 + t * sfps
        bpy.context.scene.frame_set(int(fr), subframe=fr - int(fr))
        # sem a escala do objeto da câmera (no arquivo da pistola ela vem escalada)
        C = cam.matrix_world.normalized().inverted()
        mats = {}
        for b in bones:
            pb = arm.pose.bones[src['names'][b]]
            mats[b] = C @ arm.matrix_world @ pb.matrix
        out.append((t, mats))
    return out, (f1 - f0) / sfps


def rest(src, bones):
    """o descanso de cada osso no espaço do esqueleto do arquivo"""
    arm = src['arm']
    return {b: arm.matrix_world @ arm.data.bones[src['names'][b]].matrix_local for b in bones}
