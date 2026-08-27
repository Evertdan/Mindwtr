import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useThemeColors } from '@/hooks/use-theme-colors';

import { styles, TDAH_TIMELINE_DAY_START_HOUR, TDAH_TIMELINE_PIXELS_PER_MINUTE } from './tdah-today.styles';
import { formatWallClockInTimeZone, getMinutesSinceMidnightInTimeZone } from './tdah-time';

const NOW_TICK_INTERVAL_MS = 30_000;
const PULSE_DURATION_MS = 900;

export type TdahNowLineProps = {
    /** The TDAH profile's own configured IANA zone (`GET /v1/tdah/day`'s `timeZone`). */
    timeZone: string;
};

/**
 * The "ahora" marker (spec Always: pulse gates on the existing
 * `useReducedMotion()` hook, never a fresh reduced-motion detection). Its
 * vertical offset reuses calendar-view.tsx's now-marker formula —
 * `((hours - DAY_START_HOUR) * 60 + minutes) * PIXELS_PER_MINUTE` — not its
 * column-layout logic, but with hours/minutes resolved in the profile's own
 * `timeZone` rather than the device's local clock (AD-6).
 *
 * UX-DR3: the marker is the theme's PRIMARY semantic token (`tc.tint`, what
 * the token source maps to M3 `primary`) with an 8% halo — `tc.danger` stays
 * reserved for error semantics. The line also carries the real time: a
 * small HH:mm label at the gutter's edge, resolved in the same `timeZone`
 * and advancing together with the position tick (the same `now` state).
 */
export function TdahNowLine({ timeZone }: TdahNowLineProps) {
    const tc = useThemeColors();
    const reducedMotion = useReducedMotion();
    const [now, setNow] = useState(() => new Date());
    const pulse = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), NOW_TICK_INTERVAL_MS);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (reducedMotion) {
            pulse.setValue(1);
            return undefined;
        }
        // A plain `setInterval` alternating `Animated.timing(...).start()` calls
        // rather than `Animated.loop(Animated.sequence([...]))`: each tick is one
        // bounded step instead of a self-perpetuating animation chain, which
        // keeps this safe under the mobile test shim's synchronous
        // `timing().start(cb)` (a chained loop would recurse synchronously
        // there and never yield).
        let dimmed = false;
        const interval = setInterval(() => {
            dimmed = !dimmed;
            Animated.timing(pulse, {
                toValue: dimmed ? 0.35 : 1,
                duration: PULSE_DURATION_MS,
                useNativeDriver: true,
            }).start();
        }, PULSE_DURATION_MS);
        return () => clearInterval(interval);
    }, [pulse, reducedMotion]);

    const minutesSinceMidnight = getMinutesSinceMidnightInTimeZone(now, timeZone);
    const top = (minutesSinceMidnight - TDAH_TIMELINE_DAY_START_HOUR * 60) * TDAH_TIMELINE_PIXELS_PER_MINUTE;
    const timeLabel = formatWallClockInTimeZone(now, timeZone);

    return (
        <View pointerEvents="none" style={[styles.nowLine, { top }]} testID="tdah-now-line">
            <View style={[styles.nowHalo, { backgroundColor: tc.tint }]} testID="tdah-now-line-halo" />
            <Animated.View
                style={[styles.nowDot, { backgroundColor: tc.tint, opacity: pulse }]}
                testID="tdah-now-line-dot"
            />
            <View style={[styles.nowRule, { backgroundColor: tc.tint }]} testID="tdah-now-line-rule" />
            <Text style={[styles.nowTimeLabel, { color: tc.tint }]} testID="tdah-now-line-time">
                {timeLabel}
            </Text>
        </View>
    );
}
