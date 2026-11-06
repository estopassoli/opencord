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
      /** início da chamada no canal (ms desde a época), para o contador; null sem a informação */
      startedAt: z.number().int().nonnegative().nullable(),
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
            /** cor do cargo mais alto (#rrggbb); null sem cor */
            color: z
              .string()
              .regex(/^#[0-9a-fA-F]{6}$/)
              .nullable(),
            /** foto (só http/https); null usa as iniciais */
            avatar: z
              .string()
              .max(1000)
              .refine((u) => /^https?:\/\//i.test(u))
              .nullable(),
          }),
        )
        .max(50),
    })
    .nullable(),
  notices: z
    .array(
      z.object({
        id: z.number().int(),
        text: z.string().max(200),
        kind: z.enum(['info', 'error', 'success', 'clip', 'clip-error']),
      }),
    )
    .max(5),
});
export type OverlayState = z.infer<typeof OverlayState>;
