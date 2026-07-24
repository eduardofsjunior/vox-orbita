/**
 * Curated visual palettes. `ThemeColors` feeds layer rendering; the UI keeps
 * its own fixed dark chrome and only the accent follows the theme.
 */

import type { ThemeColors, ThemeScope, ThemeScopes } from './engine/types';

export { THEME_SCOPES, defaultThemeScopes } from './engine/types';
export type { ThemeScope, ThemeScopes } from './engine/types';

export interface Theme {
  id: string;
  colors: ThemeColors;
}

export const THEMES: readonly Theme[] = [
  { id: 'ember', colors: { a: '#ff6b3d', b: '#ffb35c', c: '#ffe3c4', bg: '#0d0c10' } },
  { id: 'neon', colors: { a: '#00ffc6', b: '#ff2ec4', c: '#7df9ff', bg: '#07070f' } },
  { id: 'ocean', colors: { a: '#38bdf8', b: '#6366f1', c: '#a5f3fc', bg: '#071019' } },
  { id: 'violet', colors: { a: '#a78bfa', b: '#f472b6', c: '#e9d5ff', bg: '#0e0a18' } },
  { id: 'mono', colors: { a: '#f4f4f5', b: '#8b8b93', c: '#ffffff', bg: '#0a0a0b' } },
  { id: 'sunset', colors: { a: '#fb7185', b: '#fbbf24', c: '#fde68a', bg: '#150b12' } },
  // Neon family — saturated accents on near-black bases.
  { id: 'cyber', colors: { a: '#00e5ff', b: '#b537f2', c: '#e0f8ff', bg: '#060913' } },
  { id: 'laser', colors: { a: '#ff0090', b: '#39ff14', c: '#fffb96', bg: '#0a0612' } },
  { id: 'acid', colors: { a: '#ccff00', b: '#00ff88', c: '#f4ffd0', bg: '#071008' } },
  { id: 'synth', colors: { a: '#ff2975', b: '#00b3fe', c: '#f222ff', bg: '#12071f' } },
];

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Resolve every scope's palette id to its colors in one go. */
export function resolveScopes(scopes: ThemeScopes): Record<ThemeScope, ThemeColors> {
  return {
    app: getTheme(scopes.app).colors,
    background: getTheme(scopes.background).colors,
    visualizer: getTheme(scopes.visualizer).colors,
    overlay: getTheme(scopes.overlay).colors,
  };
}
