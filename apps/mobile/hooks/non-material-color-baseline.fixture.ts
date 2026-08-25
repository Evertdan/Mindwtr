import { THEME_PRESETS } from '../constants/theme-presets';
import { M3Colors, type M3ColorRoles } from '../constants/material3/m3-color';
import type { ThemeContextType } from '../contexts/theme-context';

type Resolvable = Pick<ThemeContextType, 'isDark' | 'themeStyle' | 'themePreset' | 'themeMode'>;

// snapshot congelado of TODAY's resolved colors for every non-Material Tema.
// Alterar cualquier valor aquí es una regresión a menos que sea intencional,
// separately-reviewed change to a non-Material Tema.
export const DEFAULT_LIGHT = {
  bg: '#F6F7FB', cardBg: '#FFFFFF', taskItemBg: '#F1F5F9',
  text: '#0F172A', secondaryText: '#4B5563', icon: '#4B5563',
  border: '#E2E8F0', tint: '#2563EB', onTint: '#FFFFFF',
  tabIconDefault: '#4B5563', tabIconSelected: '#2563EB',
  inputBg: '#EEF2F7', danger: '#EF4444', success: '#10B981',
  warning: '#F59E0B', filterBg: '#EEF2F7',
};
export const DEFAULT_DARK = {
  bg: '#151718', cardBg: '#1F2937', taskItemBg: '#1F2937',
  text: '#ECEDEE', secondaryText: '#9CA3AF', icon: '#9BA1A6',
  border: '#374151', tint: '#60A5FA', onTint: '#0F172A',
  tabIconDefault: '#9BA1A6', tabIconSelected: '#60A5FA',
  inputBg: '#374151', danger: '#EF4444', success: '#10B981',
  warning: '#F59E0B', filterBg: '#374151',
};

// Mismo patrón de remapeo M3 → ThemeColors genérico que usa use-theme-tokens.ts para `focus-*`
// (mapM3RolesToGenericColors) — se referencia aquí en vez de transcribir hex, igual que las
// demás filas de esta tabla referencian THEME_PRESETS en lugar de copiar sus valores.
const focusGenericColors = (p: M3ColorRoles): Record<string, string> => ({
  bg: p.background, cardBg: p.surfaceContainer, taskItemBg: p.surfaceContainerHigh,
  text: p.text, secondaryText: p.secondaryText, icon: p.secondaryText,
  border: p.outline, tint: p.primary, onTint: p.onPrimary,
  tabIconDefault: p.secondaryText, tabIconSelected: p.primary,
  inputBg: p.surfaceVariant, danger: p.error, success: p.success, warning: p.warning,
  filterBg: p.surfaceVariant,
});

export const NON_MATERIAL_CASES: { name: string; theme: Resolvable; expected: Record<string, string> }[] = [
  { name: 'default-light', theme: { isDark: false, themeStyle: 'default', themePreset: 'default', themeMode: 'light' }, expected: DEFAULT_LIGHT },
  { name: 'default-dark', theme: { isDark: true, themeStyle: 'default', themePreset: 'default', themeMode: 'dark' }, expected: DEFAULT_DARK },
  { name: 'eink', theme: { isDark: false, themeStyle: 'default', themePreset: 'eink', themeMode: 'eink' }, expected: THEME_PRESETS.eink },
  { name: 'nord', theme: { isDark: true, themeStyle: 'default', themePreset: 'nord', themeMode: 'nord' }, expected: THEME_PRESETS.nord },
  { name: 'catppuccin-macchiato', theme: { isDark: true, themeStyle: 'default', themePreset: 'catppuccin-macchiato', themeMode: 'catppuccin-macchiato' }, expected: THEME_PRESETS['catppuccin-macchiato'] },
  { name: 'dracula', theme: { isDark: true, themeStyle: 'default', themePreset: 'dracula', themeMode: 'dracula' }, expected: THEME_PRESETS.dracula },
  { name: 'sepia', theme: { isDark: false, themeStyle: 'default', themePreset: 'sepia', themeMode: 'sepia' }, expected: THEME_PRESETS.sepia },
  { name: 'oled', theme: { isDark: true, themeStyle: 'default', themePreset: 'oled', themeMode: 'oled' }, expected: THEME_PRESETS.oled },
];

// `focus-dark`/`focus-light` son Material 3 real bajo el capó (isMaterial=true, roles≠null vía
// use-theme-tokens.ts) aunque expongan `.colors` por la misma llave genérica — por eso viven en
// un array aparte y NO en NON_MATERIAL_CASES: use-theme-tokens.isolation.test.ts recorre ese
// array asumiendo `isMaterial === false` para cada entrada, invariante que `focus-*` rompe a
// propósito (ver Design Notes de la spec 1-2). Cobertura de regresión de `.colors` para focus
// vive en use-theme-colors.regression.test.ts, iterando este array en vez de NON_MATERIAL_CASES.
export const FOCUS_M3_CASES: { name: string; theme: Resolvable; expected: Record<string, string> }[] = [
  { name: 'focus-dark', theme: { isDark: true, themeStyle: 'default', themePreset: 'focus-dark', themeMode: 'focus-dark' }, expected: focusGenericColors(M3Colors['focus-dark']) },
  { name: 'focus-light', theme: { isDark: false, themeStyle: 'default', themePreset: 'focus-light', themeMode: 'focus-light' }, expected: focusGenericColors(M3Colors['focus-light']) },
];
