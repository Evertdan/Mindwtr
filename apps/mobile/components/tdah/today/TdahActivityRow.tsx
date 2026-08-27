import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatI18nTemplate, tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';

import { TdahStatusGlyph } from './TdahStatusGlyph';
import { tdahActivityOriginLabel, tdahActivityStateLabel } from './tdah-activity-labels';
import { styles } from './tdah-today.styles';
import { computeActivityLayout } from './tdah-timeline-layout';
import type { TdahActivity } from './tdah-today-types';

export type TdahActivityRowProps = {
    activity: TdahActivity;
    onPress: (activity: TdahActivity) => void;
};

/**
 * One Activity row, used both on the T-01 timeline (absolutely positioned by
 * `computeActivityLayout`) and in its trailing "sin hora" section (plain
 * document flow, no time column) — hour (when present) + status glyph +
 * title + duration + origin badge, with a composed accessibility label
 * mirroring SwipeableTaskItemContent.tsx's
 * `formatI18nTemplate(tFallback(...), values)` pattern: "hora, título,
 * estado, origen" in that order when a time exists (spec Always), or
 * "título, estado, origen" — the time segment dropped entirely rather than
 * left as an empty/garbled placeholder — when it doesn't.
 */
export function TdahActivityRow({ activity, onPress }: TdahActivityRowProps) {
    const tc = useThemeColors();
    const { t } = useLanguage();
    const layout = computeActivityLayout(activity.startTime, activity.durationMinutes);

    const stateLabel = tdahActivityStateLabel(t, activity.state);
    const originLabel = tdahActivityOriginLabel(t, activity.origin);
    const accessibilityLabel = activity.startTime !== null
        ? formatI18nTemplate(
            tFallback(t, 'tdahActivity.ariaLabel', '{time}, {title}, {state}, {origin}'),
            { time: activity.startTime, title: activity.title, state: stateLabel, origin: originLabel },
        )
        : formatI18nTemplate(
            tFallback(t, 'tdahActivity.ariaLabelNoTime', '{title}, {state}, {origin}'),
            { title: activity.title, state: stateLabel, origin: originLabel },
        );

    const wrapperStyle = layout ? [styles.rowWrapper, { top: layout.top, height: layout.height }] : [styles.rowWrapperStatic];
    const rowStyle = layout
        ? [styles.row, { backgroundColor: tc.cardBg, borderColor: tc.border, height: layout.height }]
        : [styles.row, { backgroundColor: tc.cardBg, borderColor: tc.border }];

    return (
        <View style={wrapperStyle}>
            <Pressable
                onPress={() => onPress(activity)}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                style={rowStyle}
                testID={`tdah-activity-row-${activity.id}`}
            >
                <View style={styles.rowGlyph}>
                    <TdahStatusGlyph state={activity.state} />
                </View>
                <View style={styles.rowBody}>
                    <View style={styles.rowTopLine}>
                        {activity.startTime !== null ? (
                            <Text style={[styles.rowTime, { color: tc.secondaryText }]}>{activity.startTime}</Text>
                        ) : null}
                        <Text style={[styles.rowTitle, { color: tc.text }]} numberOfLines={2}>
                            {activity.title}
                        </Text>
                    </View>
                    <View style={styles.rowMetaLine}>
                        {activity.durationMinutes !== null && activity.durationMinutes > 0 ? (
                            <Text style={[styles.rowMetaText, { color: tc.secondaryText }]}>
                                {activity.durationMinutes} min
                            </Text>
                        ) : null}
                        <View style={[styles.originBadge, { backgroundColor: tc.filterBg }]}>
                            <Text style={[styles.originBadgeText, { color: tc.secondaryText }]}>{originLabel}</Text>
                        </View>
                    </View>
                </View>
            </Pressable>
        </View>
    );
}
