// The themes that ship. A theme is one CSS file beside this one setting the token contract under a data attribute;
// this registry is what the picker lists. Adding a theme is one file and one line here.
export const THEMES = [
  { id: 'graphite', name: 'Graphite', kind: 'dark' },
  { id: 'paper', name: 'Paper', kind: 'light' },
  { id: 'nord', name: 'Nord', kind: 'dark' },
  { id: 'catppuccin', name: 'Catppuccin', kind: 'dark' },
  { id: 'tokyo', name: 'Tokyo Night', kind: 'dark' },
  { id: 'gruvbox', name: 'Gruvbox', kind: 'dark' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
export const DEFAULT_THEME: ThemeId = 'graphite';
export const THEME_ATTRIBUTE = 'data-theme';

export const isThemeId = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);

/** Put the theme on the document; the stylesheet does the rest. */
export function applyTheme(id: ThemeId): void {
  const root = document.documentElement;
  root.setAttribute(THEME_ATTRIBUTE, id);
  root.setAttribute('data-kind', THEMES.find((t) => t.id === id)?.kind ?? 'dark');
}
