# Política de segurança

- Relate vulnerabilidades em privado ao mantenedor (canal a definir antes da publicação do repositório). Não abra issue pública com detalhes exploráveis.
- Escopo: API, cliente desktop (incluindo IPC/preload), configuração padrão de LiveKit/coturn e scripts de implantação.
- O OpenCord não oferece E2EE: as chamadas são criptografadas em trânsito (DTLS/SRTP) até o SFU que você hospeda.
- Modelo de ameaça, controles e resultados da revisão: [`docs/SECURITY.md`](docs/SECURITY.md).
