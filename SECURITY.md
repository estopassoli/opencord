# Política de segurança

## Como relatar
- Relate vulnerabilidades **em privado** pelo GitHub: aba **Security → Report a vulnerability** deste repositório ([link direto](https://github.com/estopassoli/opencord/security/advisories/new)).
- Não abra issue pública com detalhes exploráveis.
- Inclua passos para reproduzir, a versão (app e/ou commit da API) e o impacto esperado.
- É um projeto pessoal, sem fins lucrativos e sem equipe dedicada: a resposta é por boa vontade, sem prazo garantido e sem programa de recompensa. Vulnerabilidades graves na instância pública (opencord.pro) têm prioridade.

## Escopo
- API, cliente desktop (incluindo IPC/preload), interface no navegador, configuração padrão de LiveKit/coturn e scripts/workflows de implantação.
- Fora do escopo: ataques de negação de serviço por volume, engenharia social e testes que afetem outros usuários da instância pública. Teste numa instância sua.

## Limites conhecidos
- O OpenCord não oferece E2EE: as chamadas são criptografadas em trânsito (DTLS/SRTP) até o SFU, e as mensagens ficam no banco do servidor. Quem administra a instância tem acesso técnico a elas.
- Os instaladores ainda não têm assinatura de código (Windows) nem notarização (macOS).

Modelo de ameaça, controles e resultados da revisão: [`docs/SECURITY.md`](docs/SECURITY.md).
