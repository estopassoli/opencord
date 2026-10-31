/**
 * Detecção do jogo aberto (ADR-0021), parte pura (testável sem Windows):
 * - Steam: o próprio cliente escreve no registro qual jogo está rodando (`RunningAppID`) e o nome de cada um;
 * - fora da Steam: o nome do executável em execução, comparado com os jogos que a pessoa cadastrou e com a lista
 *   abaixo (montada pelo OpenCord a partir dos nomes públicos dos executáveis; não usa lista de outro serviço).
 */

export interface DetectedGame {
  name: string;
  steamAppId?: number;
  /** executável que identificou o jogo (fora da Steam) */
  exe?: string;
}

export interface CustomGame {
  exe: string;
  name: string;
}

/** Jogos populares fora da Steam (ou que costumam ser abertos pelo próprio launcher). Chave: executável em minúsculas. */
export const KNOWN_GAMES: Readonly<Record<string, string>> = {
  'valorant-win64-shipping.exe': 'VALORANT',
  'league of legends.exe': 'League of Legends',
  'fortniteclient-win64-shipping.exe': 'Fortnite',
  'minecraft.windows.exe': 'Minecraft',
  'pathofexile_x64.exe': 'Path of Exile',
  'pathofexilesteam.exe': 'Path of Exile',
  'pathofexile_x64steam.exe': 'Path of Exile',
  'pathofexile2.exe': 'Path of Exile 2',
  'cs2.exe': 'Counter-Strike 2',
  'dota2.exe': 'Dota 2',
  'r5apex.exe': 'Apex Legends',
  'r5apex_dx12.exe': 'Apex Legends',
  'overwatch.exe': 'Overwatch 2',
  'wow.exe': 'World of Warcraft',
  'diablo iv.exe': 'Diablo IV',
  'hearthstone.exe': 'Hearthstone',
  'cod.exe': 'Call of Duty',
  'modernwarfare.exe': 'Call of Duty: Modern Warfare',
  'gta5.exe': 'Grand Theft Auto V',
  'gta5_enhanced.exe': 'Grand Theft Auto V',
  'rdr2.exe': 'Red Dead Redemption 2',
  'rocketleague.exe': 'Rocket League',
  'robloxplayerbeta.exe': 'Roblox',
  'genshinimpact.exe': 'Genshin Impact',
  'zenlesszonezero.exe': 'Zenless Zone Zero',
  'starrail.exe': 'Honkai: Star Rail',
  'eldenring.exe': 'ELDEN RING',
  'marvel-win64-shipping.exe': 'Marvel Rivals',
  'tslgame.exe': 'PUBG: BATTLEGROUNDS',
  'rainbowsix.exe': "Tom Clancy's Rainbow Six Siege",
  'rainbowsix_vulkan.exe': "Tom Clancy's Rainbow Six Siege",
  'bf6.exe': 'Battlefield 6',
  'bf2042.exe': 'Battlefield 2042',
  'deadlock.exe': 'Deadlock',
  'huntgame.exe': 'Hunt: Showdown 1896',
  'eft.exe': 'Escape from Tarkov',
  'escapefromtarkov.exe': 'Escape from Tarkov',
  'lostark.exe': 'Lost Ark',
  'ffxiv_dx11.exe': 'FINAL FANTASY XIV Online',
  'warframe.x64.exe': 'Warframe',
  'destiny2.exe': 'Destiny 2',
  'terraria.exe': 'Terraria',
  'stardew valley.exe': 'Stardew Valley',
  'among us.exe': 'Among Us',
  'pioneergame.exe': 'ARC Raiders',
  'enshrouded.exe': 'Enshrouded',
  'palworld-win64-shipping.exe': 'Palworld',
  'helldivers2.exe': 'HELLDIVERS 2',
  'sf6.exe': 'Street Fighter 6',
  'tekken8.exe': 'TEKKEN 8',
  'leagueoflegends.exe': 'League of Legends',
  'osu!.exe': 'osu!',
  'tibia.exe': 'Tibia',
  'pointblank.exe': 'Point Blank',
  'freefire.exe': 'Free Fire',
};

/** `reg query ... /v Nome` → número de um REG_DWORD (0 se não houver). */
export function parseRegDword(out: string, value: string): number {
  const m = new RegExp(`^\\s*${value}\\s+REG_DWORD\\s+0x([0-9a-f]+)`, 'im').exec(out);
  return m ? parseInt(m[1]!, 16) : 0;
}

/** `reg query ... /v Nome` → texto de um REG_SZ (null se não houver). */
export function parseRegString(out: string, value: string): string | null {
  const m = new RegExp(`^\\s*${value}\\s+REG_SZ\\s+(.+?)\\s*$`, 'im').exec(out);
  return m ? m[1]! : null;
}

/** Saída de `tasklist /fo csv /nh` → nomes de executáveis em minúsculas, sem repetir. */
export function parseTasklist(out: string): string[] {
  const names = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^"([^"]+)"/.exec(line.trim());
    if (m) names.add(m[1]!.toLowerCase());
  }
  return [...names];
}

/** Executáveis do sistema e de programas comuns que não fazem sentido como "jogo" no seletor. */
const NOT_GAMES =
  /^(system|registry|smss|csrss|wininit|winlogon|services|lsass|svchost|fontdrvhost|dwm|explorer|sihost|taskhostw|ctfmon|conhost|runtimebroker|searchhost|startmenuexperiencehost|shellexperiencehost|textinputhost|dllhost|audiodg|spoolsv|wmiprvse|msedge|msedgewebview2|chrome|firefox|opencord|discord|steam|steamwebhelper|steamservice|epicgameslauncher|riotclientservices|battle\.net|code|powershell|cmd|wsl|wslhost|vmmem|tasklist|reg|nvcontainer|nvidia.*|amd.*|radeon.*|securityhealth.*|msmpeng|nissrv|memory compression|idle|secure system)\.?(exe)?$/;

/** Programas abertos que a pessoa pode cadastrar como jogo (sem processos do sistema). */
export function pickableProcesses(exes: string[]): string[] {
  return exes.filter((e) => e.endsWith('.exe') && !NOT_GAMES.test(e)).sort();
}

/**
 * Qual jogo está aberto: a Steam primeiro (nome oficial e página da loja); depois o que a pessoa cadastrou; por fim
 * a lista do OpenCord. `steamName` é o nome do jogo `steamAppId` lido do registro.
 */
export function pickGame(
  exes: string[],
  custom: CustomGame[],
  steamAppId: number,
  steamName: string | null,
): DetectedGame | null {
  if (steamAppId > 0 && steamName) return { name: steamName, steamAppId };
  const running = new Set(exes);
  for (const c of custom) {
    const exe = c.exe.toLowerCase();
    if (running.has(exe)) return { name: c.name, exe };
  }
  for (const exe of exes) {
    const name = KNOWN_GAMES[exe];
    if (name) return { name, exe };
  }
  return null;
}

/** Mesmo jogo (para não reenviar nem reiniciar o tempo de jogo a cada verificação). */
export const sameGame = (a: DetectedGame | null, b: DetectedGame | null) =>
  a?.name === b?.name && a?.steamAppId === b?.steamAppId;
