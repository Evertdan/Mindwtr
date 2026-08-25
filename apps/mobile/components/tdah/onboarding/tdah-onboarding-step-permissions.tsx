import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { useThemeColors } from '@/hooks/use-theme-colors';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useLanguage } from '@/contexts/language-context';
import {
    getTdahPermissionsSnapshot,
    isTdahBatteryPermissionApplicable,
    requestTdahBatteryPermission,
    requestTdahCalendarPermission,
    requestTdahNotificationsPermission,
    subscribeTdahBatteryPermissionForegroundRecheck,
    type TdahPermissionsSnapshot,
    type TdahPermissionStatus,
} from '@/lib/tdah-permissions';

import { styles } from './tdah-onboarding.styles';

type PermissionKind = 'notifications' | 'battery' | 'calendar';

const FALLBACK_SNAPSHOT: TdahPermissionsSnapshot = {
    notifications: 'undetermined',
    battery: 'undetermined',
    calendar: 'undetermined',
};

/**
 * T-14 step 4 — permisos del teléfono. Stitch: Activación 4 — Permisos
 * (`34601f24286641c8b470e26341747eff`). Never blocks: "Continuar" is always
 * enabled regardless of what got granted (spec's transversal permissions rule).
 */
export type TdahOnboardingStepPermissionsProps = {
    onContinue: (snapshot: TdahPermissionsSnapshot) => void;
    onBack: () => void;
};

export function TdahOnboardingStepPermissions({ onContinue, onBack }: TdahOnboardingStepPermissionsProps) {
    const tc = useThemeColors();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();
    const [snapshot, setSnapshot] = useState<TdahPermissionsSnapshot>(FALLBACK_SNAPSHOT);
    const [busy, setBusy] = useState<PermissionKind | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let active = true;
        void getTdahPermissionsSnapshot().then((result) => {
            if (active) {
                setSnapshot(result);
                setLoaded(true);
            }
        });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => (
        subscribeTdahBatteryPermissionForegroundRecheck((status) => {
            setSnapshot((prev) => ({ ...prev, battery: status }));
        })
    ), []);

    const requestPermission = useCallback(async (kind: PermissionKind) => {
        setBusy(kind);
        try {
            let status: TdahPermissionStatus;
            if (kind === 'notifications') status = await requestTdahNotificationsPermission();
            else if (kind === 'battery') status = await requestTdahBatteryPermission();
            else status = await requestTdahCalendarPermission();
            setSnapshot((prev) => ({ ...prev, [kind]: status }));
        } finally {
            setBusy(null);
        }
    }, []);

    const statusLabel = (status: TdahPermissionStatus): string => {
        if (status === 'granted') return t('tdahOnboarding.permissions.statusGranted');
        if (status === 'denied') return t('tdahOnboarding.permissions.statusDenied');
        return t('tdahOnboarding.permissions.statusUndetermined');
    };

    const statusColor = (status: TdahPermissionStatus): string => {
        if (status === 'granted') return tc.success;
        if (status === 'denied') return tc.danger;
        return tc.secondaryText;
    };

    const rows: { kind: PermissionKind; titleKey: string; descKey: string; applicable: boolean }[] = [
        {
            kind: 'notifications',
            titleKey: 'tdahOnboarding.permissions.notificationsTitle',
            descKey: 'tdahOnboarding.permissions.notificationsDesc',
            applicable: true,
        },
        {
            kind: 'battery',
            titleKey: 'tdahOnboarding.permissions.batteryTitle',
            descKey: 'tdahOnboarding.permissions.batteryDesc',
            applicable: isTdahBatteryPermissionApplicable(),
        },
        {
            kind: 'calendar',
            titleKey: 'tdahOnboarding.permissions.calendarTitle',
            descKey: 'tdahOnboarding.permissions.calendarDesc',
            applicable: Platform.OS !== 'web',
        },
    ];

    return (
        <View style={styles.container} testID="tdah-onboarding-step-permissions">
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.title, { color: tc.text }]}>{t('tdahOnboarding.permissions.title')}</Text>
                <Text style={[styles.body, { color: tc.secondaryText }]}>{t('tdahOnboarding.permissions.body')}</Text>

                {rows.filter((row) => row.applicable).map((row) => {
                    const status = snapshot[row.kind];
                    return (
                        <View key={row.kind} style={[styles.card, { borderColor: tc.border, backgroundColor: tc.cardBg }]}>
                            <View style={styles.row}>
                                <Text style={[styles.cardTitle, { color: tc.text }]}>{t(row.titleKey)}</Text>
                                <View style={[styles.badge, { backgroundColor: `${statusColor(status)}22` }]}>
                                    <Text style={[styles.badgeText, { color: statusColor(status) }]} testID={`tdah-onboarding-permission-status-${row.kind}`}>
                                        {loaded ? statusLabel(status) : '…'}
                                    </Text>
                                </View>
                            </View>
                            <Text style={[styles.cardDescription, { color: tc.secondaryText }]}>{t(row.descKey)}</Text>
                            {status !== 'granted' ? (
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityState={{ disabled: busy === row.kind }}
                                    disabled={busy === row.kind}
                                    onPress={() => void requestPermission(row.kind)}
                                    style={[styles.button, styles.buttonOutline, { borderColor: tc.tint, alignSelf: 'flex-start' }]}
                                    testID={`tdah-onboarding-permission-request-${row.kind}`}
                                >
                                    {busy === row.kind ? (
                                        <ActivityIndicator color={tc.tint} size="small" />
                                    ) : (
                                        <Text style={[styles.buttonText, { color: tc.tint }]}>
                                            {t('tdahOnboarding.permissions.request')}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            ) : null}
                        </View>
                    );
                })}
            </ScrollView>
            <View style={styles.footer}>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={onBack}
                    style={[styles.button, styles.buttonOutline, { borderColor: tc.border }]}
                    testID="tdah-onboarding-permissions-back"
                >
                    <Text style={[styles.buttonText, { color: tc.text }]}>{t('tdahOnboarding.back')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => onContinue(snapshot)}
                    style={[styles.button, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-onboarding-permissions-continue"
                >
                    <Text style={[styles.buttonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {t('tdahOnboarding.permissions.continue')}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}
