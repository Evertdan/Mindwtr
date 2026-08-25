import React, { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { cloudGetJson, cloudPutJson, getCloudBaseUrl } from '@mindwtr/core';

import { useThemeColors } from '@/hooks/use-theme-colors';
import { getSecureConfigValue } from '@/lib/secure-config';
import { CLOUD_ALLOW_INSECURE_HTTP_KEY, CLOUD_TOKEN_KEY, CLOUD_URL_KEY } from '@/lib/sync-constants';
import { getMobileCloudRequestOptions } from '@/lib/webdav-request-options';

import { SettingRow, SettingToggleRow } from './setting-row';
import { useSettingsLocalization, useSettingsScrollContent } from './settings.hooks';
import { SettingsTopBar } from './settings.shell';
import { styles } from './settings.styles';

type CloudSyncConfig = {
    url: string;
    token: string;
    allowInsecureHttp: boolean;
};

type TdahProfileState = {
    mode: 'on' | 'off';
    timeZone: string;
    ritualHour: string;
};

type TdahScreenPhase = 'loading' | 'no-sync' | 'ready' | 'error';

const TDAH_PROFILE_PATH = '/tdah/profile';
const TDAH_REQUEST_TIMEOUT_MS = 10_000;
const DEVICE_TIME_ZONE_PATTERN = /^[A-Za-z0-9+_/-]{1,64}$/;

export const detectDeviceTimeZone = (): string => {
    try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return timeZone && DEVICE_TIME_ZONE_PATTERN.test(timeZone) ? timeZone : 'UTC';
    } catch {
        return 'UTC';
    }
};

const buildTdahProfileUrl = (cloudUrl: string): string => `${getCloudBaseUrl(cloudUrl)}${TDAH_PROFILE_PATH}`;

const buildCloudOptions = (config: CloudSyncConfig) => ({
    ...getMobileCloudRequestOptions(config.allowInsecureHttp),
    token: config.token,
    timeoutMs: TDAH_REQUEST_TIMEOUT_MS,
});

export function TdahSettingsScreen() {
    const tc = useThemeColors();
    const { t } = useSettingsLocalization();
    const scrollContentStyle = useSettingsScrollContent();
    const [phase, setPhase] = useState<TdahScreenPhase>('loading');
    const [cloud, setCloud] = useState<CloudSyncConfig | null>(null);
    const [profile, setProfile] = useState<TdahProfileState | null>(null);
    const [mutating, setMutating] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);

    const loadProfile = useCallback(async (config: CloudSyncConfig): Promise<void> => {
        const result = await cloudGetJson<{ profile: TdahProfileState | null }>(
            buildTdahProfileUrl(config.url),
            buildCloudOptions(config),
        );
        setProfile(result?.profile ?? null);
        setPhase('ready');
    }, []);

    const reload = useCallback(async (): Promise<void> => {
        setPhase('loading');
        setSaveFailed(false);
        try {
            const [rawUrl, rawToken, rawAllowInsecureHttp] = await Promise.all([
                AsyncStorage.getItem(CLOUD_URL_KEY),
                getSecureConfigValue(CLOUD_TOKEN_KEY),
                AsyncStorage.getItem(CLOUD_ALLOW_INSECURE_HTTP_KEY),
            ]);
            const url = rawUrl?.trim() ?? '';
            const token = rawToken?.trim() ?? '';
            if (!url || !token) {
                setCloud(null);
                setProfile(null);
                setPhase('no-sync');
                return;
            }
            const config: CloudSyncConfig = {
                url,
                token,
                allowInsecureHttp: rawAllowInsecureHttp === 'true',
            };
            setCloud(config);
            await loadProfile(config);
        } catch {
            setProfile(null);
            setPhase('error');
        }
    }, [loadProfile]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const handleToggleMode = useCallback(async (next: boolean) => {
        if (!cloud || mutating) return;
        setMutating(true);
        setSaveFailed(false);
        try {
            const body = next
                ? { mode: 'on' as const, timeZone: detectDeviceTimeZone() }
                : { mode: 'off' as const };
            await cloudPutJson(buildTdahProfileUrl(cloud.url), body, buildCloudOptions(cloud));
            await loadProfile(cloud);
        } catch {
            setSaveFailed(true);
        } finally {
            setMutating(false);
        }
    }, [cloud, loadProfile, mutating]);

    const modeEnabled = profile?.mode === 'on';

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]} edges={['bottom']}>
            <SettingsTopBar title={t('settings.tdah.title')} />
            <ScrollView style={styles.scrollView} contentContainerStyle={scrollContentStyle}>
                <View style={styles.menuGroupStack}>
                    <View style={[styles.menuCard, { backgroundColor: tc.cardBg }]}>
                        {phase === 'loading' ? (
                            <SettingRow label={t('settings.tdah.loading')} testID="tdah-loading">
                                <ActivityIndicator size="small" color={tc.secondaryText} />
                            </SettingRow>
                        ) : null}
                        {phase === 'no-sync' ? (
                            <SettingToggleRow
                                label={t('settings.tdah.enable')}
                                description={t('settings.tdah.needsSync')}
                                value={false}
                                onChange={() => undefined}
                                disabled
                                testID="tdah-no-sync"
                                switchTestID="tdah-mode-switch"
                            />
                        ) : null}
                        {phase === 'error' ? (
                            <SettingRow label={t('settings.tdah.loadError')} testID="tdah-load-error">
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityLabel={t('settings.tdah.retry')}
                                    onPress={() => void reload()}
                                    testID="tdah-retry"
                                >
                                    <Text style={[styles.linkText, { color: tc.tint }]}>
                                        {t('settings.tdah.retry')}
                                    </Text>
                                </TouchableOpacity>
                            </SettingRow>
                        ) : null}
                        {phase === 'ready' ? (
                            <SettingToggleRow
                                label={t('settings.tdah.enable')}
                                description={t('settings.tdah.enableDesc')}
                                value={modeEnabled}
                                onChange={(next) => void handleToggleMode(next)}
                                disabled={mutating}
                                testID="tdah-mode-row"
                                switchTestID="tdah-mode-switch"
                            />
                        ) : null}
                        {phase === 'ready' && saveFailed ? (
                            <SettingRow
                                label={t('settings.tdah.saveError')}
                                divider
                                testID="tdah-save-error"
                            />
                        ) : null}
                        {phase === 'ready' ? (
                            <SettingRow
                                label={t('settings.tdah.timeZone')}
                                description={t('settings.tdah.timeZoneDesc')}
                                divider
                                testID="tdah-time-zone-row"
                            >
                                <Text
                                    style={[styles.settingValue, { color: tc.secondaryText }]}
                                    testID="tdah-time-zone-value"
                                >
                                    {profile ? profile.timeZone : '—'}
                                </Text>
                            </SettingRow>
                        ) : null}
                        {phase === 'ready' ? (
                            <SettingRow
                                label={t('settings.tdah.ritualHour')}
                                description={t('settings.tdah.ritualHourDesc')}
                                divider
                                testID="tdah-ritual-hour-row"
                            >
                                <Text
                                    style={[styles.settingValue, { color: tc.secondaryText }]}
                                    testID="tdah-ritual-hour-value"
                                >
                                    {profile ? profile.ritualHour : '23:00'}
                                </Text>
                            </SettingRow>
                        ) : null}
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}
