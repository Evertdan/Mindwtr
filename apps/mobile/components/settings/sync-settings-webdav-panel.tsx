import type { ReactNode } from 'react';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { ThemeColors } from '@/hooks/use-theme-colors';

import { isValidHttpUrl } from './settings.constants';
import { styles } from './settings.styles';

type Translate = (key: string) => string;

export type WebDavSyncSettings = {
    allowInsecureHttp: boolean;
    password: string;
    url: string;
    username: string;
};

type SyncWebDavBackendPanelProps = {
    initialAllowInsecureHttp: boolean;
    initialPassword: string;
    initialUrl: string;
    initialUsername: string;
    isSyncing: boolean;
    isTestingConnection: boolean;
    lastSyncCard: ReactNode;
    onSave: (settings: WebDavSyncSettings) => void;
    onSync: (settings: WebDavSyncSettings) => void;
    onTestConnection: (settings: WebDavSyncSettings) => void;
    t: Translate;
    tc: ThemeColors;
};

export function SyncWebDavBackendPanel({
    initialAllowInsecureHttp,
    initialPassword,
    initialUrl,
    initialUsername,
    isSyncing,
    isTestingConnection,
    lastSyncCard,
    onSave,
    onSync,
    onTestConnection,
    t,
    tc,
}: SyncWebDavBackendPanelProps) {
    const [allowInsecureHttp, setAllowInsecureHttp] = useState(initialAllowInsecureHttp);
    const [password, setPassword] = useState(initialPassword);
    const [url, setUrl] = useState(initialUrl);
    const [username, setUsername] = useState(initialUsername);

    useEffect(() => {
        setUrl(initialUrl);
    }, [initialUrl]);

    useEffect(() => {
        setAllowInsecureHttp(initialAllowInsecureHttp);
    }, [initialAllowInsecureHttp]);

    useEffect(() => {
        setUsername(initialUsername);
    }, [initialUsername]);

    useEffect(() => {
        setPassword(initialPassword);
    }, [initialPassword]);

    const urlError = url.trim() ? !isValidHttpUrl(url.trim()) : false;
    const settings = { allowInsecureHttp, password, url, username };
    const canUseActions = url.trim().length > 0 && !urlError;

    return (
        <>
            <Text style={[styles.sectionTitle, { color: tc.text, marginTop: 16 }]}>{t('settings.syncBackendWebdav')}</Text>
            <View style={[styles.settingCard, { backgroundColor: tc.cardBg }]}>
                <View style={styles.inputGroup}>
                    <Text style={[styles.settingLabel, { color: tc.text }]}>{t('settings.webdavUrl')}</Text>
                    <TextInput
                        value={url}
                        onChangeText={setUrl}
                        placeholder={t('settings.webdavUrlPlaceholder')}
                        placeholderTextColor={tc.secondaryText}
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={[styles.textInput, { backgroundColor: tc.inputBg, borderColor: tc.border, color: tc.text }]}
                    />
                    <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>{t('settings.webdavHint')}</Text>
                    {urlError && (
                        <Text style={[styles.settingDescription, { color: tc.danger }]}>{t('settings.invalidUrlHttp')}</Text>
                    )}
                </View>
                <View style={[styles.inputGroup, { borderTopWidth: 1, borderTopColor: tc.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={styles.settingInfo}>
                            <Text style={[styles.settingLabel, { color: tc.text }]}>{t('settings.allowInsecureHttp')}</Text>
                            <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>{t('settings.allowInsecureHttpHint')}</Text>
                        </View>
                        <Switch
                            value={allowInsecureHttp}
                            onValueChange={setAllowInsecureHttp}
                            trackColor={{ false: '#767577', true: '#3B82F6' }}
                        />
                    </View>
                </View>
                <View style={[styles.inputGroup, { borderTopWidth: 1, borderTopColor: tc.border }]}>
                    <Text style={[styles.settingLabel, { color: tc.text }]}>{t('settings.webdavUsername')}</Text>
                    <TextInput
                        value={username}
                        onChangeText={setUsername}
                        placeholder={t('settings.webdavUsernamePlaceholder')}
                        placeholderTextColor={tc.secondaryText}
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={[styles.textInput, { backgroundColor: tc.inputBg, borderColor: tc.border, color: tc.text }]}
                    />
                </View>
                <View style={[styles.inputGroup, { borderTopWidth: 1, borderTopColor: tc.border }]}>
                    <Text style={[styles.settingLabel, { color: tc.text }]}>{t('settings.webdavPassword')}</Text>
                    <TextInput
                        value={password}
                        onChangeText={setPassword}
                        placeholder="••••••••"
                        placeholderTextColor={tc.secondaryText}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                        style={[styles.textInput, { backgroundColor: tc.inputBg, borderColor: tc.border, color: tc.text }]}
                    />
                </View>
                {Platform.OS === 'web' && (
                    <Text style={[styles.settingDescription, { color: tc.warning }]}>
                        {t('settings.webdavBrowserStorageWarning')}
                    </Text>
                )}
                <TouchableOpacity
                    style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}
                    onPress={() => onSave(settings)}
                    disabled={!canUseActions}
                >
                    <View style={styles.settingInfo}>
                        <Text style={[styles.settingLabel, { color: canUseActions ? tc.tint : tc.secondaryText }]}>
                            {t('settings.webdavSave')}
                        </Text>
                        <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>{t('settings.webdavUrl')}</Text>
                    </View>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}
                    onPress={() => onSync(settings)}
                    disabled={isSyncing || !canUseActions}
                >
                    <View style={styles.settingInfo}>
                        <Text style={[styles.settingLabel, { color: canUseActions ? tc.tint : tc.secondaryText }]}>
                            {t('settings.syncNow')}
                        </Text>
                        <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>{t('settings.syncReadMergeWebdav')}</Text>
                    </View>
                    {isSyncing && <ActivityIndicator size="small" color={tc.tint} />}
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: tc.border }]}
                    onPress={() => onTestConnection(settings)}
                    disabled={isSyncing || isTestingConnection || !canUseActions}
                >
                    <View style={styles.settingInfo}>
                        <Text style={[styles.settingLabel, { color: canUseActions ? tc.tint : tc.secondaryText }]}>
                            {t('settings.testConnection')}
                        </Text>
                        <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>{t('settings.webdavTestHint')}</Text>
                    </View>
                    {isTestingConnection && <ActivityIndicator size="small" color={tc.tint} />}
                </TouchableOpacity>
            </View>
            {lastSyncCard}
        </>
    );
}
