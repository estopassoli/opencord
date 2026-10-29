import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { AuthGuard } from './common/auth.js';
import { DomainEvents } from './common/domain-events.js';
import { PrismaService } from './common/prisma.service.js';
import { RedisService } from './common/redis.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { TokenService } from './auth/token.service.js';
import { AuditService } from './audit/audit.service.js';
import { AttachmentsController } from './attachments/attachments.controller.js';
import { AttachmentsService } from './attachments/attachments.service.js';
import { StorageService } from './attachments/storage.service.js';
import { DownloadsController } from './downloads/downloads.controller.js';
import { HealthController } from './health/health.controller.js';
import { MessagesController } from './messages/messages.controller.js';
import { MessagesService } from './messages/messages.service.js';
import { PresenceService } from './realtime/presence.service.js';
import { RealtimeGateway } from './realtime/realtime.gateway.js';
import { RealtimeService } from './realtime/realtime.service.js';
import { PermissionsService } from './servers/permissions.service.js';
import { ServersController } from './servers/servers.controller.js';
import { ServersService } from './servers/servers.service.js';
import { DiscordImportService } from './servers/discord-import.service.js';
import { ActivitiesService } from './voice/activities.service.js';
import { AvatarService } from './users/avatar.service.js';
import { AvatarsController } from './users/avatars.controller.js';
import { SocialController } from './social/social.controller.js';
import { SocialService } from './social/social.service.js';
import { UsersController } from './users/users.controller.js';
import { VoiceController } from './voice/voice.controller.js';
import { VoiceService } from './voice/voice.service.js';

@Module({})
export class AppModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        DownloadsController,
        AuthController,
        UsersController,
        ServersController,
        AvatarsController,
        MessagesController,
        AttachmentsController,
        SocialController,
        VoiceController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        { provide: APP_GUARD, useClass: AuthGuard },
        PrismaService,
        RedisService,
        DomainEvents,
        TokenService,
        AuthService,
        PermissionsService,
        AuditService,
        ServersService,
        DiscordImportService,
        ActivitiesService,
        AvatarService,
        RealtimeService,
        PresenceService,
        RealtimeGateway,
        StorageService,
        AttachmentsService,
        MessagesService,
        SocialService,
        VoiceService,
      ],
    };
  }
}
