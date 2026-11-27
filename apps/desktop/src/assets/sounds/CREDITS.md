# Sons gravados do app

Gravações que substituem a síntese em alguns sons (`SOUND_SAMPLES` em `src/lib/sounds.ts`). Os demais sons do app
são sintetizados na hora com Web Audio.

| Arquivo          | Som                                     | Origem                                                   |
| ---------------- | --------------------------------------- | -------------------------------------------------------- |
| `join-call.ogg`  | entrar na chamada (conjunto "Padrão")   | `join_call.wav`, enviado pelo mantenedor em 2026-11-27  |
| `leave-call.ogg` | sair da chamada (conjunto "Padrão")     | `leave_call.wav`, enviado pelo mantenedor em 2026-11-27 |

Tratamento (2026-11-27): os originais (WAV estéreo 44,1 kHz, 32 bits float, ~3,3 s) têm ~1,2 s de som e o resto em
silêncio. Recorte em 1,8 s com saída suave de 180 ms, estéreo 48 kHz, codificação Opus em Ogg a 96 kbps (VBR). Volume
original mantido (pico −9,5 dBFS); o `gain` de 0,9 no código deixa a janela de 50 ms mais forte no mesmo nível dos
sons sintetizados do conjunto (≈ −17 dBFS RMS com o volume em 100%).
