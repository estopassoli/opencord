# Armas do gunfight vindas dos modelos "Low Poly" de TastyTony no Sketchfab (CC-BY 4.0, ver
# `src/features/space3d/assets/guns/CREDITS.md`). Converte o .glb baixado do Sketchfab para o formato que o
# `gunfight/models.ts` espera (o mesmo das armas do pacote Ultimate Low Poly Guns). Uso, um modelo por vez:
#
#   blender -b --factory-startup -P scripts/guns-build.py -- baixados/rs9.glb saida/rs9.glb rs9
#
# Só lê a geometria e os materiais do arquivo (nada de script dele roda: --factory-startup e sem auto-exec).
# O que sai:
# - em metros, do comprimento da arma de verdade (`LENGTH`), cano para +x, cima para +y (glTF), sem esqueleto: cada
#   peça que mexe vira um nó com o nome que o jogo procura (`mag`, `bullets`, `bolt`, `boltmove`, `boltrotate`,
#   `slide`, `charginghandle`, `bolthandle`), com o pivô no lugar do osso, e a malha dela por baixo;
# - a pose de descanso do esqueleto aplicada nos vértices (os ossos somem: as peças são rígidas);
# - cada vértice vai para a peça do osso de maior peso (ou do ancestral mais perto que seja peça; o resto é o corpo);
# - nos modelos sem esqueleto, as peças saem pelos nomes das malhas (`OBJ_PARTS`);
# - a mira e a empunhadura vertical que vêm montadas (MSMC, MCX) viram os nós `optic` e `foregrip` (o jogo esconde
#   quando se monta outra peça do armeiro);
# - um nó `trigger` vazio na frente da lâmina do gatilho (`TRIGGER`, em metros, antes de centrar): o jogo põe a
#   origem da arma nele;
# - malhas da mesma peça juntadas numa só (uma chamada de desenho por material), sem UV nem cor de vértice.
import re
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

SRC, OUT, GID = sys.argv[sys.argv.index('--') + 1 :][:3]

# comprimento total da arma de verdade (m), na configuração do modelo (coronha aberta)
LENGTH = {
    'rs9': 1.25,
    'msmc': 0.62,
    'mcx': 0.86,
    'scarl': 0.89,
    'mpx': 0.66,
    'automag3': 0.25,
    'aks74u': 0.73,
    'pdw': 0.68,
    'sv98': 1.2,
    'ballista': 1.3,
    'bfr': 0.375,
    'stg44': 0.94,
    'rhino': 0.29,
    'm200': 1.35,
    'deagle': 0.27,
}

# modelos de proporção estilizada: comprimento, largura e altura finais (m), escala por eixo. A Automag do arquivo é
# baixa e larga demais para uma pistola (com o comprimento de verdade, o punho não cabia na mão)
DIMS = {
    'automag3': (0.25, 0.034, 0.13),
}

# nome limpo do osso (sem o número do Sketchfab, sem espaço, minúsculo) → peça do jogo
PART_OF_BONE = {
    'mag': 'mag',
    'bullet': 'bullets',
    'bullets': 'bullets',
    'bolt': 'bolt',
    'boltmove': 'boltmove',
    'boltrotate': 'boltrotate',
    'slide': 'slide',
    'charginghandle': 'charginghandle',
    'bolthandle': 'bolthandle',
}
# por arma: osso → outra peça (o ferrolho da SV-98 gira e corre junto, como o da M200)
BONE_OVERRIDE = {
    'sv98': {'bolt': 'boltrotate'},
}
# peças sem esqueleto: nome da malha (sem o sufixo do primitivo) → peça
OBJ_PARTS = {
    'msmc': {'optic': ['Object_25', 'Object_26', 'Object_27', 'Object_28'], 'foregrip': ['Object_30', 'Object_31', 'Object_32']},
    'mcx': {'optic': ['Object_33', 'Object_34', 'Object_35', 'Object_36'], 'foregrip': ['Object_29', 'Object_30', 'Object_31']},
    'm200': {'mag': ['Cube.003_0'], 'bullets': ['Cube.003_1', 'Cube.003_2', 'Cube.003_3'], 'boltrotate': ['Cylinder.022_0', 'Cylinder.022_1', 'Cylinder.022_2']},
    'ballista': {'mag': ['Cube.004_0', 'Cube.011_0'], 'boltrotate': ['Cylinder.036_0', 'Cylinder.012_0']},
    'bfr': {'mag': ['Cylinder.001_0', 'Cylinder.010_0']},
    'rhino': {'mag': ['Cylinder.004_0', 'Cylinder.004_1']},
}
# peças tiradas do corpo por caixa (metros na escala final, centro da arma em 0: x de, x até, z de, z até): a alça e a
# massa que deitam quando se monta uma mira do armeiro (nó `irons`)
BOX_PARTS = {
    'scarl': [('irons', -0.19, -0.15, 0.083, 0.2), ('irons', 0.215, 0.255, 0.083, 0.2)],
    'mpx': [('irons', -0.065, -0.018, 0.107, 0.2), ('irons', 0.24, 0.29, 0.107, 0.2)],
    'pdw': [('irons', -0.08, -0.035, 0.0915, 0.2), ('irons', 0.155, 0.2, 0.0915, 0.2)],
    'aks74u': [('irons', 0.0, 0.08, 0.109, 0.2)],
    'stg44': [('irons', -0.005, 0.075, 0.0905, 0.2)],
}
# hierarquia das peças (filho → pai) quando não vem do esqueleto
PARENT = {'bullets': 'mag', 'boltrotate': 'boltmove'}
# malhas que não entram (ajudantes do arquivo)
DROP = {'Icosphere'}
# frente da lâmina do gatilho, no meio da altura dela (x para a frente, z para cima, em metros já na escala final e
# com o centro da caixa da arma em 0), medida nas vistas de lado com grade de 1 cm. O nó `trigger` fica 7 mm atrás e
# 18 mm acima dela (onde fica o pivô do gatilho nas armas do pacote antigo): o jogo põe a origem da arma por ele.
TRIGGER = {
    'rs9': (-0.252, -0.05),
    'msmc': (0.04, -0.002),
    'mcx': (-0.144, -0.016),
    'scarl': (-0.093, -0.022),
    'mpx': (-0.007, 0.002),
    'automag3': (-0.026, 0.009),
    'aks74u': (-0.037, 0.026),
    'pdw': (-0.037, 0.003),
    'sv98': (-0.245, -0.034),
    'ballista': (-0.255, -0.038),
    'bfr': (-0.078, -0.011),
    'stg44': (-0.1, 0.018),
    'rhino': (-0.037, -0.01),
    'm200': (-0.33, -0.049),
    'deagle': (-0.029, 0.008),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
dg = bpy.context.evaluated_depsgraph_get()


def clean(n):
    n = re.sub(r'_(end_)?\d+$', '', n)
    return n.replace(' ', '').lower()


arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
bone_part = {}
if arm:
    over = BONE_OVERRIDE.get(GID, {})
    for b in arm.data.bones:
        k = None
        q = b
        while q is not None and k is None:
            c = clean(q.name)
            k = over.get(c) or PART_OF_BONE.get(c)
            q = q.parent
        bone_part[b.name] = k or 'body'
    # pais das peças pelo esqueleto
    for b in arm.data.bones:
        c = clean(b.name)
        p = over.get(c) or PART_OF_BONE.get(c)
        if not p:
            continue
        q = b.parent
        while q is not None:
            cq = clean(q.name)
            pq = over.get(cq) or PART_OF_BONE.get(cq)
            if pq and pq != p:
                PARENT[p] = pq
                break
            q = q.parent

obj_part = {}
for part, names in OBJ_PARTS.get(GID, {}).items():
    for n in names:
        obj_part[n] = part

# 1) cada malha na pose de descanso, em coordenadas do mundo, separada por peça
pieces = {}  # peça → [objetos novos]
for o in list(bpy.data.objects):
    if o.type != 'MESH' or o.name in DROP or not o.data.materials:
        continue
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=False, depsgraph=dg)
    me.transform(o.matrix_world)
    if o.matrix_world.determinant() < 0:
        me.flip_normals()
    vg = o.vertex_groups
    owner = []
    for v in o.data.vertices:
        if v.groups and arm:
            g = max(v.groups, key=lambda g: g.weight)
            owner.append(bone_part.get(vg[g.group].name, 'body'))
        else:
            owner.append(obj_part.get(o.name, 'body'))
    parts_here = sorted(set(owner))
    for part in parts_here:
        m2 = me.copy()
        bm = bmesh.new()
        bm.from_mesh(m2)
        bm.verts.ensure_lookup_table()
        kill = [f for f in bm.faces if owner[f.verts[0].index] != part]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        bm.to_mesh(m2)
        bm.free()
        if not m2.polygons:
            bpy.data.meshes.remove(m2)
            continue
        ob = bpy.data.objects.new(f'{GID}_{part}_{len(pieces.get(part, []))}', m2)
        bpy.context.scene.collection.objects.link(ob)
        pieces.setdefault(part, []).append(ob)
    bpy.data.meshes.remove(me)

# 2) tira o original (malhas, esqueleto e nós vazios)
keep = {ob for lst in pieces.values() for ob in lst}
for o in list(bpy.data.objects):
    if o not in keep:
        bpy.data.objects.remove(o, do_unlink=True)

# 3) escala e centro: o comprimento em x vira `LENGTH`, o centro da caixa vai para a origem
mn = Vector((1e9,) * 3)
mx = Vector((-1e9,) * 3)
for ob in keep:
    for v in ob.data.vertices:
        mn = Vector(map(min, mn, v.co))
        mx = Vector(map(max, mx, v.co))
s = LENGTH[GID] / (mx.x - mn.x)
c = (mn + mx) / 2
S = Matrix.Scale(s, 4)
if GID in DIMS:
    dx, dy, dz = DIMS[GID]
    S = Matrix.Diagonal((dx / (mx.x - mn.x), dy / (mx.y - mn.y), dz / (mx.z - mn.z), 1))
T = S @ Matrix.Translation(-c)
for ob in keep:
    ob.data.transform(T)
# peças por caixa: as faces do corpo inteiras dentro da caixa vão para a peça
for part, x0, x1, z0, z1 in BOX_PARTS.get(GID, []):
    for ob in list(pieces.get('body', [])):
        me = ob.data
        bm = bmesh.new()
        bm.from_mesh(me)
        inside = lambda f: all(x0 <= v.co.x <= x1 and z0 <= v.co.z <= z1 for v in f.verts)
        if not any(inside(f) for f in bm.faces):
            bm.free()
            continue
        m2 = me.copy()
        bm2 = bmesh.new()
        bm2.from_mesh(m2)
        bmesh.ops.delete(bm2, geom=[f for f in bm2.faces if not inside(f)], context='FACES')
        bm2.to_mesh(m2)
        bm2.free()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if inside(f)], context='FACES')
        bm.to_mesh(me)
        bm.free()
        nb = bpy.data.objects.new(f'{GID}_{part}_box', m2)
        bpy.context.scene.collection.objects.link(nb)
        pieces.setdefault(part, []).append(nb)
        keep.add(nb)

# meia largura do corpo (o eixo do cano fica em y = 0 depois de centrar)
bmn = Vector((1e9,) * 3)
bmx = Vector((-1e9,) * 3)
for ob in pieces.get('body', []):
    for v in ob.data.vertices:
        bmn = Vector(map(min, bmn, v.co))
        bmx = Vector(map(max, bmx, v.co))
cy = (bmn.y + bmx.y) / 2


def part_box(part):
    a = Vector((1e9,) * 3)
    b = Vector((-1e9,) * 3)
    for ob in pieces.get(part, []):
        for v in ob.data.vertices:
            a = Vector(map(min, a, v.co))
            b = Vector(map(max, b, v.co))
    return a, b


# 4) juntar cada peça numa malha e pôr debaixo de um nó vazio no pivô
def pivot(part):
    a, b = part_box(part)
    if part == 'boltrotate':
        # o ferrolho gira em volta do eixo dele: o meio do corpo (perto do centro da arma em y), não a alavanca
        zs = [v.co.z for ob in pieces[part] for v in ob.data.vertices if abs(v.co.y - cy) < 0.006]
        z = (min(zs) + max(zs)) / 2 if zs else (a.z + b.z) / 2
        x = (a.x + b.x) / 2
        return Vector((x, cy, z))
    return (a + b) / 2


root = bpy.data.objects.new(GID, None)
bpy.context.scene.collection.objects.link(root)
nodes = {}
pvs = {}
order = [p for p in pieces if p != 'body']
# pais antes dos filhos
order.sort(key=lambda p: 1 if p in PARENT else 0)
for part in ['body'] + order:
    lst = pieces[part]
    with bpy.context.temp_override(active_object=lst[0], selected_editable_objects=lst, selected_objects=lst):
        if len(lst) > 1:
            bpy.ops.object.join()
    ob = lst[0]
    pieces[part] = [ob]
    ob.name = f'{part}_mesh'
    if part == 'body':
        ob.parent = root
        continue
    pv = pivot(part)
    e = bpy.data.objects.new(part, None)
    bpy.context.scene.collection.objects.link(e)
    par = nodes.get(PARENT.get(part)) if PARENT.get(part) in pieces else None
    if par is not None:
        e.parent = par
        e.location = pv - pvs[PARENT[part]]
    else:
        e.parent = root
        e.location = pv
    pvs[part] = pv
    ob.data.transform(Matrix.Translation(-pv))
    ob.parent = e
    nodes[part] = e
    print('PART', part, 'pivot', [round(x, 4) for x in pv])

if GID in TRIGGER:
    t = bpy.data.objects.new('trigger', None)
    bpy.context.scene.collection.objects.link(t)
    t.parent = root
    fx, fz = TRIGGER[GID]
    t.location = Vector((fx - 0.007, cy, fz + 0.018))

# materiais: só cor, rugosidade e metal (nada de textura)
for m in bpy.data.materials:
    m.use_backface_culling = True

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_texcoords=False,
    export_normals=True,
    export_tangents=False,
    export_vertex_color='NONE',
    export_materials='EXPORT',
    export_yup=True,
    export_extras=False,
    export_animations=False,
    export_skins=False,
    export_morph=False,
    use_selection=False,
)
print('BOX', [round(x, 4) for x in (S @ (mx - mn).to_4d()).to_3d()])
