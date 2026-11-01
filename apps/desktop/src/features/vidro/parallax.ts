/**
 * "Reduzir movimento" do sistema, para o fundo (three.js) parar num quadro só.
 *
 * Aqui também morava o reflexo que seguia o mouse (variáveis --mx/--my atualizadas a cada quadro). Foi removido:
 * trocar o ângulo dos gradientes dos painéis a cada movimento fazia o Chromium recriar as camadas sem liberar as
 * antigas — medido em teste de 60 s: +1 GB por minuto; com as variáveis congeladas, memória estável. O reflexo da
 * borda agora é fixo (vidro.css).
 */
import { create } from 'zustand';

export const useReducedMotion = create<{ reduced: boolean }>(() => ({
  reduced: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
}));

export function startReducedMotionWatch(): () => void {
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const onMq = () => useReducedMotion.setState({ reduced: mq.matches });
  mq.addEventListener('change', onMq);
  return () => mq.removeEventListener('change', onMq);
}
