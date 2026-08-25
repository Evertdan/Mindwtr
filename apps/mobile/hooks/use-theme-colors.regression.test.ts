import { describe, expect, it } from 'vitest';
import { resolveThemeColors } from './use-theme-colors';
import { NON_MATERIAL_CASES, FOCUS_M3_CASES } from './non-material-color-baseline.fixture';

describe('non-Material color isolation (byte-identical to today)', () => {
  it.each(NON_MATERIAL_CASES)('$name is unchanged', ({ theme, expected }) => {
    expect(resolveThemeColors(theme)).toEqual(expected);
  });
});

// `focus-dark`/`focus-light` son Material 3 (ver non-material-color-baseline.fixture.ts), pero
// exponen `.colors` por la misma llave genérica `useThemeColors` — se verifica por separado.
describe('focus preset generic colors (Material 3 under the hood)', () => {
  it.each(FOCUS_M3_CASES)('$name resolves .colors from M3Colors', ({ theme, expected }) => {
    expect(resolveThemeColors(theme)).toEqual(expected);
  });
});
