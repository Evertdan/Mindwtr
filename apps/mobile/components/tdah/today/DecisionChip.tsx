import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';

import type { TdahActivityDecideRequest, TdahActivityDecision } from './tdah-today-types';

export type DecisionChipProps = {
    activityId: number;
    /**
     * The TDAH profile's own configured IANA zone (AD-6, mirroring
     * `TdahDayResponse.timeZone`) — the picker's "today"/"tomorrow" floor is
     * derived from this, never the device's own local clock, since the
     * server validates a `move-date` pick against the profile's zone, not
     * the device's.
     */
    timeZone: string;
    /**
     * Applies one decision for `activityId` and resolves once the server
     * has responded — `true` when it was applied (spec Always: a row only
     * atenúa/colapsa after a real 200, never optimistically), `false` when
     * it wasn't (the caller already surfaced its own toast/error, mirroring
     * TdahActivityDetailScreen's `runAction` pattern — this component never
     * renders its own error UI). A `false` result re-enables every chip in
     * this row (spec Error Handling: "chip vuelve a habilitarse").
     */
    onDecide: (activityId: number, request: TdahActivityDecideRequest) => Promise<boolean>;
    /**
     * Story 3.4 (T-08's Limbo, spec Code Map): `'limbo'` swaps the 4th chip
     * from "sin fecha" (a no-op there — the Limbo's own I/O Matrix never
     * offers it, since a Limbo Activity is already undated) for "completar
     * tardíamente" (`decision:'complete-late'`). Defaults to `'cierre'` so
     * every existing T-05 call site (and this component's own pre-3.4
     * tests) keeps its original 4 chips untouched. Deliberately the
     * smallest change over duplicating this ~200-line component (Design
     * Notes) — the other 3 chips are byte-for-byte identical between both
     * variants.
     */
    variant?: 'cierre' | 'limbo';
};

const pad = (value: number): string => value.toString().padStart(2, '0');

/**
 * The date the user tapped in the native picker, as a plain "yyyy-MM-dd" —
 * the literal calendar day they picked, no time-zone conversion. The
 * server is the sole authority on whether it's valid for the profile's own
 * zone (spec Always: never move-date to <= today, profile tz); this is
 * just the wire value.
 */
const toDateKey = (value: Date): string => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

/**
 * `date`'s calendar day in `timeZone` as a "yyyy-MM-dd" key — the same
 * technique tdah-time.ts's own `formatDayKeyInTimeZone` uses (kept local to
 * this file rather than imported, since that helper isn't exported from a
 * file this story owns).
 */
const dayKeyInTimeZone = (date: Date, timeZone: string): string => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
    const month = parts.find((part) => part.type === 'month')?.value ?? '01';
    const day = parts.find((part) => part.type === 'day')?.value ?? '01';
    return `${year}-${month}-${day}`;
};

/**
 * The profile's own "today" (AD-6), expressed as a local-midnight `Date` so
 * the native picker's y/m/d fields (which `toDateKey` reads back with plain
 * local getters) agree with it — never the device's own local calendar day,
 * which can disagree with the profile's configured zone near a day
 * boundary.
 */
const profileTodayAsLocalDate = (timeZone: string): Date => {
    const [year, month, day] = dayKeyInTimeZone(new Date(), timeZone).split('-').map(Number);
    return new Date(year, month - 1, day);
};

/** Tomorrow in the profile's own zone (AD-6) — the picker's opening value and its soft `minimumDate` client-side guard (the server remains the real 400 gate for a same-day/past pick, computed the same way its own `computeTomorrowDate` does). */
const tomorrowFloor = (timeZone: string): Date => {
    const today = profileTodayAsLocalDate(timeZone);
    today.setDate(today.getDate() + 1);
    return today;
};

/**
 * T-05's 4-chip decision row (spec Code Map) — one tap applies a decision
 * directly ("cierre... con decisiones de un tap"), no separate confirm
 * step. "Mañana" is drawn preselected (an outlined, non-filled border) to
 * read as the recommended default, but every chip commits immediately on
 * tap; the preselection is purely visual, never a staged/pending choice.
 * Story 3.4: also reused by T-08 (the Limbo) via `variant='limbo'`, which
 * swaps only the 4th chip (see `variant` prop doc).
 */
export function DecisionChip({ activityId, timeZone, onDecide, variant = 'cierre' }: DecisionChipProps) {
    const tc = useThemeColors();
    const { t } = useLanguage();
    const [pending, setPending] = useState<TdahActivityDecision | null>(null);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const disabled = pending !== null;

    const applyDecision = useCallback(async (
        decision: TdahActivityDecision,
        request: TdahActivityDecideRequest,
    ): Promise<void> => {
        if (disabled) return;
        setPending(decision);
        try {
            await onDecide(activityId, request);
        } finally {
            // Either outcome ends this tap's pending state: on success the
            // parent hides this whole row on its next render (nothing left
            // to reset here); on failure the spec requires the chip to
            // re-enable, which this same reset satisfies. The `finally`
            // guards this even if `onDecide` — documented as never-throwing
            // — ever did throw, rather than leaving every chip stuck
            // disabled (defense in depth, not a contract this component
            // relies on).
            setPending(null);
        }
    }, [activityId, disabled, onDecide]);

    const handleTomorrow = useCallback(() => {
        void applyDecision('move-tomorrow', { decision: 'move-tomorrow' });
    }, [applyDecision]);

    const handleDiscard = useCallback(() => {
        void applyDecision('discard', { decision: 'discard' });
    }, [applyDecision]);

    const handleUndated = useCallback(() => {
        void applyDecision('undated', { decision: 'undated' });
    }, [applyDecision]);

    const handleCompleteLate = useCallback(() => {
        void applyDecision('complete-late', { decision: 'complete-late' });
    }, [applyDecision]);

    const openDatePicker = useCallback(() => {
        if (disabled) return;
        setShowDatePicker(true);
    }, [disabled]);

    const handleDateChange = useCallback((event: DateTimePickerEvent, selected?: Date) => {
        setShowDatePicker(false);
        if (event.type === 'dismissed' || !selected) return;
        void applyDecision('move-date', { decision: 'move-date', date: toDateKey(selected) });
    }, [applyDecision]);

    const tomorrowLabel = tFallback(t, 'quickDate.tomorrow', 'Tomorrow');
    const dateLabel = tFallback(t, 'tdahToday.decisionDate', 'Date');
    const discardLabel = tFallback(t, 'common.discard', 'Discard');
    const noDateLabel = tFallback(t, 'quickDate.noDate', 'No date');
    const completeLateLabel = tFallback(t, 'tdahToday.decisionCompleteLate', 'Complete (late)');
    const fourthChipLabel = variant === 'limbo' ? completeLateLabel : noDateLabel;

    return (
        <View style={chipStyles.row} testID={`tdah-decision-chip-${activityId}`}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={tomorrowLabel}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={handleTomorrow}
                style={[
                    chipStyles.chip,
                    { borderWidth: 2, borderColor: tc.tint, backgroundColor: 'transparent', opacity: disabled ? 0.5 : 1 },
                ]}
                testID={`tdah-decision-chip-${activityId}-move-tomorrow`}
            >
                <Text style={[chipStyles.chipText, { color: tc.tint }]}>{tomorrowLabel}</Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={dateLabel}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={openDatePicker}
                style={[chipStyles.chip, { backgroundColor: tc.filterBg, opacity: disabled ? 0.5 : 1 }]}
                testID={`tdah-decision-chip-${activityId}-move-date`}
            >
                <Text style={[chipStyles.chipText, { color: tc.text }]}>{dateLabel}</Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={discardLabel}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={handleDiscard}
                style={[chipStyles.chip, { backgroundColor: tc.filterBg, opacity: disabled ? 0.5 : 1 }]}
                testID={`tdah-decision-chip-${activityId}-discard`}
            >
                <Text style={[chipStyles.chipText, { color: tc.text }]}>{discardLabel}</Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={fourthChipLabel}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={variant === 'limbo' ? handleCompleteLate : handleUndated}
                style={[chipStyles.chip, { backgroundColor: tc.filterBg, opacity: disabled ? 0.5 : 1 }]}
                testID={variant === 'limbo'
                    ? `tdah-decision-chip-${activityId}-complete-late`
                    : `tdah-decision-chip-${activityId}-undated`}
            >
                <Text style={[chipStyles.chipText, { color: tc.text }]}>{fourthChipLabel}</Text>
            </Pressable>
            {showDatePicker ? (
                <DateTimePicker
                    value={tomorrowFloor(timeZone)}
                    mode="date"
                    display="default"
                    minimumDate={tomorrowFloor(timeZone)}
                    onChange={handleDateChange}
                    testID={`tdah-decision-chip-${activityId}-date-picker`}
                />
            ) : null}
        </View>
    );
}

const chipStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 8,
    },
    chip: {
        minHeight: 48,
        borderRadius: 24,
        paddingHorizontal: 14,
        alignItems: 'center',
        justifyContent: 'center',
        flexGrow: 1,
    },
    chipText: {
        fontSize: 13,
        fontWeight: '700',
    },
});
