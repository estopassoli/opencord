import { describe, expect, it } from 'vitest';
import {
  KNOWN_GAMES,
  parseRegDword,
  parseRegString,
  parseInstallDir,
  parseLibraryFolders,
  parseTasklist,
  pickableProcesses,
  pickGame,
  sameGame,
} from '../electron/shared/games-core';

const REG_DWORD = `\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    RunningAppID    REG_DWORD    0x291d5a\r\n\r\n`;
const REG_SZ = `\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps\\2694490\r\n    Name    REG_SZ    Path of Exile 2\r\n`;
const TASKLIST = `"System Idle Process","0","Services","0","8 K"\r\n"svchost.exe","1200","Services","0","10.000 K"\r\n"VALORANT-Win64-Shipping.exe","4321","Console","1","2.000.000 K"\r\n"svchost.exe","1300","Services","0","9.000 K"\r\n"MyIndieGame.exe","999","Console","1","100 K"\r\n`;

describe('detecção do jogo (ADR-0021)', () => {
  it('lê o registro da Steam', () => {
    expect(parseRegDword(REG_DWORD, 'RunningAppID')).toBe(2694490);
    expect(parseRegDword('', 'RunningAppID')).toBe(0);
    expect(parseRegString(REG_SZ, 'Name')).toBe('Path of Exile 2');
    expect(parseRegString('', 'Name')).toBeNull();
  });
  it('lista executáveis sem repetir e sem os do sistema no seletor', () => {
    const exes = parseTasklist(TASKLIST);
    expect(exes).toEqual(['system idle process', 'svchost.exe', 'valorant-win64-shipping.exe', 'myindiegame.exe']);
    expect(pickableProcesses(exes)).toEqual(['myindiegame.exe', 'valorant-win64-shipping.exe']);
  });
  it('Steam primeiro, depois o cadastrado pela pessoa, depois a lista do OpenCord', () => {
    const exes = parseTasklist(TASKLIST);
    const custom = [{ exe: 'MyIndieGame.exe', name: 'Meu Jogo' }];
    expect(pickGame(exes, custom, 2694490, 'Path of Exile 2')).toEqual({
      name: 'Path of Exile 2',
      steamAppId: 2694490,
    });
    expect(pickGame(exes, custom, 0, null)).toEqual({ name: 'Meu Jogo', exe: 'myindiegame.exe' });
    expect(pickGame(exes, [], 0, null)).toEqual({ name: 'VALORANT', exe: 'valorant-win64-shipping.exe' });
    expect(pickGame(['notepad.exe'], [], 0, null)).toBeNull();
  });
  it('mesmo jogo não reinicia o tempo; lista conhecida em minúsculas', () => {
    expect(sameGame({ name: 'A', exe: 'a.exe' }, { name: 'A', exe: 'b.exe' })).toBe(true);
    expect(sameGame({ name: 'A' }, null)).toBe(false);
    for (const exe of Object.keys(KNOWN_GAMES)) expect(exe).toBe(exe.toLowerCase());
  });
  it('pasta do jogo da Steam pelas bibliotecas e pelo appmanifest', () => {
    const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\Jogos"\n\t}\n}';
    expect(parseLibraryFolders(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\Jogos']);
    expect(parseInstallDir('"AppState"\n{\n\t"installdir"\t\t"Path of Exile 2"\n}')).toBe('Path of Exile 2');
    expect(parseInstallDir('{}')).toBeNull();
  });
});
