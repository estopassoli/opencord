import type { Plugin } from 'vite';

export interface BundleChunkLike {
  type: string;
  isEntry?: boolean;
  imports?: string[];
  viteMetadata?: { importedCss?: Set<string> };
}
export const STATIC_PRECACHE: string[];
export function precacheFromBundle(bundle: Record<string, BundleChunkLike>): string[];
export function versionFromBundle(bundle: Record<string, BundleChunkLike>): string;
export function buildServiceWorker(opts: { version: string; precache: string[] }): string;
export function pwaPlugin(): Plugin;
