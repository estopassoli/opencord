import { ForbiddenException, NotFoundException } from '@nestjs/common';

/** 404 em vez de 403 quando revelar a existência do recurso seria vazamento (IDOR). */
export const notFound = (what = 'recurso') => new NotFoundException(`${what} não encontrado`);
export const forbidden = (why = 'permissão insuficiente') => new ForbiddenException(why);
