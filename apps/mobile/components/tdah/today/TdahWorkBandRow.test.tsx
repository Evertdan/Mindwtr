import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TdahWorkBandRow, workOriginErrorMessageKey } from './TdahWorkBandRow';
import { styles } from './tdah-today.styles';
import type { TdahActivity } from './tdah-today-types';

const flattenStyle = (style: unknown): Record<string, unknown> => (
    Array.isArray(style) ? Object.assign({}, ...style.map(flattenStyle)) : ((style ?? {}) as Record<string, unknown>)
);

const THEME = {
    text: '#0f172a', secondaryText: '#94a3b8', cardBg: '#ffffff', border: '#e2e8f0', filterBg: '#eef2f7',
    taskItemBg: '#f1f5f9', tint: '#3b82f6', warning: '#f59e0b',
};
vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => THEME,
}));

// Both branches of the `tokens.roles?.X ?? tc.Y` fallback matter (the same
// pair TdahTodayScreen's own limbo-badge test exercises): a Material theme
// resolves real M3 roles, a non-Material one leaves `roles` null.
const M3_ROLES = {
    secondaryContainer: '#dae2f9',
    onSecondaryContainer: '#131c2b',
    surfaceContainerHigh: '#e5e9f0',
};
const themeTokens = vi.hoisted(() => ({ roles: null as Record<string, string> | null }));
vi.mock('@/hooks/use-theme-tokens', () => ({
    useThemeTokens: () => themeTokens,
}));

// Miss every key so labels resolve through tFallback's English fallback —
// the same "always-miss" convention TdahActivityRow.test.tsx uses.
vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

const band: TdahActivity = {
    id: 91,
    dayPlanDate: '2026-08-28',
    blockId: null,
    title: 'Sprint',
    startTime: '09:30',
    durationMinutes: 270,
    origin: 'jira',
    state: 'pending',
    startedAt: null,
    completedAt: null,
    workItems: [
        { externalKey: 'ABC-1', summary: 'Arreglar el login', status: 'In Progress' },
        { externalKey: 'ABC-2', summary: 'Revisar el informe', status: 'To Do' },
        { externalKey: 'ABC-3', summary: 'Actualizar el changelog', status: 'To Do' },
    ],
};

const renderBand = (
    activity: TdahActivity = band,
    props?: { workOriginErrorCode?: string | null; defaultExpanded?: boolean },
): ReactTestRenderer => {
    let tree!: ReactTestRenderer;
    act(() => {
        tree = create(
            <TdahWorkBandRow
                activity={activity}
                workOriginErrorCode={props?.workOriginErrorCode}
                defaultExpanded={props?.defaultExpanded}
            />,
        );
    });
    return tree;
};

const allText = (tree: ReactTestRenderer): string => tree.root
    .findAll((node) => node.type === Text)
    .map((node) => node.props.children)
    .flat()
    .filter((value) => typeof value === 'string')
    .join(' | ');

const toggle = (tree: ReactTestRenderer) => tree.root.findByProps({ testID: `tdah-work-band-${band.id}-toggle` });

beforeEach(() => {
    themeTokens.roles = null;
});

describe('TdahWorkBandRow', () => {
    // AC: "la franja aparece como una sola fila agrupada con su rango
    // horario, el título del servidor y el conteo de tareas".
    it('renders the band as one grouped row: range, server title and task count', () => {
        const text = allText(renderBand());
        expect(text).toContain('9:30–14:00');
        expect(text).toContain('Sprint');
        expect(text).toContain('3 task(s)');
    });

    it('counts the tasks it actually has, never a hard-coded figure', () => {
        const text = allText(renderBand({ ...band, workItems: [band.workItems![0]] }));
        expect(text).toContain('1 task(s)');
    });

    it('reads a band with no workItems at all as zero tasks rather than crashing', () => {
        const { workItems: _omitted, ...withoutItems } = band;
        const text = allText(renderBand(withoutItems as TdahActivity));
        expect(text).toContain('0 task(s)');
    });

    it('renders only the start when the band has no duration — never a fabricated end', () => {
        const text = allText(renderBand({ ...band, durationMinutes: null }));
        expect(text).toContain('9:30');
        expect(text).not.toContain('–');
    });

    it('names the Jira origin on the badge', () => {
        expect(allText(renderBand())).toContain('Jira');
    });

    describe('expanding in place', () => {
        it('starts collapsed, showing no sub-task and no read-only notice yet', () => {
            const tree = renderBand();
            expect(tree.root.findAllByProps({ testID: `tdah-work-band-${band.id}-panel` })).toHaveLength(0);
            expect(allText(tree)).not.toContain('ABC-1');
        });

        it('expands in place on tap — never a modal, never a navigation', () => {
            const tree = renderBand();
            act(() => { toggle(tree).props.onPress(); });

            const text = allText(tree);
            expect(text).toContain('ABC-1');
            expect(text).toContain('Arreglar el login');
            expect(text).toContain('In Progress');
            // The panel is a child of this very row, not a sibling overlay.
            expect(tree.root.findAllByProps({ testID: `tdah-work-band-${band.id}-panel` }).length).toBeGreaterThan(0);
        });

        it('collapses again on a second tap', () => {
            const tree = renderBand();
            act(() => { toggle(tree).props.onPress(); });
            act(() => { toggle(tree).props.onPress(); });
            expect(allText(tree)).not.toContain('ABC-1');
        });

        it('announces the expanded state and swaps the expand/collapse label for screen readers', () => {
            const tree = renderBand();
            expect(toggle(tree).props.accessibilityState).toEqual({ expanded: false });
            expect(toggle(tree).props.accessibilityLabel).toBe('Show the tasks in this work band');

            act(() => { toggle(tree).props.onPress(); });
            expect(toggle(tree).props.accessibilityState).toEqual({ expanded: true });
            expect(toggle(tree).props.accessibilityLabel).toBe('Hide the tasks in this work band');
        });

        // N-04's deep link (spec I/O matrix: "Abre T-01 con esa franja ya
        // expandida").
        it('starts expanded when the deep link named this band', () => {
            const tree = renderBand(band, { defaultExpanded: true });
            expect(allText(tree)).toContain('ABC-1');
        });

        // N-04 arrives over an OPEN socket, so T-01 is very plausibly already
        // mounted when the user taps it. If the router reuses that screen, only
        // the prop changes — a band that read `defaultExpanded` once at mount
        // would leave the tap doing nothing at all.
        it('expands when the deep link names it while the row is already mounted and collapsed', () => {
            let tree!: ReactTestRenderer;
            act(() => {
                tree = create(<TdahWorkBandRow activity={band} defaultExpanded={false} />);
            });
            expect(allText(tree)).not.toContain('ABC-1');

            act(() => {
                tree.update(<TdahWorkBandRow activity={band} defaultExpanded />);
            });
            expect(allText(tree)).toContain('ABC-1');
        });

        // The re-sync must not fight the user: collapsing a band the deep link
        // opened has to stick.
        it('does not re-collapse a band the user closed by hand', () => {
            let tree!: ReactTestRenderer;
            act(() => {
                tree = create(<TdahWorkBandRow activity={band} defaultExpanded />);
            });
            expect(allText(tree)).toContain('ABC-1');

            act(() => {
                tree.root.findAll((node) => node.type === Pressable)[0]?.props.onPress();
            });
            expect(allText(tree)).not.toContain('ABC-1');

            // A re-render with the same prop value must not reopen it.
            act(() => {
                tree.update(<TdahWorkBandRow activity={band} defaultExpanded />);
            });
            expect(allText(tree)).not.toContain('ABC-1');
        });
    });

    describe('read-only surface (FR-11)', () => {
        it('shows the persistent read-only notice for as long as the band is expanded', () => {
            const tree = renderBand(band, { defaultExpanded: true });
            expect(allText(tree)).toContain('Read-only — work logging lives in Jira');
        });

        // The single most load-bearing assertion of this story: a band that
        // invented an hour per task would be exactly the FR-11 violation the
        // grouping exists to prevent.
        it('never gives a sub-task an hour of its own', () => {
            const tree = renderBand(band, { defaultExpanded: true });
            // Only the host element, not the composite wrapper the react-native
            // shim renders around it — otherwise every row is matched twice.
            const items = tree.root.findAll((node) => (
                typeof node.type === 'string'
                && typeof node.props?.testID === 'string'
                && node.props.testID.startsWith('tdah-work-band-item-')
            ));
            expect(items).toHaveLength(3);
            for (const item of items) {
                const text = item.findAll((node) => node.type === Text)
                    .map((node) => node.props.children)
                    .flat()
                    .join(' ');
                expect(text).not.toMatch(/\d{1,2}:\d{2}/);
            }
        });

        it('offers no edit, delete or per-task action — the header toggle is the only pressable', () => {
            const tree = renderBand(band, { defaultExpanded: true });
            const pressables = tree.root.findAllByType(Pressable);
            expect(pressables).toHaveLength(1);
            expect(pressables[0].props.testID).toBe(`tdah-work-band-${band.id}-toggle`);
        });

        it('says the list has not synced yet rather than showing an empty, unexplained panel', () => {
            const tree = renderBand({ ...band, workItems: [] }, { defaultExpanded: true });
            expect(allText(tree)).toContain('The task list has not been synced yet.');
        });
    });

    describe('degraded pull notice', () => {
        it('paints the degraded notice from workOriginErrorCode, reusing T-13\'s own copy', () => {
            const tree = renderBand(band, { workOriginErrorCode: 'TDAH_ORIGIN_CREDENTIALS_INVALID' });
            expect(allText(tree)).toContain('The token no longer works');
        });

        it('shows the notice while collapsed too — degradation is not hidden behind a tap', () => {
            const tree = renderBand(band, { workOriginErrorCode: 'TDAH_ORIGIN_UNREACHABLE' });
            expect(tree.root.findAllByProps({ testID: `tdah-work-band-${band.id}-panel` })).toHaveLength(0);
            expect(allText(tree)).toContain('could not reach Jira');
        });

        it('shows nothing when the last pull succeeded', () => {
            const tree = renderBand(band, { workOriginErrorCode: null });
            expect(tree.root.findAllByProps({ testID: `tdah-work-band-${band.id}-degraded` })).toHaveLength(0);
        });

        it('falls back to the honest superset copy for a code this build does not know', () => {
            expect(workOriginErrorMessageKey('TDAH_SOMETHING_NEW')).toBe('tdahJira.error.unreachable');
            expect(workOriginErrorMessageKey(null)).toBeNull();
            expect(workOriginErrorMessageKey(undefined)).toBeNull();
        });

        it('maps every code T-13 knows onto the same key T-13 uses', () => {
            expect(workOriginErrorMessageKey('TDAH_ORIGIN_CREDENTIALS_INVALID')).toBe('tdahJira.error.credentials');
            expect(workOriginErrorMessageKey('TDAH_ORIGIN_UNREACHABLE')).toBe('tdahJira.error.unreachable');
            expect(workOriginErrorMessageKey('TDAH_ORIGIN_KEY_UNAVAILABLE')).toBe('tdahJira.error.keyUnavailable');
            expect(workOriginErrorMessageKey('TDAH_ORIGIN_DAY_FULL')).toBe('tdahJira.error.dayFull');
        });
    });

    describe('badge and panel colors', () => {
        it('uses Material 3\'s secondaryContainer pair for the badge when the theme resolves roles', () => {
            themeTokens.roles = M3_ROLES;
            const tree = renderBand();
            const badge = tree.root.findByProps({ testID: `tdah-work-band-${band.id}-badge` });
            expect(flattenStyle(badge.props.style).backgroundColor).toBe(M3_ROLES.secondaryContainer);
            const badgeText = badge.findByType(Text);
            expect(flattenStyle(badgeText.props.style).color).toBe(M3_ROLES.onSecondaryContainer);
        });

        it('falls back to the generic tokens on a non-Material theme (roles: null)', () => {
            themeTokens.roles = null;
            const tree = renderBand();
            const badge = tree.root.findByProps({ testID: `tdah-work-band-${band.id}-badge` });
            expect(flattenStyle(badge.props.style).backgroundColor).toBe(THEME.filterBg);
            expect(flattenStyle(badge.findByType(Text).props.style).color).toBe(THEME.secondaryText);
        });

        it('raises the expanded panel onto surfaceContainerHigh with a hairline separator', () => {
            themeTokens.roles = M3_ROLES;
            const tree = renderBand(band, { defaultExpanded: true });
            const panel = tree.root.findByProps({ testID: `tdah-work-band-${band.id}-panel` });
            const panelStyle = flattenStyle(panel.props.style);
            expect(panelStyle.backgroundColor).toBe(M3_ROLES.surfaceContainerHigh);
            expect(panelStyle.borderTopColor).toBe(THEME.border);
            expect(panelStyle.borderTopWidth).toBe(styles.workBandPanel.borderTopWidth);
        });

        it('falls back to taskItemBg for the panel on a non-Material theme', () => {
            themeTokens.roles = null;
            const tree = renderBand(band, { defaultExpanded: true });
            const panel = tree.root.findByProps({ testID: `tdah-work-band-${band.id}-panel` });
            expect(flattenStyle(panel.props.style).backgroundColor).toBe(THEME.taskItemBg);
        });
    });

    // Same AC as TdahActivityRow's: content grows the row instead of being
    // clipped at 200% font scale.
    it('sizes the timeline slot with minHeight and never caps the title to a line count', () => {
        const tree = renderBand();
        const wrapper = tree.root.findAllByType(View).find((node) => {
            const flat = flattenStyle(node.props.style);
            return flat.position === 'absolute' && typeof flat.top === 'number';
        });
        const wrapperStyle = flattenStyle(wrapper!.props.style);
        expect(typeof wrapperStyle.minHeight).toBe('number');
        expect(wrapperStyle.height).toBeUndefined();
        expect(tree.root.findByProps({ children: band.title }).props.numberOfLines).toBeUndefined();
    });
});
