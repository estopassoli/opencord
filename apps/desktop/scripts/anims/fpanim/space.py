"""Conversão entre o espaço do jogo (three.js: y para cima, câmera olhando para −z) e o do Blender (z para cima).

Tudo nas contas da animação é escrito no espaço do jogo (o mesmo de `viewmodel.ts`: a câmera da primeira pessoa na
origem); só na hora de pôr os ossos e ler a malha passa para o Blender. O exportador glTF faz a conversão de volta
(Blender (x, y, z) → glTF (x, z, −y)), então o que se escreve aqui chega igual no jogo.
"""
import math

from mathutils import Euler, Matrix, Quaternion, Vector

# jogo → Blender: (x, y, z) → (x, −z, y)
C3 = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
C4 = C3.to_4x4()
C4I = C4.inverted()


def vb(v):
    """vetor do jogo para o Blender"""
    return C3 @ Vector(v)


def vg(v):
    """vetor do Blender para o jogo"""
    return C3.transposed() @ Vector(v)


def mb(m):
    """matriz 4×4 do jogo para o Blender"""
    return C4 @ m @ C4I


def mg(m):
    """matriz 4×4 do Blender para o jogo"""
    return C4I @ m @ C4


def qxyz(x, y, z):
    """giro de Euler na ordem 'XYZ' do three (matriz Rx·Ry·Rz)"""
    return Quaternion((1, 0, 0), x) @ Quaternion((0, 1, 0), y) @ Quaternion((0, 0, 1), z)


def qyxz(x, y, z):
    """giro de Euler na ordem 'YXZ' do three (o `holder` do viewmodel): Ry·Rx·Rz"""
    return Quaternion((0, 1, 0), y) @ Quaternion((1, 0, 0), x) @ Quaternion((0, 0, 1), z)


def trs(pos=(0, 0, 0), quat=None, scale=1.0):
    m = (quat or Quaternion()).to_matrix().to_4x4()
    if scale != 1.0:
        m = m @ Matrix.Scale(scale, 4)
    m.translation = Vector(pos)
    return m


def basis(x, y, z):
    """giro cujas colunas são os eixos dados (já ortonormais)"""
    return Matrix((x, y, z)).transposed().to_quaternion()


def look_basis(fwd, up):
    """giro da mão (espaço da mão: dedos para −z, dorso para +y) com os dedos em `fwd` e o dorso perto de `up`"""
    z = -Vector(fwd).normalized()
    y = Vector(up) - z * Vector(up).dot(z)
    y.normalize()
    x = y.cross(z)
    return basis(x, y, z)


def deg(d):
    return math.radians(d)
