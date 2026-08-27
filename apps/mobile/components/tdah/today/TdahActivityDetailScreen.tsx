import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import { formatI18nTemplate, tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useThemeColors } from '@/hooks/use-theme-colors';

import { tdahActivityStateLabel } from './tdah-activity-labels';
import { styles } from './tdah-today.styles';
import type { TdahActivity, TdahActivityTransitionAction } from './tdah-today-types';
import { formatIsoWallClockInTimeZone } from './tdah-time';
import { useTdahToday } from './use-tdah-today';

// Same shape apps/cloud/src/tdah/routes.ts validates `startTime` with
// (RITUAL_HOUR_PATTERN) — kept in sync by hand, clients never import server
// types across the wire boundary (ADR 0026), mirroring
// tdah-onboarding-step-ritual.tsx's own copy of this pattern.
const START_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TITLE_MAX_LENGTH = 80;
const DURATION_MAX_MINUTES = 1440;

export type TdahActivityDetailScreenProps =
    | { mode: 'view'; activityId: number }
    | { mode: 'create' };

/**
 * T-02 — view mode registers Iniciar/Completar/No completar on an existing
 * Activity; create mode adds a manual one (spec: existing-Activity editing
 * of title/time/duration is out of scope, only creation gets those fields).
 * Both modes fetch fresh via their own `useTdahToday()` instance rather than
 * trusting route params, so a stale navigation param can never show a
 * decision another device already made (AD-1).
 */
export function TdahActivityDetailScreen(props: TdahActivityDetailScreenProps) {
    const tc = useThemeColors();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();
    const router = useRouter();
    const { phase, routineTitle, timeZone, activities, reload, createManualActivity, registerActivityAction } = useTdahToday();

    useFocusEffect(useCallback(() => {
        void reload();
    }, [reload]));

    const goBack = useCallback(() => {
        if (router.canGoBack()) router.back();
        else router.replace('/tdah-today');
    }, [router]);

    // --- Create mode ---------------------------------------------------
    const [title, setTitle] = useState('');
    const [startTimeInput, setStartTimeInput] = useState('');
    const [durationInput, setDurationInput] = useState('');
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState(false);

    const trimmedTitle = title.trim();
    const startTimeValid = startTimeInput.length === 0 || START_TIME_PATTERN.test(startTimeInput);
    const durationValue = durationInput.length === 0 ? null : Number(durationInput);
    const durationValid = durationInput.length === 0
        || (Number.isInteger(durationValue) && (durationValue as number) >= 0 && (durationValue as number) <= DURATION_MAX_MINUTES);
    const canSubmit = trimmedTitle.length > 0
        && trimmedTitle.length <= TITLE_MAX_LENGTH
        && startTimeValid
        && durationValid
        && !creating;

    const handleCreate = useCallback(async () => {
        if (!canSubmit) return;
        setCreating(true);
        setCreateError(false);
        try {
            await createManualActivity({
                title: trimmedTitle,
                ...(startTimeInput ? { startTime: startTimeInput } : {}),
                ...(durationInput ? { durationMinutes: Number(durationInput) } : {}),
            });
            goBack();
        } catch {
            setCreateError(true);
        } finally {
            setCreating(false);
        }
    }, [canSubmit, createManualActivity, durationInput, goBack, startTimeInput, trimmedTitle]);

    if (props.mode === 'create') {
        return (
            <SafeAreaView style={[styles.detailContainer, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.detailScroll}>
                    <Text style={[styles.detailTitle, { color: tc.text }]} accessibilityRole="header">
                        {tFallback(t, 'tdahActivity.createTitle', 'New activity')}
                    </Text>

                    <View style={styles.fieldGroup}>
                        <Text style={[styles.fieldLabel, { color: tc.text }]}>{t('taskEdit.titleLabel')}</Text>
                        <TextInput
                            accessibilityLabel={t('taskEdit.titleLabel')}
                            onChangeText={setTitle}
                            placeholder={tFallback(t, 'tdahActivity.titlePlaceholder', 'What are you going to do?')}
                            placeholderTextColor={tc.secondaryText}
                            style={[styles.textInput, { borderColor: tc.border, color: tc.text, backgroundColor: tc.inputBg }]}
                            testID="tdah-activity-title-input"
                            value={title}
                        />
                    </View>

                    <View style={styles.fieldGroup}>
                        <Text style={[styles.fieldLabel, { color: tc.text }]}>
                            {tFallback(t, 'tdahActivity.startTimeLabel', 'Time (optional)')}
                        </Text>
                        <TextInput
                            accessibilityLabel={tFallback(t, 'tdahActivity.startTimeLabel', 'Time (optional)')}
                            autoCapitalize="none"
                            autoCorrect={false}
                            onChangeText={setStartTimeInput}
                            placeholder="09:30"
                            placeholderTextColor={tc.secondaryText}
                            style={[styles.textInput, { borderColor: tc.border, color: tc.text, backgroundColor: tc.inputBg }]}
                            testID="tdah-activity-start-time-input"
                            value={startTimeInput}
                        />
                    </View>

                    <View style={styles.fieldGroup}>
                        <Text style={[styles.fieldLabel, { color: tc.text }]}>
                            {tFallback(t, 'tdahActivity.durationLabel', 'Duration in minutes (optional)')}
                        </Text>
                        <TextInput
                            accessibilityLabel={tFallback(t, 'tdahActivity.durationLabel', 'Duration in minutes (optional)')}
                            keyboardType="number-pad"
                            onChangeText={setDurationInput}
                            placeholder="30"
                            placeholderTextColor={tc.secondaryText}
                            style={[styles.textInput, { borderColor: tc.border, color: tc.text, backgroundColor: tc.inputBg }]}
                            testID="tdah-activity-duration-input"
                            value={durationInput}
                        />
                    </View>

                    {createError ? (
                        <View style={[styles.errorBanner, { backgroundColor: tc.filterBg, borderColor: tc.danger }]} testID="tdah-activity-create-error">
                            <Text style={[styles.errorBannerText, { color: tc.text }]}>
                                {tFallback(t, 'tdahActivity.errorGeneric', 'Could not complete the action. Try again.')}
                            </Text>
                        </View>
                    ) : null}
                </ScrollView>
                <View style={styles.footer}>
                    <View style={styles.actionsRow}>
                        <TouchableOpacity
                            accessibilityRole="button"
                            onPress={goBack}
                            style={[styles.actionButton, { borderWidth: 1, borderColor: tc.border }]}
                            testID="tdah-activity-cancel"
                        >
                            <Text style={[styles.actionButtonText, { color: tc.text }]}>{t('common.cancel')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !canSubmit }}
                            disabled={!canSubmit}
                            onPress={() => void handleCreate()}
                            style={[styles.actionButton, { backgroundColor: filledButton.backgroundColor, opacity: canSubmit ? 1 : 0.5 }]}
                            testID="tdah-activity-save"
                        >
                            {creating ? (
                                <ActivityIndicator size="small" color={filledButton.textColor ?? tc.onTint} />
                            ) : (
                                <Text style={[styles.actionButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                                    {t('common.save')}
                                </Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </SafeAreaView>
        );
    }

    // --- View mode -------------------------------------------------------
    return (
        <TdahActivityViewMode
            activityId={props.activityId}
            activities={activities}
            phase={phase}
            reload={reload}
            registerActivityAction={registerActivityAction}
            routineTitle={routineTitle}
            timeZone={timeZone}
            goBack={goBack}
        />
    );
}

type TdahActivityViewModeProps = {
    activityId: number;
    activities: TdahActivity[];
    phase: ReturnType<typeof useTdahToday>['phase'];
    reload: () => Promise<void>;
    registerActivityAction: (activityId: number, action: TdahActivityTransitionAction) => Promise<TdahActivity>;
    routineTitle: string | null;
    /** The day's profile zone (AD-6): startedAt/completedAt render in this zone, one clock everywhere. */
    timeZone: string;
    goBack: () => void;
};

function TdahActivityViewMode({
    activityId,
    activities,
    phase,
    reload,
    registerActivityAction,
    routineTitle,
    timeZone,
    goBack,
}: TdahActivityViewModeProps) {
    const tc = useThemeColors();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();
    const [pendingAction, setPendingAction] = useState<TdahActivityTransitionAction | null>(null);
    const [actionError, setActionError] = useState(false);

    const activity = useMemo(
        () => activities.find((candidate) => candidate.id === activityId) ?? null,
        [activities, activityId],
    );

    const runAction = useCallback(async (action: TdahActivityTransitionAction) => {
        if (pendingAction) return;
        setPendingAction(action);
        setActionError(false);
        try {
            await registerActivityAction(activityId, action);
        } catch {
            setActionError(true);
        } finally {
            setPendingAction(null);
        }
    }, [activityId, pendingAction, registerActivityAction]);

    if (phase === 'loading') {
        return (
            <SafeAreaView style={[styles.centered, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <ActivityIndicator size="large" color={tc.tint} testID="tdah-activity-loading" />
            </SafeAreaView>
        );
    }

    if (phase === 'offline' || phase === 'error' || phase === 'unconfigured') {
        return (
            <SafeAreaView style={[styles.centered, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <Text style={[styles.emptyTitle, { color: tc.text }]} testID="tdah-activity-load-error">
                    {tFallback(t, 'tdahToday.loadError', 'Could not load your day.')}
                </Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => void reload()}
                    style={[styles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-activity-retry"
                >
                    <Text style={[styles.ctaButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {tFallback(t, 'tdahToday.retry', 'Retry')}
                    </Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    if (!activity) {
        return (
            <SafeAreaView style={[styles.centered, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <Text style={[styles.emptyTitle, { color: tc.text }]} testID="tdah-activity-not-found">
                    {tFallback(t, 'tdahToday.loadError', 'Could not load your day.')}
                </Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={goBack}
                    style={[styles.ctaButton, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-activity-back"
                >
                    <Text style={[styles.ctaButtonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {t('common.back')}
                    </Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    const stateLabel = tdahActivityStateLabel(t, activity.state);
    // AD-6, one clock everywhere: these instants render in the profile's own
    // zone — the same clock the timeline and now-line use — never the
    // device's local zone.
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

    // AD-7 / doc 02 T-02 note: a second tap on an already-registered action
    // is disabled, not merely tolerated — this also collapses a raced
    // double-tap into "button already disabled" rather than a second POST.
    const startDisabled = activity.state !== 'pending' || pendingAction !== null;
    // The state-based reason Complete/Not completed are disabled (as opposed
    // to merely "an action is pending right now") — mirrors Start's own
    // "ya iniciada" pattern below so a screen reader explains *why* these are
    // disabled once the Activity is no longer pending/started, not just that
    // they are.
    const alreadyRegistered = !(activity.state === 'pending' || activity.state === 'started');
    const registerDisabled = alreadyRegistered || pendingAction !== null;

    return (
        <SafeAreaView style={[styles.detailContainer, { backgroundColor: tc.bg }]} edges={['bottom']}>
            <ScrollView contentContainerStyle={styles.detailScroll}>
                <View style={styles.detailHeaderRow}>
                    <Text style={[styles.detailTitle, { color: tc.text }]} accessibilityRole="header" numberOfLines={2}>
                        {activity.title}
                    </Text>
                </View>

                <Text style={[styles.readOnlyValue, { color: tc.secondaryText }]} testID="tdah-activity-state">
                    {stateLabel}
                </Text>

                <View style={styles.fieldGroup}>
                    <Text style={[styles.fieldLabel, { color: tc.text }]}>
                        {tFallback(t, 'tdahActivity.startTimeLabel', 'Time (optional)')}
                    </Text>
                    <Text style={[styles.readOnlyValue, { color: tc.secondaryText }]}>
                        {activity.startTime ?? tFallback(t, 'tdahToday.noTime', 'No time')}
                    </Text>
                </View>

                {activity.durationMinutes !== null && activity.durationMinutes > 0 ? (
                    <View style={styles.fieldGroup}>
                        <Text style={[styles.fieldLabel, { color: tc.text }]}>
                            {tFallback(t, 'tdahActivity.durationLabel', 'Duration in minutes (optional)')}
                        </Text>
                        <Text style={[styles.readOnlyValue, { color: tc.secondaryText }]}>{activity.durationMinutes} min</Text>
                    </View>
                ) : null}

                {activity.origin === 'routine' && routineTitle ? (
                    <Text style={[styles.routineContext, { color: tc.secondaryText }]}>
                        {formatI18nTemplate(tFallback(t, 'tdahActivity.routineContext', 'Part of Routine {name}'), {
                            name: routineTitle,
                        })}
                    </Text>
                ) : null}

                <View style={styles.actionsRow}>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityState={{ disabled: startDisabled }}
                        accessibilityLabel={activity.state !== 'pending'
                            ? tFallback(t, 'tdahActivity.alreadyRegistered', 'Already registered')
                            : tFallback(t, 'tdahActivity.actionStart', 'Start')}
                        disabled={startDisabled}
                        onPress={() => void runAction('start')}
                        style={[styles.actionButton, { backgroundColor: tc.filterBg, opacity: startDisabled ? 0.5 : 1 }]}
                        testID="tdah-activity-action-start"
                    >
                        {pendingAction === 'start' ? (
                            <ActivityIndicator size="small" color={tc.text} />
                        ) : (
                            <Text style={[styles.actionButtonText, { color: tc.text }]}>
                                {tFallback(t, 'tdahActivity.actionStart', 'Start')}
                            </Text>
                        )}
                    </TouchableOpacity>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityState={{ disabled: registerDisabled }}
                        accessibilityLabel={alreadyRegistered
                            ? tFallback(t, 'tdahActivity.alreadyRegistered', 'Already registered')
                            : tFallback(t, 'tdahActivity.actionComplete', 'Completed')}
                        disabled={registerDisabled}
                        onPress={() => void runAction('complete')}
                        style={[styles.actionButton, { backgroundColor: tc.success, opacity: registerDisabled ? 0.5 : 1 }]}
                        testID="tdah-activity-action-complete"
                    >
                        {pendingAction === 'complete' ? (
                            <ActivityIndicator size="small" color={tc.onTint} />
                        ) : (
                            <Text style={[styles.actionButtonText, { color: tc.onTint }]}>
                                {tFallback(t, 'tdahActivity.actionComplete', 'Completed')}
                            </Text>
                        )}
                    </TouchableOpacity>
                    <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityState={{ disabled: registerDisabled }}
                        accessibilityLabel={alreadyRegistered
                            ? tFallback(t, 'tdahActivity.alreadyRegistered', 'Already registered')
                            : tFallback(t, 'tdahActivity.actionMiss', 'Not completed')}
                        disabled={registerDisabled}
                        onPress={() => void runAction('miss')}
                        style={[styles.actionButton, { backgroundColor: tc.danger, opacity: registerDisabled ? 0.5 : 1 }]}
                        testID="tdah-activity-action-miss"
                    >
                        {pendingAction === 'miss' ? (
                            <ActivityIndicator size="small" color={tc.onTint} />
                        ) : (
                            <Text style={[styles.actionButtonText, { color: tc.onTint }]}>
                                {tFallback(t, 'tdahActivity.actionMiss', 'Not completed')}
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>

                {startedAtLabel ? (
                    <Text style={[styles.readOnlyValue, { color: tc.secondaryText }]}>{startedAtLabel}</Text>
                ) : null}
                {completedAtLabel ? (
                    <Text style={[styles.readOnlyValue, { color: tc.secondaryText }]}>{completedAtLabel}</Text>
                ) : null}

                {actionError ? (
                    <View style={[styles.errorBanner, { backgroundColor: tc.filterBg, borderColor: tc.danger }]} testID="tdah-activity-action-error">
                        <Text style={[styles.errorBannerText, { color: tc.text }]}>
                            {tFallback(t, 'tdahActivity.errorGeneric', 'Could not complete the action. Try again.')}
                        </Text>
                    </View>
                ) : null}
            </ScrollView>
        </SafeAreaView>
    );
}
