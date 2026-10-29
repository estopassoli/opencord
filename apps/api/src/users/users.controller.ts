import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import {
  SetPresenceRequest,
  UpdateProfileRequest,
  UserSettingsV1,
  defaultUserSettings,
  type UserSettings,
} from '@opencord/contracts';
import type { Prisma } from '@opencord/db';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth.js';
import { PrismaService } from '../common/prisma.service.js';
import { zodPipe } from '../common/zod.pipe.js';
import { AuthService } from '../auth/auth.service.js';
import { PresenceService } from '../realtime/presence.service.js';

@Controller('me')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly presence: PresenceService,
  ) {}

  @Get()
  async me(@CurrentUser() u: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    return { ...this.auth.toMe(user), presence: await this.presence.chosen(u.userId) };
  }

  @Patch()
  async update(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(UpdateProfileRequest)) dto: z.infer<typeof UpdateProfileRequest>,
  ) {
    if (!dto.displayName) return this.auth.toMe(await this.prisma.user.findUniqueOrThrow({ where: { id: u.userId } }));
    return this.auth.toMe(await this.auth.rename(u.userId, dto.displayName));
  }

  @Put('presence')
  async setPresence(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(SetPresenceRequest)) dto: z.infer<typeof SetPresenceRequest>,
  ) {
    await this.presence.setStatus(u.userId, dto.status);
    return { status: dto.status };
  }

  @Get('settings')
  async settings(@CurrentUser() u: AuthUser): Promise<UserSettings> {
    const row = await this.prisma.userSettings.findUnique({ where: { userId: u.userId } });
    if (!row) return defaultUserSettings();
    // dados antigos/corrompidos voltam aos defaults em vez de quebrar o cliente
    const parsed = UserSettingsV1.safeParse(row.json);
    return parsed.success ? parsed.data : defaultUserSettings();
  }

  @Put('settings')
  async saveSettings(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(UserSettingsV1)) dto: UserSettings,
  ): Promise<UserSettings> {
    await this.prisma.userSettings.upsert({
      where: { userId: u.userId },
      create: { userId: u.userId, version: dto.version, json: dto as unknown as Prisma.InputJsonValue },
      update: { version: dto.version, json: dto as unknown as Prisma.InputJsonValue },
    });
    return dto;
  }
}
