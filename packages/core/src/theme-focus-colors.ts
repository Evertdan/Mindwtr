/**
 * Single source of truth for the `focus-dark`/`focus-light` preset's named hex roles
 * (DESIGN.md §Colors). Consumed by `theme-scheme.ts` (GTD status-badge palette),
 * `theme-contrast.test.ts` (WCAG verification), and `apps/mobile/constants/material3/
 * m3-color.ts` (Material 3 role table) — previously each hand-typed its own copy of
 * these values, which meant a fix or update had to be applied in three places to stay
 * consistent (and, in practice, drifted: see `onSecondaryContainer` below).
 *
 * Only the roles DESIGN.md actually names live here. Platform-specific scaffolding
 * (M3's unrelated onPrimary, primaryContainer, inverse-surface fields, etc., and
 * desktop's CSS custom properties) stays local to its own file — this is not a full
 * M3ColorRoles object.
 */

export type FocusRoleHex = {
    surface: string;
    surfaceContainer: string;
    /** Only DESIGN.md's `focus-dark` table gives this a distinct value; `focus-light`'s
     * is `[ASSUMPTION]`-derived (no entry in the source table for that variant). */
    surfaceContainerHigh: string;
    outline: string;
    onSurface: string;
    onSurfaceVariant: string;
    primary: string;
    success: string;
    error: string;
    tertiary: string;
    outlineVariant: string;
    /** DESIGN.md's "discarded" role — dim, tachado text/glyph. */
    discarded: string;
    dnd: string;
    /** `[ASSUMPTION]`: DESIGN.md doesn't name an on-dnd color; each scheme reuses its own
     * `surface` as a legible foreground, the same fallback the desktop CSS block uses. */
    onDnd: string;
    secondaryContainer: string;
    /** `[ASSUMPTION]`: DESIGN.md doesn't name this either. Chosen for contrast against
     * `secondaryContainer`, not reused from `dark`/`light`'s own onSecondaryContainer —
     * reusing that value here previously left `secondaryContainer` (a text-bearing Jira
     * badge per DESIGN.md) at ~1.9:1/~2.9:1 contrast, both below the 3:1 graphical floor. */
    onSecondaryContainer: string;
};

export const FOCUS_DARK_ROLE_HEX: FocusRoleHex = {
    surface: '#0E1116',
    surfaceContainer: '#1B2129',
    surfaceContainerHigh: '#232B35',
    outline: '#2A323C',
    onSurface: '#E6EAF0',
    onSurfaceVariant: '#9AA6B4',
    primary: '#5B9DF9',
    success: '#4ED8A0',
    error: '#F08A7A',
    tertiary: '#D9A94E',
    outlineVariant: '#7C8899',
    discarded: '#69737F',
    dnd: '#A78BFA',
    onDnd: '#0E1116',
    secondaryContainer: '#37B3C4',
    onSecondaryContainer: '#0E1116',
};

export const FOCUS_LIGHT_ROLE_HEX: FocusRoleHex = {
    surface: '#F7F9FC',
    surfaceContainer: '#EDF1F7',
    surfaceContainerHigh: '#E3E9F1',
    outline: '#D3DBE5',
    onSurface: '#141C26',
    onSurfaceVariant: '#54626F',
    primary: '#2563D8',
    success: '#0B7A54',
    error: '#B84632',
    tertiary: '#8A5E0C',
    outlineVariant: '#6B7787',
    discarded: '#7A8390',
    dnd: '#6242C4',
    onDnd: '#F7F9FC',
    secondaryContainer: '#0A6E7E',
    onSecondaryContainer: '#FFFFFF',
};
