import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { formatI18nTemplate, tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { useThemeTokens } from '@/hooks/use-theme-tokens';

import { styles } from './tdah-dnd.styles';
import type { TdahDndWindow, TdahDndWindowInput, TdahDndWindowKind } from './tdah-dnd-types';
import { useTdahDnd, type TdahDndMutationError } from './use-tdah-dnd';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * A REAL calendar date, not merely a `YYYY-MM-DD`-shaped string — `2026-02-31`
 * matches the pattern above and does not exist. Mirrors the `Date.UTC`
 * round-trip both the server (`isValidDndDate`, dnd.ts) and the desktop view
 * (`isValidDndDate`, TdahDndView.tsx) already perform; without it the editor
 * lets the user press Save and the impossible date comes back as a generic
 * "could not save" instead of the field turning red where it is wrong.
 */
const isRealCalendarDate = (value: string): boolean => {
    if (!DATE_PATTERN.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const roundTrip = new Date(Date.UTC(year, month - 1, day));
    return roundTrip.getUTCFullYear() === year
        && roundTrip.getUTCMonth() === month - 1
        && roundTrip.getUTCDate() === day;
};

// `HH:mm` is lexicographically ordered, which is exactly why the whole
// module speaks it (server included) — no minute arithmetic anywhere.
const isOrderedRange = (start: string, end: string): boolean => (
    TIME_PATTERN.test(start) && TIME_PATTERN.test(end) && start < end
);

// A fixed Sunday, so `weekday` 0-6 indexes the same day names the server's
// `Date.UTC(...).getUTCDay()` numbering produces. Read in UTC so the device's
// own zone can never shift the label by a day.
const WEEKDAY_REFERENCE_SUNDAY_MS = Date.UTC(2024, 0, 7);
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

const weekdayLabel = (weekday: number, locale?: string): string => (
    new Date(WEEKDAY_REFERENCE_SUNDAY_MS + weekday * 24 * 60 * 60 * 1000)
        .toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })
);

type EditorState = {
    /** `null` while creating; the window's id while editing an existing one. */
    windowId: string | null;
    kind: TdahDndWindowKind;
    weekdays: number[];
    date: string;
    startTime: string;
    endTime: string;
    label: string;
};

const emptyEditor = (): EditorState => ({
    windowId: null,
    kind: 'weekly',
    weekdays: [],
    date: '',
    startTime: '',
    endTime: '',
    label: '',
});

const editorFromWindow = (window: TdahDndWindow): EditorState => ({
    windowId: window.id,
    kind: window.kind,
    weekdays: window.weekdays ?? [],
    date: window.date ?? '',
    startTime: window.startTime,
    endTime: window.endTime,
    label: window.label ?? '',
});

const isEditorValid = (editor: EditorState): boolean => {
    if (!isOrderedRange(editor.startTime, editor.endTime)) return false;
    if (editor.kind === 'weekly') return editor.weekdays.length > 0;
    return isRealCalendarDate(editor.date);
};

const editorToInput = (editor: EditorState): TdahDndWindowInput => ({
    kind: editor.kind,
    weekdays: editor.kind === 'weekly' ? [...editor.weekdays].sort((a, b) => a - b) : null,
    date: editor.kind === 'once' ? editor.date : null,
    startTime: editor.startTime,
    endTime: editor.endTime,
    label: editor.label.trim().length > 0 ? editor.label.trim() : null,
});

const MUTATION_ERROR_COPY: Record<TdahDndMutationError, { key: string; fallback: string }> = {
    workingHours: { key: 'tdahDnd.work.saveError', fallback: 'Could not save your working hours on your server.' },
    windowSave: { key: 'tdahDnd.editor.saveError', fallback: 'Could not save that window on your server.' },
    windowLimit: { key: 'tdahDnd.windows.limit', fallback: 'You have reached the limit of manual windows. Delete one to add another.' },
    windowDelete: { key: 'tdahDnd.windows.deleteError', fallback: 'Could not delete that window on your server.' },
    calendar: { key: 'tdahDnd.calendar.syncError', fallback: 'Could not send your calendar windows to your server.' },
};

/**
 * T-12 — "No molestar" (story 4.3, doc 06). Four zones: the current state,
 * calendar detection with its permission state, the working hours that bound
 * that detection, and the manual windows with their editor.
 *
 * The screen is a pure projection of server state (AD-8): it renders the
 * `activeUntil` the VPS already computed and never decides, clips or
 * recomputes a window itself. The promise copy is load-bearing product
 * behavior, not decoration — a user who suspects a post-meeting avalanche
 * turns DND off (SM-C1), so "lo suprimido no vuelve después" stays visible
 * on the screen at all times.
 */
export function TdahDndScreen() {
    const tc = useThemeColors();
    const tokens = useThemeTokens();
    const filledButton = useFilledButtonColors();
    const { t, language } = useLanguage();
    const {
        phase,
        settings,
        windows,
        activeUntil,
        permission,
        calendarSupported,
        calendarSyncing,
        mutationError,
        clearMutationError,
        reload,
        requestCalendarPermission,
        setCalendarEnabled,
        saveWorkingHours,
        createWindow,
        updateWindow,
        deleteWindow,
    } = useTdahDnd();

    const [editor, setEditor] = useState<EditorState | null>(null);
    const [editorTouched, setEditorTouched] = useState(false);
    const [saving, setSaving] = useState(false);
    const [workStartText, setWorkStartText] = useState(settings.workStart);
    const [workEndText, setWorkEndText] = useState(settings.workEnd);
    const [workTouched, setWorkTouched] = useState(false);

    useFocusEffect(useCallback(() => {
        void reload();
    }, [reload]));

    // The working-hours fields are locally controlled while the user types,
    // then re-seeded from the server's own values on every reload — the same
    // "local draft, server truth" split T-06's row inputs use.
    useEffect(() => {
        setWorkStartText(settings.workStart);
        setWorkEndText(settings.workEnd);
        setWorkTouched(false);
    }, [settings.workStart, settings.workEnd]);

    // AC: the state is a datum of calm, in the `dnd` role when the active
    // theme resolves one (`tokens.roles`, null for a non-Material theme) —
    // never a danger/alert token. Same fallback shape as T-01's limbo badge.
    const dndColor = tokens.roles?.dnd ?? tc.tint;

    const manualWindows = useMemo(
        () => windows.filter((window) => window.source === 'manual'),
        [windows],
    );
    const calendarWindows = useMemo(
        () => windows.filter((window) => window.source === 'calendar'),
        [windows],
    );

    const describeWindow = useCallback((window: TdahDndWindow): string => {
        if (window.kind === 'weekly') {
            const days = (window.weekdays ?? []).map((weekday) => weekdayLabel(weekday, language)).join(', ');
            return formatI18nTemplate(
                tFallback(t, 'tdahDnd.windows.weekly', '{days} · {start}–{end}'),
                { days, start: window.startTime, end: window.endTime },
            );
        }
        return formatI18nTemplate(
            tFallback(t, 'tdahDnd.windows.once', '{date} · {start}–{end}'),
            { date: window.date ?? '', start: window.startTime, end: window.endTime },
        );
    }, [language, t]);

    const openCreateEditor = useCallback(() => {
        clearMutationError();
        setEditorTouched(false);
        setEditor(emptyEditor());
    }, [clearMutationError]);

    const openEditEditor = useCallback((window: TdahDndWindow) => {
        clearMutationError();
        setEditorTouched(false);
        setEditor(editorFromWindow(window));
    }, [clearMutationError]);

    const closeEditor = useCallback(() => {
        setEditor(null);
        setEditorTouched(false);
    }, []);

    const toggleEditorDay = useCallback((weekday: number) => {
        setEditor((current) => {
            if (!current) return current;
            const weekdays = current.weekdays.includes(weekday)
                ? current.weekdays.filter((day) => day !== weekday)
                : [...current.weekdays, weekday];
            return { ...current, weekdays };
        });
    }, []);

    const submitEditor = useCallback(async () => {
        if (!editor || saving) return;
        setEditorTouched(true);
        if (!isEditorValid(editor)) return;
        setSaving(true);
        try {
            const input = editorToInput(editor);
            const applied = editor.windowId === null
                ? await createWindow(input)
                : await updateWindow(editor.windowId, input);
            // A failed save keeps the editor open with the user's values
            // intact — the error line below says why, and the same Save
            // button is the retry.
            if (applied) closeEditor();
        } finally {
            setSaving(false);
        }
    }, [closeEditor, createWindow, editor, saving, updateWindow]);

    const commitWorkingHours = useCallback(async () => {
        setWorkTouched(true);
        if (!isOrderedRange(workStartText, workEndText)) return;
        await saveWorkingHours(workStartText, workEndText);
    }, [saveWorkingHours, workEndText, workStartText]);

    const openSystemSettings = useCallback(() => {
        // `Linking` is absent from the test-time react-native shim, and
        // `openSettings` is a no-op on some platforms — never let either
        // crash a screen whose whole job is to stay calm.
        const linking = Linking as Partial<typeof Linking> | undefined;
        void linking?.openSettings?.();
    }, []);

    const mutationErrorCopy = mutationError ? MUTATION_ERROR_COPY[mutationError] : null;

    if (phase === 'loading') {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <View style={styles.centered} testID="tdah-dnd-loading">
                    <ActivityIndicator size="small" color={tc.secondaryText} />
                    <Text style={[styles.centeredText, { color: tc.secondaryText }]}>
                        {tFallback(t, 'tdahDnd.loading', 'Loading your quiet windows…')}
                    </Text>
                </View>
            </SafeAreaView>
        );
    }

    if (phase === 'unconfigured' || phase === 'inactive' || phase === 'error' || phase === 'offline') {
        const message = phase === 'unconfigured'
            ? tFallback(t, 'tdahDnd.needsSync', 'Set up Self-Hosted cloud sync to manage your quiet windows.')
            : phase === 'inactive'
                ? tFallback(t, 'tdahDnd.inactive', 'ADHD mode is off — turn it on to manage your quiet windows.')
                : phase === 'offline'
                    ? tFallback(t, 'tdahDnd.offlineBanner', 'Offline — showing the last loaded state.')
                    : tFallback(t, 'tdahDnd.loadError', 'Could not load your quiet windows from your server.');
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]} edges={['bottom']}>
                <View style={styles.centered} testID={`tdah-dnd-${phase}`}>
                    <Text style={[styles.centeredText, { color: tc.text }]}>{message}</Text>
                    {/* UX-DR5: `unconfigured` has no retry — it can only ever
                        fail until the user configures sync in Settings. */}
                    {phase === 'error' || phase === 'offline' ? (
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={tFallback(t, 'tdahDnd.retry', 'Retry')}
                            onPress={() => void reload()}
                            testID="tdah-dnd-retry"
                        >
                            <Text style={[styles.actionText, { color: tc.tint }]}>
                                {tFallback(t, 'tdahDnd.retry', 'Retry')}
                            </Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]} edges={['bottom']}>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
                {/* Zone 1 — current state, plus the promise that makes DND
                    trustworthy (FR-12: nothing comes back afterwards). */}
                <View style={[styles.section, { backgroundColor: tc.cardBg, borderColor: tc.border }]} testID="tdah-dnd-status">
                    <Text style={[styles.sectionTitle, { color: tc.secondaryText }]}>
                        {tFallback(t, 'tdahDnd.status.title', 'Right now')}
                    </Text>
                    <Text
                        style={[styles.statusValue, { color: activeUntil ? dndColor : tc.text }]}
                        testID="tdah-dnd-status-value"
                    >
                        {activeUntil
                            ? formatI18nTemplate(
                                tFallback(t, 'tdahDnd.status.active', 'Quiet until {time}'),
                                { time: activeUntil },
                            )
                            : tFallback(t, 'tdahDnd.status.idle', 'Not quiet right now — reminders are coming through.')}
                    </Text>
                    <Text style={[styles.promise, { color: tc.secondaryText }]} testID="tdah-dnd-promise">
                        {tFallback(
                            t,
                            'tdahDnd.promise',
                            'During a meeting we stay quiet. What gets suppressed does not come back later — you settle it at night, in the ritual.',
                        )}
                    </Text>
                </View>

                {mutationErrorCopy ? (
                    <View
                        style={[styles.banner, { borderColor: tc.danger, backgroundColor: tc.filterBg }]}
                        testID="tdah-dnd-mutation-error"
                    >
                        <Text style={[styles.bannerText, { color: tc.text }]}>
                            {tFallback(t, mutationErrorCopy.key, mutationErrorCopy.fallback)}
                        </Text>
                    </View>
                ) : null}

                {/* Zone 2 — calendar detection and the permission state. */}
                <View style={[styles.section, { backgroundColor: tc.cardBg, borderColor: tc.border }]} testID="tdah-dnd-calendar">
                    <Text style={[styles.sectionTitle, { color: tc.text }]}>
                        {tFallback(t, 'tdahDnd.calendar.title', 'Calendar detection')}
                    </Text>
                    <Text style={[styles.sectionHint, { color: tc.secondaryText }]}>
                        {tFallback(
                            t,
                            'tdahDnd.calendar.description',
                            'Events marked busy inside your working hours silence reminders on their own.',
                        )}
                    </Text>

                    {calendarSupported ? (
                        <>
                            <View style={styles.toggleRow}>
                                <Text style={[styles.toggleLabel, { color: tc.text }]}>
                                    {tFallback(t, 'tdahDnd.calendar.toggle', 'Detect meetings from my calendar')}
                                </Text>
                                <Switch
                                    accessibilityLabel={tFallback(t, 'tdahDnd.calendar.toggle', 'Detect meetings from my calendar')}
                                    onValueChange={(next: boolean) => { void setCalendarEnabled(next); }}
                                    testID="tdah-dnd-calendar-toggle"
                                    value={settings.calendarEnabled}
                                />
                            </View>

                            {permission !== 'granted' ? (
                                <View testID="tdah-dnd-calendar-permission">
                                    {/* Copy sin culpa (doc 06): a denied
                                        permission is a legitimate choice that
                                        degrades to manual windows, never a
                                        user error. */}
                                    <Text style={[styles.sectionHint, { color: tc.secondaryText }]}>
                                        {tFallback(
                                            t,
                                            'tdahDnd.calendar.permissionDenied',
                                            'Calendar access is off, so only your manual windows apply. You can turn it on whenever you want.',
                                        )}
                                    </Text>
                                    <TouchableOpacity
                                        accessibilityRole="button"
                                        onPress={() => { void requestCalendarPermission(); }}
                                        testID="tdah-dnd-calendar-permission-cta"
                                    >
                                        <Text style={[styles.actionText, { color: tc.tint }]}>
                                            {tFallback(t, 'tdahDnd.calendar.permissionCta', 'Allow calendar access')}
                                        </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        accessibilityRole="button"
                                        onPress={openSystemSettings}
                                        testID="tdah-dnd-calendar-permission-settings"
                                    >
                                        <Text style={[styles.actionText, { color: tc.tint }]}>
                                            {tFallback(t, 'tdahDnd.calendar.permissionSettings', 'Open system settings')}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            ) : null}

                            {calendarSyncing ? (
                                <Text style={[styles.sectionHint, { color: tc.secondaryText }]} testID="tdah-dnd-calendar-syncing">
                                    {tFallback(t, 'tdahDnd.calendar.syncing', 'Reading your calendar…')}
                                </Text>
                            ) : null}

                            {settings.calendarEnabled && permission === 'granted' ? (
                                <Text style={[styles.sectionHint, { color: tc.secondaryText }]} testID="tdah-dnd-calendar-detected">
                                    {calendarWindows.length > 0
                                        ? formatI18nTemplate(
                                            tFallback(t, 'tdahDnd.calendar.detected', '{count} windows detected from your calendar'),
                                            { count: String(calendarWindows.length) },
                                        )
                                        : tFallback(t, 'tdahDnd.calendar.detectedEmpty', 'No busy events in your working hours right now.')}
                                </Text>
                            ) : null}

                            <Text style={[styles.sectionHint, { color: tc.secondaryText }]}>
                                {tFallback(
                                    t,
                                    'tdahDnd.calendar.readOnly',
                                    'Windows detected from your calendar refresh on their own — change them in your calendar.',
                                )}
                            </Text>
                        </>
                    ) : (
                        // Permanent state on a platform that never reads
                        // calendars (doc 06's PWA note), not a degradation
                        // the user can undo from here.
                        <Text style={[styles.sectionHint, { color: tc.secondaryText }]} testID="tdah-dnd-calendar-unsupported">
                            {tFallback(
                                t,
                                'tdahDnd.calendar.unsupported',
                                'This app does not read calendars. Here you manage your manual windows; meeting detection lives on your phone.',
                            )}
                        </Text>
                    )}
                </View>

                {/* Zone 3 — the working hours that bound the detection. */}
                <View style={[styles.section, { backgroundColor: tc.cardBg, borderColor: tc.border }]} testID="tdah-dnd-work">
                    <Text style={[styles.sectionTitle, { color: tc.text }]}>
                        {tFallback(t, 'tdahDnd.work.title', 'Working hours')}
                    </Text>
                    <Text style={[styles.sectionHint, { color: tc.secondaryText }]}>
                        {tFallback(t, 'tdahDnd.work.hint', 'Calendar detection only looks inside this range.')}
                    </Text>
                    <View style={styles.fieldRow}>
                        <Text style={[styles.fieldLabel, { color: tc.secondaryText }]}>
                            {tFallback(t, 'tdahDnd.work.start', 'From')}
                        </Text>
                        <TextInput
                            accessibilityLabel={tFallback(t, 'tdahDnd.work.start', 'From')}
                            autoCapitalize="none"
                            autoCorrect={false}
                            onChangeText={(next: string) => { setWorkStartText(next); setWorkTouched(true); }}
                            onEndEditing={() => { void commitWorkingHours(); }}
                            placeholder="09:00"
                            placeholderTextColor={tc.secondaryText}
                            style={[styles.input, { borderColor: tc.border, color: tc.text, backgroundColor: tc.inputBg }]}
                            testID="tdah-dnd-work-start"
                            value={workStartText}
                        />
                        <Text style={[styles.fieldLabel, { color: tc.secondaryText }]}>
                            {tFallback(t, 'tdahDnd.work.end', 'To')}
                        </Text>
                        <TextInput
                            accessibilityLabel={tFallback(t, 'tdahDnd.work.end', 'To')}
                            autoCapitalize="none"
                            autoCorrect={false}
                            onChangeText={(next: string) => { setWorkEndText(next); setWorkTouched(true); }}
                            onEndEditing={() => { void commitWorkingHours(); }}
                            placeholder="18:00"
                            placeholderTextColor={tc.secondaryText}
                            style={[styles.input, { borderColor: tc.border, color: tc.text, backgroundColor: tc.inputBg }]}
                            testID="tdah-dnd-work-end"
                            value={workEndText}
                        />
                    </View>
                    {workTouched && !isOrderedRange(workStartText, workEndText) ? (
                        <Text style={[styles.errorText, { color: tc.danger }]} testID="tdah-dnd-work-invalid">
                            {tFallback(t, 'tdahDnd.work.invalid', 'The start has to come before the end.')}
                        </Text>
                    ) : null}
                </View>

                {/* Zone 4 — the manual windows, plus the read-only rows the
                    calendar detection materialized. */}
                <View style={[styles.section, { backgroundColor: tc.cardBg, borderColor: tc.border }]} testID="tdah-dnd-windows">
                    <Text style={[styles.sectionTitle, { color: tc.text }]}>
                        {tFallback(t, 'tdahDnd.windows.title', 'Manual windows')}
                    </Text>

                    {manualWindows.length === 0 ? (
                        <Text style={[styles.sectionHint, { color: tc.secondaryText }]} testID="tdah-dnd-windows-empty">
                            {tFallback(
                                t,
                                'tdahDnd.windows.empty',
                                'No manual windows yet. Add one for the meetings that come back every week.',
                            )}
                        </Text>
                    ) : null}

                    {manualWindows.map((window) => (
                        <View
                            key={window.id}
                            style={[styles.windowRow, { borderColor: tc.border }]}
                            testID={`tdah-dnd-window-${window.id}`}
                        >
                            <Text style={[styles.windowTitle, { color: tc.text }]}>
                                {window.label ?? describeWindow(window)}
                            </Text>
                            {/* The meta line REPEATS the title verbatim when
                                the window has no label (the title already
                                falls back to `describeWindow`), so it is only
                                rendered when there is a label for it to
                                explain. */}
                            {window.label !== null ? (
                                <Text style={[styles.windowMeta, { color: tc.secondaryText }]}>
                                    {describeWindow(window)}
                                </Text>
                            ) : null}
                            <View style={styles.windowActions}>
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    onPress={() => openEditEditor(window)}
                                    testID={`tdah-dnd-window-${window.id}-edit`}
                                >
                                    <Text style={[styles.actionText, { color: tc.tint }]}>
                                        {tFallback(t, 'tdahDnd.windows.edit', 'Edit')}
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    onPress={() => { void deleteWindow(window.id); }}
                                    testID={`tdah-dnd-window-${window.id}-delete`}
                                >
                                    <Text style={[styles.actionText, { color: tc.danger }]}>
                                        {tFallback(t, 'tdahDnd.windows.delete', 'Delete')}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))}

                    {calendarWindows.map((window) => (
                        <View
                            key={window.id}
                            style={[styles.windowRow, { borderColor: tc.border }]}
                            testID={`tdah-dnd-window-${window.id}`}
                        >
                            <Text style={[styles.windowTitle, { color: tc.text }]}>
                                {window.label ?? describeWindow(window)}
                            </Text>
                            {/* The meta line REPEATS the title verbatim when
                                the window has no label (the title already
                                falls back to `describeWindow`), so it is only
                                rendered when there is a label for it to
                                explain. */}
                            {window.label !== null ? (
                                <Text style={[styles.windowMeta, { color: tc.secondaryText }]}>
                                    {describeWindow(window)}
                                </Text>
                            ) : null}
                            {/* No edit/delete at all: the server answers 409
                                TDAH_DND_READ_ONLY on a calendar row, so the
                                affordance would only ever fail. */}
                            <Text
                                style={[styles.windowMeta, { color: dndColor }]}
                                testID={`tdah-dnd-window-${window.id}-source`}
                            >
                                {tFallback(t, 'tdahDnd.windows.sourceCalendar', 'From your calendar')}
                            </Text>
                        </View>
                    ))}

                    {editor === null ? (
                        <TouchableOpacity
                            accessibilityRole="button"
                            onPress={openCreateEditor}
                            style={[styles.primaryButton, { backgroundColor: filledButton.backgroundColor }]}
                            testID="tdah-dnd-add-window"
                        >
                            <Text style={[styles.primaryButtonText, { color: filledButton.textColor }]}>
                                {tFallback(t, 'tdahDnd.windows.add', 'Add a window')}
                            </Text>
                        </TouchableOpacity>
                    ) : null}
                </View>

                {editor !== null ? (
                    <View style={[styles.section, { backgroundColor: tc.cardBg, borderColor: tc.border }]} testID="tdah-dnd-editor">
                        <Text style={[styles.sectionTitle, { color: tc.text }]}>
                            {editor.windowId === null
                                ? tFallback(t, 'tdahDnd.editor.addTitle', 'New quiet window')
                                : tFallback(t, 'tdahDnd.editor.editTitle', 'Edit quiet window')}
                        </Text>

                        <Text style={[styles.fieldLabel, { color: tc.secondaryText }]}>
                            {tFallback(t, 'tdahDnd.editor.kind', 'Repeats')}
                        </Text>
                        <View style={styles.dayChipRow}>
                            {(['weekly', 'once'] as const).map((kind) => (
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: editor.kind === kind }}
                                    key={kind}
                                    onPress={() => setEditor((current) => (current ? { ...current, kind } : current))}
                                    style={[
                                        styles.dayChip,
                                        {
                                            borderColor: editor.kind === kind ? tc.tint : tc.border,
                                            backgroundColor: editor.kind === kind ? tc.filterBg : 'transparent',
                                        },
                                    ]}
                                    testID={`tdah-dnd-editor-kind-${kind}`}
                                >
                                    <Text style={[styles.dayChipText, { color: editor.kind === kind ? tc.tint : tc.secondaryText }]}>
                                        {kind === 'weekly'
                                            ? tFallback(t, 'tdahDnd.editor.kindWeekly', 'Every week')
                                            : tFallback(t, 'tdahDnd.editor.kindOnce', 'One-off')}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {editor.kind === 'weekly' ? (
                            <>
                                <Text style={[styles.fieldLabel, { color: tc.secondaryText }]}>
                                    {tFallback(t, 'tdahDnd.editor.days', 'Days')}
                                </Text>
                                <View style={styles.dayChipRow}>
                                    {WEEKDAYS.map((weekday) => {
                                        const selected = editor.weekdays.includes(weekday);
                                        return (
                                            <TouchableOpacity
                                                accessibilityRole="button"
                                                accessibilityState={{ selected }}
                                                key={weekday}
                                                onPress={() => toggleEditorDay(weekday)}
                                                style={[
                                                    styles.dayChip,
                                                    {
                                                        borderColor: selected ? tc.tint : tc.border,
                                                        backgroundColor: selected ? tc.filterBg : 'transparent',
                                                    },
                                                ]}
                                                testID={`tdah-dnd-editor-day-${weekday}`}
                                            >
                                                <Text style={[styles.dayChipText, { color: selected ? tc.tint : tc.secondaryText }]}>
                                                    {weekdayLabel(weekday, language)}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </>
                        ) : (
                            <View style={styles.fieldRow}>
                                <Text style={[styles.fieldLabel, { color: tc.secondaryText }]}>
                                    {tFallback(t, 'tdahDnd.editor.date', 'Date')}
                                </Text>
                                <TextInput
                                    accessibilityLabel={tFallback(t, 'tdahDnd.editor.date', 'Date')}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    onChangeText={(next: string) => setEditor((current) => (current ? { ...current, date: next } : current))}
                                    placeholder="2026-09-01"
                                    placeholderTextColor={tc.secondaryText}
                                    style={[styles.input, { borderColor: tc.border, color: tc.text, backgroundColor: tc.inputBg }]}
                                    testID="tdah-dnd-editor-date"
                                    value={editor.date}
                                />
                            </View>
                        )}

                        <View style={styles.fieldRow}>
                            <Text style={[styles.fieldLabel, { color: tc.secondaryText }]}>
                                {tFallback(t, 'tdahDnd.editor.start', 'Starts')}
                            </Text>
                            <TextInput
                                accessibilityLabel={tFallback(t, 'tdahDnd.editor.start', 'Starts')}
                                autoCapitalize="none"
                                autoCorrect={false}
                                onChangeText={(next: string) => setEditor((current) => (current ? { ...current, startTime: next } : current))}
                                placeholder="10:00"
                                placeholderTextColor={tc.secondaryText}
                                style={[styles.input, { borderColor: tc.border, color: tc.text, backgroundColor: tc.inputBg }]}
                                testID="tdah-dnd-editor-start"
                                value={editor.startTime}
                            />
                            <Text style={[styles.fieldLabel, { color: tc.secondaryText }]}>
                                {tFallback(t, 'tdahDnd.editor.end', 'Ends')}
                            </Text>
                            <TextInput
                                accessibilityLabel={tFallback(t, 'tdahDnd.editor.end', 'Ends')}
                                autoCapitalize="none"
                                autoCorrect={false}
                                onChangeText={(next: string) => setEditor((current) => (current ? { ...current, endTime: next } : current))}
                                placeholder="11:00"
                                placeholderTextColor={tc.secondaryText}
                                style={[styles.input, { borderColor: tc.border, color: tc.text, backgroundColor: tc.inputBg }]}
                                testID="tdah-dnd-editor-end"
                                value={editor.endTime}
                            />
                        </View>

                        <TextInput
                            accessibilityLabel={tFallback(t, 'tdahDnd.editor.label', 'Name (optional)')}
                            onChangeText={(next: string) => setEditor((current) => (current ? { ...current, label: next } : current))}
                            placeholder={tFallback(t, 'tdahDnd.editor.labelPlaceholder', 'Leaders meeting')}
                            placeholderTextColor={tc.secondaryText}
                            style={[styles.inputWide, { borderColor: tc.border, color: tc.text, backgroundColor: tc.inputBg }]}
                            testID="tdah-dnd-editor-label"
                            value={editor.label}
                        />

                        {editorTouched && !isEditorValid(editor) ? (
                            <Text style={[styles.errorText, { color: tc.danger }]} testID="tdah-dnd-editor-invalid">
                                {tFallback(t, 'tdahDnd.editor.invalid', 'Check the days, the date and the times.')}
                            </Text>
                        ) : null}

                        <View style={styles.editorActions}>
                            <TouchableOpacity
                                accessibilityRole="button"
                                disabled={saving}
                                onPress={() => { void submitEditor(); }}
                                style={[styles.primaryButton, { backgroundColor: filledButton.backgroundColor, opacity: saving ? 0.7 : 1 }]}
                                testID="tdah-dnd-editor-save"
                            >
                                <Text style={[styles.primaryButtonText, { color: filledButton.textColor }]}>
                                    {saving
                                        ? tFallback(t, 'tdahDnd.editor.saving', 'Saving…')
                                        : tFallback(t, 'tdahDnd.editor.save', 'Save')}
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                accessibilityRole="button"
                                onPress={closeEditor}
                                style={styles.primaryButton}
                                testID="tdah-dnd-editor-cancel"
                            >
                                <Text style={[styles.primaryButtonText, { color: tc.secondaryText }]}>
                                    {tFallback(t, 'tdahDnd.editor.cancel', 'Cancel')}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : null}
            </ScrollView>
        </SafeAreaView>
    );
}
