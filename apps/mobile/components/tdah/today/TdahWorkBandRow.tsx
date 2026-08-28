import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatI18nTemplate, tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { useThemeTokens } from '@/hooks/use-theme-tokens';

import { tdahActivityOriginLabel } from './tdah-activity-labels';
import { styles, TDAH_TIMELINE_GUTTER_WIDTH } from './tdah-today.styles';
import { computeActivityLayout, formatActivityTimeRange, TDAH_TIMELINE_LANE_OFFSET_PX } from './tdah-timeline-layout';
import type { TdahActivity } from './tdah-today-types';

/**
 * The band's degradation notice reuses T-13's already-translated
 * `tdahJira.error.*` copy verbatim (spec Execution: "mapeado desde
 * `workOriginErrorCode` a los `tdahJira.error.*` existentes"), rather than
 * introducing a second vocabulary for the same four server codes. Kept as a
 * hand-mirror of `ORIGIN_ERROR_MESSAGE_KEYS` in
 * apps/desktop/src/components/views/settings/TdahJiraView.tsx for the same
 * reason every wire shape in this folder is hand-mirrored (ADR 0026): the two
 * apps never import across each other's boundaries.
 */
const WORK_ORIGIN_ERROR_MESSAGE_KEYS: Record<string, string> = {
    TDAH_ORIGIN_CREDENTIALS_INVALID: 'tdahJira.error.credentials',
    TDAH_ORIGIN_UNREACHABLE: 'tdahJira.error.unreachable',
    TDAH_ORIGIN_KEY_UNAVAILABLE: 'tdahJira.error.keyUnavailable',
    TDAH_ORIGIN_DAY_FULL: 'tdahJira.error.dayFull',
};

const WORK_ORIGIN_ERROR_FALLBACKS: Record<string, string> = {
    'tdahJira.error.credentials': 'The token no longer works — add a new one. Your personal activities keep running as usual.',
    'tdahJira.error.unreachable': 'Your server could not reach Jira. Your personal activities keep running as usual.',
    'tdahJira.error.keyUnavailable': 'Your server has no at-rest encryption key configured, so it refuses to store the token. Ask whoever runs it to set one.',
    'tdahJira.error.dayFull': 'Your day is already full, so the work band could not be added. Free up some activities and sync again.',
};

/**
 * An unknown persisted code still has to say something actionable rather
 * than reading as a healthy band (same judgement, and the same chosen
 * superset copy, as TdahJiraView's `lastErrorMessageKey`): "your server
 * could not reach Jira, your personal activities keep running" is true of
 * every origin failure.
 */
export function workOriginErrorMessageKey(code: string | null | undefined): string | null {
    if (!code) return null;
    return WORK_ORIGIN_ERROR_MESSAGE_KEYS[code] ?? 'tdahJira.error.unreachable';
}

export type TdahWorkBandRowProps = {
    /** The `origin: 'jira'` Activity itself — its `workItems` are the sub-rows. */
    activity: TdahActivity;
    /** `TdahDayResponse.workOriginErrorCode`: the last failed pull, or null/absent when the last one succeeded. */
    workOriginErrorCode?: string | null;
    /** N-04's deep-link (`workBandId` route param) opens T-01 with the band already expanded. */
    defaultExpanded?: boolean;
    /** Overlap lane from `computeActivityLaneOffsets`, same contract as TdahActivityRow's. */
    laneIndex?: number;
};

/**
 * T-01's Jira work band (doc 02's T-01 zone 4, story 4.2) — the one grouped,
 * read-only row a day can have: "{rango} · {título} · {n} tareas ▾".
 *
 * Three things this row deliberately is *not*:
 *
 * - **Not a `TdahActivityRow`.** It has no status glyph, no per-row tap into
 *   T-02's editing surface, and no "{n} min" duration chip — it shows a real
 *   *range* (`formatActivityTimeRange`) because a band is a window, not a
 *   moment.
 * - **Not a modal.** Tapping expands in place (spec Execution: "expandible en
 *   sitio (nunca modal)"), so the sub-tasks appear inside the day rather than
 *   taking the user out of it.
 * - **Not a list of timed tasks.** Sub-rows are `{externalKey} · {summary} ·
 *   {status}` and nothing else: Jira issues carry no time of their own, and
 *   FR-11's whole point is that the band never invents one per task.
 *
 * The read-only notice stays visible for as long as the band is expanded
 * (never a toast, never a one-shot hint): it is the only thing standing
 * between the user and the assumption that this row writes back to Jira,
 * which it never does — Mindwtr has no Jira write path at all.
 */
export function TdahWorkBandRow({
    activity,
    workOriginErrorCode = null,
    defaultExpanded = false,
    laneIndex = 0,
}: TdahWorkBandRowProps) {
    const tc = useThemeColors();
    const tokens = useThemeTokens();
    const { t } = useLanguage();
    const [expanded, setExpanded] = useState(defaultExpanded);
    // N-04 is delivered over an OPEN WebSocket, so the app is in the
    // foreground and T-01 is very plausibly already mounted when the user taps
    // the notification. If the router reuses that mounted screen, the
    // `workBandId` param changes but `useState`'s initial value never runs
    // again, and the deep link silently lands on a collapsed band. Expanding
    // only (never collapsing) keeps this from fighting the user's own taps.
    useEffect(() => {
        if (defaultExpanded) setExpanded(true);
    }, [defaultExpanded]);

    const layout = computeActivityLayout(activity.startTime, activity.durationMinutes);
    const items = activity.workItems ?? [];
    const timeRange = formatActivityTimeRange(activity.startTime, activity.durationMinutes);
    const originLabel = tdahActivityOriginLabel(t, activity.origin);
    const countLabel = formatI18nTemplate(
        tFallback(t, 'tdahToday.workBandTasks', '{count} tasks'),
        { count: String(items.length) },
    );
    const toggleLabel = expanded
        ? tFallback(t, 'tdahToday.workBandCollapseLabel', 'Hide the tasks in this work band')
        : tFallback(t, 'tdahToday.workBandExpandLabel', 'Show the tasks in this work band');
    const readOnlyLabel = tFallback(t, 'tdahToday.workBandReadOnly', 'Read-only — work logging lives in Jira');
    const degradedKey = workOriginErrorMessageKey(workOriginErrorCode);
    const degradedLabel = degradedKey
        ? tFallback(t, degradedKey, WORK_ORIGIN_ERROR_FALLBACKS[degradedKey] ?? WORK_ORIGIN_ERROR_FALLBACKS['tdahJira.error.unreachable'])
        : null;

    // Material 3's own secondaryContainer pair for the Jira badge, with the
    // exact same fallback shape story 3.4's limbo badge established
    // (`tokens.roles?.X ?? tc.Y`, roles being null on a non-Material theme).
    // Deliberately not `tc.filterBg` unconditionally: the band is the one row
    // in the day that isn't the user's own plan, and the container role is
    // what carries that distinction without reaching for a danger/alert tone.
    const badgeBackground = tokens.roles?.secondaryContainer ?? tc.filterBg;
    const badgeText = tokens.roles?.onSecondaryContainer ?? tc.secondaryText;
    const panelBackground = tokens.roles?.surfaceContainerHigh ?? tc.taskItemBg;

    const laneOffset = laneIndex * TDAH_TIMELINE_LANE_OFFSET_PX;
    // An expanded band grows past its planned slot, so it has to paint over
    // the absolutely-positioned rows below it rather than under them — the
    // now-line's own zIndex (20) still wins, as it must.
    const wrapperStyle = layout
        ? [styles.rowWrapper, {
            top: layout.top,
            minHeight: layout.height,
            left: TDAH_TIMELINE_GUTTER_WIDTH + 4 + laneOffset,
            ...(expanded ? { zIndex: 10 } : {}),
        }]
        : [styles.rowWrapperStatic];

    return (
        <View style={wrapperStyle} testID={`tdah-work-band-${activity.id}`}>
            <View style={[styles.workBandRow, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={toggleLabel}
                    accessibilityState={{ expanded }}
                    onPress={() => setExpanded((current) => !current)}
                    style={[styles.workBandHeader, layout ? { minHeight: layout.height } : null]}
                    testID={`tdah-work-band-${activity.id}-toggle`}
                >
                    <Text style={[styles.workBandChevron, { color: tc.secondaryText }]}>{expanded ? '▾' : '▸'}</Text>
                    <View style={styles.workBandHeaderBody}>
                        <View style={styles.workBandTopLine}>
                            {timeRange !== null ? (
                                <Text
                                    style={[styles.workBandRange, { color: tc.secondaryText }]}
                                    testID={`tdah-work-band-${activity.id}-range`}
                                >
                                    {timeRange}
                                </Text>
                            ) : null}
                            <Text style={[styles.workBandTitle, { color: tc.text }]}>{activity.title}</Text>
                            <Text
                                style={[styles.workBandCount, { color: tc.secondaryText }]}
                                testID={`tdah-work-band-${activity.id}-count`}
                            >
                                {countLabel}
                            </Text>
                            <View
                                style={[styles.originBadge, { backgroundColor: badgeBackground }]}
                                testID={`tdah-work-band-${activity.id}-badge`}
                            >
                                <Text style={[styles.originBadgeText, { color: badgeText }]}>{originLabel}</Text>
                            </View>
                        </View>
                        {degradedLabel ? (
                            // FR-11's consequence: a failed sync degrades the
                            // band and nothing else — it is announced right
                            // here, on the band, whether or not it is
                            // expanded, and never as a screen-level error.
                            <Text
                                style={[styles.workBandNotice, { color: tc.warning }]}
                                testID={`tdah-work-band-${activity.id}-degraded`}
                            >
                                {degradedLabel}
                            </Text>
                        ) : null}
                    </View>
                </Pressable>

                {expanded ? (
                    <View
                        style={[styles.workBandPanel, { backgroundColor: panelBackground, borderTopColor: tc.border }]}
                        testID={`tdah-work-band-${activity.id}-panel`}
                    >
                        <Text
                            style={[styles.workBandNotice, { color: tc.secondaryText }]}
                            testID={`tdah-work-band-${activity.id}-read-only`}
                        >
                            {readOnlyLabel}
                        </Text>
                        {items.length === 0 ? (
                            <Text style={[styles.workBandItemSummary, { color: tc.secondaryText }]} testID={`tdah-work-band-${activity.id}-empty`}>
                                {tFallback(t, 'tdahToday.workBandItemsEmpty', 'The task list has not been synced yet.')}
                            </Text>
                        ) : items.map((item) => (
                            <View
                                key={item.externalKey}
                                style={styles.workBandItem}
                                testID={`tdah-work-band-item-${item.externalKey}`}
                            >
                                <Text style={[styles.workBandItemKey, { color: tc.text }]}>{item.externalKey}</Text>
                                <Text style={[styles.workBandItemSummary, { color: tc.text }]}>{item.summary}</Text>
                                <Text style={[styles.workBandItemStatus, { color: tc.secondaryText }]}>{item.status}</Text>
                            </View>
                        ))}
                    </View>
                ) : null}
            </View>
        </View>
    );
}
