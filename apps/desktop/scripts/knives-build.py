# Facas novas do gunfight (balisong, Ka-Bar, Bowie e kukri), modelos do Sketchfab sob CC-BY 4.0 (autores e links em
# `src/features/space3d/assets/guns/CREDITS.md`). Converte o .glb baixado para o formato que `gunfight/models.ts`
# espera das facas que vêm de arquivo. Uso, um modelo por vez:
#
#   blender -b --factory-startup -P scripts/knives-build.py -- baixados/kabar.glb saida/kabar.glb kabar
#
# Só lê a geometria, os materiais e as texturas do arquivo (nada de script dele roda: --factory-startup e sem
# auto-exec). O que sai (eixos do glTF, que são os do three.js):
# - em metros (`LENGTH`: o comprimento total da faca de verdade), a lâmina para −z, o fio para baixo (−y), a espessura
#   em x e a origem no meio do cabo;
# - o cabo alinhado com o eixo z (o kukri tem o cabo inclinado em relação à lâmina: o cabo fica reto na mão e a
#   lâmina cai, como na de verdade);
# - um nó vazio `guard` na frente do cabo (onde o indicador encosta), achado pela malha do cabo ou, na Ka-Bar (uma
#   malha só), pela espessura ao longo do comprimento;
# - texturas reduzidas para 512 px e gravadas em JPEG; as facas sem textura recebem cores de aço, cabo e fio;
# - balisong: só a pose fechada do arquivo (o arquivo traz três poses da mesma faca), com a lâmina e o cabo de
#   morder em nós próprios girando nos pinos (`blade` no pino do cabo seguro, `bite` no pino do cabo de morder, filho
#   da lâmina); o jogo abre e fecha a faca girando esses nós em volta do eixo x.
import math
import sys

import bpy
from mathutils import Matrix, Vector

SRC, OUT, KID = sys.argv[sys.argv.index('--') + 1 :][:3]

# comprimento total (m) e os eixos do arquivo (no Blender, depois de importar): comprimento e espessura
CFG = {
    'kabar': {'length': 0.30, 'len': 0, 'thin': 1, 'handle': None},
    'bowie': {'length': 0.35, 'len': 1, 'thin': 0, 'handle': ['Handle_low']},
    'kukri': {'length': 0.42, 'len': 0, 'thin': 1, 'handle': ['Object_6']},
    'balisong': {'length': 0.133},
}
cfg = CFG[KID]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)


meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if KID == 'balisong':
    # a pose fechada: Cube.370 (lâmina e fio), Cube.371 (cabo seguro), Cube.372 (cabo de morder)
    keep = {'Cube.370': 'blade', 'Cube.371': 'safe', 'Cube.372': 'bite'}
    role = {}
    for o in meshes:
        p = o.parent
        while p is not None and p.name not in keep:
            p = p.parent
        if p is not None:
            role[o] = keep[p.name]
    for o in meshes:
        if o not in role:
            bpy.data.objects.remove(o)
    meshes = list(role)
else:
    role = {}
    for o in meshes:
        p = o
        names = set()
        while p is not None:
            names.add(p.name)
            p = p.parent
        role[o] = 'handle' if cfg['handle'] and any(n.split('.')[0] in cfg['handle'] or n in cfg['handle'] for n in names) else 'body'

# geometria no espaço do mundo, sem pais
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.data = o.data.copy()
    o.data.transform(mw)
    o.matrix_world = Matrix.Identity(4)
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o)


def verts(objs):
    return [v.co.copy() for o in objs for v in o.data.vertices]


def bbox(ps):
    a = Vector((min(p.x for p in ps), min(p.y for p in ps), min(p.z for p in ps)))
    b = Vector((max(p.x for p in ps), max(p.y for p in ps), max(p.z for p in ps)))
    return a, b


def apply(m):
    for o in meshes:
        o.data.transform(m)


if KID == 'balisong':
    # arquivo em cm, comprimento em z (lâmina aberta para −z), espessura em y, largura em x (o fio da lâmina fechada
    # para −x; aberta, para +x). Destino no Blender (y do glTF = z do Blender, z do glTF = −y do Blender):
    # lâmina aberta → +y do Blender (−z do glTF), fio da aberta → −z do Blender, espessura → x.
    safe = [o for o in meshes if role[o] == 'safe']
    bite = [o for o in meshes if role[o] == 'bite']
    sa, sb = bbox(verts(safe))
    ba, bb = bbox(verts(bite))
    # os pinos: no meio da largura de cada cabo, a 0,7 cm da ponta do lado da lâmina (medido nas poses do arquivo)
    pin_s = Vector(((sa.x + sb.x) / 2, 0, sa.z + 0.71))
    pin_b = Vector(((ba.x + bb.x) / 2, 0, ba.z + 0.71))
    rot = Matrix(((0, 1, 0, 0), (0, 0, -1, 0), (-1, 0, 0, 0), (0, 0, 0, 1)))
    m = Matrix.Scale(0.01, 4) @ rot @ Matrix.Translation(-pin_s)
    apply(m)
    pin_b = (m @ pin_b.to_4d()).to_3d()
    root = bpy.data.objects.new(KID, None)
    bpy.context.scene.collection.objects.link(root)
    blade = bpy.data.objects.new('blade', None)
    bpy.context.scene.collection.objects.link(blade)
    blade.parent = root
    bite_n = bpy.data.objects.new('bite', None)
    bpy.context.scene.collection.objects.link(bite_n)
    bite_n.parent = blade
    bite_n.location = pin_b
    for o in meshes:
        r = role[o]
        if r == 'safe':
            o.parent = root
            o.name = 'safe_mesh'
        elif r == 'blade':
            o.parent = blade
            o.name = 'blade_mesh'
        else:
            o.data.transform(Matrix.Translation(-pin_b))
            o.parent = bite_n
            o.name = 'bite_mesh'
    print('PIN bite', [round(x, 4) for x in pin_b])
else:
    L, T = cfg['len'], cfg['thin']
    Wd = 3 - L - T
    allv = verts(meshes)
    a, b = bbox(allv)
    mid = (a + b) / 2
    hv = verts([o for o in meshes if role[o] == 'handle'])
    if hv:
        hc = sum(hv, Vector()) / len(hv)
        tip = 1 if hc[L] < mid[L] else -1
    else:
        # uma malha só: o lado mais grosso é o cabo
        lo = [p for p in allv if p[L] < mid[L]]
        hi = [p for p in allv if p[L] >= mid[L]]
        th = lambda ps: max(p[T] for p in ps) - min(p[T] for p in ps)
        tip = 1 if th(lo) > th(hi) else -1
    # rotação para: comprimento (ponta) → +y do Blender, espessura → x, largura → z
    cols = [Vector((0, 0, 0)) for _ in range(3)]
    e = [Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))]
    # linhas da matriz: x' = espessura, y' = tip * comprimento, z' = ±largura (sinal do fio depois)
    rows = [e[T], e[L] * tip, e[Wd]]
    if Matrix(rows).determinant() < 0:
        rows[0] = -rows[0]
    m = Matrix(rows).to_4x4()
    apply(m)
    allv = verts(meshes)
    hv = verts([o for o in meshes if role[o] == 'handle'])
    # cabo alinhado com y (kukri): o eixo principal do cabo no plano y-z
    if hv:
        c = sum(hv, Vector()) / len(hv)
        syy = sum((p.y - c.y) ** 2 for p in hv)
        szz = sum((p.z - c.z) ** 2 for p in hv)
        syz = sum((p.y - c.y) * (p.z - c.z) for p in hv)
        ang = 0.5 * math.atan2(2 * syz, syy - szz)
        apply(Matrix.Rotation(-ang, 4, 'X'))
        print('HANDLE tilt', round(math.degrees(ang), 2))
    allv = verts(meshes)
    a, b = bbox(allv)
    s = cfg['length'] / (b.y - a.y)
    apply(Matrix.Scale(s, 4))
    allv = verts(meshes)
    a, b = bbox(allv)
    # o cabo: a malha dele, ou as fatias grossas a partir do fim (Ka-Bar)
    if hv:
        ha, hb = bbox(verts([o for o in meshes if role[o] == 'handle']))
    else:
        n = 60
        step = (b.y - a.y) / n
        th = []
        for i in range(n):
            ps = [p for p in allv if a.y + i * step <= p.y < a.y + (i + 1) * step]
            th.append(max(p.x for p in ps) - min(p.x for p in ps) if ps else 0)
        big = max(th)
        # o último trecho grosso é o fim do cabo (a guarda, mais fina que o couro empilhado, fica de fora)
        i = max(k for k in range(n) if th[k] >= 0.8 * big) + 1
        hy = a.y + i * step
        hp = [p for p in allv if p.y < hy]
        ha, hb = bbox(hp)
    # fio para baixo: na lâmina (à frente do cabo), o lado mais fino é o fio
    bl = [p for p in allv if p.y > hb.y + 0.02]
    zc = (min(p.z for p in bl) + max(p.z for p in bl)) / 2
    up = [abs(p.x) for p in bl if p.z > zc]
    dn = [abs(p.x) for p in bl if p.z <= zc]
    if sum(up) / max(1, len(up)) < sum(dn) / max(1, len(dn)):
        apply(Matrix.Rotation(math.pi, 4, 'Y'))
        ha, hb = Vector((-hb.x, ha.y, -hb.z)), Vector((-ha.x, hb.y, -ha.z))
    hc = (ha + hb) / 2
    apply(Matrix.Translation(-hc))
    root = bpy.data.objects.new(KID, None)
    bpy.context.scene.collection.objects.link(root)
    for o in meshes:
        o.parent = root
    g = bpy.data.objects.new('guard', None)
    bpy.context.scene.collection.objects.link(g)
    g.parent = root
    g.location = Vector((0, hb.y - hc.y, 0))
    print('HANDLE len', round(hb.y - ha.y, 4), 'guard', round(hb.y - hc.y, 4))

# materiais: as facas sem textura ganham cores legíveis (no arquivo quase tudo é preto)
FLAT = {
    'balisong': {'Dark_4': ((0.42, 0.44, 0.47), 0.85, 0.32), 'Grey_3': ((0.78, 0.8, 0.82), 0.9, 0.2),
                 'Dark_3': ((0.07, 0.12, 0.2), 0.55, 0.45)},
    'kukri': {'Material.001': ((0.3, 0.31, 0.32), 0.75, 0.4), 'Material.002': ((0.72, 0.74, 0.76), 0.9, 0.22),
              'Material.004': ((0.16, 0.08, 0.035), 0.0, 0.7)},
}
for m in bpy.data.materials:
    m.use_backface_culling = True
    f = FLAT.get(KID, {}).get(m.name)
    if f and m.use_nodes:
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (*f[0], 1)
            bsdf.inputs['Metallic'].default_value = f[1]
            bsdf.inputs['Roughness'].default_value = f[2]
for img in bpy.data.images:
    if img.size[0] > 512:
        img.scale(512, 512 * img.size[1] // img.size[0])

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_image_format='JPEG',
    export_texcoords=True,
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
