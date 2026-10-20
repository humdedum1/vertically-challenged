export const SITES: readonly [host: string, name: string, share: number][];
export const WORDS: readonly string[];
export function siteFor(n: number): [host: string, name: string, share: number];
export function fixtureFor(n: number): { url: string; title: string };
