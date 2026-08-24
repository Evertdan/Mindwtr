import { useThemeColors } from '@/hooks/use-theme-colors';
import { useThemeTokens } from '@/hooks/use-theme-tokens';

export interface FilledButtonColors {
  backgroundColor: string;
  // Bajo temas no materiales, la persona que llama mantiene su Color de etiqueta existente, así que esto
  // is left undefined and applied as `textColor ? { Color: textColor } : null`.
  textColor: string | undefined;
}

// Two-tier M3 emphasis: the capture FAB owns the high-emphasis `primary` role;
// every other filled CTA button sits one step below it on the canonical
// `primaryContainer`/`onPrimaryContainer` pair. Non-Material themes are untouched
// (today's tint fill, existing label Color).
export function resolveFilledButtonColors(
  tokens: { isMaterial: boolean; roles: { primaryContainer: string; onPrimaryContainer: string } | null },
  tc: { tint: string },
): FilledButtonColors {
  if (tokens.isMaterial && tokens.roles) {
    return {
      backgroundColor: tokens.roles.primaryContainer,
      textColor: tokens.roles.onPrimaryContainer,
    };
  }
  return { backgroundColor: tc.tint, textColor: undefined };
}

export function useFilledButtonColors(): FilledButtonColors {
  const tokens = useThemeTokens();
  const tc = useThemeColors();
  return resolveFilledButtonColors(tokens, tc);
}
