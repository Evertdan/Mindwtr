import type { ReactNode } from 'react';
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import type { ThemeColors } from '@/hooks/use-theme-colors';

import { styles } from './settings.styles';

type Translate = (key: string) => string;
type SettingsTranslator = (key: string, values?: Record<string, string | number | boolean | null | undefined>) => string;

type SyncDropboxBackendPanelProps = {
    dropboxBusy: boolean;
    dropboxConfigured: boolean;
    dropboxConnected: boolean;
    isExpoGo: boolean;
    isSyncing: boolean;
    isTestingConnection: boolean;
    lastSyncCard: ReactNode;
    tr: SettingsTranslator;
    onConnectToggle: () => void;
    onSync: () => void;
    onTestConnection: () => void;
    redirectUri: string;
    t: Translate;
    tc: ThemeColors;
};

export function SyncDropboxBackendPanel({
    dropboxBusy,
    dropboxConfigured,
    dropboxConnected,
    isExpoGo,
    isSyncing,
    isTestingConnection,
    lastSyncCard,
    tr,
    onConnectToggle,
    onSync,
    onTestConnection,
    redirectUri,
    t,
    tc,
}: SyncDropboxBackendPanelProps) {
    return (
        <>
            <View style={[styles.settingCard, { backgroundColor: tc.cardBg, marginTop: 12 }]}>
                <View style={styles.settingRowColumn}>
                    <Text style={[styles.settingLabel, { color: tc.text }]}>{tr('settings.dropboxAppKey')}</Text>
                    <Text style={[styles.settingDescription, { color: tc.secondaryText, marginTop: 6 }]}>
                        {tr('settings.syncMobile.oauthWithDropboxAppFolderAccessMindwtrSyncsAppsMindwtr')}
                    </Text>
                    <Text style={[styles.settingDescription, { color: tc.secondaryText, marginTop: 6 }]}>
                        {tr('settings.dropboxRedirectUri')}: {redirectUri}
                    </Text>
                    {!dropboxConfigured && (
                        <Text style={[styles.settingDescription, { color: tc.danger, marginTop: 8 }]}>
                            {tr('settings.syncMobile.dropboxAppKeyIsNotConfiguredForThisBuild')}
                        </Text>
                    )}
                    {isExpoGo && (
                        <Text style={[styles.settingDescription, { color: tc.danger, marginTop: 8 }]}>
                            {tr('settings.syncMobile.expoGoIsNotSupportedForDropboxOauthUseA')}
                        </Text>
                    )}
                    <Text style={[styles.settingDescription, { color: tc.secondaryText, marginTop: 8 }]}>
                        {dropboxConnected ? tr('settings.syncMobile.statusConnected') : tr('settings.syncMobile.statusNotConnected')}
                    </Text>
                </View>
                <TouchableOpacity
                    style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}
                    onPress={onConnectToggle}
                    disabled={dropboxBusy || !dropboxConfigured || isExpoGo}
                >
                    <View style={styles.settingInfo}>
                        <Text style={[styles.settingLabel, { color: dropboxConfigured && !isExpoGo ? tc.tint : tc.secondaryText }]}>
                            {dropboxConnected ? tr('settings.dropboxDisconnect') : tr('settings.dropboxConnect')}
                        </Text>
                        <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                            {isExpoGo
                                ? tr('settings.syncMobile.requiresDevelopmentReleaseBuildExpoGoUnsupported')
                                : dropboxConnected
                                    ? tr('settings.syncMobile.revokeAppTokenAndRemoveLocalAuth')
                                    : tr('settings.syncMobile.openDropboxOauthSignInInBrowser')}
                        </Text>
                    </View>
                    {dropboxBusy && <ActivityIndicator size="small" color={tc.tint} />}
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}
                    onPress={onTestConnection}
                    disabled={isTestingConnection || !dropboxConfigured || !dropboxConnected}
                >
                    <View style={styles.settingInfo}>
                        <Text style={[styles.settingLabel, { color: dropboxConnected ? tc.tint : tc.secondaryText }]}>
                            {t('settings.testConnection')}
                        </Text>
                        <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>{t('settings.dropboxTestHint')}</Text>
                    </View>
                    {isTestingConnection && <ActivityIndicator size="small" color={tc.tint} />}
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}
                    onPress={onSync}
                    disabled={isSyncing || !dropboxConfigured || !dropboxConnected}
                >
                    <View style={styles.settingInfo}>
                        <Text style={[styles.settingLabel, { color: dropboxConnected ? tc.tint : tc.secondaryText }]}>
                            {t('settings.syncNow')}
                        </Text>
                        <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                            {tr('settings.syncMobile.readAndMergeDropboxData')}
                        </Text>
                    </View>
                    {isSyncing && <ActivityIndicator size="small" color={tc.tint} />}
                </TouchableOpacity>
            </View>
            {lastSyncCard}
        </>
    );
}
