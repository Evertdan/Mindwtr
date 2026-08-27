import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { formatI18nTemplate, tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useThemeColors } from '@/hooks/use-theme-colors';

import { styles as todayStyles } from './tdah-today.styles';

const BEAT_DURATION_MS = 400;
const BEAT_START_SCALE = 0.98;

/**
 * Every count arrives as a route-param string (spec Code Map: "T-07 no hace
 * fetch propio: recibe conteos por route params numéricos"), defaulted to
 * `'0'` the same way a screen reached with an incomplete param set (a direct
 * deep link, a stale test) should still render a coherent all-zero summary
 * rather than throwing on `NaN`.
 */
function parseCount(value: string | undefined): number {
    const parsed = Number(value ?? '0');
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

/**
 * T-07 — the closing beat of the T-05 -> T-06 -> T-07 flow (spec Code Map).
 * Pure presentation: every figure it shows was computed upstream (T-05's own
 * 4 decision counts, T-06's own `morningChanges`) and arrives via route
 * params — this screen never fetches (spec Always).
 */
export function TdahConfirmationScreen() {
    const tc = useThemeColors();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();
    const router = useRouter();
    const reducedMotion = useReducedMotion();
    const params = useLocalSearchParams<{
        movedTomorrow?: string;
        movedDate?: string;
        discarded?: string;
        limbo?: string;
        morningChanges?: string;
    }>();

    const movedTomorrow = parseCount(params.movedTomorrow);
    const movedDate = parseCount(params.movedDate);
    const discarded = parseCount(params.discarded);
    const limbo = parseCount(params.limbo);
    const morningChanges = parseCount(params.morningChanges);

    // Design Notes / spec Code Map: a 400ms scale 0.98->1 + fade beat, fired
    // exactly once via useEffect — gated on the existing useReducedMotion()
    // hook (same convention as TdahNowLine's own pulse) so it lands at its
    // resting opacity/scale immediately rather than animating for a viewer
    // who has reduced motion enabled.
    const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
    const scale = useRef(new Animated.Value(reducedMotion ? 1 : BEAT_START_SCALE)).current;
    const firedRef = useRef(false);

    useEffect(() => {
        if (firedRef.current || reducedMotion) return;
        firedRef.current = true;
        // Two independent `.start()` calls (never `Animated.parallel`) —
        // same reasoning as TdahNowLine's own pulse: this keeps the beat
        // safe under the mobile test shim's synchronous `timing().start(cb)`
        // (`Animated.parallel` isn't implemented there).
        Animated.timing(opacity, { toValue: 1, duration: BEAT_DURATION_MS, useNativeDriver: true }).start();
        Animated.timing(scale, { toValue: 1, duration: BEAT_DURATION_MS, useNativeDriver: true }).start();
        // Fires once per mount, deliberately independent of any prop/param
        // change — a re-render from a param mutation must never replay it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The terminal screen of the whole T-05 -> T-06 -> T-07 flow — `replace`
    // (never `back`/`push`) so the exit CTA can't leave the now-confirmed,
    // already-visited T-06/T-05 screens reachable via a back-swipe.
    const exit = () => router.replace('/tdah-today');

    return (
        <SafeAreaView style={[todayStyles.container, { backgroundColor: tc.bg }]} edges={['bottom']} testID="tdah-confirmation-screen">
            <View style={confirmationStyles.body}>
                <Animated.View style={{ opacity, transform: [{ scale }] }} testID="tdah-confirmation-beat">
                    <Text
                        style={[confirmationStyles.success, { color: tc.text }]}
                        accessibilityRole="header"
                        testID="tdah-confirmation-success"
                    >
                        {tFallback(t, 'tdahToday.confirmationSuccess', 'Tomorrow is ready.')}
                    </Text>
                </Animated.View>

                <View style={confirmationStyles.summary} testID="tdah-confirmation-summary">
                    <Text
                        style={[confirmationStyles.summaryLine, { color: tc.secondaryText }]}
                        testID="tdah-confirmation-moved-tomorrow"
                    >
                        {formatI18nTemplate(
                            tFallback(t, 'tdahToday.confirmationMovedTomorrow', 'Moved to tomorrow: {count}'),
                            { count: String(movedTomorrow) },
                        )}
                    </Text>
                    <Text
                        style={[confirmationStyles.summaryLine, { color: tc.secondaryText }]}
                        testID="tdah-confirmation-moved-date"
                    >
                        {formatI18nTemplate(
                            tFallback(t, 'tdahToday.confirmationMovedDate', 'Moved to another date: {count}'),
                            { count: String(movedDate) },
                        )}
                    </Text>
                    <Text
                        style={[confirmationStyles.summaryLine, { color: tc.secondaryText }]}
                        testID="tdah-confirmation-discarded"
                    >
                        {formatI18nTemplate(tFallback(t, 'tdahToday.confirmationDiscarded', 'Discarded: {count}'), { count: String(discarded) })}
                    </Text>
                    <Text
                        style={[confirmationStyles.summaryLine, { color: tc.secondaryText }]}
                        testID="tdah-confirmation-limbo"
                    >
                        {formatI18nTemplate(tFallback(t, 'tdahToday.confirmationLimbo', 'Left in Limbo: {count}'), { count: String(limbo) })}
                    </Text>
                    <Text
                        style={[confirmationStyles.summaryLine, { color: tc.secondaryText }]}
                        testID="tdah-confirmation-changes"
                    >
                        {formatI18nTemplate(
                            tFallback(t, 'tdahToday.confirmationChanges', 'Changes to tomorrow: {count}'),
                            { count: String(morningChanges) },
                        )}
                    </Text>
                </View>

                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={exit}
                    style={[todayStyles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-confirmation-done"
                >
                    <Text style={[todayStyles.ctaButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {tFallback(t, 'tdahToday.confirmationDone', 'Done')}
                    </Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

// Local to this screen (not added to tdah-today.styles.ts, out of this
// story's owned files) — same convention TdahRitualScreen.tsx/
// TdahMorningScreen.tsx's own local StyleSheets already established.
const confirmationStyles = StyleSheet.create({
    body: {
        flex: 1,
        padding: 24,
        gap: 24,
        justifyContent: 'center',
    },
    success: {
        fontSize: 22,
        fontWeight: '700',
        textAlign: 'center',
    },
    summary: {
        gap: 8,
    },
    summaryLine: {
        fontSize: 14,
        textAlign: 'center',
    },
});
