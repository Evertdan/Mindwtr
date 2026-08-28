import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import DraggableFlatList, { type DragEndParams, type RenderItemParams } from 'react-native-draggable-flatlist';

import { CloudHttpError, formatI18nTemplate, safeFormatDate, tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useToast } from '@/contexts/toast-context';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useThemeColors } from '@/hooks/use-theme-colors';

import { DURATION_MAX_MINUTES, START_TIME_PATTERN } from './TdahActivityDetailScreen';
import { styles as todayStyles } from './tdah-today.styles';
import type { TdahActivity } from './tdah-today-types';
import { useTdahMorning } from './use-tdah-morning';

/**
 * T-06 — the real "Mañana" editor (spec: replaces Story 3.2's "próximamente"
 * placeholder). Reorder/inline hora-duración edits/deletion only ever touch
 * the hook's in-memory draft (spec Always) — nothing here ever fires a
 * request per action; only "Confirmar mañana" does, in one grouped request.
 */

const parseTimeToMinutes = (value: string): number | null => {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
};

/**
 * A simple pairwise overlap check (Design Notes/Never: never blocks the
 * confirm send, purely an informational, non-blocking banner) — activities
 * with no time or a zero/omitted duration are excluded, since a "sin hora"
 * or zero-length entry has no interval to overlap with anything.
 */
function draftHasOverlap(activities: TdahActivity[]): boolean {
    const ranges = activities
        .filter((activity) => activity.startTime !== null && activity.durationMinutes !== null && activity.durationMinutes > 0)
        .map((activity) => {
            const start = parseTimeToMinutes(activity.startTime as string) ?? 0;
            return { start, end: start + (activity.durationMinutes as number) };
        });
    for (let i = 0; i < ranges.length; i += 1) {
        for (let j = i + 1; j < ranges.length; j += 1) {
            if (ranges[i].start < ranges[j].end && ranges[j].start < ranges[i].end) return true;
        }
    }
    return false;
}

type MorningActivityRowProps = {
    activity: TdahActivity;
    routineTitle: string | null;
    onDrag: () => void;
    isActive: boolean;
    onCommit: (activityId: number, changes: { startTime: string | null; durationMinutes: number | null }) => void;
    onDelete: (activityId: number) => void;
};

/**
 * One draggable row. Its two `TextInput`s are locally controlled and only
 * commit into the shared draft on `onEndEditing` (mirroring
 * TdahActivityDetailScreen's create-mode validity gating): an in-progress,
 * not-yet-valid keystroke never corrupts `draftActivities`, and an invalid
 * commit reverts the field back to the draft's own last-good value instead
 * of silently accepting it.
 */
function MorningActivityRow({ activity, routineTitle, onDrag, isActive, onCommit, onDelete }: MorningActivityRowProps) {
    const tc = useThemeColors();
    const { t } = useLanguage();
    const [timeText, setTimeText] = useState(activity.startTime ?? '');
    const [durationText, setDurationText] = useState(
        activity.durationMinutes !== null ? String(activity.durationMinutes) : '',
    );

    useEffect(() => {
        setTimeText(activity.startTime ?? '');
    }, [activity.startTime]);
    useEffect(() => {
        setDurationText(activity.durationMinutes !== null ? String(activity.durationMinutes) : '');
    }, [activity.durationMinutes]);

    const commitTime = useCallback(() => {
        if (timeText.length === 0) {
            onCommit(activity.id, { startTime: null, durationMinutes: activity.durationMinutes });
            return;
        }
        if (START_TIME_PATTERN.test(timeText)) {
            onCommit(activity.id, { startTime: timeText, durationMinutes: activity.durationMinutes });
        } else {
            setTimeText(activity.startTime ?? '');
        }
    }, [activity.durationMinutes, activity.id, activity.startTime, onCommit, timeText]);

    const commitDuration = useCallback(() => {
        if (durationText.length === 0) {
            onCommit(activity.id, { startTime: activity.startTime, durationMinutes: null });
            return;
        }
        const parsed = Number(durationText);
        if (Number.isInteger(parsed) && parsed >= 0 && parsed <= DURATION_MAX_MINUTES) {
            onCommit(activity.id, { startTime: activity.startTime, durationMinutes: parsed });
        } else {
            setDurationText(activity.durationMinutes !== null ? String(activity.durationMinutes) : '');
        }
    }, [activity.durationMinutes, activity.id, activity.startTime, durationText, onCommit]);

    const badge = (activity.movedAt ?? null) !== null
        ? tFallback(t, 'tdahToday.morningMovedBadge', 'Moved from Cierre')
        : (activity.origin === 'routine' && routineTitle
            ? formatI18nTemplate(tFallback(t, 'tdahActivity.routineContext', 'Part of Routine {name}'), { name: routineTitle })
            : null);

    // Story 4.2, the middle of the three read-only layers (spec Design Notes:
    // "Cerrar la mitad blanda de 'solo lectura'"): T-06 stops offering
    // deletion and hora/duración editing on a jira-origin row and says why
    // instead. The server closes the same door from behind
    // (`SELECT_ELIGIBLE_MORNING_ACTIVITY_IDS_SQL` excludes `origin='jira'`, so
    // a confirm body carrying the band is rejected with
    // `TDAH_ORIGIN_READ_ONLY`) — this is the half that keeps the user from
    // reaching for an affordance that could only ever fail.
    const isReadOnlyBand = activity.origin === 'jira';

    if (isReadOnlyBand) {
        return (
            <View
                style={[morningStyles.row, { borderColor: tc.border, backgroundColor: tc.cardBg }]}
                testID={`tdah-morning-row-${activity.id}`}
            >
                <Text style={[morningStyles.rowTitle, { color: tc.text }]} numberOfLines={2}>{activity.title}</Text>
                <Text
                    style={[morningStyles.rowBadge, { color: tc.secondaryText }]}
                    testID={`tdah-morning-row-${activity.id}-read-only`}
                >
                    {tFallback(t, 'tdahToday.workBandReadOnly', 'Read-only — work logging lives in Jira')}
                </Text>
            </View>
        );
    }

    return (
        <TouchableOpacity
            accessibilityRole="button"
            onLongPress={onDrag}
            disabled={isActive}
            style={[morningStyles.row, { borderColor: tc.border, backgroundColor: tc.cardBg, opacity: isActive ? 0.7 : 1 }]}
            testID={`tdah-morning-row-${activity.id}`}
        >
            <Text style={[morningStyles.rowTitle, { color: tc.text }]} numberOfLines={2}>{activity.title}</Text>
            {badge ? (
                <Text style={[morningStyles.rowBadge, { color: tc.secondaryText }]} testID={`tdah-morning-row-${activity.id}-badge`}>
                    {badge}
                </Text>
            ) : null}
            <View style={morningStyles.rowFieldsRow}>
                <TextInput
                    accessibilityLabel={tFallback(t, 'tdahActivity.startTimeLabel', 'Time (optional)')}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setTimeText}
                    onEndEditing={commitTime}
                    placeholder="09:30"
                    placeholderTextColor={tc.secondaryText}
                    style={[morningStyles.timeInput, { borderColor: tc.border, color: tc.text, backgroundColor: tc.inputBg }]}
                    testID={`tdah-morning-row-${activity.id}-time`}
                    value={timeText}
                />
                <TextInput
                    accessibilityLabel={tFallback(t, 'tdahActivity.durationLabel', 'Duration in minutes (optional)')}
                    keyboardType="number-pad"
                    onChangeText={setDurationText}
                    onEndEditing={commitDuration}
                    placeholder="30"
                    placeholderTextColor={tc.secondaryText}
                    style={[morningStyles.durationInput, { borderColor: tc.border, color: tc.text, backgroundColor: tc.inputBg }]}
                    testID={`tdah-morning-row-${activity.id}-duration`}
                    value={durationText}
                />
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={tFallback(t, 'common.delete', 'Delete')}
                    onPress={() => onDelete(activity.id)}
                    style={morningStyles.deleteButton}
                    testID={`tdah-morning-row-${activity.id}-delete`}
                >
                    <Trash2 size={18} color={tc.danger} />
                </TouchableOpacity>
            </View>
        </TouchableOpacity>
    );
}

export function TdahMorningScreen() {
    const tc = useThemeColors();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();
    const { showToast } = useToast();
    const router = useRouter();
    // T-05's own 4 figures, forwarded verbatim as route params (spec Code
    // Map) — T-06 never re-derives them, and T-07 never fetches its own
    // copy either. Defaulted to '0' the same way T-07 itself defaults every
    // numeric param (spec Code Map).
    const params = useLocalSearchParams<{
        movedTomorrow?: string;
        movedDate?: string;
        discarded?: string;
        limbo?: string;
    }>();
    const {
        phase, date, routineTitle, confirmedAt, draftActivities,
        reload, reorderDraft, updateDraftActivity, deleteDraftActivity, syncNewActivities, confirmMorning,
    } = useTdahMorning();
    const [confirming, setConfirming] = useState(false);

    // Mount-only fetch — deliberately NOT useFocusEffect (unlike every other
    // T-0X screen's "refetch on every focus", AD-1): the local draft (Design
    // Notes) must survive the round trip to "Agregar manual" and back. The
    // Stack keeps this screen mounted across that push/pop, so a plain
    // mount-only effect leaves `draftActivities` untouched there, while a
    // genuine abandon-and-later-reopen unmounts and remounts this screen,
    // which does re-run this effect and so does lose the draft (spec
    // Always: "abandonar sin confirmar pierde el borrador de T-06").
    useEffect(() => {
        void reload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // "Agregar manual" pushes `/tdah-activity/new`, which owns its own
    // separate `useTdahMorning()` instance and POSTs the new Activity
    // through that instance — this screen's own draft never learns about it
    // any other way. On regaining focus after that round trip (never on the
    // very first focus, which the mount-only effect above already covers),
    // merge in whatever the server now knows about without touching/
    // reordering anything already in the draft (bug fix: previously left
    // this screen's `draftActivities` one Activity short of the server's
    // pending count, so every subsequent "Confirmar mañana" failed with a
    // 400 from the exact-accounting check).
    const hasHadFirstFocusRef = useRef(false);
    useFocusEffect(useCallback(() => {
        if (!hasHadFirstFocusRef.current) {
            hasHadFirstFocusRef.current = true;
            return;
        }
        void syncNewActivities();
    }, [syncNewActivities]));

    const handleCommit = useCallback((
        activityId: number,
        changes: { startTime: string | null; durationMinutes: number | null },
    ) => {
        updateDraftActivity(activityId, changes);
    }, [updateDraftActivity]);

    const handleDragEnd = useCallback(({ from, to }: DragEndParams<TdahActivity>) => {
        reorderDraft(from, to);
    }, [reorderDraft]);

    const openAddManual = useCallback(() => {
        router.push({ pathname: '/tdah-activity/new', params: { targetDate: 'tomorrow' } });
    }, [router]);

    const handleConfirm = useCallback(async () => {
        if (confirming) return;
        setConfirming(true);
        try {
            const { changesCount } = await confirmMorning();
            router.push({
                pathname: '/tdah-confirmation',
                params: {
                    movedTomorrow: params.movedTomorrow ?? '0',
                    movedDate: params.movedDate ?? '0',
                    discarded: params.discarded ?? '0',
                    limbo: params.limbo ?? '0',
                    morningChanges: String(changesCount),
                },
            });
        } catch (error) {
            // Same offline-vs-rejection split as TdahRitualScreen's own
            // handleDecide (spec Error Handling): a real 400 gets the
            // generic action-failed toast, a network failure gets the
            // offline-specific one. The draft is never touched here on
            // either path — confirmMorning() itself leaves it intact on a
            // thrown error (spec: "borrador local intacto").
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
        } finally {
            setConfirming(false);
        }
    }, [confirmMorning, confirming, params.discarded, params.limbo, params.movedDate, params.movedTomorrow, router, showToast, t]);

    const renderItem = useCallback(({ item, drag, isActive }: RenderItemParams<TdahActivity>) => (
        <MorningActivityRow
            activity={item}
            routineTitle={routineTitle}
            onDrag={drag}
            isActive={isActive}
            onCommit={handleCommit}
            onDelete={deleteDraftActivity}
        />
    ), [deleteDraftActivity, handleCommit, routineTitle]);

    const overlapDetected = useMemo(() => draftHasOverlap(draftActivities), [draftActivities]);

    if (phase === 'loading') {
        return (
            <SafeAreaView style={[todayStyles.centered, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <ActivityIndicator size="large" color={tc.tint} testID="tdah-morning-loading" />
            </SafeAreaView>
        );
    }

    if (phase === 'offline') {
        // AD-11: offline is its own full-screen state with a visible retry
        // (same pattern as T-01/T-05), never a banner over a phantom draft.
        return (
            <SafeAreaView style={[todayStyles.centered, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <Text style={[todayStyles.emptyTitle, { color: tc.text }]} testID="tdah-morning-offline">
                    {tFallback(t, 'tdahToday.offlineBanner', 'No connection to the server — retrying')}
                </Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => void reload()}
                    style={[todayStyles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-morning-retry"
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
                <Text style={[todayStyles.emptyTitle, { color: tc.text }]} testID="tdah-morning-error">
                    {tFallback(t, 'tdahToday.loadError', 'Could not load your day.')}
                </Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => void reload()}
                    style={[todayStyles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-morning-retry"
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
                <Text style={[todayStyles.emptyTitle, { color: tc.text }]} testID="tdah-morning-unconfigured">
                    {tFallback(t, 'tdahToday.unconfiguredTitle', 'Cloud sync is not set up')}
                </Text>
                <Text style={[todayStyles.emptyBody, { color: tc.secondaryText }]}>
                    {t('settings.tdah.needsSync')}
                </Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => router.push('/settings')}
                    style={[todayStyles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-morning-open-settings"
                >
                    <Text style={[todayStyles.ctaButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {tFallback(t, 'tdahToday.unconfiguredOpenSettings', 'Open settings')}
                    </Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    // AD-6: the header date is the server's own "mañana" `date`, verbatim —
    // never derived from the device's local `new Date()` (mirrors
    // TdahTodayScreen's own dateLabel).
    const dateLabel = date ? safeFormatDate(date, 'EEEE d', '') : '';
    const headerText = formatI18nTemplate(tFallback(t, 'tdahToday.morningHeader', 'Tomorrow {date}'), { date: dateLabel });
    const routineLabel = routineTitle
        ? formatI18nTemplate(tFallback(t, 'tdahToday.morningRoutineLabel', 'Routine {name}'), { name: routineTitle })
        : null;

    return (
        <SafeAreaView style={[todayStyles.container, { backgroundColor: tc.bg }]} edges={['bottom']} testID="tdah-morning-screen">
            <View style={morningStyles.header}>
                <Text style={[morningStyles.headerDate, { color: tc.text }]} accessibilityRole="header">{headerText}</Text>
                {routineLabel ? (
                    <Text style={[morningStyles.headerRoutine, { color: tc.secondaryText }]}>{routineLabel}</Text>
                ) : null}
            </View>

            {confirmedAt !== null ? (
                <View
                    style={[morningStyles.banner, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
                    testID="tdah-morning-confirmed-banner"
                >
                    <Text style={[morningStyles.bannerText, { color: tc.text }]}>
                        {tFallback(
                            t,
                            'tdahToday.morningConfirmedBanner',
                            'You already confirmed tomorrow — you can still make changes and confirm again.',
                        )}
                    </Text>
                </View>
            ) : null}

            {overlapDetected ? (
                <View
                    style={[morningStyles.banner, { backgroundColor: tc.filterBg, borderColor: tc.warning }]}
                    testID="tdah-morning-overlap-warning"
                >
                    <Text style={[morningStyles.bannerText, { color: tc.text }]}>
                        {tFallback(t, 'tdahToday.morningOverlapWarning', 'Some activities overlap in time.')}
                    </Text>
                </View>
            ) : null}

            {draftActivities.length === 0 ? (
                <View style={todayStyles.centered} testID="tdah-morning-empty">
                    <Text style={[todayStyles.emptyTitle, { color: tc.text }]}>
                        {tFallback(t, 'tdahToday.morningEmpty', 'Nothing planned for tomorrow yet.')}
                    </Text>
                </View>
            ) : (
                <DraggableFlatList
                    data={draftActivities}
                    keyExtractor={(item) => String(item.id)}
                    renderItem={renderItem}
                    onDragEnd={handleDragEnd}
                    containerStyle={morningStyles.list}
                    testID="tdah-morning-list"
                />
            )}

            <View style={morningStyles.footer}>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={openAddManual}
                    style={[morningStyles.secondaryButton, { borderColor: tc.border }]}
                    testID="tdah-morning-add-manual"
                >
                    <Text style={[morningStyles.secondaryButtonText, { color: tc.text }]}>
                        {tFallback(t, 'tdahToday.morningAddManual', 'Add activity')}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ disabled: confirming }}
                    disabled={confirming}
                    onPress={() => void handleConfirm()}
                    style={[
                        todayStyles.ctaButton,
                        { flexGrow: 1, backgroundColor: filledButton.backgroundColor, opacity: confirming ? 0.6 : 1 },
                    ]}
                    testID="tdah-morning-confirm"
                >
                    {confirming ? (
                        <ActivityIndicator size="small" color={filledButton.textColor ?? tc.onTint} />
                    ) : (
                        <Text style={[todayStyles.ctaButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                            {tFallback(t, 'tdahToday.morningConfirm', 'Confirm tomorrow')}
                        </Text>
                    )}
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

// Local to this screen (not added to tdah-today.styles.ts, out of this
// story's owned files) — same convention TdahRitualScreen.tsx's own
// ritualStyles already established.
const morningStyles = StyleSheet.create({
    header: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
    },
    headerDate: {
        fontSize: 20,
        fontWeight: '700',
    },
    headerRoutine: {
        fontSize: 13,
        marginTop: 2,
    },
    banner: {
        flexDirection: 'row',
        marginHorizontal: 16,
        marginBottom: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
    },
    bannerText: {
        flex: 1,
        fontSize: 13,
    },
    list: {
        flex: 1,
        paddingHorizontal: 16,
    },
    row: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        gap: 6,
        marginBottom: 10,
    },
    rowTitle: {
        fontSize: 15,
        fontWeight: '600',
    },
    rowBadge: {
        fontSize: 11,
    },
    rowFieldsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 4,
    },
    timeInput: {
        flexGrow: 1,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 14,
    },
    durationInput: {
        flexGrow: 1,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 14,
    },
    deleteButton: {
        padding: 8,
        minWidth: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    footer: {
        flexDirection: 'row',
        gap: 10,
        padding: 16,
    },
    secondaryButton: {
        flexGrow: 1,
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    secondaryButtonText: {
        fontSize: 15,
        fontWeight: '700',
    },
});
