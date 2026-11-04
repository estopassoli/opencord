# ADR-0044: Seletor de GIFs (KLIPY)
Status: Accepted (pedido do mantenedor, 2026-11-04; card "Ter figurinhas" do #kanban-de-ideias)

## Contexto
O card pedia "figurinhas". O mantenedor esclareceu com um print que são **GIFs**: um seletor com busca, "Favoritos", "GIFs em alta" e categorias, alimentado pelo KLIPY. Antes disso ele tinha escolhido:
- pacotes por servidor;
- uso em qualquer canal ou DM;
- figurinhas animadas.

O print trocou o escopo para um provedor de GIFs.

## Decisão
- **Provedor:** KLIPY (API grátis; chave de teste limitada, chave de produção pedida no painel deles). Pelos termos do KLIPY (docs.klipy.com/attribution):
  - as requisições e a mídia saem do app de cada pessoa, sem servidor intermediário salvo aprovação escrita deles;
  - as URLs são usadas como vieram;
  - os resultados aparecem na ordem entregue;
  - "Powered by KLIPY" é opcional, e mostramos mesmo assim no rodapé do seletor.
- **Configuração:** `KLIPY_APP_KEY` na API vira `InstanceInfo.gifs = { provider, appKey, apiUrl }`.
  - Não é segredo, porque o cliente precisa dela.
  - Sem a chave, o botão GIF some.
- **Identificador da pessoa:** `customer_id` é um hash SHA-256 do id da pessoa (16 bytes), nunca o id em si.
- **Envio:** o GIF vai como mensagem cujo corpo é a URL do GIF médio entregue pelo KLIPY. Também avisamos o KLIPY do compartilhamento (`/share/{slug}`, ignorando falhas).
  - Apps antigos e o SDK veem um link. O app novo mostra a animação quando a mensagem é só uma URL de mídia de `*.klipy.com`.
  - A moderação por IA já ignora mensagem só com link.
- **Favoritos:** `UserSettings.gifFavorites`, até 100, mais recente primeiro. Ficam no JSON de configurações, sem migração.
- **Anúncios:** o KLIPY só manda anúncios se o parceiro ligar no painel. Itens que não são GIF ficam de fora do seletor.

## Alternativas descartadas
- **Proxy na API:** esconderia o IP das pessoas do KLIPY, mas os termos exigem aprovação prévia. Pode ser pedido depois a developers@klipy.com.
- **Figurinhas enviadas por servidor:** o pedido real era o seletor de GIFs. Pode virar outro card.
- **Tenor ou Giphy:** o mantenedor mostrou o KLIPY, e a migração do Tenor para o KLIPY é o caminho que o próprio KLIPY documenta.

## Consequências
- **Privacidade:** quem abre o seletor fala direto com o KLIPY, que vê o IP e o identificador anônimo. A Política de privacidade passou a citar o KLIPY (versão de 4 de novembro de 2026).
- **Deploy:** sem migração. Basta definir `KLIPY_APP_KEY` na API e fazer redeploy. A chave de teste tem limite de requisições, e para produção é preciso pedir acesso no painel do KLIPY.
- **Reversão:** tirar a chave esconde o botão. As mensagens já enviadas continuam como link, e no app novo como animação.
