import { describe, expect, it } from 'vitest';
import { contrastRatio, GRAPHICAL_CONTRAST_FLOOR, TEXT_CONTRAST_FLOOR } from './theme-contrast';
import { FOCUS_DARK_ROLE_HEX, FOCUS_LIGHT_ROLE_HEX, type FocusRoleHex } from './theme-focus-colors';

describe('contrastRatio', () => {
    it('agrees with WCAG worked examples', () => {
        expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
        expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
        // order-independent
        expect(contrastRatio('#0E1116', '#E6EAF0')).toBeCloseTo(contrastRatio('#E6EAF0', '#0E1116'), 5);
    });
});

// Values come from theme-focus-colors.ts (the single source shared with theme-scheme.ts's
// status badges and m3-color.ts's M3 role table) — not hand-retyped — so a future edit to the
// shipped hex is exactly what these tests re-verify, instead of a frozen, independent copy.
//
// `outline` (the 1px hairline divider) is deliberately excluded: DESIGN.md never claims it
// meets either floor, it is a subtle divider by design.
//
// `outlineVariant` and `discarded` are graphical-only roles (DESIGN.md's own footnote:
// "elementos gráficos... el piso aplicable es 3:1"); every other role is text-or-glyph-bearing
// and held to the stricter 4.5:1 floor.
const surfaceRoleFloors = (hex: FocusRoleHex): [string, { value: string; floor: number }][] => [
    ['onSurface', { value: hex.onSurface, floor: TEXT_CONTRAST_FLOOR }],
    ['onSurfaceVariant', { value: hex.onSurfaceVariant, floor: TEXT_CONTRAST_FLOOR }],
    ['primary', { value: hex.primary, floor: TEXT_CONTRAST_FLOOR }],
    ['success', { value: hex.success, floor: TEXT_CONTRAST_FLOOR }],
    ['error', { value: hex.error, floor: TEXT_CONTRAST_FLOOR }],
    ['tertiary', { value: hex.tertiary, floor: TEXT_CONTRAST_FLOOR }],
    ['outlineVariant', { value: hex.outlineVariant, floor: GRAPHICAL_CONTRAST_FLOOR }],
    ['discarded', { value: hex.discarded, floor: GRAPHICAL_CONTRAST_FLOOR }],
    ['dnd', { value: hex.dnd, floor: TEXT_CONTRAST_FLOOR }],
    ['secondaryContainer', { value: hex.secondaryContainer, floor: TEXT_CONTRAST_FLOOR }],
];

describe('preset focus contrast (DESIGN.md §Colors, roles read against `surface`)', () => {
    it('clears its floor for every role on focus-dark surface', () => {
        for (const [role, { value, floor }] of surfaceRoleFloors(FOCUS_DARK_ROLE_HEX)) {
            expect(contrastRatio(value, FOCUS_DARK_ROLE_HEX.surface), `focus-dark.${role}`).toBeGreaterThanOrEqual(floor);
        }
    });

    it('clears its floor for every role on focus-light surface', () => {
        for (const [role, { value, floor }] of surfaceRoleFloors(FOCUS_LIGHT_ROLE_HEX)) {
            expect(contrastRatio(value, FOCUS_LIGHT_ROLE_HEX.surface), `focus-light.${role}`).toBeGreaterThanOrEqual(floor);
        }
    });
});

// Container roles are read against their OWN companion, not `surface` — a role reused as a
// text-bearing badge fill (DESIGN.md: "Cápsula de texto... el de Jira lleva color
// (secondaryContainer)") needs its own foreground legible on itself, not on the page background.
// This is the pairing the surface-only checks above cannot catch: `secondaryContainer` originally
// kept `dark`/`light`'s old `onSecondaryContainer` value verbatim while only `secondaryContainer`
// changed hue, which silently failed both floors (~1.9:1 dark, ~2.9:1 light) until fixed in
// theme-focus-colors.ts.
describe('preset focus contrast (container roles read against their own companion)', () => {
    it('secondaryContainer / onSecondaryContainer clears the text floor', () => {
        expect(contrastRatio(FOCUS_DARK_ROLE_HEX.onSecondaryContainer, FOCUS_DARK_ROLE_HEX.secondaryContainer))
            .toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
        expect(contrastRatio(FOCUS_LIGHT_ROLE_HEX.onSecondaryContainer, FOCUS_LIGHT_ROLE_HEX.secondaryContainer))
            .toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
    });

    it('dnd / onDnd clears the text floor', () => {
        expect(contrastRatio(FOCUS_DARK_ROLE_HEX.onDnd, FOCUS_DARK_ROLE_HEX.dnd))
            .toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
        expect(contrastRatio(FOCUS_LIGHT_ROLE_HEX.onDnd, FOCUS_LIGHT_ROLE_HEX.dnd))
            .toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
    });
});
