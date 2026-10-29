# F0.3 / F0.4 / F0.5 — Captura de tela, janela e áudio do sistema no Electron (Windows)

PoC Electron (contextIsolation, sandbox, nodeIntegration=false, IPC com allowlist validada) que, em modo `--selftest`, executa automaticamente e grava um relatório JSON:

1. `desktopCapturer.getSources` (monitores/janelas, thumbnails). Títulos de janelas **não** são gravados.
2. Capacidades de codec WebRTC e encoder efetivo por codec (loopback `RTCPeerConnection` local, `getStats().encoderImplementation`).
3. `getDisplayMedia` de monitor com `audio: 'loopback'` (áudio do sistema), fps medido, stop e recaptura.
4. Loopback com `restrictOwnAudio: true` (excluir o áudio do próprio app).
5. Captura de uma janela-alvo própria e encerramento automático da trilha quando a janela é fechada.
6. Captura de uma janela arbitrária de terceiros (informativo).

## Rodar (Windows 11, PowerShell/cmd no Windows — não via `\\wsl$`)
```bat
cd %LOCALAPPDATA%\Temp\opencord-spikes\f0.3   :: copie os arquivos desta pasta para cá
npm install
npm run selftest          :: silencioso
npm run selftest:tone     :: TOCA um tom de 1234 Hz em volume baixo (~1,5 s, várias vezes)
```
`selftest:tone` mede o tom no loopback (mesmo processo e processo externo via PowerShell `SoundPlayer`). **Ele é audível: avise quem estiver de fone antes de rodar.**

## Evidências
`evidence/selftest-run*.json` — ver a análise em `docs/research/F0_FEASIBILITY.md`.
