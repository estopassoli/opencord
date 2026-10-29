# PRD — OpenCord

## Problema e objetivo
Oferecer aos amigos um espaço privado, self-hosted, com experiência desktop de chat, canais de voz persistentes, webcam e Go Live. Não é um clone comercial ou federação entre instâncias.

## Público e premissas
5–15 usuários conhecidos; Windows 11 prioritário; instalação simples; internet doméstica com NAT; servidores gerenciados pelo proprietário; um único tenant/instância na V1. A meta de 10 usuários em voz e 2–4 streams simultâneas é hipótese para testes, não garantia.

## Personas
- Proprietário: provisiona instância, emite convites, administra cargos/canais e acompanha saúde.
- Membro: instala desktop, entra em voz em um clique, troca mensagens, compartilha jogo e assiste a amigos.

## Histórias prioritárias (MUST)
- P01: como amigo, abro o app, digito um apelido e entro, sem conta, sem endereço de servidor e sem convite. Criar conta é opcional, para usar o mesmo apelido em outros computadores (ADR-0007).
- P02: como membro, navego por servidores, categorias e canais com indicadores de não lidas.
- P03: como membro, envio, edito, respondo e reajo a mensagens; anexo imagens/arquivos.
- P04: como membro, entro em canal de voz com um clique e continuo conectado ao navegar.
- P05: como membro, ajusto mute, deafen, PTT, dispositivos e volume por pessoa.
- P06: como membro, ativo webcam na sala e escolho visualização em grade/destaque.
- P07: como membro, escolho monitor/janela e transmito tela e áudio do sistema.
- P08: como membro, assisto a uma stream ou várias streams sem interromper voz.
- P09: como membro, uso DM, lista de amigos e presença.
- P10: como proprietário, gerencio cargos, permissões e expulsão (servidores são abertos a todos).
- P11: como membro, recebo notificações e mantenho voz ativa com janela minimizada.

## SHOULD
Busca de mensagens, configurações detalhadas de vídeo, reconexão refinada, atalho global, indicadores de rede, atualização assinada.

## Fora de escopo V1
Mobile, web client de uso geral, federação, bots, marketplace, streaming gravado, transcrição, monetização, descoberta pública, overlay em jogos e paridade com todos os recursos do Discord.

## Critérios de sucesso
Dois computadores Windows em redes distintas conseguem autenticar, entrar em voz, conversar, publicar webcam, compartilhar tela com áudio do sistema, assistir, navegar e reconectar. Evidência de testes manuais obrigatória.

## Restrições
Não copiar marca, assets ou código proprietário. Não afirmar E2EE sem implementação auditada. Qualidade 1440p60 é opção aspiracional sujeita a hardware e banda.
