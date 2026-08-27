import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useThemeColors } from '@/hooks/use-theme-colors';

import { styles, TDAH_TIMELINE_DAY_START_HOUR, TDAH_TIMELINE_PIXELS_PER_MINUTE } from './tdah-today.styles';

const NOW_TICK_INTERVAL_MS = 30_000;
const PULSE_DURATION_MS = 900;

/**
 * Minutes-since-midnight of `date`'s wall-clock time *in `timeZone`* — the
 * same `Intl.DateTimeFormat`-in-time-zone technique as the cloud side's
 * `formatDateInTimeZone` (apps/cloud/src/tdah/storage.ts), never the
 * device's own local `Date.getHours()`/`getMinutes()` (AD-6: wall-clock
 * always in the TDAH profile's own configured zone, not the requesting
 * device's — a device set to a different zone than the profile would
 * otherwise show the "ahora" marker in the wrong position).
 */
const getMinutesSinceMidnightInTimeZone = (date: Date, timeZone: string): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
    return hour * 60 + minute;
};

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

    const top = useMemo(() => (
        (getMinutesSinceMidnightInTimeZone(now, timeZone) - TDAH_TIMELINE_DAY_START_HOUR * 60) * TDAH_TIMELINE_PIXELS_PER_MINUTE
    ), [now, timeZone]);

    return (
        <View pointerEvents="none" style={[styles.nowLine, { top }]} testID="tdah-now-line">
            <Animated.View
                style={[styles.nowDot, { backgroundColor: tc.danger, opacity: pulse }]}
                testID="tdah-now-line-dot"
            />
            <View style={[styles.nowRule, { backgroundColor: tc.danger }]} />
        </View>
    );
}
