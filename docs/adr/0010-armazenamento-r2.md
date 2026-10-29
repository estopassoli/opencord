# ADR-0010 — Arquivos no Cloudflare R2 (driver S3 compatível)
Status: Accepted (pedido do mantenedor, 2026-10-29)

## Contexto
- Anexos, fotos de perfil e imagens de servidor ficavam em disco local, no volume `opencord-uploads`.
- O volume prende a API a um nó.
- Em produção, a gravação falhou por permissão do volume.
- O mantenedor pediu: "pode salvar mídias no R2 da Cloudflare".

## Decisão
- `STORAGE_DRIVER=s3` usa um bucket S3 compatível pelo `@aws-sdk/client-s3`.
- O alvo é o Cloudflare R2: endpoint `https://<account-id>.r2.cloudflarestorage.com`, região `auto`.
- Também funciona com MinIO ou AWS S3 (`S3_FORCE_PATH_STYLE=true` no MinIO).
- O bucket é **privado**. A API continua servindo os arquivos (`/attachments/...`, `/avatars/...`, `/server-icons/...`) com as mesmas verificações: acesso por canal, URL assinada, cabeçalhos `nosniff`/CSP.
  - Não há URL pública do bucket nem URL pré-assinada.
  - O tráfego de download passa pela API. O R2 não cobra egress.
- As chaves continuam geradas pelo servidor e são validadas (`[0-9a-z/_-]`, sem `..`).
- `local` continua o padrão, para self-host sem nuvem.
- A API recusa subir com `s3` incompleto. As variáveis exigidas são `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY`.

## Consequências
- Nova dependência externa opcional, com custo de armazenamento no R2.
- Para usar, o mantenedor cria o bucket e um token R2 com Object Read & Write restrito ao bucket.
- Trocar de `local` para `s3` não move os arquivos antigos. Antes de trocar, copie o volume para o bucket com a mesma estrutura de chaves, por exemplo `rclone copy <volume> r2:<bucket>`. Sem a cópia, os anexos antigos retornam 404.
- Evidência: `apps/api/src/attachments/storage.s3.test.ts`, com um S3 falso em memória (gravar, medir, ler, apagar e recusar chaves inválidas). Os testes de integração passam com o driver `local`.
- **Pendente:** validar contra o R2 real depois que o bucket existir.
