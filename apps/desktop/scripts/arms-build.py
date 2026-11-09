# Braços da primeira pessoa do gunfight (assets/arms.glb), feitos a partir do "fps arms (rigged only)" de para
# (OpenGameArt, CC0: https://opengameart.org/content/fps-arms-rigged-only). Uso, com o .blend do pacote baixado:
#
#   blender -b --disable-autoexec "FPS ARMS RIG 1.blend" -P scripts/arms-build.py -- saida/arms.glb
#
# O que muda em relação ao original:
# - esqueleto limpo, sem controles nem restrições: braço → antebraço → mão → metacarpos → 3 falanges por dedo e polegar
#   de 3 ossos (os pesos da clavícula e do deltoide vão para o braço);
# - em metros, a mão do tamanho da mão antiga do jogo (pulso até o nó do médio ~9 cm), braço e antebraço esticados
#   para medidas de adulto (os vértices esticam junto, em linha);
# - manga (cópia inflada do braço e do antebraço até perto do pulso, com a borda dobrada para dentro) e luva sem dedos
#   (as falanges do meio e da ponta ficam de pele): três materiais, que o jogo troca pelos dele;
# - uma subdivisão aplicada (a malha original é baixa) e sombreamento suave.
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = sys.argv[sys.argv.index('--') + 1]
KNUCKLE = 0.09  # pulso → nó do médio (m)
UPPER = 0.29  # ombro → cotovelo
FORE = 0.26  # cotovelo → pulso
SLEEVE_END = 0.8  # a manga vai até 80% do antebraço
SLEEVE_IN = 0.012  # folga da manga no ombro e no cotovelo
SLEEVE_CUFF = 0.008  # e no punho

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = next(o for o in bpy.data.objects if o.type == 'MESH')
if arm.animation_data:
    arm.animation_data_clear()
for pb in arm.pose.bones:
    for c in list(pb.constraints):
        pb.constraints.remove(c)
arm.data.pose_position = 'REST'
bpy.context.view_layer.update()

FINGERS = ['index', 'middle', 'ring', 'pinky']


def rename(n):
    """nome do osso original → nome novo (None: some, o peso vai para o braço)"""
    base, side = n[:-2], n[-1].lower()
    if base in ('clavicle', 'deltoid', 'upper_arm'):
        return 'upperarm_' + side
    if base == 'forearm':
        return 'forearm_' + side
    if base == 'hand':
        return 'hand_' + side
    if base.startswith('palm_'):
        return base + '_' + side
    if base.startswith('f_'):
        f, k = base[2:].split('.')
        return f'{f}{int(k)}_{side}'
    if base.startswith('thumb.'):
        return f'thumb{int(base[6:])}_{side}'
    return None


def parent_of(n):
    base, side = n[:-2], n[-2:]
    if base == 'upperarm':
        return None
    if base == 'forearm':
        return 'upperarm' + side
    if base == 'hand':
        return 'forearm' + side
    if base.startswith('palm_'):
        return 'hand' + side
    for f in FINGERS:
        if base == f + '1':
            return 'palm_' + f + side
        if base.startswith(f):
            return f + str(int(base[-1]) - 1) + side
    if base == 'thumb1':
        return 'hand' + side
    if base.startswith('thumb'):
        return 'thumb' + str(int(base[-1]) - 1) + side


M0 = arm.matrix_world.copy()
bones = {}
for b in arm.data.bones:
    n = rename(b.name)
    if not n or b.name.startswith(('clavicle', 'deltoid')):
        continue
    m = M0 @ b.matrix_local
    bones[n] = {'head': M0 @ b.head_local, 'tail': M0 @ b.tail_local, 'z': (m.to_3x3() @ Vector((0, 0, 1))).normalized()}

# escala: pulso até o nó do médio
S = KNUCKLE / (bones['middle1_r']['head'] - bones['hand_r']['head']).length
center = (bones['upperarm_r']['head'] + bones['upperarm_l']['head']) / 2
for b in bones.values():
    b['head'] = (b['head'] - center) * S
    b['tail'] = (b['tail'] - center) * S

# malha (pose de descanso) no mesmo espaço, com os pesos já renomeados
me = body.data
gname = {g.index: g.name for g in body.vertex_groups}
verts = []
for v in me.vertices:
    co = ((body.matrix_world @ v.co) - center) * S
    w = {}
    for g in v.groups:
        n = rename(gname[g.group])
        if n and g.weight > 0:
            w[n] = w.get(n, 0) + g.weight
    tot = sum(w.values()) or 1
    verts.append({'co': co, 'w': {k: x / tot for k, x in w.items()}})


def stretch(side):
    """estica braço e antebraço do lado, levando junto o que vem depois (vértices e ossos)"""
    sh, el, wr = (bones[n + side]['head'].copy() for n in ('upperarm_', 'forearm_', 'hand_'))

    def move(p, a, b, length):
        d = b - a
        L = d.length
        t = max(0.0, min(1.0, (p - a).dot(d) / (L * L)))
        return p + d.normalized() * (length - L) * t

    for a, b, L in ((sh, el, UPPER), (None, None, FORE)):
        if a is None:
            a, b = bones['forearm_' + side]['head'].copy(), bones['hand_' + side]['head'].copy()
        for v in verts:
            if sum(x for k, x in v['w'].items() if k.endswith('_' + side)) >= 0.5:
                v['co'] = move(v['co'], a, b, L)
        for n, bb in bones.items():
            if n.endswith('_' + side):
                bb['head'] = move(bb['head'], a, b, L)
                bb['tail'] = move(bb['tail'], a, b, L)


stretch('r')
stretch('l')

# dedos: as falanges do modelo são curtas (o médio ~7,4 cm para uma palma de 9 cm; numa mão adulta, ~9 cm) e não
# davam a volta num punho de arma; esticadas ao longo do dedo, a da base mais que as outras
FINGER_SCALE = (1.45, 1.15, 1.05)


def lengthen(side):
    for f in FINGERS:
        k = bones[f'{f}1_{side}']['head'].copy()
        p = bones[f'{f}2_{side}']['head'].copy()
        d = bones[f'{f}3_{side}']['head'].copy()
        tip = bones[f'{f}3_{side}']['tail'].copy()
        axis = (tip - k).normalized()
        l1 = (p - k).dot(axis)
        l2 = (d - p).dot(axis)

        def remap(s):
            a1, a2, a3 = FINGER_SCALE
            if s <= 0:
                return s
            if s <= l1:
                return s * a1
            if s <= l1 + l2:
                return l1 * a1 + (s - l1) * a2
            return l1 * a1 + l2 * a2 + (s - l1 - l2) * a3

        def move(q, w=1.0):
            s = (q - k).dot(axis)
            return q + axis * (remap(s) - s) * w

        chain = {f'{f}{i}_{side}' for i in (1, 2, 3)}
        for v in verts:
            w = sum(x for n, x in v['w'].items() if n in chain)
            if w > 0:
                v['co'] = move(v['co'], w)
        for n in chain:
            bones[n]['head'] = move(bones[n]['head'])
            bones[n]['tail'] = move(bones[n]['tail'])


lengthen('r')
lengthen('l')


def side_of(v):
    return 'r' if sum(x for k, x in v['w'].items() if k.endswith('_r')) >= 0.5 else 'l'


def fore_t(p, side):
    a, b = bones['forearm_' + side]['head'], bones['hand_' + side]['head']
    d = b - a
    return (p - a).dot(d) / d.length_squared


HAND_CHAIN = ('hand', 'palm', 'thumb') + tuple(FINGERS)


def dominant(v):
    return max(v['w'].items(), key=lambda kv: kv[1])[0] if v['w'] else ''


def is_hand(v):
    return dominant(v).startswith(HAND_CHAIN)


# monta a malha nova
bm = bmesh.new()
dl = bm.verts.layers.deform.verify()
names = sorted(bones)
gi = {n: i for i, n in enumerate(names)}
bv = []
for v in verts:
    x = bm.verts.new(v['co'])
    for n, w in v['w'].items():
        x[dl][gi[n]] = w
    bv.append(x)
bm.verts.ensure_lookup_table()
for p in me.polygons:
    try:
        bm.faces.new([bv[i] for i in p.vertices])
    except ValueError:
        pass
bm.normal_update()

info = {}
for x, v in zip(bv, verts):
    s = side_of(v)
    info[x] = (s, fore_t(v['co'], s), is_hand(v), dominant(v))

# materiais: 0 manga, 1 luva, 2 pele (falanges do meio e da ponta)
SKIN_BONES = tuple(f'{f}{k}_' for f in FINGERS for k in (2, 3)) + ('thumb3_',)
for f in bm.faces:
    doms = [info[x][3] for x in f.verts]
    f.material_index = 2 if all(d.startswith(SKIN_BONES) for d in doms) else 1
    f.smooth = True


def sleeved(x):
    s, t, hand, _ = info[x]
    return not hand and t < SLEEVE_END


# manga: cópia das faces cobertas, inflada pela normal (mais folgada no ombro), com a borda do punho dobrada para dentro
cover = [f for f in bm.faces if all(sleeved(x) for x in f.verts)]
copy = {}
for f in cover:
    for x in f.verts:
        if x in copy:
            continue
        t = max(0.0, min(1.0, info[x][1]))
        k = SLEEVE_IN + (SLEEVE_CUFF - SLEEVE_IN) * (t / SLEEVE_END)
        y = bm.verts.new(x.co + x.normal * k)
        for g, w in x[dl].items():
            y[dl][g] = w
        copy[x] = y
        info[y] = info[x]
new_faces = []
for f in cover:
    nf = bm.faces.new([copy[x] for x in f.verts])
    nf.material_index = 0
    nf.smooth = True
    new_faces.append(nf)
# borda do punho: as arestas da manga que só têm uma face e ficam no antebraço
for f in new_faces:
    for e in f.edges:
        if len(e.link_faces) != 1:
            continue
        a, b = e.verts
        if min(info[a][1], info[b][1]) < SLEEVE_END - 0.25:
            continue
        ins = []
        for y in (a, b):
            src = next(x for x, c in copy.items() if c is y)
            z = bm.verts.new(src.co + src.normal * 0.0015)
            for g, w in y[dl].items():
                z[dl][g] = w
            ins.append(z)
        try:
            rf = bm.faces.new([b, a, ins[0], ins[1]])
            rf.material_index = 0
            rf.smooth = True
        except ValueError:
            pass
# a pele escondida pela manga sai (fica uma faixa embaixo da borda, para não abrir fresta ao dobrar)
hidden = [f for f in bm.faces if f.material_index != 0 and all(
    (not info[x][2]) and info[x][1] < SLEEVE_END - 0.12 for x in f.verts)]
bmesh.ops.delete(bm, geom=hidden, context='FACES')
bmesh.ops.remove_doubles(bm, verts=[v for v in bm.verts if v.is_valid], dist=1e-6)
loose = [v for v in bm.verts if not v.link_faces]
bmesh.ops.delete(bm, geom=loose, context='VERTS')

mesh = bpy.data.meshes.new('arms')
bm.to_mesh(mesh)
bm.free()
for n, c in (('manga', (0.17, 0.2, 0.15)), ('luva', (0.08, 0.08, 0.08)), ('pele', (0.75, 0.55, 0.42))):
    m = bpy.data.materials.new(n)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*c, 1)
    mesh.materials.append(m)

# limpa a cena e monta o objeto novo
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
obj = bpy.data.objects.new('arms', mesh)
bpy.context.scene.collection.objects.link(obj)
for n in names:
    obj.vertex_groups.new(name=n)

ad = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('rig', ad)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for n in names:
    b = bones[n]
    e = ad.edit_bones.new(n)
    e.head, e.tail = b['head'], b['tail']
    e.align_roll(b['z'])
    eb[n] = e
for n in names:
    p = parent_of(n)
    if p:
        eb[n].parent = eb[p]
bpy.ops.object.mode_set(mode='OBJECT')
obj.parent = rig
mod = obj.modifiers.new('rig', 'ARMATURE')
mod.object = rig

# subdivisão aplicada (antes da armadura: os pesos são interpolados)
bpy.context.view_layer.objects.active = obj
sub = obj.modifiers.new('sub', 'SUBSURF')
sub.levels = 1
sub.render_levels = 1
bpy.ops.object.modifier_move_to_index(modifier='sub', index=0)
bpy.ops.object.modifier_apply(modifier='sub')

bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
rig.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_skins=True,
    export_animations=False,
    export_morph=False,
    export_texcoords=False,
    export_materials='EXPORT',
)
print('OK', OUT, 'verts', len(mesh.vertices), 'faces', len(mesh.polygons), 'S', S)
