import { Readable } from 'node:stream';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
  EnableEmailTwoFactorRequest,
  SetEmailRequest,
  SetFeaturedBadgesRequest,
  VerifyEmailRequest,
  SetPresenceRequest,
  SetStatusTextRequest,
  TwoFactorDisableRequest,
  TwoFactorEnableRequest,
  TwoFactorSetupRequest,
  UpdateProfileRequest,
  UpdateUserProfileRequest,
  UseRecentAvatarRequest,
  type ProfileUpdateResponse,
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
import { TwoFactorService } from '../auth/two-factor.service.js';
import { AccountEmailService } from '../auth/account-email.service.js';
import { BadgesService } from '../admin/badges.service.js';

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
    private readonly twoFactor: TwoFactorService,
    private readonly accountEmail: AccountEmailService,
    private readonly badges: BadgesService,
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
    if (!dto.displayName && !dto.username)
      return this.auth.toMe(await this.prisma.user.findUniqueOrThrow({ where: { id: u.userId } }));
    // o @ primeiro: se ele for recusado (prazo, em uso), o apelido também não muda
    let user = dto.username ? await this.auth.changeUsername(u.userId, dto.username) : null;
    if (dto.displayName) user = await this.auth.rename(u.userId, dto.displayName);
    await this.avatars.announce(u.userId);
    return this.auth.toMe(user!);
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

  // ---------- Personalização do perfil (ADR-0048) ----------

  private async profileView(userId: string): Promise<ProfileUpdateResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      me: this.auth.toMe(user),
      appearance: {
        bio: user.bio,
        bannerKey: user.bannerKey,
        bannerUrl: user.bannerUrl,
        colors: user.profileColors.length === 2 ? [user.profileColors[0]!, user.profileColors[1]!] : null,
      },
    };
  }

  @Get('profile')
  myProfile(@CurrentUser() u: AuthUser) {
    return this.profileView(u.userId);
  }

  /** bio, cores, banner e foto por GIF do KLIPY; só o que veio muda */
  @Patch('profile')
  async updateMyProfile(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(UpdateUserProfileRequest)) dto: z.infer<typeof UpdateUserProfileRequest>,
  ) {
    if (dto.bio !== undefined || dto.colors !== undefined)
      await this.prisma.user.update({
        where: { id: u.userId },
        data: {
          ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
          ...(dto.colors !== undefined
            ? { profileColors: dto.colors ? dto.colors.map((c) => c.toLowerCase()) : [] }
            : {}),
        },
      });
    if (dto.bannerUrl !== undefined) await this.avatars.setBannerUrl(u.userId, dto.bannerUrl);
    if (dto.avatarUrl !== undefined) await this.avatars.setUrl(u.userId, dto.avatarUrl);
    return this.profileView(u.userId);
  }

  /** Banner do perfil (multipart, campo "file"): PNG/JPEG/WebP/GIF até 4 MB e 2560 px de lado. */
  @Post('banner')
  async setBanner(@CurrentUser() u: AuthUser, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw new BadRequestException('multipart/form-data esperado');
    const file = await req.file();
    if (!file) throw new BadRequestException('campo "file" ausente');
    await this.avatars.setBanner(u.userId, file.file);
    return this.profileView(u.userId);
  }

  @Delete('banner')
  async clearBanner(@CurrentUser() u: AuthUser) {
    await this.avatars.setBannerUrl(u.userId, null);
    return this.profileView(u.userId);
  }

  /** insígnias em destaque ao lado do nome (até 3 das próprias) */
  @Put('badges/featured')
  @HttpCode(204)
  async setFeaturedBadges(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(SetFeaturedBadgesRequest)) dto: z.infer<typeof SetFeaturedBadgesRequest>,
  ) {
    await this.badges.setFeatured(u.userId, dto.badgeIds);
    await this.avatars.announce(u.userId);
  }

  @Get('avatars/recent')
  recentAvatars(@CurrentUser() u: AuthUser) {
    return this.avatars.recent(u.userId);
  }

  @Post('avatars/recent')
  @HttpCode(200)
  async useRecentAvatar(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(UseRecentAvatarRequest)) dto: z.infer<typeof UseRecentAvatarRequest>,
  ) {
    return this.auth.toMe(await this.avatars.useRecent(u.userId, dto.entry));
  }

  // ---------- Verificação em duas etapas e aparelhos conectados (ADR-0046) ----------

  @Post('2fa/setup')
  @HttpCode(200)
  setupTwoFactor(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(TwoFactorSetupRequest)) dto: z.infer<typeof TwoFactorSetupRequest>,
  ) {
    return this.twoFactor.setup(u.userId, dto.password);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  enableTwoFactor(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(TwoFactorEnableRequest)) dto: z.infer<typeof TwoFactorEnableRequest>,
  ) {
    return this.twoFactor.enable(u.userId, dto.code);
  }

  @Post('2fa/disable')
  @HttpCode(204)
  async disableTwoFactor(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(TwoFactorDisableRequest)) dto: z.infer<typeof TwoFactorDisableRequest>,
  ) {
    await this.twoFactor.disable(u.userId, dto.password, dto.code);
  }

  @Post('2fa/recovery-codes')
  @HttpCode(200)
  regenerateRecovery(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(TwoFactorDisableRequest)) dto: z.infer<typeof TwoFactorDisableRequest>,
  ) {
    return this.twoFactor.regenerateRecovery(u.userId, dto.password, dto.code);
  }

  // ---------- E-mail e código por e-mail (ADR-0047) ----------

  @Put('email')
  @HttpCode(204)
  async setEmail(@CurrentUser() u: AuthUser, @Body(zodPipe(SetEmailRequest)) dto: z.infer<typeof SetEmailRequest>) {
    await this.accountEmail.set(u.userId, dto.email, dto.password);
  }

  @Post('email/verify/send')
  @HttpCode(204)
  async sendEmailVerification(@CurrentUser() u: AuthUser) {
    await this.accountEmail.sendVerification(u.userId);
  }

  @Post('email/verify')
  @HttpCode(204)
  async verifyEmail(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(VerifyEmailRequest)) dto: z.infer<typeof VerifyEmailRequest>,
  ) {
    await this.accountEmail.verify(u.userId, dto.code);
  }

  @Post('2fa/email/enable')
  @HttpCode(200)
  enableEmailTwoFactor(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(EnableEmailTwoFactorRequest)) dto: z.infer<typeof EnableEmailTwoFactorRequest>,
  ) {
    return this.twoFactor.enableEmail(u.userId, dto.password);
  }

  /** manda o código da segunda etapa por e-mail (para desligar ou gerar novos códigos) */
  @Post('2fa/email/send')
  @HttpCode(204)
  async sendTwoFactorEmail(@CurrentUser() u: AuthUser) {
    await this.twoFactor.sendTwoFactorEmail(u.userId);
  }

  @Get('sessions')
  sessions(@CurrentUser() u: AuthUser) {
    return this.auth.listSessions(u.userId, u.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@CurrentUser() u: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.auth.revokeSession(u.userId, id);
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOthers(@CurrentUser() u: AuthUser) {
    return { revoked: await this.auth.revokeOtherSessions(u.userId, u.sessionId) };
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
