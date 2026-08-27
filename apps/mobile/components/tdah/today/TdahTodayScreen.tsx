import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { addNetworkStateListener } from 'expo-network';
import { Moon, Plus } from 'lucide-react-native';

import { formatI18nTemplate, safeFormatDate, tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import {
    getTdahConnectionState,
    subscribeTdahConnectionReconnected,
    subscribeTdahConnectionState,
} from '@/hooks/root-layout/use-root-layout-tdah-connection';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { useThemeTokens } from '@/hooks/use-theme-tokens';
import {
    isIgnoringBatteryOptimizations,
    isPersistentConnectionSupported,
    requestIgnoreBatteryOptimizations,
    type TdahConnectionState,
} from '@/lib/persistent-connection';

import { TdahActivityRow } from './TdahActivityRow';
import { TdahConnectionDot } from './TdahConnectionDot';
import { TdahNowLine } from './TdahNowLine';
import { findCurrentActivityId } from './tdah-current-activity';
import {
    styles,
    TDAH_TIMELINE_DAY_END_HOUR,
    TDAH_TIMELINE_DAY_START_HOUR,
    TDAH_TIMELINE_PIXELS_PER_MINUTE,
} from './tdah-today.styles';
import type { TdahActivity } from './tdah-today-types';
import { formatDayKeyInTimeZone, getMinutesSinceMidnightInTimeZone } from './tdah-time';
import { computeActivityLaneOffsets } from './tdah-timeline-layout';
import { useTdahLimbo } from './use-tdah-limbo';
import { useTdahNow, TDAH_NOW_TICK_INTERVAL_MS } from './use-tdah-now';
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

// Local, ad-hoc header layout (not added to tdah-today.styles.ts, out of this
// story's owned files): places `connection-dot` at the header's corner
// (DESIGN.md §Components: "8 pt, esquina") without disturbing the date/routine
// column's own existing styles.
const headerRowStyle = { flexDirection: 'row' as const, alignItems: 'flex-start' as const, justifyContent: 'space-between' as const };
const headerTextColumnStyle = { flexShrink: 1 as const };
// Story 3.1 ("La invitación nocturna"): second of the two manual-open
// entries for T-05 (the other is the More sheet's tdah-ritual tile) — a
// same-row header action next to the connection dot, per Code Map
// ("botón manual 'abrir ritual' en el header, junto al connection-dot").
// Ad-hoc like the two styles above, for the same reason.
const headerActionsStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 as const };
const ritualButtonStyle = { padding: 4 as const };
// Story 3.4 (T-08's limbo-badge, spec Code Map: "⬤ N", junto al botón de
// Moon) — ad-hoc like the four styles above, for the same reason (no
// counterpart in tdah-today.styles.ts, out of this story's owned files).
const limboBadgeStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 as const, padding: 4 as const };
const limboBadgeTextStyle = { fontSize: 13 as const, fontWeight: '700' as const };

/**
 * T-01 — the today timeline (spec Code Map). Every focus is a fresh
 * `GET /v1/tdah/day` (AD-1: no client-side plan cache) via `useFocusEffect`,
 * so returning here from T-02 always reflects the latest server state.
 */
export function TdahTodayScreen() {
    const tc = useThemeColors();
    const tokens = useThemeTokens();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();
    const router = useRouter();
    const { phase, date, timeZone, routineTitle, activities, reload } = useTdahToday();
    const now = useTdahNow();
    // Story 3.4 (T-08's limbo-badge, spec Code Map): a second, independent
    // `useTdahLimbo()` instance for the live count alone — never merged into
    // `useTdahToday`'s own fetch lifecycle (AD-1: every screen's data hook
    // stays fully separate), so a fetch failure here can never affect the
    // day's own timeline. Reuses the same full hook rather than inventing a
    // separate "lightweight" one (spec Code Map explicitly allows either),
    // since one already exists and this screen only ever reads `.length`
    // from it.
    const { activities: limboActivities, reload: reloadLimbo } = useTdahLimbo();
    // One-shot latch per offline stint: connectivity events can arrive in a
    // burst and only one recovery reload may start per stint.
    const offlineRecoveryFiredRef = useRef(false);

    useFocusEffect(useCallback(() => {
        void reload();
    }, [reload]));

    // Story 3.4: the limbo-badge count's own mount-only initial fetch, then
    // a `useFocusEffect` that skips that very first focus (already covered
    // by the mount effect below) and only refetches on every focus after —
    // same anti-staleness pattern as T-06's own `syncNewActivities` (spec
    // Code Map's badge paragraph) — so returning here from a decision made
    // in T-05 or T-08 always shows the real count, without a manual reload,
    // and without doubling the request T-01's own mount/first-focus already
    // fires.
    useEffect(() => {
        void reloadLimbo();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const limboBadgeHasHadFirstFocusRef = useRef(false);
    useFocusEffect(useCallback(() => {
        if (!limboBadgeHasHadFirstFocusRef.current) {
            limboBadgeHasHadFirstFocusRef.current = true;
            return;
        }
        void reloadLimbo();
    }, [reloadLimbo]));

    // A screen focused across the profile zone's midnight would otherwise
    // render yesterday's plan forever (AD-1 has no client cache to expire):
    // when the zone's day key stops matching the loaded `date`, reload.
    useEffect(() => {
        if (date === null) return undefined;
        const interval = setInterval(() => {
            if (formatDayKeyInTimeZone(new Date(), timeZone) !== date) void reload();
        }, TDAH_NOW_TICK_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [date, timeZone, reload]);

    // AD-11's offline copy promises retrying, so connectivity restoration
    // during the offline phase reloads without waiting for a Retry tap.
    useEffect(() => {
        if (phase !== 'offline') {
            offlineRecoveryFiredRef.current = false;
            return undefined;
        }
        const subscription = addNetworkStateListener((state) => {
            if (state.isConnected !== true || offlineRecoveryFiredRef.current) return;
            offlineRecoveryFiredRef.current = true;
            void reload();
        });
        return () => subscription.remove?.();
    }, [phase, reload]);

    const [connectionState, setConnectionState] = useState<TdahConnectionState>(() => getTdahConnectionState());
    const [batteryLimited, setBatteryLimited] = useState(false);
    const connectionSupported = isPersistentConnectionSupported();
    const reloadRef = useRef(reload);
    reloadRef.current = reload;

    const refreshBatteryLimited = useCallback(() => {
        if (!connectionSupported) return;
        setBatteryLimited(!isIgnoringBatteryOptimizations());
    }, [connectionSupported]);

    // Modo TDAH's connection channel now opens/closes with the mode itself,
    // owned by the root layout (spec Always: "se abre al activar el modo y
    // se cierra intencionalmente al desactivarlo") — see
    // use-root-layout-tdah-connection.ts. T-01 only ever reads the current
    // state here for its connection-dot; it never starts or stops the
    // socket, so the channel survives navigating away from T-01 while the
    // mode stays on.
    useEffect(() => {
        if (!connectionSupported) return undefined;
        refreshBatteryLimited();
        setConnectionState(getTdahConnectionState());
        return subscribeTdahConnectionState(setConnectionState);
    }, [connectionSupported, refreshBatteryLimited]);

    // AC: "T-01 re-obtiene el plan del día automáticamente" on every
    // reconnect, no user action — the root layout owns the socket, so it
    // publishes this event instead of T-01 passing its own `reload` as
    // `onReconnected` to `startPersistentConnection`.
    useEffect(() => {
        if (!connectionSupported) return undefined;
        return subscribeTdahConnectionReconnected(() => {
            void reloadRef.current();
        });
    }, [connectionSupported]);

    // The battery-exemption chip can only clear once the user leaves system
    // Settings and returns — re-check on every foreground transition.
    useEffect(() => {
        if (!connectionSupported) return undefined;
        const subscription = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') refreshBatteryLimited();
        });
        return () => subscription.remove();
    }, [connectionSupported, refreshBatteryLimited]);

    const requestBatteryExemption = useCallback(() => {
        requestIgnoreBatteryOptimizations();
    }, []);

    const showConnectionBanner = connectionSupported
        && connectionState.status === 'offline'
        && phase !== 'offline'
        && phase !== 'unconfigured';

    const openActivity = useCallback((activity: TdahActivity) => {
        router.push(`/tdah-activity/${activity.id}`);
    }, [router]);

    const openCreate = useCallback(() => {
        router.push('/tdah-activity/new');
    }, [router]);

    // Story 3.1 ("La invitación nocturna"): AC — "puede abrir el ritual
    // manualmente ... desde un botón en T-01, en cualquier momento", never
    // gated on the day-fetch phase or the connection state, since the ritual
    // itself never depends on either.
    const openRitual = useCallback(() => {
        router.push('/tdah-ritual');
    }, [router]);

    // Story 3.4 (T-08's limbo-badge): tap navigates straight into the Limbo
    // tray — same always-available, phase-independent affordance as
    // `openRitual` above.
    const openLimbo = useCallback(() => {
        router.push('/tdah-limbo');
    }, [router]);

    const limboCount = limboActivities.length;
    // AC: "muestra N en color terciario (nunca rojo)" — Material 3's own
    // tertiary role when the active theme resolves one (`tokens.roles`,
    // null for a non-Material theme, use-theme-tokens.ts), falling back to
    // `tc.tint` rather than any red/danger token so a non-Material theme
    // still reads as calm/neutral, never an alert.
    const limboBadgeColor = tokens.roles?.tertiary ?? tc.tint;
    const limboBadgeLabel = formatI18nTemplate(
        tFallback(t, 'tdahToday.limboBadgeLabel', '{count} in Limbo'),
        { count: String(limboCount) },
    );

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
    const laneOffsets = computeActivityLaneOffsets(activities);
    const currentActivityId = findCurrentActivityId(
        activities,
        getMinutesSinceMidnightInTimeZone(now, timeZone),
    );

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]} edges={['bottom']}>
            <View style={styles.header}>
                <View style={headerRowStyle}>
                    <View style={headerTextColumnStyle}>
                        <Text style={[styles.headerDate, { color: tc.text }]} accessibilityRole="header">
                            {dateLabel}
                        </Text>
                        {routineLabel ? (
                            <Text style={[styles.headerRoutine, { color: tc.secondaryText }]}>{routineLabel}</Text>
                        ) : null}
                    </View>
                    <View style={headerActionsStyle}>
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={tFallback(t, 'nav.tdahRitual', 'Night Ritual')}
                            onPress={openRitual}
                            style={ritualButtonStyle}
                            hitSlop={8}
                            testID="tdah-today-open-ritual"
                        >
                            <Moon size={20} color={tc.secondaryText} />
                        </TouchableOpacity>
                        {limboCount > 0 ? (
                            <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={limboBadgeLabel}
                                onPress={openLimbo}
                                style={limboBadgeStyle}
                                hitSlop={8}
                                testID="tdah-today-limbo-badge"
                            >
                                <Text
                                    style={[limboBadgeTextStyle, { color: limboBadgeColor }]}
                                    testID="tdah-today-limbo-badge-count"
                                >
                                    {`⬤ ${limboCount}`}
                                </Text>
                            </TouchableOpacity>
                        ) : null}
                        {connectionSupported ? (
                            <TdahConnectionDot
                                status={connectionState.status}
                                batteryLimited={batteryLimited}
                                onRequestBatteryExemption={requestBatteryExemption}
                            />
                        ) : null}
                    </View>
                </View>
            </View>

            {showConnectionBanner ? (
                <View
                    style={[styles.offlineBanner, { borderColor: tc.danger, backgroundColor: tc.filterBg }]}
                    testID="tdah-today-connection-banner"
                >
                    <Text style={[styles.offlineBannerText, { color: tc.text }]}>
                        {tFallback(t, 'tdahToday.connectionBanner', 'No connection to the server — retrying')}
                    </Text>
                </View>
            ) : null}

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

            {phase === 'unconfigured' ? (
                // UX-DR5: Self-Hosted sync not set up is not an error — a
                // Retry here could never succeed. The way out is Settings,
                // where the sync backend is configured.
                <View style={styles.centered} testID="tdah-today-unconfigured">
                    <Text style={[styles.emptyTitle, { color: tc.text }]}>
                        {tFallback(t, 'tdahToday.unconfiguredTitle', 'Cloud sync is not set up')}
                    </Text>
                    <Text style={[styles.emptyBody, { color: tc.secondaryText }]}>
                        {t('settings.tdah.needsSync')}
                    </Text>
                    <TouchableOpacity
                        accessibilityRole="button"
                        onPress={() => router.push('/settings')}
                        style={[styles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                        testID="tdah-today-open-settings"
                    >
                        <Text style={[styles.ctaButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                            {tFallback(t, 'tdahToday.unconfiguredOpenSettings', 'Open settings')}
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
                                <TdahActivityRow
                                    key={activity.id}
                                    activity={activity}
                                    onPress={openActivity}
                                    isCurrent={activity.id === currentActivityId}
                                    laneIndex={laneOffsets.get(activity.id) ?? 0}
                                />
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
