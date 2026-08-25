import { describe, expect, it } from 'vitest';
import { resolveThemeTokens } from './use-theme-tokens';
import { M3Colors } from '../constants/material3/m3-color';

const m3Light = { isDark: false, themeStyle: 'material3', themePreset: 'default', themeMode: 'material3-light' } as const;
const eink = { isDark: false, themeStyle: 'default', themePreset: 'eink', themeMode: 'eink' } as const;
const focusDark = { isDark: true, themeStyle: 'default', themePreset: 'focus-dark', themeMode: 'focus-dark' } as const;
const focusLight = { isDark: false, themeStyle: 'default', themePreset: 'focus-light', themeMode: 'focus-light' } as const;

describe('resolveThemeTokens', () => {
  it('flags Material only for the material3 style', () => {
    expect(resolveThemeTokens(m3Light).isMaterial).toBe(true);
    expect(resolveThemeTokens(eink).isMaterial).toBe(false);
    expect(resolveThemeTokens(null).isMaterial).toBe(false);
  });
  it('exposes full M3 roles under Material and null otherwise', () => {
    expect(resolveThemeTokens(m3Light).roles).toEqual(M3Colors.light);
    expect(resolveThemeTokens(eink).roles).toBeNull();
  });
  it('self-gates behavioral tokens for non-Material themes', () => {
    const t = resolveThemeTokens(eink);
    expect(t.elevation(3)).toEqual({});
    expect(t.state.rippleColor).toBeUndefined();
    expect(t.state.stateLayerColor('pressed')).toBe('transparent');
  });
  it('activates behavioral tokens under Material', () => {
    const t = resolveThemeTokens(m3Light);
    expect(t.elevation(3).backgroundColor).toBe(M3Colors.light.surfaceContainerHigh);
    expect(t.state.rippleColor).toBeDefined();
  });

  // El preset `focus` es Material 3 real aunque `themeStyle` siga en 'default' (dimensiones
  // ortogonales) — isMaterial/roles deben poblarse igual que bajo themeStyle==='material3'.
  it('flags Material and exposes full M3 roles (incl. dnd) for focus-* regardless of themeStyle', () => {
    const dark = resolveThemeTokens(focusDark);
    expect(dark.isMaterial).toBe(true);
    expect(dark.roles).toEqual(M3Colors['focus-dark']);
    expect(dark.roles?.dnd).toBe(M3Colors['focus-dark'].dnd);

    const light = resolveThemeTokens(focusLight);
    expect(light.isMaterial).toBe(true);
    expect(light.roles).toEqual(M3Colors['focus-light']);
    expect(light.roles?.dnd).toBe(M3Colors['focus-light'].dnd);
  });

  // Las filas memorizadas comparan `tc` por identidad (#766), y ThemeProvider entrega un
  // fresh Contexto object on every Renderizar, so equal inputs must yield the same
  // object — and a real Tema change must still yield a different one.
  it('returns the same object for equal inputs and a new one when the theme changes', () => {
    const light = { isDark: false, themeStyle: 'default', themePreset: 'default', themeMode: 'system' } as const;
    const first = resolveThemeTokens(light);
    expect(resolveThemeTokens({ ...light })).toBe(first);
    expect(resolveThemeTokens({ ...light }).colors).toBe(first.colors);

    const changed = [
      { ...light, isDark: true },
      { ...light, themeStyle: 'material3' as const, themeMode: 'material3-light' as const },
      { ...light, themePreset: 'nord' as const, themeMode: 'nord' as const },
    ];
    for (const theme of changed) {
      const next = resolveThemeTokens(theme);
      expect(next).not.toBe(first);
      expect(next.colors).not.toEqual(first.colors);
    }
  });
});
