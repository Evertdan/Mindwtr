import React, { useCallback } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';

import { formatI18nTemplate, safeFormatDate, tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useThemeColors } from '@/hooks/use-theme-colors';

import { TdahActivityRow } from './TdahActivityRow';
import { TdahNowLine } from './TdahNowLine';
import {
    styles,
    TDAH_TIMELINE_DAY_END_HOUR,
    TDAH_TIMELINE_DAY_START_HOUR,
    TDAH_TIMELINE_PIXELS_PER_MINUTE,
} from './tdah-today.styles';
import type { TdahActivity } from './tdah-today-types';
import { useTdahToday } from './use-tdah-today';

const formatHourLabel = (hour: number): string => `${hour.toString().padStart(2, '0')}:00`;

// A handful of representative hour marks for the loading skeleton (spec's
// AC: "skeleton con canal dibujado") — deliberately not the full 0-24
// TDAH_TIMELINE_DAY_START_HOUR..END_HOUR range the ready timeline uses, since
// the skeleton only needs to read as "the timeline's shape, loading", not
// reproduce its exact scale.
const TDAH_TODAY_SKELETON_HOURS = [6, 9, 12, 15, 18, 21] as const;
const TDAH_TODAY_SKELETON_HEIGHT = 280;
const TDAH_TODAY_SKELETON_ROW_TOPS = [28, 108, 188] as const;

/**
 * T-01 — the today timeline (spec Code Map). Every focus is a fresh
 * `GET /v1/tdah/day` (AD-1: no client-side plan cache) via `useFocusEffect`,
 * so returning here from T-02 always reflects the latest server state.
 */
export function TdahTodayScreen() {
    const tc = useThemeColors();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();
    const router = useRouter();
    const { phase, date, timeZone, routineTitle, activities, reload } = useTdahToday();

    useFocusEffect(useCallback(() => {
        void reload();
    }, [reload]));

    const openActivity = useCallback((activity: TdahActivity) => {
        router.push(`/tdah-activity/${activity.id}`);
    }, [router]);

    const openCreate = useCallback(() => {
        router.push('/tdah-activity/new');
    }, [router]);

    // AD-6: the header date is always the server's own `date` field for the
    // profile's configured time zone, verbatim — never the device's local
    // `new Date()`, which can disagree with it (e.g. shortly after local
    // midnight when the profile's own zone hasn't rolled over yet, or vice
    // versa).
    const dateLabel = safeFormatDate(date, 'EEEE d', '');
    const routineLabel = routineTitle
        ? formatI18nTemplate(tFallback(t, 'tdahToday.routineLabel', 'Routine {name}'), { name: routineTitle })
        : null;

    const hours = Array.from(
        { length: TDAH_TIMELINE_DAY_END_HOUR - TDAH_TIMELINE_DAY_START_HOUR + 1 },
        (_value, index) => TDAH_TIMELINE_DAY_START_HOUR + index,
    );
    const timelineHeight = (TDAH_TIMELINE_DAY_END_HOUR - TDAH_TIMELINE_DAY_START_HOUR) * 60 * TDAH_TIMELINE_PIXELS_PER_MINUTE;

    // doc 02's T-01 layout: a manual Activity with no explicit time (FR-4,
    // genuinely optional) never gets a position on the timed timeline — it
    // renders in its own trailing "sin hora" section instead (server already
    // orders `activities` timed-first, no-time-last; see
    // apps/cloud/src/tdah/storage.ts's SELECT_ACTIVITIES_FOR_DAY_SQL).
    const timedActivities = activities.filter((activity) => activity.startTime !== null);
    const noTimeActivities = activities.filter((activity) => activity.startTime === null);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]} edges={['bottom']}>
            <View style={styles.header}>
                <Text style={[styles.headerDate, { color: tc.text }]} accessibilityRole="header">
                    {dateLabel}
                </Text>
                {routineLabel ? (
                    <Text style={[styles.headerRoutine, { color: tc.secondaryText }]}>{routineLabel}</Text>
                ) : null}
            </View>

            {phase === 'loading' ? (
                // AC: a skeleton that already draws the hour channel, not a
                // bare spinner — reuses the same hourLine/hourLabel/hourDivider
                // shapes the ready timeline renders below, plus a few
                // placeholder row blocks. Fully decorative (the real content
                // hasn't loaded yet), so it's excluded from the accessibility
                // tree; the loading text above it is what a screen reader
                // actually announces.
                <View testID="tdah-today-loading">
                    <Text style={[styles.loadingHint, { color: tc.secondaryText }]}>
                        {tFallback(t, 'tdahToday.loading', 'Loading your day…')}
                    </Text>
                    <View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={[styles.loadingSkeleton, { height: TDAH_TODAY_SKELETON_HEIGHT }]}
                    >
                        {TDAH_TODAY_SKELETON_HOURS.map((hour, index) => {
                            const top = (index / (TDAH_TODAY_SKELETON_HOURS.length - 1)) * (TDAH_TODAY_SKELETON_HEIGHT - 18);
                            return (
                                <View key={hour} pointerEvents="none" style={[styles.hourLine, { top }]}>
                                    <Text style={[styles.hourLabel, { color: tc.secondaryText }]}>
                                        {formatHourLabel(hour)}
                                    </Text>
                                    <View style={[styles.hourDivider, { backgroundColor: tc.border }]} />
                                </View>
                            );
                        })}
                        {TDAH_TODAY_SKELETON_ROW_TOPS.map((top, index) => (
                            <View
                                key={top}
                                style={[styles.skeletonRow, { top, backgroundColor: tc.filterBg }]}
                                testID={`tdah-today-skeleton-row-${index}`}
                            />
                        ))}
                    </View>
                </View>
            ) : null}

            {phase === 'error' ? (
                <View style={styles.centered} testID="tdah-today-error">
                    <Text style={[styles.emptyTitle, { color: tc.text }]}>
                        {tFallback(t, 'tdahToday.loadError', 'Could not load your day.')}
                    </Text>
                    <TouchableOpacity
                        accessibilityRole="button"
                        onPress={() => void reload()}
                        style={[styles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                        testID="tdah-today-retry"
                    >
                        <Text style={[styles.ctaButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                            {tFallback(t, 'tdahToday.retry', 'Retry')}
                        </Text>
                    </TouchableOpacity>
                </View>
            ) : null}

            {phase === 'offline' ? (
                // AD-11: offline is its own full-screen state, never a banner
                // laid over a stale/phantom plan.
                <View style={styles.centered} testID="tdah-today-offline">
                    <Text style={[styles.emptyTitle, { color: tc.text }]}>
                        {tFallback(t, 'tdahToday.offlineBanner', 'No connection to the server — retrying')}
                    </Text>
                    <TouchableOpacity
                        accessibilityRole="button"
                        onPress={() => void reload()}
                        style={[styles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                        testID="tdah-today-retry"
                    >
                        <Text style={[styles.ctaButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                            {tFallback(t, 'tdahToday.retry', 'Retry')}
                        </Text>
                    </TouchableOpacity>
                </View>
            ) : null}

            {phase === 'empty' ? (
                <View style={styles.centered} testID="tdah-today-empty">
                    <Text style={[styles.emptyTitle, { color: tc.text }]}>
                        {tFallback(t, 'tdahToday.noRoutineTitle', 'No Routine today')}
                    </Text>
                    <Text style={[styles.emptyBody, { color: tc.secondaryText }]}>
                        {tFallback(t, 'tdahToday.noRoutineBody', 'Add a manual activity to get started.')}
                    </Text>
                    <TouchableOpacity
                        accessibilityRole="button"
                        onPress={openCreate}
                        style={[styles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                        testID="tdah-today-add-manual-empty"
                    >
                        <Text style={[styles.ctaButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                            {tFallback(t, 'tdahToday.addManual', 'Add activity')}
                        </Text>
                    </TouchableOpacity>
                </View>
            ) : null}

            {phase === 'ready' ? (
                <>
                    <ScrollView style={styles.scrollView} testID="tdah-today-scroll">
                        <View style={[styles.timelineArea, { height: timelineHeight }]}>
                            {hours.map((hour) => {
                                const top = (hour - TDAH_TIMELINE_DAY_START_HOUR) * 60 * TDAH_TIMELINE_PIXELS_PER_MINUTE;
                                return (
                                    // Decorative hour-channel marking, not an
                                    // Activity — excluded from the
                                    // accessibility tree so a screen reader
                                    // never announces it interleaved with the
                                    // real Activity rows below.
                                    <View
                                        key={hour}
                                        pointerEvents="none"
                                        accessibilityElementsHidden
                                        importantForAccessibility="no-hide-descendants"
                                        style={[styles.hourLine, { top }]}
                                    >
                                        <Text style={[styles.hourLabel, { color: tc.secondaryText }]}>
                                            {formatHourLabel(hour)}
                                        </Text>
                                        <View style={[styles.hourDivider, { backgroundColor: tc.border }]} />
                                    </View>
                                );
                            })}
                            <TdahNowLine timeZone={timeZone} />
                            {timedActivities.map((activity) => (
                                <TdahActivityRow key={activity.id} activity={activity} onPress={openActivity} />
                            ))}
                        </View>
                        {noTimeActivities.length > 0 ? (
                            <View style={styles.noTimeSection} testID="tdah-today-no-time-section">
                                <Text style={[styles.noTimeSectionTitle, { color: tc.text }]}>
                                    {tFallback(t, 'tdahToday.noTime', 'No time')}
                                </Text>
                                {noTimeActivities.map((activity) => (
                                    <TdahActivityRow key={activity.id} activity={activity} onPress={openActivity} />
                                ))}
                            </View>
                        ) : null}
                    </ScrollView>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={tFallback(t, 'tdahToday.addManual', 'Add activity')}
                        onPress={openCreate}
                        style={[styles.addManualFab, { backgroundColor: filledButton.backgroundColor }]}
                        testID="tdah-today-add-manual-fab"
                    >
                        <Plus size={24} color={filledButton.textColor ?? tc.onTint} strokeWidth={2.5} />
                    </TouchableOpacity>
                </>
            ) : null}
        </SafeAreaView>
    );
}
