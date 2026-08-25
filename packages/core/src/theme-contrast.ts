/**
 * WCAG 2.x contrast-ratio math. No existing utility in the repo computes this —
 * theme palettes were reviewed by hand (see comments in theme-scheme.ts). This
 * gives future palettes (starting with the `focus` preset) a way to verify
 * their contrast claims instead of estimating them.
 */

const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;

const hexToRgb = (hex: string): [number, number, number] => {
    if (!HEX_COLOR_PATTERN.test(hex)) {
        throw new Error(`theme-contrast: expected a 6-digit #RRGGBB hex color, got "${hex}"`);
    }
    const normalized = hex.replace('#', '');
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return [r, g, b];
};

const channelLuminance = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of a `#RRGGBB` hex color, in [0, 1]. */
export function relativeLuminance(hex: string): number {
    const [r, g, b] = hexToRgb(hex);
    return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/**
 * WCAG contrast ratio between two `#RRGGBB` hex colors, in [1, 21].
 * Order of the two colors does not matter.
 */
export function contrastRatio(hexA: string, hexB: string): number {
    const lumA = relativeLuminance(hexA);
    const lumB = relativeLuminance(hexB);
    const lighter = Math.max(lumA, lumB);
    const darker = Math.min(lumA, lumB);
    return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG floor for body text (AA, normal size): 4.5:1. */
export const TEXT_CONTRAST_FLOOR = 4.5;

/** WCAG floor for non-text graphical objects (1.4.11): 3:1. */
export const GRAPHICAL_CONTRAST_FLOOR = 3;
