import { BadRequestException, Body, Controller, Delete, Get, Patch, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
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
import { AvatarService } from './avatar.service.js';

@Controller('me')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly presence: PresenceService,
    private readonly avatars: AvatarService,
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
    const user = await this.auth.rename(u.userId, dto.displayName);
    await this.avatars.announce(u.userId);
    return this.auth.toMe(user);
  }

  /** Foto de perfil (multipart, campo "file"): PNG/JPEG/WebP/GIF até 1 MB e 1024 px de lado. */
  @Post('avatar')
  async setAvatar(@CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw new BadRequestException('multipart/form-data esperado');
    const file = await req.file();
    if (!file) throw new BadRequestException('campo "file" ausente');
    return this.auth.toMe(await this.avatars.set(u.userId, file.file));
  }

  @Delete('avatar')
  async clearAvatar(@CurrentUser() u: AuthUser) {
    return this.auth.toMe(await this.avatars.clear(u.userId));
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
