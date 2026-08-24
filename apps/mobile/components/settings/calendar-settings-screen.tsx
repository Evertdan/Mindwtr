import React, { useCallback, useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
    EXTERNAL_CALENDAR_COLORS,
    generateUUID,
    hasExplicitExternalCalendarColor,
    normalizeExternalCalendarColor,
    shallow,
    tFallback,
    themeExternalCalendarDisplayColor,
    type ExternalCalendarSubscription,
    useTaskStore,
} from '@mindwtr/core';

import {
    fetchExternalCalendarEvents,
    getExternalCalendars,
    getSystemCalendarPermissionStatus,
    getSystemCalendars,
    getSystemCalendarSettings,
    requestSystemCalendarPermission,
    saveExternalCalendars,
    saveSystemCalendarSettings,
    type SystemCalendarInfo,
    type SystemCalendarPermissionStatus,
} from '@/lib/external-calendar';
import {
    CALENDAR_PUSH_COLOR_OPTIONS,
    deleteMindwtrCalendar,
    getCalendarPushColor,
    getCalendarPushEnabled,
    getCalendarPushTargetCalendarId,
    getCalendarPushTargetCalendars,
    getCalendarWritePermissionStatus,
    requestCalendarWritePermission,
    runFullCalendarSync,
    setCalendarPushEnabled,
    setCalendarPushTargetCalendarId,
    startCalendarPushSync,
    stopCalendarPushSync,
    updateMindwtrCalendarColor,
    type CalendarPushTargetCalendar,
} from '@/lib/calendar-push-sync';
import { useTheme } from '@/contexts/theme-context';
import { useToast } from '@/contexts/toast-context';
import { maskCalendarUrl } from '@/lib/settings-utils';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { CompactText } from '@/components/compact-text';

import { useSettingsLocalization, useSettingsScrollContent } from './settings.hooks';
import { SettingsGuideLink, SettingsTopBar } from './settings.shell';
import { styles } from './settings.styles';

const CALENDAR_INTEGRATION_GUIDE_URL = 'https://docs.mindwtr.app/use/calendar-integration';

type CollapsibleSettingHeaderProps = {
    title: string;
    description: string;
    open: boolean;
    onToggle: () => void;
    textColor: string;
    secondaryTextColor: string;
    rightControl: React.ReactNode;
};

function CollapsibleSettingHeader({
    title,
    description,
    open,
    onToggle,
    textColor,
    secondaryTextColor,
    rightControl,
}: CollapsibleSettingHeaderProps) {
    return (
        <View style={styles.settingRow}>
            <TouchableOpacity
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', marginRight: 12 }}
                onPress={onToggle}
                activeOpacity={0.7}
            >
                <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={[styles.settingLabel, { color: textColor }]}>{title}</Text>
                    <Text style={[styles.settingDescription, { color: secondaryTextColor }]}>{description}</Text>
                </View>
                <Text style={[styles.chevron, { color: secondaryTextColor }]}>{open ? '▾' : '▸'}</Text>
            </TouchableOpacity>
            {rightControl}
        </View>
    );
}

export function CalendarSettingsScreen() {
    const tc = useThemeColors();
    const { themePreset } = useTheme();
    const filledButton = useFilledButtonColors();
    const { showToast } = useToast();
    const { isChineseLanguage, tr, t } = useSettingsLocalization();
    const { settings, updateSettings } = useTaskStore((state) => ({
        settings: state.settings,
        updateSettings: state.updateSettings,
    }), shallow);
    const scrollContentStyle = useSettingsScrollContent();
    const [externalCalendars, setExternalCalendars] = useState<ExternalCalendarSubscription[]>([]);
    const [newCalendarName, setNewCalendarName] = useState('');
    const [newCalendarUrl, setNewCalendarUrl] = useState('');
    const [systemCalendarEnabled, setSystemCalendarEnabled] = useState(false);
    const [systemCalendarSelectAll, setSystemCalendarSelectAll] = useState(true);
    const [systemCalendarSelectedIds, setSystemCalendarSelectedIds] = useState<string[]>([]);
    const [systemCalendarPermission, setSystemCalendarPermission] = useState<SystemCalendarPermissionStatus>('undetermined');
    const [systemCalendars, setSystemCalendars] = useState<SystemCalendarInfo[]>([]);
    const [isSystemCalendarLoading, setIsSystemCalendarLoading] = useState(false);
    const [systemCalendarOpen, setSystemCalendarOpen] = useState(false);

    // Push-to-calendar Estado
    const [calendarPushEnabled, setCalendarPushEnabledState] = useState(false);
    const [calendarPushPermission, setCalendarPushPermission] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');
    const [calendarPushTargetCalendarId, setCalendarPushTargetCalendarIdState] = useState<string | null>(null);
    const [calendarPushTargets, setCalendarPushTargets] = useState<CalendarPushTargetCalendar[]>([]);
    const [calendarPushColor, setCalendarPushColorState] = useState('#3B82F6');
    const [isCalendarPushTargetLoading, setIsCalendarPushTargetLoading] = useState(false);
    const [isDeletingMindwtrCalendar, setIsDeletingMindwtrCalendar] = useState(false);
    const [calendarPushOpen, setCalendarPushOpen] = useState(false);

    const loadCalendarPushTargetState = useCallback(async () => {
        setIsCalendarPushTargetLoading(true);
        try {
            const [targetId, targets, color] = await Promise.all([
                getCalendarPushTargetCalendarId(),
                getCalendarPushTargetCalendars(),
                getCalendarPushColor(),
            ]);
            setCalendarPushTargetCalendarIdState(targetId);
            setCalendarPushTargets(targets);
            setCalendarPushColorState(color);
        } catch (error) {
            console.error(error);
            showToast({
                title: tr('settings.syncMobile.error'),
                message: tr('settings.calendarMobile.failedToLoadWritableCalendars'),
                tone: 'warning',
                durationMs: 4200,
            });
        } finally {
            setIsCalendarPushTargetLoading(false);
        }
    }, [tr, showToast]);

    useEffect(() => {
        void (async () => {
            const [enabled, permission] = await Promise.all([
                getCalendarPushEnabled(),
                getCalendarWritePermissionStatus(),
            ]);
            setCalendarPushEnabledState(enabled);
            setCalendarPushPermission(permission);
            if (permission === 'granted') {
                await loadCalendarPushTargetState();
            } else {
                setCalendarPushTargetCalendarIdState(await getCalendarPushTargetCalendarId());
            }
        })();
    }, [loadCalendarPushTargetState]);

    const handleToggleCalendarPush = async (enabled: boolean) => {
        if (enabled) {
            const granted = calendarPushPermission === 'granted'
                ? true
                : await requestCalendarWritePermission();
            if (!granted) {
                setCalendarPushPermission('denied');
                showToast({
                    title: tr('settings.calendarMobile.permissionRequired'),
                    message: tr('settings.calendarMobile.calendarAccessIsRequiredToPushTasksToYourCalendar'),
                    tone: 'warning',
                    durationMs: 4200,
                });
                return;
            }
            setCalendarPushPermission('granted');
            await loadCalendarPushTargetState();
            await setCalendarPushEnabled(true);
            setCalendarPushEnabledState(true);
            setCalendarPushOpen(true);
            startCalendarPushSync();
            void runFullCalendarSync();
        } else {
            await setCalendarPushEnabled(false);
            setCalendarPushEnabledState(false);
            stopCalendarPushSync();
            showToast({
                title: tr('settings.calendarMobile.calendarSyncDisabled'),
                message: tr('settings.calendarMobile.tasksWillNoLongerBePushedToYourCalendarExisting'),
                tone: 'info',
                durationMs: 4200,
            });
        }
    };

    const handleSelectCalendarPushTarget = async (calendarId: string | null) => {
        if (calendarId === calendarPushTargetCalendarId) return;
        await setCalendarPushTargetCalendarId(calendarId);
        setCalendarPushTargetCalendarIdState(calendarId);
        if (calendarPushEnabled) {
            void runFullCalendarSync();
        }
        showToast({
            title: tr('settings.calendarMobile.calendarTargetUpdated'),
            message: tr('settings.calendarMobile.dueDateTasksWillBeWrittenToTheSelectedCalendar'),
            tone: 'success',
            durationMs: 3200,
        });
    };

    const handleSelectCalendarPushColor = async (color: string) => {
        const updated = await updateMindwtrCalendarColor(color);
        setCalendarPushColorState(color);
        await loadCalendarPushTargetState();
        showToast({
            title: tFallback(t, 'settings.calendarMobile.calendarColorUpdated', 'Calendar color updated'),
            message: updated
                ? tFallback(t, 'settings.calendarMobile.calendarColorUpdatedMessage', 'Mindwtr calendar color was updated.')
                : tFallback(t, 'settings.calendarMobile.calendarColorSavedMessage', 'Mindwtr will use this color when it creates the calendar.'),
            tone: 'success',
            durationMs: 3000,
        });
    };

    const performDeleteMindwtrCalendar = useCallback(async () => {
        if (isDeletingMindwtrCalendar) return;
        setIsDeletingMindwtrCalendar(true);
        try {
            // Disable push sync first so the calendar is not recreated on the next
            // startup or task change.
            await setCalendarPushEnabled(false);
            setCalendarPushEnabledState(false);
            stopCalendarPushSync();
            await deleteMindwtrCalendar();
            setCalendarPushTargetCalendarIdState(null);
            await loadCalendarPushTargetState();
            showToast({
                title: tr('settings.calendarMobile.calendarDeleted'),
                message: tr('settings.calendarMobile.theMindwtrCalendarAndAllItsEventsHaveBeenRemoved'),
                tone: 'success',
                durationMs: 3500,
            });
        } catch (error) {
            console.error(error);
            showToast({
                title: tr('settings.syncMobile.error'),
                message: tr('settings.calendarMobile.failedToLoadWritableCalendars'),
                tone: 'warning',
                durationMs: 4200,
            });
        } finally {
            setIsDeletingMindwtrCalendar(false);
        }
    }, [isDeletingMindwtrCalendar, loadCalendarPushTargetState, tr, showToast]);

    const handleDeleteMindwtrCalendar = useCallback(() => {
        if (isDeletingMindwtrCalendar) return;
        Alert.alert(
            tr('settings.calendarMobile.deleteMindwtrCalendar'),
            tr('settings.calendarMobile.removeTheDedicatedCalendarAndItsPushedEventsFromThis'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('common.delete'),
                    style: 'destructive',
                    onPress: () => {
                        void performDeleteMindwtrCalendar();
                    },
                },
            ],
        );
    }, [isDeletingMindwtrCalendar, performDeleteMindwtrCalendar, t, tr]);

    const loadSystemCalendarState = useCallback(async (requestAccess = false) => {
        setIsSystemCalendarLoading(true);
        try {
            const stored = await getSystemCalendarSettings();
            setSystemCalendarEnabled(stored.enabled);
            setSystemCalendarSelectAll(stored.selectAll);
            setSystemCalendarSelectedIds(stored.selectedCalendarIds);

            const permission = requestAccess
                ? await requestSystemCalendarPermission()
                : await getSystemCalendarPermissionStatus();
            setSystemCalendarPermission(permission);

            if (permission !== 'granted') {
                setSystemCalendars([]);
                return;
            }

            const calendars = await getSystemCalendars();
            setSystemCalendars(calendars);
            if (stored.selectAll) return;

            const validIds = new Set(calendars.map((calendar) => calendar.id));
            const filteredSelection = stored.selectedCalendarIds.filter((id) => validIds.has(id));
            if (
                filteredSelection.length === stored.selectedCalendarIds.length &&
                filteredSelection.every((id, index) => id === stored.selectedCalendarIds[index])
            ) {
                return;
            }

            setSystemCalendarSelectedIds(filteredSelection);
            await saveSystemCalendarSettings({
                enabled: stored.enabled,
                selectAll: false,
                selectedCalendarIds: filteredSelection,
            });
        } catch (error) {
            console.error(error);
            showToast({
                title: tr('settings.syncMobile.error'),
                message: tr('settings.calendarMobile.failedToLoadDeviceCalendarSettings'),
                tone: 'warning',
                durationMs: 4200,
            });
        } finally {
            setIsSystemCalendarLoading(false);
        }
    }, [tr, showToast]);

    useEffect(() => {
        void loadSystemCalendarState();
    }, [loadSystemCalendarState]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const stored = await getExternalCalendars();
                if (cancelled) return;
                if (Array.isArray(settings.externalCalendars)) {
                    setExternalCalendars(settings.externalCalendars);
                    if (settings.externalCalendars.length || stored.length) {
                        await saveExternalCalendars(settings.externalCalendars);
                    }
                    return;
                }
                setExternalCalendars(stored);
            } catch (error) {
                console.error(error);
                showToast({
                    title: tr('settings.syncMobile.error'),
                    message: tr('settings.calendarMobile.failedToLoadSavedCalendars'),
                    tone: 'warning',
                    durationMs: 4200,
                });
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [tr, settings.externalCalendars, showToast]);

    const persistSystemCalendarState = async (next: {
        enabled?: boolean;
        selectAll?: boolean;
        selectedCalendarIds?: string[];
    }) => {
        const payload = {
            enabled: next.enabled ?? systemCalendarEnabled,
            selectAll: next.selectAll ?? systemCalendarSelectAll,
            selectedCalendarIds: next.selectedCalendarIds ?? systemCalendarSelectedIds,
        };
        setSystemCalendarEnabled(payload.enabled);
        setSystemCalendarSelectAll(payload.selectAll);
        setSystemCalendarSelectedIds(payload.selectedCalendarIds);
        await saveSystemCalendarSettings(payload);
    };

    const handleToggleSystemCalendarEnabled = async (enabled: boolean) => {
        await persistSystemCalendarState({ enabled });
        if (enabled) setSystemCalendarOpen(true);
        if (enabled && systemCalendarPermission !== 'granted') {
            await loadSystemCalendarState(true);
        }
    };

    const handleToggleSystemCalendarSelection = async (calendarId: string, enabled: boolean) => {
        const allIds = systemCalendars.map((calendar) => calendar.id);
        if (allIds.length === 0) return;

        const currentSelection = systemCalendarSelectAll
            ? allIds
            : Array.from(new Set(systemCalendarSelectedIds.filter((id) => allIds.includes(id))));
        const nextSelection = enabled
            ? Array.from(new Set([...currentSelection, calendarId]))
            : currentSelection.filter((id) => id !== calendarId);
        const selectAll = nextSelection.length === allIds.length;

        await persistSystemCalendarState({
            selectAll,
            selectedCalendarIds: selectAll ? [] : nextSelection,
        });
    };

    const handleAddCalendar = async () => {
        const url = newCalendarUrl.trim();
        if (!url) return;

        const name = (newCalendarName.trim() || tr('nav.calendar')).trim();
        const id = generateUUID();
        // No Color yet: an unset Color means "no explicit pick", so a feed
        // hint or the deterministic hash fallback can still apply (#974).
        const next: ExternalCalendarSubscription[] = [
            ...externalCalendars,
            { id, name, url, enabled: true },
        ];

        setExternalCalendars(next);
        setNewCalendarName('');
        setNewCalendarUrl('');
        await saveExternalCalendars(next);
        await updateSettings({ externalCalendars: next });
    };

    const handleChooseLocalCalendar = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ['text/calendar', 'application/ics', 'application/octet-stream', '*/*'],
                copyToCacheDirectory: false,
            });
            if (result.canceled) return;
            const asset = result.assets[0];
            if (!asset?.uri) return;

            const fileName = (asset.name || asset.uri.split('/').pop() || '').trim();
            const inferredName = fileName.replace(/\.ics$/iu, '').trim();
            const name = (newCalendarName.trim() || inferredName || tr('nav.calendar')).trim();
            const id = generateUUID();
            const next: ExternalCalendarSubscription[] = [
                ...externalCalendars,
                { id, name, url: asset.uri.trim(), enabled: true },
            ];

            setExternalCalendars(next);
            setNewCalendarName('');
            setNewCalendarUrl('');
            await saveExternalCalendars(next);
            await updateSettings({ externalCalendars: next });
            showToast({
                title: tr('settings.calendarMobile.localIcsFileAdded'),
                message: tr('settings.calendarMobile.localIcsFilesAreReadOnly'),
                tone: 'success',
                durationMs: 3500,
            });
        } catch (error) {
            console.error(error);
            showToast({
                title: tr('settings.syncMobile.error'),
                message: tr('settings.calendarMobile.failedToLoadSavedCalendars'),
                tone: 'warning',
                durationMs: 4200,
            });
        }
    };

    const handleToggleCalendar = async (id: string, enabled: boolean) => {
        const next = externalCalendars.map((c) => (c.id === id ? { ...c, enabled } : c));
        setExternalCalendars(next);
        await saveExternalCalendars(next);
        await updateSettings({ externalCalendars: next });
    };

    const handleCalendarColorChange = async (id: string, color: string | undefined) => {
        // `undefined` is the Auto swatch: drop the pick so the feed hint or
        // the assigned default applies again (#974).
        const normalized = color === undefined ? undefined : normalizeExternalCalendarColor(color);
        if (color !== undefined && !normalized) return;
        const next = externalCalendars.map((c) => {
            if (c.id !== id) return c;
            if (normalized) return { ...c, color: normalized };
            const { color: _cleared, ...rest } = c;
            return rest;
        });
        setExternalCalendars(next);
        await saveExternalCalendars(next);
        await updateSettings({ externalCalendars: next });
    };

    const handleRemoveCalendar = async (id: string) => {
        const next = externalCalendars.filter((c) => c.id !== id);
        setExternalCalendars(next);
        await saveExternalCalendars(next);
        await updateSettings({ externalCalendars: next });
    };

    const handleTestFetch = async () => {
        try {
            const now = new Date();
            const rangeStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
            const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            const { events } = await fetchExternalCalendarEvents(rangeStart, rangeEnd);
            showToast({
                title: tr('common.success'),
                message: isChineseLanguage ? `已加载 ${events.length} 个日程` : `Loaded ${events.length} events`,
                tone: 'success',
            });
        } catch (error) {
            console.error(error);
            showToast({
                title: tr('settings.syncMobile.error'),
                message: tr('settings.calendarMobile.failedToLoadEvents'),
                tone: 'warning',
            });
        }
    };

    const selectedSystemCalendarSet = new Set(systemCalendarSelectedIds);
    const selectedCalendarPushTarget = calendarPushTargetCalendarId
        ? calendarPushTargets.find((calendar) => calendar.id === calendarPushTargetCalendarId)
        : null;
    const selectedSharedAccountCalendarForPush = Boolean(
        selectedCalendarPushTarget
        && !selectedCalendarPushTarget.isMindwtrDedicated
        && !selectedCalendarPushTarget.isLocalOnly
    );
    const selectedLocalCalendarForPush = calendarPushTargetCalendarId === null || Boolean(selectedCalendarPushTarget?.isLocalOnly);
    const selectedManagedMindwtrCalendarForPush = calendarPushTargetCalendarId === null
        || selectedCalendarPushTarget?.isMindwtrManaged === true;
    const hasDedicatedAccountCalendarForPush = calendarPushTargets.some((calendar) =>
        calendar.isMindwtrDedicated && !calendar.isLocalOnly
    );
    const getCalendarPushTargetDescription = (calendar: CalendarPushTargetCalendar): string => {
        const kind = calendar.isMindwtrDedicated
            ? calendar.isLocalOnly
                ? tr('settings.calendarMobile.dedicatedLocalCalendar')
                : tr('settings.calendarMobile.dedicatedAccountCalendar')
            : calendar.isLocalOnly
                ? tr('settings.calendarMobile.sharedLocalCalendar')
                : tr('settings.calendarMobile.sharedAccountCalendar');
        return calendar.sourceName ? `${kind} · ${calendar.sourceName}` : kind;
    };
    const defaultLocalTargetOption = {
        id: null as string | null,
        name: tr('settings.calendarMobile.mindwtrCalendar'),
        description: tr('settings.calendarMobile.dedicatedLocalCalendar'),
        color: calendarPushColor,
    };
    const calendarPushTargetOptions: Array<{
        id: string | null;
        name: string;
        description: string;
        color?: string;
    }> = [
        ...(!hasDedicatedAccountCalendarForPush || calendarPushTargetCalendarId === null
            ? [defaultLocalTargetOption]
            : []),
        ...calendarPushTargets
            .filter((calendar) => {
                if (calendar.isMindwtrManaged && calendar.id !== calendarPushTargetCalendarId) return false;
                if (
                    hasDedicatedAccountCalendarForPush
                    && calendar.isMindwtrDedicated
                    && calendar.isLocalOnly
                    && calendar.id !== calendarPushTargetCalendarId
                ) {
                    return false;
                }
                return true;
            })
            .map((calendar) => ({
                id: calendar.id as string | null,
                name: calendar.name,
                description: getCalendarPushTargetDescription(calendar),
                color: calendar.color,
            })),
    ];

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]} edges={['bottom']}>
            <SettingsTopBar title={t('settings.calendar')} />
            <ScrollView style={styles.scrollView} contentContainerStyle={scrollContentStyle}>
                {/* Push tasks to calendar */}
                <View style={[styles.settingCard, { backgroundColor: tc.cardBg, marginBottom: 16 }]}>
                    <CollapsibleSettingHeader
                        title={tr('settings.calendarMobile.pushTasksToCalendar')}
                        description={tr('settings.calendarMobile.scheduledTasksAndTasksWithDueDatesAreAddedTo')}
                        open={calendarPushOpen}
                        onToggle={() => setCalendarPushOpen((open) => !open)}
                        textColor={tc.text}
                        secondaryTextColor={tc.secondaryText}
                        rightControl={(
                            <Switch
                                value={calendarPushEnabled}
                                onValueChange={(v) => void handleToggleCalendarPush(v)}
                                trackColor={{ false: '#767577', true: '#3B82F6' }}
                            />
                        )}
                    />

                    {calendarPushOpen && calendarPushEnabled && calendarPushPermission === 'denied' && (
                        <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: tc.border }}>
                            <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                {tr('settings.calendarMobile.calendarAccessWasDeniedPleaseGrantAccessInSettings')}
                            </Text>
                        </View>
                    )}

                    {calendarPushOpen && calendarPushEnabled && calendarPushPermission === 'granted' && (
                        <View style={{ borderTopWidth: 1, borderTopColor: tc.border }}>
                            <View style={styles.settingRowColumn}>
                                <Text style={[styles.settingLabel, { color: tc.text }]}>
                                    {tr('settings.calendarMobile.syncTarget')}
                                </Text>
                                <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                    {tr('settings.calendarMobile.chooseAnAccountCalendarIfYourCalendarAppHidesLocal')}
                                </Text>
                                {selectedLocalCalendarForPush && (
                                    <Text style={[styles.settingDescription, { color: tc.secondaryText, marginTop: 8 }]}>
                                        {tr('settings.calendarMobile.localCalendarTargetsStayOnThisDeviceUseAGoogle')}
                                    </Text>
                                )}
                                {selectedSharedAccountCalendarForPush && (
                                    <Text style={[styles.settingDescription, { color: tc.secondaryText, marginTop: 8 }]}>
                                        {tr('settings.calendarMobile.forASeparateColorInGoogleCalendarSelectADedicated')}
                                    </Text>
                                )}
                            </View>

                            {isCalendarPushTargetLoading ? (
                                <View style={{ paddingBottom: 16 }}>
                                    <ActivityIndicator color={tc.tint} />
                                </View>
                            ) : (
                                calendarPushTargetOptions.map((target, idx) => {
                                    const selected = target.id === calendarPushTargetCalendarId;
                                    return (
                                        <TouchableOpacity
                                            key={target.id ?? 'mindwtr-managed'}
                                            accessibilityRole="button"
                                            accessibilityLabel={`${target.name}. ${target.description}`}
                                            accessibilityState={{ selected }}
                                            style={[
                                                styles.settingRow,
                                                { borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: tc.border },
                                            ]}
                                            onPress={() => void handleSelectCalendarPushTarget(target.id)}
                                        >
                                            <View style={styles.settingInfo}>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                    {target.color && (
                                                        <View
                                                            style={{
                                                                width: 10,
                                                                height: 10,
                                                                borderRadius: 5,
                                                                backgroundColor: target.color,
                                                            }}
                                                        />
                                                    )}
                                                    <Text style={[styles.settingLabel, { color: tc.text, flex: 1 }]} numberOfLines={1}>
                                                        {target.name}
                                                    </Text>
                                                </View>
                                                <Text style={[styles.settingDescription, { color: tc.secondaryText }]} numberOfLines={1}>
                                                    {target.description}
                                                </Text>
                                            </View>
                                            {selected && <Ionicons color={tc.tint} name="checkmark" size={20} />}
                                        </TouchableOpacity>
                                    );
                                })
                            )}

                            {selectedManagedMindwtrCalendarForPush && (
                                <View style={[styles.settingRowColumn, { borderTopWidth: 1, borderTopColor: tc.border }]}>
                                    <Text style={[styles.settingLabel, { color: tc.text }]}>
                                        {tFallback(t, 'settings.calendarMobile.mindwtrCalendarColor', 'Mindwtr calendar color')}
                                    </Text>
                                    <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                        {tFallback(t, 'settings.calendarMobile.mindwtrCalendarColorDesc', 'Applies to the Mindwtr-created calendar; shared account calendars keep their own color.')}
                                    </Text>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
                                        {CALENDAR_PUSH_COLOR_OPTIONS.map((color) => {
                                            const selected = color.toUpperCase() === calendarPushColor.toUpperCase();
                                            return (
                                                <TouchableOpacity
                                                    key={color}
                                                    accessibilityRole="button"
                                                    accessibilityLabel={`${tFallback(t, 'settings.calendarMobile.mindwtrCalendarColor', 'Mindwtr calendar color')} ${color}`}
                                                    accessibilityState={{ selected }}
                                                    onPress={() => void handleSelectCalendarPushColor(color)}
                                                    style={{
                                                        width: 34,
                                                        height: 34,
                                                        borderRadius: 17,
                                                        borderWidth: selected ? 3 : 1,
                                                        borderColor: selected ? tc.text : tc.border,
                                                        backgroundColor: color,
                                                    }}
                                                />
                                            );
                                        })}
                                    </View>
                                </View>
                            )}

                            <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={tr('settings.calendarMobile.refreshCalendars')}
                                onPress={() => void loadCalendarPushTargetState()}
                                style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}
                            >
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: tc.text }]}>
                                        {tr('settings.calendarMobile.refreshCalendars')}
                                    </Text>
                                    <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                        {tr('settings.calendarMobile.reloadTheListAfterAddingACalendarInGoogleCalendar')}
                                    </Text>
                                </View>
                                <Ionicons color={tc.tint} name="refresh-outline" size={20} />
                            </TouchableOpacity>

                            <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={tr('settings.calendarMobile.deleteMindwtrCalendar')}
                                onPress={handleDeleteMindwtrCalendar}
                                disabled={isDeletingMindwtrCalendar}
                                style={[
                                    styles.settingRow,
                                    {
                                        borderTopWidth: 1,
                                        borderTopColor: tc.border,
                                        opacity: isDeletingMindwtrCalendar ? 0.6 : 1,
                                    },
                                ]}
                            >
                                <View style={styles.settingInfo}>
                                    <Text style={[styles.settingLabel, { color: '#EF4444' }]}>
                                        {tr('settings.calendarMobile.deleteMindwtrCalendar')}
                                    </Text>
                                    <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                        {tr('settings.calendarMobile.removeTheDedicatedCalendarAndItsPushedEventsFromThis')}
                                    </Text>
                                </View>
                                {isDeletingMindwtrCalendar ? (
                                    <ActivityIndicator color="#EF4444" />
                                ) : (
                                    <Ionicons color="#EF4444" name="trash-outline" size={20} />
                                )}
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                <View style={[styles.settingCard, { backgroundColor: tc.cardBg }]}>
                    <CollapsibleSettingHeader
                        title={t('settings.deviceCalendars')}
                        description={t('settings.deviceCalendarsDesc')}
                        open={systemCalendarOpen}
                        onToggle={() => setSystemCalendarOpen((open) => !open)}
                        textColor={tc.text}
                        secondaryTextColor={tc.secondaryText}
                        rightControl={(
                            <Switch
                                value={systemCalendarEnabled}
                                onValueChange={handleToggleSystemCalendarEnabled}
                                trackColor={{ false: '#767577', true: '#3B82F6' }}
                            />
                        )}
                    />

                    {systemCalendarOpen && systemCalendarEnabled && (
                        <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: tc.border }}>
                            {systemCalendarPermission !== 'granted' ? (
                                <View>
                                    <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                        {systemCalendarPermission === 'denied'
                                            ? t('settings.calendarAccessDenied')
                                            : t('settings.calendarAccessRequired')}
                                    </Text>
                                    <TouchableOpacity
                                        style={[
                                            styles.backendOption,
                                            { borderColor: tc.border, backgroundColor: tc.filterBg, marginTop: 12, alignSelf: 'flex-start' },
                                        ]}
                                        onPress={() => void loadSystemCalendarState(true)}
                                    >
                                        <CompactText
                                            style={[styles.backendOptionText, { color: tc.text }]}
                                            numberOfLines={2}
                                        >
                                            {t('settings.grantCalendarAccess')}
                                        </CompactText>
                                    </TouchableOpacity>
                                </View>
                            ) : isSystemCalendarLoading ? (
                                <View style={{ paddingVertical: 8 }}>
                                    <ActivityIndicator color={tc.tint} />
                                </View>
                            ) : systemCalendars.length === 0 ? (
                                <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>{t('settings.noDeviceCalendars')}</Text>
                            ) : (
                                <View>
                                    {systemCalendars.map((calendar, idx) => {
                                        const selected = systemCalendarSelectAll || selectedSystemCalendarSet.has(calendar.id);
                                        return (
                                            <View
                                                key={calendar.id}
                                                style={[styles.settingRow, idx > 0 && { borderTopWidth: 1, borderTopColor: tc.border }]}
                                            >
                                                <View style={styles.settingInfo}>
                                                    <Text style={[styles.settingLabel, { color: tc.text }]} numberOfLines={2}>
                                                        {calendar.name}
                                                    </Text>
                                                    <Text style={[styles.settingDescription, { color: tc.secondaryText }]} numberOfLines={2}>
                                                        {t('settings.deviceCalendar')}
                                                    </Text>
                                                </View>
                                                <Switch
                                                    value={selected}
                                                    onValueChange={(value) => void handleToggleSystemCalendarSelection(calendar.id, value)}
                                                    trackColor={{ false: '#767577', true: '#3B82F6' }}
                                                />
                                            </View>
                                        );
                                    })}
                                </View>
                            )}
                        </View>
                    )}
                </View>

                <Text style={[styles.sectionTitle, { color: tc.secondaryText, marginTop: 16 }]}>
                    {tr('settings.calendarMobile.icsSubscriptions')}
                </Text>
                <Text style={[styles.description, { color: tc.secondaryText }]}>{t('settings.calendarDesc')}</Text>

                <SettingsGuideLink
                    title="Calendar setup guide"
                    description="Setup notes for device calendars, push-to-calendar, and ICS subscriptions."
                    url={CALENDAR_INTEGRATION_GUIDE_URL}
                    testID="calendar-guide-link"
                />

                <View style={[styles.settingCard, { backgroundColor: tc.cardBg }]}>
                    <View style={styles.inputGroup}>
                        <Text style={[styles.settingLabel, { color: tc.text }]}>{t('settings.externalCalendarName')}</Text>
                        <TextInput
                            style={[styles.textInput, { borderColor: tc.border, color: tc.text }]}
                            placeholder={tr('settings.calendarMobile.optional')}
                            placeholderTextColor={tc.secondaryText}
                            value={newCalendarName}
                            onChangeText={setNewCalendarName}
                        />

                        <Text style={[styles.settingLabel, { color: tc.text, marginTop: 12 }]}>{t('settings.externalCalendarUrl')}</Text>
                        <TextInput
                            style={[styles.textInput, { borderColor: tc.border, color: tc.text }]}
                            placeholder={t('settings.externalCalendarUrlPlaceholder')}
                            placeholderTextColor={tc.secondaryText}
                            autoCapitalize="none"
                            autoCorrect={false}
                            value={newCalendarUrl}
                            onChangeText={setNewCalendarUrl}
                        />

                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                            <TouchableOpacity
                                style={[
                                    styles.backendOption,
                                    { borderColor: tc.border, backgroundColor: newCalendarUrl.trim() ? filledButton.backgroundColor : tc.filterBg },
                                ]}
                                onPress={() => void handleAddCalendar()}
                                disabled={!newCalendarUrl.trim()}
                            >
                                <CompactText
                                    style={[styles.backendOptionText, { color: newCalendarUrl.trim() ? (filledButton.textColor ?? tc.onTint) : tc.secondaryText }]}
                                    numberOfLines={2}
                                >
                                    {t('settings.externalCalendarAdd')}
                                </CompactText>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.backendOption, { borderColor: tc.border, backgroundColor: tc.filterBg }]}
                                onPress={() => void handleTestFetch()}
                            >
                                <CompactText
                                    style={[styles.backendOptionText, { color: tc.text }]}
                                    numberOfLines={2}
                                >
                                    {tr('settings.calendarMobile.test')}
                                </CompactText>
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                            style={[
                                styles.backendOption,
                                { borderColor: tc.border, backgroundColor: tc.filterBg, marginTop: 12, alignSelf: 'flex-start' },
                            ]}
                            onPress={() => void handleChooseLocalCalendar()}
                        >
                            <CompactText
                                style={[styles.backendOptionText, { color: tc.text }]}
                                numberOfLines={2}
                            >
                                {tr('settings.calendarMobile.chooseLocalIcsFile')}
                            </CompactText>
                        </TouchableOpacity>
                    </View>
                </View>

                {externalCalendars.length > 0 && (
                    <View style={{ marginTop: 16 }}>
                        <Text style={[styles.sectionTitle, { color: tc.secondaryText }]}>{t('settings.externalCalendars')}</Text>
                        <View style={[styles.settingCard, { backgroundColor: tc.cardBg }]}>
                            {externalCalendars.map((calendar, idx) => (
                                <View
                                    key={calendar.id}
                                    style={[styles.settingRow, idx > 0 && { borderTopWidth: 1, borderTopColor: tc.border }]}
                                >
                                    <View style={styles.settingInfo}>
                                        <Text style={[styles.settingLabel, { color: tc.text }]} numberOfLines={2}>
                                            {calendar.name}
                                        </Text>
                                        <Text style={[styles.settingDescription, { color: tc.secondaryText }]} numberOfLines={2}>
                                            {maskCalendarUrl(calendar.url)}
                                        </Text>
                                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                                            <TouchableOpacity
                                                accessibilityRole="button"
                                                accessibilityState={{ selected: !hasExplicitExternalCalendarColor(calendar.id, calendar.color) }}
                                                accessibilityLabel={`${calendar.name} ${t('taskEdit.textDirection.auto')}`}
                                                onPress={() => void handleCalendarColorChange(calendar.id, undefined)}
                                                style={{
                                                    width: 22,
                                                    height: 22,
                                                    borderRadius: 11,
                                                    backgroundColor: tc.cardBg,
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    borderWidth: hasExplicitExternalCalendarColor(calendar.id, calendar.color) ? 1 : 3,
                                                    borderColor: hasExplicitExternalCalendarColor(calendar.id, calendar.color) ? tc.border : tc.tint,
                                                }}
                                            >
                                                <Ionicons name="ban-outline" size={12} color={tc.secondaryText} />
                                            </TouchableOpacity>
                                            {EXTERNAL_CALENDAR_COLORS.map((color) => {
                                                const selected = hasExplicitExternalCalendarColor(calendar.id, calendar.color) && calendar.color === color;
                                                return (
                                                    <TouchableOpacity
                                                        key={color}
                                                        accessibilityRole="button"
                                                        accessibilityState={{ selected }}
                                                        accessibilityLabel={`${calendar.name} ${color}`}
                                                        onPress={() => void handleCalendarColorChange(calendar.id, color)}
                                                        style={{
                                                            width: 22,
                                                            height: 22,
                                                            borderRadius: 11,
                                                            // Fill only — the stored pick stays canonical (#974).
                                                            backgroundColor: themeExternalCalendarDisplayColor(color, themePreset),
                                                            borderWidth: selected ? 3 : 1,
                                                            borderColor: selected ? tc.tint : tc.border,
                                                        }}
                                                    />
                                                );
                                            })}
                                        </View>
                                    </View>
                                    <View style={{ alignItems: 'flex-end', gap: 10 }}>
                                        <Switch
                                            value={calendar.enabled}
                                            onValueChange={(value) => void handleToggleCalendar(calendar.id, value)}
                                            trackColor={{ false: '#767577', true: '#3B82F6' }}
                                        />
                                        <TouchableOpacity onPress={() => void handleRemoveCalendar(calendar.id)}>
                                            <Text style={{ color: '#EF4444', fontSize: 13, fontWeight: '600' }}>
                                                {t('settings.externalCalendarRemove')}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ))}
                        </View>
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}
