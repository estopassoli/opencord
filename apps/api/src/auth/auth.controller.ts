import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  ClaimAccountRequest,
  GuestJoinRequest,
  LoginRequest,
  Password,
  RefreshRequest,
  RegisterRequest,
} from '@opencord/contracts';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { AuthService, type ClientInfo } from './auth.service.js';

const ChangePasswordRequest = z.object({ currentPassword: z.string().min(1).max(256), newPassword: Password });
// Limites mais rígidos que o global para rotas de credenciais. Lido na carga do módulo (decorators são estáticos);
// AUTH_RATE_PER_MINUTE é validado em config.ts. Só aumente em dev/E2E.
const AUTH_RATE = { rateLimit: { max: Number(process.env.AUTH_RATE_PER_MINUTE) || 10, timeWindow: '1 minute' } };

const client = (req: FastifyRequest): ClientInfo => ({
  userAgent: req.headers['user-agent'],
  ip: req.clientIp || req.ip,
  deviceId: typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'].slice(0, 128) : undefined,
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('instance')
  instance() {
    return this.auth.instanceInfo();
  }

  @Public()
  @Post('guest')
  @RouteConfig(AUTH_RATE)
  guest(@Body(zodPipe(GuestJoinRequest)) dto: z.infer<typeof GuestJoinRequest>, @Req() req: FastifyRequest) {
    return this.auth.guestJoin(dto, client(req));
  }

  @Public()
  @Post('register')
  @RouteConfig(AUTH_RATE)
  register(@Body(zodPipe(RegisterRequest)) dto: RegisterRequest, @Req() req: FastifyRequest) {
    return this.auth.register(dto, client(req));
  }

  @Public()
  @Post('login')
  @RouteConfig(AUTH_RATE)
  @HttpCode(200)
  login(@Body(zodPipe(LoginRequest)) dto: LoginRequest, @Req() req: FastifyRequest) {
    return this.auth.login(dto, client(req));
  }

  @Public()
  @Post('refresh')
  @RouteConfig(AUTH_RATE)
  @HttpCode(200)
  refresh(@Body(zodPipe(RefreshRequest)) dto: RefreshRequest, @Req() req: FastifyRequest) {
    return this.auth.refresh(dto.refreshToken, client(req));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser) {
    await this.auth.logout(user.sessionId);
  }

  /** Criar conta a partir da identidade só com apelido (mesmo usuário). */
  @Post('claim')
  claim(@CurrentUser() user: AuthUser, @Body(zodPipe(ClaimAccountRequest)) dto: z.infer<typeof ClaimAccountRequest>) {
    return this.auth.claim(user.userId, dto);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(zodPipe(ChangePasswordRequest)) dto: z.infer<typeof ChangePasswordRequest>,
  ) {
    await this.auth.changePassword(user.userId, dto.currentPassword, dto.newPassword, user.sessionId);
  }
}
