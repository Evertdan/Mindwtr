import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import { CloudHttpError, cloudGetJson, formatI18nTemplate, safeFormatDate, tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useToast } from '@/contexts/toast-context';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useThemeColors } from '@/hooks/use-theme-colors';

import { DecisionChip } from './DecisionChip';
import { TdahStatusGlyph } from './TdahStatusGlyph';
import { buildTdahProfileUrl, buildTdahRequestOptions, loadTdahCloudConfig } from './tdah-today-cloud';
import { formatDayKeyInTimeZone } from './tdah-time';
import { styles as todayStyles } from './tdah-today.styles';
import type { TdahActivity, TdahActivityDecideRequest } from './tdah-today-types';
import { useTdahLimbo } from './use-tdah-limbo';

// Same file-local, hand-mirrored shape tdah-settings-screen.tsx/
// use-tdah-mode-active.ts already use for GET /v1/tdah/profile (ADR 0026:
// no shared server-type import across the wire boundary) — only `timeZone`
// is needed here (AD-6: the picker floor and the "tiempo en Limbo"
// computation both read the profile's own configured zone, never the
// device's).
type TdahLimboProfileState = { timeZone: string };

const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// A sentinel id for the batch-actions bar's own DecisionChip instance (spec
// Code Map: "reutilizando los mismos 4 chips de decisión aplicados a
// decideBatch") — never a real Activity id, so its testIDs
// (`tdah-decision-chip--1-*`) can never collide with a per-row chip's.
const TDAH_LIMBO_BATCH_CHIP_ID = -1;

const dateKeyToUtcMidnightMs = (key: string): number => {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year || 1970, (month || 1) - 1, day || 1);
};

/**
 * Days between an Activity's Limbo entry and "today", both in `timeZone`
 * (spec Code Map: "calculado cliente, dayPlanDate/movedAt vs. hoy en zona
 * del perfil"). `movedAt` (an instant) wins over `dayPlanDate` (already a
 * day key) as the entry point when present — a `move-*` decision from T-05
 * that itself lands back in Limbo (e.g. a `move-date` whose target day later
 * gets swept into Limbo) re-anchors "how long" to when it last moved, not
 * its original plan date.
 */
const daysInLimbo = (activity: TdahActivity, timeZone: string): number => {
    const originKey = activity.movedAt
        ? formatDayKeyInTimeZone(new Date(activity.movedAt), timeZone)
        : activity.dayPlanDate;
    const todayKey = formatDayKeyInTimeZone(new Date(), timeZone);
    const diffMs = dateKeyToUtcMidnightMs(todayKey) - dateKeyToUtcMidnightMs(originKey);
    return Math.max(0, Math.round(diffMs / 86_400_000));
};

/**
 * T-08 — the Limbo (spec Code Map/Intent): a persistent tray over every
 * `state='limbo'` Activity, across every day, with no date/zone scoping
 * (spec Always) — the only way out is an explicit decision, never age
 * (spec Never: "nunca auto-limpiar por antigüedad").
 */
export function TdahLimboScreen() {
    const tc = useThemeColors();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();
    const { showToast } = useToast();
    const router = useRouter();
    const {
        phase, activities, selectedIds, toggleSelect, reload, decideOne, decideBatch,
    } = useTdahLimbo();
    const [timeZone, setTimeZone] = useState<string>(DEVICE_TIME_ZONE);

    // Mount-only initial load, then a `useFocusEffect` that skips that very
    // first focus (already covered by this effect) and only refetches on
    // every focus after — same anti-staleness pattern T-06's own
    // `syncNewActivities` established in story 3.3, reused here (spec Code
    // Map) so returning to T-08 after deciding rows in T-05 (or another
    // T-08 session) always reflects the real pool, without a manual reload.
    useEffect(() => {
        void reload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const hasHadFirstFocusRef = useRef(false);
    useFocusEffect(useCallback(() => {
        if (!hasHadFirstFocusRef.current) {
            hasHadFirstFocusRef.current = true;
            return;
        }
        void reload();
    }, [reload]));

    // Best-effort only, same as every other TDAH screen's own profile read
    // (use-tdah-mode-active.ts) — a failed fetch just keeps the device zone
    // fallback rather than blocking the list itself, which never depends on
    // the profile beyond this cosmetic/picker-floor purpose.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const cloud = await loadTdahCloudConfig();
                if (!cloud) return;
                const result = await cloudGetJson<{ profile: TdahLimboProfileState | null }>(
                    buildTdahProfileUrl(cloud.url),
                    buildTdahRequestOptions(cloud),
                );
                if (cancelled) return;
                const zone = result?.profile?.timeZone;
                if (typeof zone === 'string' && zone.length > 0) setTimeZone(zone);
            } catch {
                // Fallback stays DEVICE_TIME_ZONE.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const reportDecideFailure = useCallback((error: unknown) => {
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
    }, [showToast, t]);

    const handleDecideOne = useCallback(async (
        activityId: number,
        request: TdahActivityDecideRequest,
    ): Promise<boolean> => {
        try {
            await decideOne(activityId, request);
            return true;
        } catch (error) {
            reportDecideFailure(error);
            return false;
        }
    }, [decideOne, reportDecideFailure]);

    const handleDecideBatch = useCallback(async (
        _activityId: number,
        request: TdahActivityDecideRequest,
    ): Promise<boolean> => {
        // Unreachable in practice: `variant="limbo"` never emits 'undated'
        // (spec Never), and `TdahLimboDecideBatchRequest` excludes it by
        // type. Guarded defensively rather than asserted away, so a future
        // DecisionChip regression fails safe (no request sent) instead of a
        // runtime type violation.
        if (request.decision === 'undated') return false;
        try {
            await decideBatch(request);
            return true;
        } catch (error) {
            reportDecideFailure(error);
            return false;
        }
    }, [decideBatch, reportDecideFailure]);

    const selectionCount = selectedIds.size;
    const headerCountLabel = useMemo(() => formatI18nTemplate(
        tFallback(t, 'tdahToday.limboBadgeLabel', '{count} in Limbo'),
        { count: String(activities.length) },
    ), [t, activities.length]);
    const selectionCountLabel = useMemo(() => formatI18nTemplate(
        tFallback(t, 'tdahToday.limboSelectionCount', '{count} selected'),
        { count: String(selectionCount) },
    ), [t, selectionCount]);

    if (phase === 'loading') {
        return (
            <SafeAreaView style={[todayStyles.centered, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <ActivityIndicator size="large" color={tc.tint} testID="tdah-limbo-loading" />
            </SafeAreaView>
        );
    }

    if (phase === 'offline') {
        // AD-11: offline is its own full-screen state with a visible retry,
        // never a banner laid over a phantom list (spec I/O Matrix: "banner +
        // reintento (mismo patrón AD-11 de T-01/T-05)").
        return (
            <SafeAreaView style={[todayStyles.centered, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <Text style={[todayStyles.emptyTitle, { color: tc.text }]} testID="tdah-limbo-offline">
                    {tFallback(t, 'tdahToday.offlineBanner', 'No connection to the server — retrying')}
                </Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => void reload()}
                    style={[todayStyles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-limbo-retry"
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
                <Text style={[todayStyles.emptyTitle, { color: tc.text }]} testID="tdah-limbo-error">
                    {tFallback(t, 'tdahToday.loadError', 'Could not load your day.')}
                </Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => void reload()}
                    style={[todayStyles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-limbo-retry"
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
                <Text style={[todayStyles.emptyTitle, { color: tc.text }]} testID="tdah-limbo-unconfigured">
                    {tFallback(t, 'tdahToday.unconfiguredTitle', 'Cloud sync is not set up')}
                </Text>
                <Text style={[todayStyles.emptyBody, { color: tc.secondaryText }]}>
                    {t('settings.tdah.needsSync')}
                </Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => router.push('/settings')}
                    style={[todayStyles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-limbo-open-settings"
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
            <View style={limboStyles.header} testID="tdah-limbo-header">
                <Text style={[limboStyles.headerTitle, { color: tc.text }]} accessibilityRole="header">
                    {tFallback(t, 'tdahToday.limboTitle', 'Limbo')}
                </Text>
                <Text style={[limboStyles.headerCount, { color: tc.secondaryText }]}>{headerCountLabel}</Text>
            </View>

            {activities.length === 0 ? (
                // Deliberately calm, not celebratory (spec Always: "sin
                // celebración desproporcionada del vacío digno") — a plain
                // statement of fact, the same register as T-05's own
                // undecided-count summary.
                <View style={todayStyles.centered} testID="tdah-limbo-empty">
                    <Text style={[todayStyles.emptyTitle, { color: tc.text }]}>
                        {tFallback(t, 'tdahToday.limboEmpty', 'Nothing pending a decision — clean')}
                    </Text>
                </View>
            ) : (
                <>
                    {selectionCount > 0 ? (
                        <View
                            style={[limboStyles.batchBar, { borderColor: tc.border, backgroundColor: tc.cardBg }]}
                            testID="tdah-limbo-batch-bar"
                        >
                            <Text style={[limboStyles.batchBarLabel, { color: tc.text }]}>{selectionCountLabel}</Text>
                            <Text style={[limboStyles.batchBarSubLabel, { color: tc.secondaryText }]}>
                                {tFallback(t, 'tdahToday.limboBatchApply', 'Apply to selection')}
                            </Text>
                            <DecisionChip
                                activityId={TDAH_LIMBO_BATCH_CHIP_ID}
                                timeZone={timeZone}
                                variant="limbo"
                                onDecide={handleDecideBatch}
                            />
                        </View>
                    ) : null}

                    <ScrollView contentContainerStyle={limboStyles.scroll} testID="tdah-limbo-scroll">
                        <View style={limboStyles.list} testID="tdah-limbo-activity-list">
                            {activities.map((activity) => {
                                const selected = selectedIds.has(activity.id);
                                // FR-9: nothing here ever auto-expires, so an
                                // item can genuinely be a year (or several)
                                // old — 'P' (locale-aware short date, the
                                // same token this app already uses for every
                                // other arbitrary-age date: due/start dates,
                                // completion timestamps) always carries the
                                // year, unlike T-01's own header 'EEEE d'
                                // (safe there only because it's always
                                // "today").
                                const originalDateLabel = safeFormatDate(activity.dayPlanDate, 'P', activity.dayPlanDate);
                                const timeLabel = activity.startTime;
                                const daysLabel = formatI18nTemplate(
                                    tFallback(t, 'tdahToday.limboTimeInLimboDays', '{count} day(s) in Limbo'),
                                    { count: String(daysInLimbo(activity, timeZone)) },
                                );

                                return (
                                    <View
                                        key={activity.id}
                                        style={[limboStyles.row, { borderColor: tc.border, backgroundColor: tc.cardBg }]}
                                        testID={`tdah-limbo-row-${activity.id}`}
                                    >
                                        <View style={limboStyles.rowHeader}>
                                            <Pressable
                                                accessibilityRole="checkbox"
                                                accessibilityState={{ checked: selected }}
                                                accessibilityLabel={activity.title}
                                                onPress={() => toggleSelect(activity.id)}
                                                hitSlop={8}
                                                style={[
                                                    limboStyles.checkbox,
                                                    {
                                                        borderColor: tc.tint,
                                                        backgroundColor: selected ? tc.tint : 'transparent',
                                                    },
                                                ]}
                                                testID={`tdah-limbo-checkbox-${activity.id}`}
                                            />
                                            <TdahStatusGlyph state="limbo" />
                                            <Text style={[limboStyles.rowTitle, { color: tc.text }]} numberOfLines={2}>
                                                {activity.title}
                                            </Text>
                                        </View>
                                        <View style={limboStyles.rowMetaLine}>
                                            <Text style={[limboStyles.rowMeta, { color: tc.secondaryText }]}>
                                                {originalDateLabel}
                                            </Text>
                                            {timeLabel ? (
                                                <Text style={[limboStyles.rowMeta, { color: tc.secondaryText }]}>
                                                    {timeLabel}
                                                </Text>
                                            ) : null}
                                            <Text style={[limboStyles.rowMeta, { color: tc.secondaryText }]}>
                                                {daysLabel}
                                            </Text>
                                        </View>
                                        <DecisionChip
                                            activityId={activity.id}
                                            timeZone={timeZone}
                                            variant="limbo"
                                            onDecide={handleDecideOne}
                                        />
                                    </View>
                                );
                            })}
                        </View>
                    </ScrollView>
                </>
            )}
        </SafeAreaView>
    );
}

// Local to this screen (not added to tdah-today.styles.ts, out of this
// story's owned files): T-08's header/batch-bar/checkbox/row-meta shapes
// have no counterpart there, unlike the row/centered/cta styles this screen
// already borrows (todayStyles.centered/emptyTitle/emptyBody/ctaButton/
// ctaButtonText/container) — same convention as TdahRitualScreen's own
// local `ritualStyles`.
const limboStyles = StyleSheet.create({
    header: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
        gap: 2,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '700',
    },
    headerCount: {
        fontSize: 13,
        fontVariant: ['tabular-nums'],
    },
    scroll: {
        padding: 16,
        gap: 10,
    },
    batchBar: {
        marginHorizontal: 16,
        marginBottom: 8,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        gap: 4,
    },
    batchBarLabel: {
        fontSize: 14,
        fontWeight: '700',
    },
    batchBarSubLabel: {
        fontSize: 12,
    },
    list: {
        gap: 10,
    },
    row: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        gap: 6,
    },
    rowHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    checkbox: {
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 2,
    },
    rowTitle: {
        fontSize: 15,
        fontWeight: '600',
        flexShrink: 1,
    },
    rowMetaLine: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    rowMeta: {
        fontSize: 12,
    },
});
