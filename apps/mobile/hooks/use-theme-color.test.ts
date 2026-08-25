import { describe, expect, it } from 'vitest';
import { resolveThemeColorPalette } from './use-theme-color';
import { M3Colors } from '../constants/material3/m3-color';

// `useThemeColor` (singular — a different, older hook than `useThemeColors`/`useThemeTokens`)
// had no direct test: the only consumer test (themed-text.test.tsx) mocks the whole hook away,
// so its real implementation — including this focus branch — never ran under any test.
describe('resolveThemeColorPalette — focus preset', () => {
  it('resolves focus-dark colors from M3Colors', () => {
    const palette = resolveThemeColorPalette({
      colorScheme: 'dark', themeStyle: 'default', themePreset: 'focus-dark', themeMode: 'focus-dark',
    });
    const roles = M3Colors['focus-dark'];
    expect(palette).toEqual({
      text: roles.onSurface,
      background: roles.background,
      tint: roles.primary,
      icon: roles.onSurfaceVariant,
      tabIconDefault: roles.onSurfaceVariant,
      tabIconSelected: roles.primary,
    });
  });

  it('resolves focus-light colors from M3Colors', () => {
    const palette = resolveThemeColorPalette({
      colorScheme: 'light', themeStyle: 'default', themePreset: 'focus-light', themeMode: 'focus-light',
    });
    const roles = M3Colors['focus-light'];
    expect(palette).toEqual({
      text: roles.onSurface,
      background: roles.background,
      tint: roles.primary,
      icon: roles.onSurfaceVariant,
      tabIconDefault: roles.onSurfaceVariant,
      tabIconSelected: roles.primary,
    });
  });

  it('still resolves a named preset (nord) through THEME_PRESETS, unaffected by the focus branch', () => {
    const palette = resolveThemeColorPalette({
      colorScheme: 'dark', themeStyle: 'default', themePreset: 'nord', themeMode: 'nord',
    });
    expect(palette.tint).toBe('#88C0D0');
  });
});
