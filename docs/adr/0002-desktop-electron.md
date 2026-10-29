# ADR-0002 — Electron Windows-first
Status: Accepted

## Contexto
Necessidade de tray, hotkeys globais, captura de monitor/janelas e integração nativa Windows.

## Decisão
Electron + React/Vite com main/preload isolados e possível módulo nativo para captura.

## Consequências
Maior tamanho de distribuição, mas melhor integração desktop e produtividade. Segurança do IPC e consumo de recursos exigem testes contínuos.
