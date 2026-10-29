# F0.2 — LiveKit local, dois participantes, áudio bidirecional

Dois participantes (`alice`, `bob`) entram numa sala LiveKit com tokens emitidos por `livekit-server-sdk`. Cada um publica um tom sintético distinto como trilha `microphone` (alice 440 Hz, bob 880 Hz), assina a trilha do outro e confirma, via Goertzel, que o tom recebido é o do outro participante (razão de energia > 10×). Nada é tocado nos alto-falantes: o áudio é gerado e analisado em memória.

## Rodar (Linux/WSL)
```sh
# binário oficial verificado por checksum (fora do Git, em .tools/)
V=1.13.10; mkdir -p .tools/livekit && cd .tools/livekit
curl -sSLO https://github.com/livekit/livekit/releases/download/v$V/livekit_${V}_linux_amd64.tar.gz
curl -sSLO https://github.com/livekit/livekit/releases/download/v$V/checksums.txt
grep linux_amd64 checksums.txt | sha256sum -c - && tar xzf livekit_${V}_linux_amd64.tar.gz
./livekit-server --dev --bind 127.0.0.1 &      # chaves de dev: devkey / secret

cd spikes/f0.2-livekit-audio && npm install && node poc.mjs   # exit 0 = PASS
```

## Escopo e limites
- Valida: emissão de token pelo servidor, sinalização, ICE/DTLS/SRTP, publicação e assinatura de áudio Opus via SFU, em loopback (127.0.0.1).
- **Não valida:** NAT, TURN, redes distintas, perda de pacotes nem o cliente Electron/browser (usa o SDK nativo `@livekit/rtc-node`).
