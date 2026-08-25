/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/Color-schemes/
 */

import { resolveThemeColorScheme } from '@mindwtr/core';
import { Colors, Material3 } from '@/constants/theme';
import { THEME_PRESETS } from '@/constants/theme-presets';
import { M3Colors } from '@/constants/material3/m3-color';
import { isFocusPreset } from '@/hooks/use-theme-tokens';
import { useTheme, type ThemeContextType } from '@/contexts/theme-context';

type ResolvableThemeColor = Pick<ThemeContextType, 'colorScheme' | 'themeStyle' | 'themePreset' | 'themeMode'>;

// Pure resolver, separated from the hook (same split as resolveThemeTokens/useThemeTokens) so
// it can be unit-tested with a plain object instead of rendering through ThemeProvider/useTheme.
export function resolveThemeColorPalette(theme: ResolvableThemeColor): Record<keyof typeof Colors.light, string> {
  const { colorScheme, themeStyle, themePreset, themeMode } = theme;
  const defaultPalette = colorScheme === 'dark' ? Colors.dark : Colors.light;
  const materialPalette = resolveThemeColorScheme(themeMode, colorScheme) === 'dark'
    ? Material3.dark
    : Material3.light;
  // `focus-dark`/`focus-light` route through the Material 3 contract (M3Colors), not the flat
  // THEME_PRESETS shape — see theme-presets.ts / spec 1.2 Design Notes.
  if (isFocusPreset(themePreset)) {
    const focusPalette = M3Colors[themePreset];
    return {
      text: focusPalette.onSurface,
      background: focusPalette.background,
      tint: focusPalette.primary,
      icon: focusPalette.onSurfaceVariant,
      tabIconDefault: focusPalette.onSurfaceVariant,
      tabIconSelected: focusPalette.primary,
    };
  }
  if (themePreset !== 'default') {
    const presetPalette = THEME_PRESETS[themePreset];
    return {
      text: presetPalette.text,
      background: presetPalette.bg,
      tint: presetPalette.tint,
      icon: presetPalette.icon,
      tabIconDefault: presetPalette.tabIconDefault,
      tabIconSelected: presetPalette.tabIconSelected,
    };
  }
  if (themeStyle === 'material3') {
    return {
      text: materialPalette.text,
      background: materialPalette.background,
      tint: materialPalette.primary,
      icon: materialPalette.secondaryText,
      tabIconDefault: materialPalette.secondaryText,
      tabIconSelected: materialPalette.primary,
    };
  }
  return {
    text: defaultPalette.text,
    background: defaultPalette.background,
    tint: defaultPalette.tint,
    icon: defaultPalette.icon,
    tabIconDefault: defaultPalette.tabIconDefault,
    tabIconSelected: defaultPalette.tabIconSelected,
  };
}

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
  const theme = useTheme();
  const colorFromProps = props[theme.colorScheme];
  if (colorFromProps) return colorFromProps;
  return resolveThemeColorPalette(theme)[colorName];
}
