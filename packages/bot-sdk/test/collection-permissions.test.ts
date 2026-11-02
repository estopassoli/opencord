import { describe, expect, it } from 'vitest';
import { Permission as ContractPermission } from '@opencord/contracts';
import {
  Collection,
  Permission,
  PermissionFlagsBits,
  PermissionsBitField,
  computeBasePermissions,
  computeChannelPermissions,
} from '../src/index.js';

describe('Collection', () => {
  const c = new Collection<string, number>([
    ['a', 1],
    ['b', 2],
    ['c', 3],
  ]);
  it('first/last/at/random/find/filter/map/some/every/reduce/sort/toJSON', () => {
    expect(c.first()).toBe(1);
    expect(c.first(2)).toEqual([1, 2]);
    expect(c.last()).toBe(3);
    expect(c.last(2)).toEqual([2, 3]);
    expect(c.at(-1)).toBe(3);
    expect(c.keyAt(1)).toBe('b');
    expect([1, 2, 3]).toContain(c.random());
    expect(c.random(5)).toHaveLength(3);
    expect(c.find((v) => v > 1)).toBe(2);
    expect(c.findKey((v) => v > 1)).toBe('b');
    expect([...c.filter((v) => v % 2 === 1).keys()]).toEqual(['a', 'c']);
    expect(c.map((v, k) => `${k}${v}`)).toEqual(['a1', 'b2', 'c3']);
    expect(c.mapValues((v) => v * 2).get('c')).toBe(6);
    expect(c.flatMap((v) => [v, v])).toHaveLength(6);
    expect(c.some((v) => v === 3)).toBe(true);
    expect(c.every((v) => v > 0)).toBe(true);
    expect(c.reduce((acc, v) => acc + v, 0)).toBe(6);
    expect(c.partition((v) => v > 1).map((p) => p.size)).toEqual([2, 1]);
    expect(c.sorted((x, y) => y - x).first()).toBe(3);
    expect(c.first()).toBe(1);
    const copy = c.clone().sort((x, y) => y - x);
    expect([...copy.keys()]).toEqual(['c', 'b', 'a']);
    expect(c.toJSON()).toEqual([1, 2, 3]);
    expect(JSON.stringify(c)).toBe('[1,2,3]');
    expect(c.hasAll('a', 'b')).toBe(true);
    expect(c.hasAny('z', 'b')).toBe(true);
    expect(c.equals(c.clone())).toBe(true);
    expect(c.concat(new Map([['d', 4]])).size).toBe(4);
    expect([
      ...c
        .difference(
          new Map([
            ['a', 1],
            ['z', 9],
          ]),
        )
        .keys(),
    ]).toEqual(['z', 'b', 'c']);
    expect([...c.intersect(new Map([['a', 1]])).keys()]).toEqual(['a']);
    const s = c.clone();
    expect(s.sweep((v) => v > 1)).toBe(2);
    expect(s.ensure('q', () => 7)).toBe(7);
    expect(s.ensure('q', () => 8)).toBe(7);
    expect(Object.prototype.toString.call(c)).toBe('[object Collection]');
    expect(c).toBeInstanceOf(Map);
  });
});

describe('PermissionsBitField', () => {
  it('espelha os bits do contrato', () => {
    expect(Permission).toEqual(ContractPermission);
    expect(PermissionFlagsBits.BanMembers).toBe(1 << 19);
    expect(PermissionFlagsBits.ModerateMembers).toBe(1 << 20);
    expect(PermissionsBitField.All).toBe(Object.values(ContractPermission).reduce((a, b) => a | b, 0));
  });
  it('has/any/add/remove/toArray/serialize/missing/resolve', () => {
    const p = new PermissionsBitField(['ViewChannel', 'SendMessages']);
    expect(p.bitfield).toBe(3);
    expect(p.has('ViewChannel')).toBe(true);
    expect(p.has(PermissionFlagsBits.SendMessages)).toBe(true);
    expect(p.has(['ViewChannel', 'SendMessages'])).toBe(true);
    expect(p.has('ManageMessages')).toBe(false);
    expect(p.has('MANAGE_MESSAGES')).toBe(false);
    expect(p.any(['ManageMessages', 'ViewChannel'])).toBe(true);
    expect(p.missing(['ViewChannel', 'KickMembers'])).toEqual(['KickMembers']);
    p.add('ManageMessages', 1n << 19n);
    expect(p.toArray()).toEqual(['ViewChannel', 'SendMessages', 'ManageMessages', 'BanMembers']);
    p.remove('BanMembers');
    expect(p.serialize().BanMembers).toBe(false);
    expect(+p).toBe(7);
    expect(JSON.stringify({ p })).toBe('{"p":7}');
    expect(`${p}`).toBe('7');
    expect([...p]).toEqual(['ViewChannel', 'SendMessages', 'ManageMessages']);
    const admin = new PermissionsBitField('Administrator');
    expect(admin.has('BanMembers')).toBe(true);
    expect(admin.has('BanMembers', false)).toBe(false);
    expect(admin.missing('BanMembers')).toEqual([]);
    expect(PermissionsBitField.resolve(new PermissionsBitField(5))).toBe(5);
    expect(() => new PermissionsBitField('Voar' as never)).toThrow(/desconhecida/);
    expect(() => new PermissionsBitField(-1)).toThrow(/inválida/);
    expect(new PermissionsBitField(PermissionsBitField.Default).has(['ViewChannel', 'Connect', 'Speak'])).toBe(true);
  });
  it('computeBase/ChannelPermissions seguem a regra da API (dono tudo, @everyone + cargos, overrides)', () => {
    const roles = new Map([
      ['everyone', PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.Connect],
      ['mod', PermissionFlagsBits.ManageMessages],
    ]);
    const ctx = {
      userId: 'u',
      ownerId: 'o',
      everyoneRoleId: 'everyone',
      rolePermissions: roles,
      memberRoleIds: ['mod'],
    };
    expect(computeBasePermissions(ctx)).toBe(roles.get('everyone')! | PermissionFlagsBits.ManageMessages);
    expect(computeBasePermissions({ ...ctx, userId: 'o' })).toBe(PermissionsBitField.All);
    const denied = computeChannelPermissions(ctx, [
      { subjectType: 'role', subjectId: 'everyone', allow: 0, deny: PermissionFlagsBits.SendMessages },
    ]);
    expect(new PermissionsBitField(denied).has('SendMessages')).toBe(false);
    const allowedByRole = computeChannelPermissions(ctx, [
      { subjectType: 'role', subjectId: 'everyone', allow: 0, deny: PermissionFlagsBits.SendMessages },
      { subjectType: 'role', subjectId: 'mod', allow: PermissionFlagsBits.SendMessages, deny: 0 },
    ]);
    expect(new PermissionsBitField(allowedByRole).has('SendMessages')).toBe(true);
    const hidden = computeChannelPermissions(ctx, [
      { subjectType: 'member', subjectId: 'u', allow: 0, deny: PermissionFlagsBits.ViewChannel },
    ]);
    expect(hidden).toBe(0);
    const noConnect = computeChannelPermissions(
      { ...ctx, rolePermissions: new Map([['everyone', PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Speak]]) },
      [],
    );
    expect(new PermissionsBitField(noConnect).has('Speak')).toBe(false);
  });
});
