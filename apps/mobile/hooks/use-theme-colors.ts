import { resolveThemeTokens, type ThemeColors, FALLBACK_THEME_COLORS } from './use-theme-tokens';
import { useTheme, type ThemeContextType } from '../contexts/theme-context';

// Re-export the forma genérica de Color from its source-of-truth module so existing
// import sites (`import { ThemeColors, useThemeColors } from './use-theme-colors'`)
// keep working unchanged. The Dependencia is strictly unidireccional:
// use-theme-colors → use-theme-tokens (use-theme-tokens imports nothing from here),
// so there is no import cycle for Metro to mishandle at module-init time.
export type { ThemeColors };
export { FALLBACK_THEME_COLORS };

export function resolveThemeColors(
  theme?: Pick<ThemeContextType, 'isDark' | 'themeStyle' | 'themePreset' | 'themeMode'> | null,
): ThemeColors {
  return resolveThemeTokens(theme).colors;
}

export function useThemeColors() {
  return resolveThemeColors(useTheme());
}
