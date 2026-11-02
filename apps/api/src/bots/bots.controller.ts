import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  OfficialBotClaimRequest,
  AddBotToServerRequest,
  CreateBotRequest,
  CreateInteractionRequest,
  InteractionAutocompleteRequest,
  InteractionDeferRequest,
  InteractionModalRequest,
  InteractionReplyRequest,
  InteractionUpdateRequest,
  SetBotCommandsRequest,
  UpdateBotRequest,
} from '@opencord/contracts';
import type { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../common/auth.js';
import { zodPipe } from '../common/zod.pipe.js';
import { BotsService } from './bots.service.js';
import { InteractionsService } from './interactions.service.js';

const id = new ParseUUIDPipe();

/** Bots e aplicativos (ADR-0032; interações v2 na ADR-0034). Todas as rotas passam pelo AuthGuard global; tokens `ocb_…` também valem. */
@Controller()
export class BotsController {
  constructor(
    private readonly bots: BotsService,
    private readonly interactions: InteractionsService,
  ) {}

  // ---------- Meus bots (dono) ----------
  @Get('me/bots')
  listMine(@CurrentUser() u: AuthUser) {
    return this.bots.listMine(u.userId);
  }

  @Post('me/bots')
  create(@CurrentUser() u: AuthUser, @Body(zodPipe(CreateBotRequest)) dto: z.infer<typeof CreateBotRequest>) {
    return this.bots.create(u, dto);
  }

  /** Bots oficiais (ADR-0037): container dos bots pede o token com o segredo compartilhado (rota pública). */
  @Public()
  @Post('bots/official/claim')
  claimOfficial(@Body(zodPipe(OfficialBotClaimRequest)) dto: z.infer<typeof OfficialBotClaimRequest>) {
    return this.bots.claimOfficial(dto);
  }

  // ---------- Diretório e o próprio bot (as rotas fixas vêm antes de `bots/:id`) ----------
  @Get('bots/directory')
  directory() {
    return this.bots.directory();
  }

  @Get('bots/@me')
  me(@CurrentUser() u: AuthUser) {
    return this.bots.me(u);
  }

  @Put('bots/@me/commands')
  setCommands(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(SetBotCommandsRequest)) dto: z.infer<typeof SetBotCommandsRequest>,
  ) {
    return this.bots.setCommands(u, dto.commands);
  }

  @Get('bots/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', id) botId: string) {
    return this.bots.get(u.userId, botId);
  }

  @Patch('bots/:id')
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', id) botId: string,
    @Body(zodPipe(UpdateBotRequest)) dto: z.infer<typeof UpdateBotRequest>,
  ) {
    return this.bots.update(u.userId, botId, dto);
  }

  @Post('bots/:id/token')
  regenerateToken(@CurrentUser() u: AuthUser, @Param('id', id) botId: string) {
    return this.bots.regenerateToken(u.userId, botId);
  }

  @Delete('bots/:id')
  @HttpCode(204)
  async remove(@CurrentUser() u: AuthUser, @Param('id', id) botId: string) {
    await this.bots.remove(u.userId, botId);
  }

  // ---------- Bots num servidor ----------
  @Get('servers/:id/bots')
  listServerBots(@CurrentUser() u: AuthUser, @Param('id', id) serverId: string) {
    return this.bots.listServerBots(u.userId, serverId);
  }

  @Post('servers/:id/bots')
  addToServer(
    @CurrentUser() u: AuthUser,
    @Param('id', id) serverId: string,
    @Body(zodPipe(AddBotToServerRequest)) dto: z.infer<typeof AddBotToServerRequest>,
  ) {
    return this.bots.addToServer(u.userId, serverId, dto.botId);
  }

  @Delete('servers/:id/bots/:botId')
  @HttpCode(204)
  async removeFromServer(
    @CurrentUser() u: AuthUser,
    @Param('id', id) serverId: string,
    @Param('botId', id) botId: string,
  ) {
    await this.bots.removeFromServer(u.userId, serverId, botId);
  }

  @Get('servers/:id/commands')
  serverCommands(@CurrentUser() u: AuthUser, @Param('id', id) serverId: string) {
    return this.bots.serverCommands(u.userId, serverId);
  }

  // ---------- Interações ----------
  @Post('interactions')
  createInteraction(
    @CurrentUser() u: AuthUser,
    @Body(zodPipe(CreateInteractionRequest)) dto: z.infer<typeof CreateInteractionRequest>,
  ) {
    return this.interactions.create(u, dto);
  }

  // v1 manda `defer` sem corpo
  @Post('interactions/:id/defer')
  @HttpCode(204)
  async defer(
    @CurrentUser() u: AuthUser,
    @Param('id', id) interactionId: string,
    @Body(zodPipe(InteractionDeferRequest.optional())) dto: z.infer<typeof InteractionDeferRequest> | undefined,
  ) {
    await this.interactions.defer(u, interactionId, dto ?? { ephemeral: false, update: false });
  }

  @Post('interactions/:id/reply')
  @HttpCode(200)
  reply(
    @CurrentUser() u: AuthUser,
    @Param('id', id) interactionId: string,
    @Body(zodPipe(InteractionReplyRequest)) dto: z.infer<typeof InteractionReplyRequest>,
  ) {
    return this.interactions.reply(u, interactionId, dto);
  }

  @Post('interactions/:id/update')
  @HttpCode(200)
  updateInteraction(
    @CurrentUser() u: AuthUser,
    @Param('id', id) interactionId: string,
    @Body(zodPipe(InteractionUpdateRequest)) dto: z.infer<typeof InteractionUpdateRequest>,
  ) {
    return this.interactions.update(u, interactionId, dto);
  }

  @Post('interactions/:id/modal')
  @HttpCode(204)
  async modal(
    @CurrentUser() u: AuthUser,
    @Param('id', id) interactionId: string,
    @Body(zodPipe(InteractionModalRequest)) dto: z.infer<typeof InteractionModalRequest>,
  ) {
    await this.interactions.modal(u, interactionId, dto);
  }

  @Post('interactions/:id/autocomplete')
  @HttpCode(204)
  async autocomplete(
    @CurrentUser() u: AuthUser,
    @Param('id', id) interactionId: string,
    @Body(zodPipe(InteractionAutocompleteRequest)) dto: z.infer<typeof InteractionAutocompleteRequest>,
  ) {
    await this.interactions.autocomplete(u, interactionId, dto);
  }
}
