import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  computeBasePermissions,
  computeChannelPermissions,
  DEFAULT_EVERYONE_PERMISSIONS,
  hasPermission,
  Permission,
  type PermissionContext,
} from './permissions.js';

const ctx = (over: Partial<PermissionContext> = {}): PermissionContext => ({
  userId: 'u1',
  ownerId: 'owner',
  everyoneRoleId: 'everyone',
  rolePermissions: new Map([
    ['everyone', DEFAULT_EVERYONE_PERMISSIONS],
    ['mod', Permission.MANAGE_MESSAGES | Permission.KICK_MEMBERS],
    ['admin', Permission.ADMINISTRATOR],
    ['muted', 0],
  ]),
  memberRoleIds: [],
  ...over,
});

describe('computeBasePermissions', () => {
  it('owner recebe tudo', () => {
    expect(computeBasePermissions(ctx({ userId: 'owner' }))).toBe(ALL_PERMISSIONS);
  });
  it('soma @everyone e cargos', () => {
    const p = computeBasePermissions(ctx({ memberRoleIds: ['mod'] }));
    expect(hasPermission(p, Permission.SEND_MESSAGES)).toBe(true);
    expect(hasPermission(p, Permission.KICK_MEMBERS)).toBe(true);
    expect(hasPermission(p, Permission.MANAGE_ROLES)).toBe(false);
  });
  it('ADMINISTRATOR concede tudo', () => {
    expect(computeBasePermissions(ctx({ memberRoleIds: ['admin'] }))).toBe(ALL_PERMISSIONS);
  });
  it('cargo inexistente não concede nada', () => {
    expect(computeBasePermissions(ctx({ memberRoleIds: ['ghost'] }))).toBe(DEFAULT_EVERYONE_PERMISSIONS);
  });
});

describe('computeChannelPermissions', () => {
  it('deny de @everyone remove VIEW_CHANNEL e zera o canal', () => {
    const p = computeChannelPermissions(ctx(), [
      { subjectType: 'role', subjectId: 'everyone', allow: 0, deny: Permission.VIEW_CHANNEL },
    ]);
    expect(p).toBe(0);
  });
  it('allow de cargo vence deny de @everyone', () => {
    const p = computeChannelPermissions(ctx({ memberRoleIds: ['mod'] }), [
      { subjectType: 'role', subjectId: 'everyone', allow: 0, deny: Permission.VIEW_CHANNEL },
      { subjectType: 'role', subjectId: 'mod', allow: Permission.VIEW_CHANNEL, deny: 0 },
    ]);
    expect(hasPermission(p, Permission.VIEW_CHANNEL)).toBe(true);
  });
  it('no mesmo nível, allow agregado de cargos vence deny agregado', () => {
    const p = computeChannelPermissions(ctx({ memberRoleIds: ['mod', 'muted'] }), [
      { subjectType: 'role', subjectId: 'muted', allow: 0, deny: Permission.SEND_MESSAGES },
      { subjectType: 'role', subjectId: 'mod', allow: Permission.SEND_MESSAGES, deny: 0 },
    ]);
    expect(hasPermission(p, Permission.SEND_MESSAGES)).toBe(true);
  });
  it('override de membro vence cargos', () => {
    const p = computeChannelPermissions(ctx({ memberRoleIds: ['mod'] }), [
      { subjectType: 'role', subjectId: 'mod', allow: Permission.SEND_MESSAGES, deny: 0 },
      { subjectType: 'member', subjectId: 'u1', allow: 0, deny: Permission.SEND_MESSAGES },
    ]);
    expect(hasPermission(p, Permission.SEND_MESSAGES)).toBe(false);
    expect(hasPermission(p, Permission.VIEW_CHANNEL)).toBe(true);
  });
  it('override de outro membro não se aplica', () => {
    const p = computeChannelPermissions(ctx(), [
      { subjectType: 'member', subjectId: 'u2', allow: 0, deny: Permission.SEND_MESSAGES },
    ]);
    expect(hasPermission(p, Permission.SEND_MESSAGES)).toBe(true);
  });
  it('sem CONNECT remove SPEAK/VIDEO/STREAM', () => {
    const p = computeChannelPermissions(ctx(), [
      { subjectType: 'role', subjectId: 'everyone', allow: 0, deny: Permission.CONNECT },
    ]);
    expect(hasPermission(p, Permission.SPEAK)).toBe(false);
    expect(hasPermission(p, Permission.STREAM)).toBe(false);
    expect(hasPermission(p, Permission.VIEW_CHANNEL)).toBe(true);
  });
  it('owner ignora overrides', () => {
    const p = computeChannelPermissions(ctx({ userId: 'owner' }), [
      { subjectType: 'member', subjectId: 'owner', allow: 0, deny: Permission.VIEW_CHANNEL },
    ]);
    expect(p).toBe(ALL_PERMISSIONS);
  });
});
