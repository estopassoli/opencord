export const APP_PATHS: string[];
export function parseVersion(v: string): [number, number, number];
export function compareVersions(a: string, b: string): number;
export function bumpOf(message: string): 'major' | 'minor' | 'patch';
export function releaseAs(messages: string[]): string | undefined;
export function nextVersion(prev: string, messages: string[]): string;
export function latestTag(repo?: string): string | undefined;
