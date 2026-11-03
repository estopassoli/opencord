import { Readable } from 'node:stream';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  DeleteAccountRequest,
  SetPresenceRequest,
  SetStatusTextRequest,
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
import { AccountService } from './account.service.js';
import { AvatarService } from './avatar.service.js';

// exportar é caro (lê tudo da pessoa): poucas vezes por hora
const EXPORT_RATE = { rateLimit: { max: 5, timeWindow: '1 hour' } };

@Controller('me')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly presence: PresenceService,
    private readonly avatars: AvatarService,
    private readonly account: AccountService,
  ) {}

  @Get()
  async me(@CurrentUser() u: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    const [presence, statusText] = await Promise.all([this.presence.chosen(u.userId), this.presence.rawText(u.userId)]);
    return { ...this.auth.toMe(user), presence, statusText };
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

  /** Aceite dos Termos de uso e da Política de privacidade por quem já tinha conta (ADR-0039). */
  @Post('accept-terms')
  @HttpCode(204)
  async acceptTerms(@CurrentUser() u: AuthUser) {
    await this.account.acceptTerms(u.userId);
  }

  /** Tudo o que a instância guarda sobre a pessoa, em JSON (LGPD art. 18, ADR-0039). */
  @Get('export')
  @RouteConfig(EXPORT_RATE)
  async exportData(@CurrentUser() u: AuthUser, @Res() reply: FastifyReply) {
    const day = new Date().toISOString().slice(0, 10);
    return reply
      .type('application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="opencord-meus-dados-${day}.json"`)
      .header('cache-control', 'no-store')
      .send(Readable.from(this.account.exportChunks(u.userId)));
  }

  /** Exclui a própria conta (ADR-0039): sessões derrubadas, dados pessoais apagados, mensagens anonimizadas. */
  @Post('delete')
  @HttpCode(204)
  async deleteAccount(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(DeleteAccountRequest)) dto: z.infer<typeof DeleteAccountRequest>,
  ) {
    await this.account.deleteAccount(u.userId, u.sessionId, dto.password);
  }

  @Put('presence')
  async setPresence(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(SetPresenceRequest)) dto: z.infer<typeof SetPresenceRequest>,
  ) {
    await this.presence.setStatus(u.userId, dto.status);
    return { status: dto.status };
  }

  @Put('status-text')
  async setStatusText(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(SetStatusTextRequest)) dto: z.infer<typeof SetStatusTextRequest>,
  ) {
    await this.presence.setText(u.userId, dto.text);
    return { text: dto.text };
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
