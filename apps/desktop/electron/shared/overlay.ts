/**
 * Overlay no jogo (ADR-0027): o que a janela principal manda para a janelinha transparente que fica por cima do
 * jogo. Só informação (quem fala, mudo/surdo, avisos curtos); ela não recebe clique nem teclado.
 */
import { z } from 'zod';

export const OverlayCorner = z.enum(['tl', 'tr', 'bl', 'br']);
export type OverlayCorner = z.infer<typeof OverlayCorner>;

export const OverlayState = z.object({
  /** mostrar agora (ligado nas preferências, jogo aberto e algo para mostrar) */
  visible: z.boolean(),
  corner: OverlayCorner,
  call: z
    .object({
      channel: z.string().max(64),
      muted: z.boolean(),
      deafened: z.boolean(),
      people: z
        .array(
          z.object({
            id: z.string().max(64),
            name: z.string().max(64),
            speaking: z.boolean(),
            muted: z.boolean(),
            me: z.boolean(),
          }),
        )
        .max(50),
    })
    .nullable(),
  notices: z
    .array(z.object({ id: z.number().int(), text: z.string().max(200), kind: z.enum(['info', 'error', 'success']) }))
    .max(5),
});
export type OverlayState = z.infer<typeof OverlayState>;
