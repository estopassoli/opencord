# Modelo de dados lógico

## Entidades persistentes
- `User(id, email unique, passwordHash, displayName, avatarKey, createdAt, disabledAt)`
- `Session(id, userId, refreshTokenHash, deviceId, expiresAt, revokedAt)`
- `Friendship(id, requesterId, addresseeId, status, createdAt)`; unique par canônico, bloquear autoamizade.
- `Block(id, blockerId, blockedId)`.
- `Server(id, name, ownerId, iconKey)`; `ServerMember(serverId,userId,joinedAt)`.
- `Role(id, serverId, name, position, permissionsBitset)`; `MemberRole(serverId,userId,roleId)`.
- `Category(id, serverId, name, position)`.
- `Channel(id, serverId, categoryId?, kind, name, position)`; `ChannelPermissionOverride(channelId, subjectType, subjectId, allow, deny)`.
- `Conversation(id, kind)`; `ConversationMember(conversationId,userId)` para DMs/grupos.
- `Message(id, authorId, channelId?, conversationId?, body, editedAt, deletedAt, createdAt)`; XOR destino.
- `Attachment(id, messageId, storageKey, mime, sizeBytes, originalName)`.
- `Reaction(messageId,userId,emoji)`.
- `ReadState(userId, channelId?/conversationId?, lastMessageId, updatedAt)`.
- `Invite(id, serverId, tokenHash, createdBy, maxUses, uses, expiresAt, revokedAt)`.
- `UserSettings(userId, json)` com schema validado e versionado.
- `AuditLog(id, actorId, serverId?, action, targetId?, metadata, createdAt)`.

## Estados efêmeros
Redis: presença com TTL/heartbeat, conexões WebSocket, typing com expiração, ocupação lógica de voz, deduplicação curta e rate limit. LiveKit mantém participantes/publicações reais. Não persistir pacotes de mídia.

## Índices e integridade
Índices por `(channelId,createdAt,id)`, `(conversationId,createdAt,id)`, `(userId,updatedAt)` e unicidade de associações. Mensagens paginadas por cursor composto `(createdAt,id)`. Soft delete quando apropriado; nunca retornar dados sem autorização.

## Migrações
Prisma migrate versionado; seed de desenvolvimento idempotente; backups antes de mudanças destrutivas; nenhuma migração automática em produção pelo agente.
