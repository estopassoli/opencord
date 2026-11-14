import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { AuthGuard } from './common/auth.js';
import { DomainEvents } from './common/domain-events.js';
import { PrismaService } from './common/prisma.service.js';
import { RedisService } from './common/redis.service.js';
import { AdminController } from './admin/admin.controller.js';
import { AdminService } from './admin/admin.service.js';
import { InstanceService } from './admin/instance.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { TokenService } from './auth/token.service.js';
import { AuditService } from './audit/audit.service.js';
import { ClipsController } from './clips/clips.controller.js';
import { ClipsService } from './clips/clips.service.js';
import { AttachmentsController } from './attachments/attachments.controller.js';
import { AttachmentsService } from './attachments/attachments.service.js';
import { LargeUploadService } from './attachments/large-upload.service.js';
import { StorageService } from './attachments/storage.service.js';
import { BoardsController } from './boards/boards.controller.js';
import { BoardsService } from './boards/boards.service.js';
import { BotsController } from './bots/bots.controller.js';
import { BotsService } from './bots/bots.service.js';
import { InteractionsService } from './bots/interactions.service.js';
import { WebhooksController } from './webhooks/webhooks.controller.js';
import { WebhooksService } from './webhooks/webhooks.service.js';
import { SlackController } from './slack/slack.controller.js';
import { SlackService } from './slack/slack.service.js';
import { EventsController } from './events/events.controller.js';
import { EventsService } from './events/events.service.js';
import { RecordingsController } from './recordings/recordings.controller.js';
import { RecordingsService } from './recordings/recordings.service.js';
import { SoundsController } from './sounds/sounds.controller.js';
import { SoundsService } from './sounds/sounds.service.js';
import { DownloadsController } from './downloads/downloads.controller.js';
import { HealthController } from './health/health.controller.js';
import { MessagesController } from './messages/messages.controller.js';
import { MessagesService } from './messages/messages.service.js';
import { ModerationController } from './moderation/moderation.controller.js';
import { ModerationService } from './moderation/moderation.service.js';
import { PresenceService } from './realtime/presence.service.js';
import { RealtimeGateway } from './realtime/realtime.gateway.js';
import { RealtimeService } from './realtime/realtime.service.js';
import { PermissionsService } from './servers/permissions.service.js';
import { ServersController } from './servers/servers.controller.js';
import { ServersService } from './servers/servers.service.js';
import { RoomsService } from './servers/rooms.service.js';
import { DiscordImportService } from './servers/discord-import.service.js';
import { ActivitiesService } from './voice/activities.service.js';
import { MusicService } from './voice/music.service.js';
import { SpaceController } from './voice/space.controller.js';
import { SpaceService } from './voice/space.service.js';
import { DuelService } from './voice/duel.service.js';
import { SpotifyService } from './voice/spotify.service.js';
import { AccountService } from './users/account.service.js';
import { AvatarService } from './users/avatar.service.js';
import { EmojisController } from './servers/emojis.controller.js';
import { EmojisService } from './servers/emojis.service.js';
import { BadgesService } from './admin/badges.service.js';
import { SystemUserService } from './system/system-user.service.js';
import { SystemNoticesService } from './system/system-notices.service.js';
import { WelcomeService } from './system/welcome.service.js';
import { TwoFactorService } from './auth/two-factor.service.js';
import { LoginAlertsService } from './auth/login-alerts.service.js';
import { MailService } from './mail/mail.service.js';
import { AccountEmailService } from './auth/account-email.service.js';
import { CardRejectionService } from './boards/card-rejection.service.js';
import { RetentionService } from './users/retention.service.js';
import { AvatarsController } from './users/avatars.controller.js';
import { SocialController } from './social/social.controller.js';
import { SocialService } from './social/social.service.js';
import { NudgeService } from './social/nudge.service.js';
import { UsersController } from './users/users.controller.js';
import { VoiceController } from './voice/voice.controller.js';
import { VoiceService } from './voice/voice.service.js';
import { AiModerationService } from './ai-moderation/ai-moderation.service.js';
import { ModerationHoldService } from './ai-moderation/moderation-hold.service.js';
import { DeviceBansService } from './ai-moderation/device-bans.service.js';
import { ModerationCasesService } from './ai-moderation/moderation-cases.service.js';
import { ModerationCasesController } from './ai-moderation/moderation-cases.controller.js';

@Module({})
export class AppModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        AdminController,
        EmojisController,
        SoundsController,
        SpaceController,
        RecordingsController,
        EventsController,
        WebhooksController,
        SlackController,
        BotsController,
        BoardsController,
        HealthController,
        DownloadsController,
        AuthController,
        UsersController,
        ServersController,
        AvatarsController,
        MessagesController,
        ModerationController,
        ModerationCasesController,
        AttachmentsController,
        ClipsController,
        SocialController,
        VoiceController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        InstanceService,
        AdminService,
        { provide: APP_GUARD, useClass: AuthGuard },
        PrismaService,
        RedisService,
        DomainEvents,
        TokenService,
        AuthService,
        PermissionsService,
        AuditService,
        ServersService,
        RoomsService,
        DiscordImportService,
        ActivitiesService,
        MusicService,
        SpaceService,
        DuelService,
        SpotifyService,
        AvatarService,
        EmojisService,
        BadgesService,
        SystemUserService,
        SystemNoticesService,
        WelcomeService,
        TwoFactorService,
        LoginAlertsService,
        MailService,
        AccountEmailService,
        CardRejectionService,
        AccountService,
        RetentionService,
        RealtimeService,
        PresenceService,
        RealtimeGateway,
        StorageService,
        SoundsService,
        RecordingsService,
        EventsService,
        WebhooksService,
        SlackService,
        BotsService,
        InteractionsService,
        AttachmentsService,
        ClipsService,
        LargeUploadService,
        BoardsService,
        MessagesService,
        ModerationService,
        AiModerationService,
        ModerationHoldService,
        DeviceBansService,
        ModerationCasesService,
        SocialService,
        NudgeService,
        VoiceService,
      ],
    };
  }
}
