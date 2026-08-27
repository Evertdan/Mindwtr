import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import { CloudHttpError, formatI18nTemplate, tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useToast } from '@/contexts/toast-context';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useThemeColors } from '@/hooks/use-theme-colors';

import { DecisionChip } from './DecisionChip';
import { TdahStatusGlyph } from './TdahStatusGlyph';
import { tdahActivityStateLabel } from './tdah-activity-labels';
import { formatIsoWallClockInTimeZone } from './tdah-time';
import { styles as todayStyles } from './tdah-today.styles';
import type { TdahActivity, TdahActivityDecideRequest, TdahActivityDecision } from './tdah-today-types';
import { useTdahRitual } from './use-tdah-ritual';

/**
 * T-05 — the real Cierre content (spec: replaces the "coming soon"
 * placeholder Story 3.1 shipped). Only `missed`/`limbo` rows ever grow a
 * `DecisionChip` (spec Always/Design Notes) — `completed`/`pending`/
 * `started`/`discarded` rows render read-only, same glyph/hours-only shape
 * as every other row.
 */
const DECIDABLE_STATES: ReadonlySet<TdahActivity['state']> = new Set(['missed', 'limbo']);

export function TdahRitualScreen() {
    const tc = useThemeColors();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();
    const { showToast } = useToast();
    const router = useRouter();
    const { phase, timeZone, activities, reload, decideActivity } = useTdahRitual();

    // Session-only "this row was decided, with what" map (Design Notes:
    // even "sin fecha", which changes nothing server-side, only collapses
    // the row for this session) — deliberately never mirrored into the
    // fetched `activities` themselves, so a decided row keeps showing the
    // real missed/limbo outcome and hours of the day that just closed,
    // rather than flipping to the mutation's new (and, for this recap,
    // irrelevant) `pending`/cleared-hours shape. Story 3.3: keyed by
    // decision (not just membership) so T-06's own CTA can forward per-type
    // counts to it (spec Code Map).
    const [decidedByType, setDecidedByType] = useState<ReadonlyMap<number, TdahActivityDecision>>(new Map());

    useFocusEffect(useCallback(() => {
        void reload();
    }, [reload]));

    const handleDecide = useCallback(async (
        activityId: number,
        request: TdahActivityDecideRequest,
    ): Promise<boolean> => {
        try {
            await decideActivity(activityId, request);
            setDecidedByType((current) => {
                if (current.has(activityId)) return current;
                const next = new Map(current);
                next.set(activityId, request.decision);
                return next;
            });
            return true;
        } catch (error) {
            // Unlike TdahActivityDetailScreen's runAction, a 400 here is a
            // real, user-visible failure (e.g. a past date, or the target
            // day already at its 50-Activity cap) — never silently
            // swallowed (spec I/O Matrix's Error Handling column).
            if (error instanceof CloudHttpError) {
                showToast({
                    message: tFallback(t, 'tdahActivity.errorGeneric', 'Could not complete the action. Try again.'),
                    tone: 'error',
                });
            } else {
                showToast({
                    title: tFallback(t, 'common.offline', 'Offline'),
                    message: tFallback(
                        t,
                        'tdahActivity.actionOfflineMessage',
                        'No internet connection. The action was not registered.',
                    ),
                    tone: 'error',
                });
            }
            return false;
        }
    }, [decideActivity, showToast, t]);

    // Story 3.3 (spec Code Map): T-06 receives T-05's own 4 figures as route
    // params rather than re-deriving them from a fresh fetch — "al Limbo"
    // combines rows never decided this session with the ones explicitly
    // sent "sin fecha" (`'undated'`, a deliberate no-op that still lands in
    // Limbo server-side).
    const continueToMorning = useCallback(() => {
        let movedTomorrow = 0;
        let movedDate = 0;
        let discarded = 0;
        let undatedCount = 0;
        for (const decision of decidedByType.values()) {
            if (decision === 'move-tomorrow') movedTomorrow += 1;
            else if (decision === 'move-date') movedDate += 1;
            else if (decision === 'discard') discarded += 1;
            else if (decision === 'undated') undatedCount += 1;
        }
        const stillUndecidedCount = activities.filter((activity) => (
            DECIDABLE_STATES.has(activity.state) && !decidedByType.has(activity.id)
        )).length;
        router.push({
            pathname: '/tdah-morning',
            params: {
                movedTomorrow: String(movedTomorrow),
                movedDate: String(movedDate),
                discarded: String(discarded),
                limbo: String(stillUndecidedCount + undatedCount),
            },
        });
    }, [activities, decidedByType, router]);

    const completedCount = useMemo(
        () => activities.filter((activity) => activity.state === 'completed').length,
        [activities],
    );
    const missedCount = useMemo(
        () => activities.filter((activity) => activity.state === 'missed').length,
        [activities],
    );
    const limboCount = useMemo(
        () => activities.filter((activity) => activity.state === 'limbo').length,
        [activities],
    );
    const undecidedCount = useMemo(
        () => activities.filter((activity) => (
            DECIDABLE_STATES.has(activity.state) && !decidedByType.has(activity.id)
        )).length,
        [activities, decidedByType],
    );

    if (phase === 'loading') {
        return (
            <SafeAreaView style={[todayStyles.centered, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <ActivityIndicator size="large" color={tc.tint} testID="tdah-ritual-loading" />
            </SafeAreaView>
        );
    }

    if (phase === 'offline') {
        // AD-11: offline is its own full-screen state with a visible retry,
        // never a banner laid over a phantom list (spec Always).
        return (
            <SafeAreaView style={[todayStyles.centered, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <Text style={[todayStyles.emptyTitle, { color: tc.text }]} testID="tdah-ritual-offline">
                    {tFallback(t, 'tdahToday.offlineBanner', 'No connection to the server — retrying')}
                </Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => void reload()}
                    style={[todayStyles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-ritual-retry"
                >
                    <Text style={[todayStyles.ctaButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {tFallback(t, 'tdahToday.retry', 'Retry')}
                    </Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    if (phase === 'error') {
        return (
            <SafeAreaView style={[todayStyles.centered, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <Text style={[todayStyles.emptyTitle, { color: tc.text }]} testID="tdah-ritual-error">
                    {tFallback(t, 'tdahToday.loadError', 'Could not load your day.')}
                </Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => void reload()}
                    style={[todayStyles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-ritual-retry"
                >
                    <Text style={[todayStyles.ctaButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {tFallback(t, 'tdahToday.retry', 'Retry')}
                    </Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    if (phase === 'unconfigured') {
        return (
            <SafeAreaView style={[todayStyles.centered, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <Text style={[todayStyles.emptyTitle, { color: tc.text }]} testID="tdah-ritual-unconfigured">
                    {tFallback(t, 'tdahToday.unconfiguredTitle', 'Cloud sync is not set up')}
                </Text>
                <Text style={[todayStyles.emptyBody, { color: tc.secondaryText }]}>
                    {t('settings.tdah.needsSync')}
                </Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => router.push('/settings')}
                    style={[todayStyles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-ritual-open-settings"
                >
                    <Text style={[todayStyles.ctaButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {tFallback(t, 'tdahToday.unconfiguredOpenSettings', 'Open settings')}
                    </Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[todayStyles.container, { backgroundColor: tc.bg }]} edges={['bottom']}>
            <ScrollView contentContainerStyle={ritualStyles.scroll} testID="tdah-ritual-scroll">
                <View style={ritualStyles.scoreboardRow} testID="tdah-ritual-scoreboard">
                    <View style={ritualStyles.scoreboardItem} testID="tdah-ritual-scoreboard-on-time">
                        <TdahStatusGlyph state="completed" size={22} />
                        <Text style={[ritualStyles.scoreboardCount, { color: tc.text }]}>{completedCount}</Text>
                        <Text style={[ritualStyles.scoreboardLabel, { color: tc.secondaryText }]}>
                            {tFallback(t, 'tdahToday.scoreboardOnTime', 'On time')}
                        </Text>
                    </View>
                    <View style={ritualStyles.scoreboardItem} testID="tdah-ritual-scoreboard-missed">
                        <TdahStatusGlyph state="missed" size={22} />
                        <Text style={[ritualStyles.scoreboardCount, { color: tc.text }]}>{missedCount}</Text>
                        <Text style={[ritualStyles.scoreboardLabel, { color: tc.secondaryText }]}>
                            {tFallback(t, 'tdahToday.scoreboardMissed', 'Missed')}
                        </Text>
                    </View>
                    <View style={ritualStyles.scoreboardItem} testID="tdah-ritual-scoreboard-limbo">
                        <TdahStatusGlyph state="limbo" size={22} />
                        <Text style={[ritualStyles.scoreboardCount, { color: tc.text }]}>{limboCount}</Text>
                        <Text style={[ritualStyles.scoreboardLabel, { color: tc.secondaryText }]}>
                            {tFallback(t, 'tdahToday.scoreboardLimbo', 'In limbo')}
                        </Text>
                    </View>
                </View>

                <View style={ritualStyles.list} testID="tdah-ritual-activity-list">
                    {activities.map((activity) => {
                        const decided = decidedByType.has(activity.id);
                        const needsDecision = DECIDABLE_STATES.has(activity.state) && !decided;
                        const stateLabel = tdahActivityStateLabel(t, activity.state);
                        const startedAtLabel = activity.startedAt
                            ? formatI18nTemplate(tFallback(t, 'tdahActivity.startedAtLabel', 'Started: {time}'), {
                                time: formatIsoWallClockInTimeZone(activity.startedAt, timeZone),
                            })
                            : null;
                        const completedAtLabel = activity.completedAt
                            ? formatI18nTemplate(tFallback(t, 'tdahActivity.completedAtLabel', 'Completed: {time}'), {
                                time: formatIsoWallClockInTimeZone(activity.completedAt, timeZone),
                            })
                            : null;

                        return (
                            <View
                                key={activity.id}
                                style={[
                                    ritualStyles.row,
                                    { borderColor: tc.border, backgroundColor: tc.cardBg, opacity: decided ? 0.5 : 1 },
                                ]}
                                testID={`tdah-ritual-row-${activity.id}`}
                            >
                                <View style={ritualStyles.rowHeader}>
                                    <TdahStatusGlyph state={activity.state} />
                                    <Text style={[ritualStyles.rowTitle, { color: tc.text }]} numberOfLines={2}>
                                        {activity.title}
                                    </Text>
                                </View>
                                <Text style={[ritualStyles.rowMeta, { color: tc.secondaryText }]}>{stateLabel}</Text>
                                {startedAtLabel ? (
                                    <Text style={[ritualStyles.rowMeta, { color: tc.secondaryText }]}>{startedAtLabel}</Text>
                                ) : null}
                                {completedAtLabel ? (
                                    <Text style={[ritualStyles.rowMeta, { color: tc.secondaryText }]}>{completedAtLabel}</Text>
                                ) : null}
                                {needsDecision ? (
                                    <DecisionChip activityId={activity.id} timeZone={timeZone} onDecide={handleDecide} />
                                ) : null}
                            </View>
                        );
                    })}
                </View>

                {undecidedCount > 0 ? (
                    <Text style={[ritualStyles.summary, { color: tc.secondaryText }]} testID="tdah-ritual-summary">
                        {formatI18nTemplate(
                            tFallback(t, 'tdahToday.closeSummary', "{count} left undecided — they'll stay in Limbo whenever you're ready."),
                            { count: String(undecidedCount) },
                        )}
                    </Text>
                ) : null}

                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={continueToMorning}
                    style={[ritualStyles.continueButton, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-ritual-continue"
                >
                    <Text style={[todayStyles.ctaButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {tFallback(t, 'tdahToday.continueToMorning', 'Continue to Tomorrow')}
                    </Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

// Local to this screen (not added to tdah-today.styles.ts, out of this
// story's owned files): T-05's scoreboard/list/summary/CTA have no
// counterpart there, unlike the row-level styles this screen already
// borrows (todayStyles.centered/emptyTitle/ctaButton/container).
const ritualStyles = StyleSheet.create({
    scroll: {
        padding: 16,
        gap: 16,
    },
    scoreboardRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    scoreboardItem: {
        alignItems: 'center',
        gap: 4,
    },
    scoreboardCount: {
        fontSize: 28,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
    },
    scoreboardLabel: {
        fontSize: 12,
        fontWeight: '600',
    },
    list: {
        gap: 10,
    },
    row: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        gap: 4,
    },
    rowHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    rowTitle: {
        fontSize: 15,
        fontWeight: '600',
        flexShrink: 1,
    },
    rowMeta: {
        fontSize: 12,
    },
    summary: {
        fontSize: 13,
        textAlign: 'center',
    },
    continueButton: {
        borderRadius: 10,
        paddingHorizontal: 16,
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
