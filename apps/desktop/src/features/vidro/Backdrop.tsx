/**
 * Fundo vivo do layout Vidro (three.js): uma aurora lenta de três luzes coloridas — a primeira é a cor do servidor
 * aberto — que deriva sob os painéis de vidro e pulsa de leve quando alguém fala
 * na chamada. Renderiza em meia resolução a até 30 fps (20 com um jogo aberto, para sobrar placa de vídeo); para só
 * com a janela escondida, aceleração desligada ou "reduzir movimento" (um quadro parado).
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { bridge } from '../../lib/bridge';
import { useData } from '../../store/data';
import { useGames } from '../../store/games';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { useReducedMotion } from './parallax';

const VERT = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uPulse;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;

  // ruído simplex 2D (Ashima/IQ, domínio público)
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * snoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    float aspect = uRes.x / uRes.y;
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float t = uTime * 0.035;
    // deformação de domínio: as luzes escorrem em vez de só deslizar
    vec2 w = vec2(fbm(p * 1.1 + t), fbm(p * 1.1 - t * 0.8 + 3.1));
    vec2 q = p + 0.45 * w;
    // três fontes de luz em órbitas lentas
    // as luzes moram perto das bordas: o meio (onde a conversa fica) descansa no escuro
    vec2 ca = vec2(-0.75 + sin(t * 1.3) * 0.25, 0.35 + cos(t * 0.9) * 0.3);
    vec2 cb = vec2(0.8 + cos(t * 0.7 + 2.0) * 0.25, -0.3 + sin(t * 1.1 + 1.0) * 0.35);
    vec2 cc = vec2(0.1 + sin(t * 0.5 + 4.0) * 0.5, -0.65 + cos(t * 1.4 + 2.5) * 0.2);
    float la = exp(-2.0 * dot(q - ca, q - ca));
    float lb = exp(-2.3 * dot(q - cb, q - cb));
    float lc = exp(-3.2 * dot(q - cc, q - cc));
    float grain = fbm(q * 2.5 + t * 0.5) * 0.5 + 0.5;
    vec3 base = vec3(0.024, 0.031, 0.051);
    vec3 col = base;
    float gain = 0.5 + uPulse * 0.35;
    col += uA * la * gain * (0.7 + 0.5 * grain);
    col += uB * lb * gain * (0.7 + 0.5 * (1.0 - grain));
    col += uC * lc * gain * 0.85;
    // vinheta suave, para os painéis das bordas descansarem sobre o escuro
    float vig = smoothstep(1.5, 0.45, length(p * vec2(0.9, 1.0)));
    col = mix(base, col, vig);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const FALLBACK = ['#7b6cff', '#39c6ff', '#ff5fa2'];

function hexToVec(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
    } catch {
      return; // sem WebGL: fica o gradiente do CSS
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1) * 0.5);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const uniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uA: { value: new THREE.Vector3(...hexToVec(FALLBACK[0] as string)) },
      uB: { value: new THREE.Vector3(...hexToVec(FALLBACK[1] as string)) },
      uC: { value: new THREE.Vector3(...hexToVec(FALLBACK[2] as string)) },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, depthTest: false });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

    const resize = () => {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      uniforms.uRes.value.set(s.x, s.y);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // a primeira luz é a cor do servidor aberto (tema por servidor); sem cor, a do tema da pessoa
    const colors = () => {
      const { view } = useUi.getState();
      const { details, settings } = useData.getState();
      const server = view.kind === 'server' ? details[view.serverId] : undefined;
      const accent = server?.accent ?? settings?.appearance.accent ?? (FALLBACK[0] as string);
      uniforms.uA.value.set(...hexToVec(accent));
    };
    colors();
    const unsubUi = useUi.subscribe(colors);
    const unsubData = useData.subscribe(colors);

    // quem fala na chamada faz o fundo respirar
    let pulseTarget = 0;
    const unsubVoice = useVoice.subscribe((s) => {
      pulseTarget = Math.min(1, s.participants.filter((p) => p.speaking).length * 0.5);
    });

    let frame = 0;
    let last = 0;
    const start = performance.now();
    // sem aceleração de hardware (preferência "off") a aurora fica num quadro só: WebGL por software custa caro
    let gpuOff = false;
    void bridge?.prefs
      .get()
      .then((p) => {
        gpuOff = p.activeGpuMode === 'off';
      })
      .catch(() => undefined);
    // sempre em movimento (pedido do mantenedor); com jogo aberto cai para 20 fps em vez de parar
    const idle = () => gpuOff || document.hidden || useReducedMotion.getState().reduced;
    const interval = () => (useGames.getState().mine ? 50 : 33);
    const render = (now: number) => {
      uniforms.uTime.value = (now - start) / 1000;
      uniforms.uPulse.value += (pulseTarget - uniforms.uPulse.value) * 0.05;
      renderer.render(scene, camera);
    };
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (idle()) return;
      // 30 fps bastam para uma aurora (20 com jogo aberto): fração do custo
      if (now - last < interval()) return;
      last = now;
      render(now);
    };
    render(start);
    frame = requestAnimationFrame(loop);

    // contexto WebGL perdido (jogo pesado na mesma placa, janela muito tempo minimizada): o canvas ficaria preto para
    // sempre. Escondemos o canvas (fica o gradiente do CSS) e pedimos a restauração; o three recria os programas.
    let lost = false;
    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      canvas.style.opacity = '0';
    };
    const onRestored = () => {
      lost = false;
      canvas.style.opacity = '1';
      resize();
      render(performance.now());
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    const watchdog = setInterval(() => {
      if (!lost && !renderer.getContext().isContextLost()) return;
      lost = true;
      canvas.style.opacity = '0';
      try {
        renderer.forceContextRestore();
      } catch {
        /* sem suporte à extensão: fica o gradiente do CSS */
      }
    }, 4000);
    // ao voltar de um estado parado (jogo fechou, aba visível) um quadro novo, mesmo com movimento reduzido
    const unsubGames = useGames.subscribe(() => render(performance.now()));
    const onVis = () => render(performance.now());
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(watchdog);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      ro.disconnect();
      unsubUi();
      unsubData();
      unsubVoice();
      unsubGames();
      document.removeEventListener('visibilitychange', onVis);
      mat.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={ref} className="vidro-backdrop" aria-hidden />;
}
