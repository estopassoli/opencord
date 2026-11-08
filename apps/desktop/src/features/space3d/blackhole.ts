/**
 * Buraco negro do tema estação espacial (ADR-0055). Em vez de esfera + anel (parecia um planeta com anéis), cada pixel
 * de um painel virado para a câmera traça o caminho da luz curvado pela gravidade (aproximação de Schwarzschild, em
 * unidades do raio do horizonte). Daí saem sozinhos: a sombra preta maior que o horizonte, o disco de acreção que
 * aparece por cima e por baixo do buraco (a parte de trás do disco, entortada), o anel de fótons fininho na borda e as
 * estrelas de trás distorcidas. O lado do disco que vem na nossa direção fica mais claro e azulado (efeito Doppler) e o
 * que se afasta, mais escuro e avermelhado. Desenho próprio, sem textura nem imagem.
 */
import * as THREE from 'three';

/** raio da esfera onde a luz é traçada, em raios do horizonte (fora dela a luz segue reta) */
const RB = 11;

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform mat4 holeInv;
  uniform float time;
  varying vec3 vWorld;

  const float RB = ${RB.toFixed(1)};
  const float RIN = 3.0;
  const float ROUT = 9.5;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  // cor de um corpo quente: vermelho escuro -> laranja -> amarelo-claro -> branco -> branco-azulado
  vec3 heat(float t) {
    vec3 c = mix(vec3(0.45, 0.06, 0.02), vec3(1.0, 0.38, 0.08), smoothstep(0.0, 0.45, t));
    c = mix(c, vec3(1.0, 0.78, 0.48), smoothstep(0.4, 0.85, t));
    c = mix(c, vec3(1.0, 0.97, 0.92), smoothstep(0.8, 1.25, t));
    return mix(c, vec3(0.78, 0.86, 1.0), smoothstep(1.2, 1.8, t));
  }

  // estrelas de fundo pela direção (a direção já vem entortada pela gravidade)
  float stars(vec3 d) {
    vec3 q = d * 90.0;
    vec3 c = floor(q);
    float h = hash(c);
    if (h < 0.965) return 0.0;
    vec3 o = vec3(hash(c + 7.1), hash(c + 3.7), hash(c + 1.3));
    float dd = length(fract(q) - o);
    return smoothstep(0.22, 0.0, dd) * (h - 0.965) * 30.0;
  }

  void main() {
    vec3 ro = (holeInv * vec4(cameraPosition, 1.0)).xyz;
    vec3 rd = normalize((holeInv * vec4(vWorld, 1.0)).xyz - ro);
    float b = dot(ro, rd);
    float c = dot(ro, ro) - RB * RB;
    float disc = b * b - c;
    if (disc < 0.0) discard;
    float t0 = -b - sqrt(disc);
    vec3 p = ro + rd * max(t0, 0.0);
    vec3 v = rd;
    vec3 hv = cross(p, v);
    float h2 = dot(hv, hv);

    vec3 col = vec3(0.0);
    float alpha = 0.0;
    bool escaped = false;
    for (int i = 0; i < 360; i++) {
      float r = length(p);
      if (r < 1.0) { alpha = 1.0; break; }
      if (r > RB + 0.01 && dot(p, v) > 0.0) { escaped = true; break; }
      float dt = clamp(0.09 * (r - 0.75), 0.012, 0.55);
      // curvatura da luz: aceleração radial que cresce muito perto do horizonte
      v += -1.5 * h2 * p / pow(r, 5.0) * dt;
      vec3 pn = p + v * dt;
      if (p.y * pn.y < 0.0) {
        vec3 q = mix(p, pn, p.y / (p.y - pn.y));
        float rq = length(q.xz);
        if (rq > RIN * 0.92 && rq < ROUT) {
          float x = (rq - RIN) / (ROUT - RIN);
          // giro de Kepler: o de dentro gira mais rápido; listras alongadas ao longo da órbita
          float ang = atan(q.z, q.x) + time * 0.55 * pow(rq / RIN, -1.5);
          float k = 5.0;
          vec3 np = vec3(cos(ang) * k, sin(ang) * k, rq * 2.6);
          float dens = fbm(np) * 0.85 + 0.35 * fbm(np * vec3(1.0, 1.0, 3.5) + 4.0);
          dens *= smoothstep(RIN * 0.92, RIN * 1.12, rq) * (1.0 - smoothstep(0.55, 1.0, x));
          // Doppler + desvio gravitacional
          float beta = 0.62 * sqrt(0.5 / max(rq - 1.0, 0.2));
          vec3 vel = normalize(vec3(-q.z, 0.0, q.x)) * beta;
          float gam = inversesqrt(1.0 - beta * beta);
          float del = 1.0 / (gam * (1.0 - dot(vel, -normalize(v))));
          float g = del * sqrt(1.0 - 1.0 / rq);
          float temp = pow(RIN / rq, 0.75);
          vec3 e = heat(temp * g * 1.05) * pow(g, 3.0) * dens * (2.4 + 3.0 * (1.0 - x));
          float a = clamp(dens * 1.35, 0.0, 1.0);
          col += (1.0 - alpha) * e;
          alpha += (1.0 - alpha) * a;
          if (alpha > 0.995) break;
        }
      }
      p = pn;
    }
    if (escaped) {
      float s = stars(normalize(v));
      col += (1.0 - alpha) * vec3(s);
      alpha += (1.0 - alpha) * clamp(s, 0.0, 1.0);
    }
    if (alpha < 0.004) discard;
    col = 1.0 - exp(-col * 1.25);
    gl_FragColor = vec4(col, alpha);
  }
`;

/**
 * Buraco negro com `rs` unidades de raio do horizonte. O disco fica no plano XZ local; incline o grupo para escolher
 * de que ângulo ele é visto.
 */
export function blackHole(rs: number): THREE.Group {
  const g = new THREE.Group();
  const uniforms = { holeInv: { value: new THREE.Matrix4() }, time: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    fog: false,
  });
  const size = RB * rs * 2 * 1.35;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  quad.frustumCulled = false;
  const scale = new THREE.Matrix4().makeScale(1 / rs, 1 / rs, 1 / rs);
  const clock = new THREE.Clock();
  const q = new THREE.Quaternion();
  quad.onBeforeRender = (_r, _s, camera) => {
    // o painel sempre de frente para a câmera; a luz é traçada no espaço do buraco (com a inclinação do grupo)
    g.getWorldQuaternion(q).invert();
    quad.quaternion.copy(camera.quaternion).premultiply(q);
    quad.updateMatrixWorld();
    uniforms.holeInv.value.copy(g.matrixWorld).invert().premultiply(scale);
    uniforms.time.value = clock.getElapsedTime();
  };
  g.add(quad);
  g.raycast = () => undefined;
  quad.raycast = () => undefined;
  return g;
}
