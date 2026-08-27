import React from 'react';
import { Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { useThemeColors } from '@/hooks/use-theme-colors';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useLanguage } from '@/contexts/language-context';
import type { TdahPermissionsSnapshot } from '@/lib/tdah-permissions';

import { styles } from './tdah-onboarding.styles';

type DegradedPermissionKind = 'notifications' | 'battery' | 'calendar';

/**
 * Transversal "Aviso de Permisos" screen (Stitch `77c959d0f86e4a18bb1213cbed1da848`).
 * Reused for any denial from step 4 — per the spec's cross-cutting permissions
 * rule, this never blocks the rest of the onboarding; it only shows the
 * degraded state and a recovery path (system settings), then lets the user
 * continue to step 5 regardless.
 */
export type TdahOnboardingPermissionNoticeProps = {
    permissions: TdahPermissionsSnapshot | null;
    onBack: () => void;
    onContinue: () => void;
};

export function TdahOnboardingPermissionNotice({ permissions, onBack, onContinue }: TdahOnboardingPermissionNoticeProps) {
    const tc = useThemeColors();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();

    const degraded: DegradedPermissionKind[] = permissions
        ? (['notifications', 'battery', 'calendar'] as const).filter((kind) => permissions[kind] !== 'granted')
        : [];

    return (
        <View style={styles.container} testID="tdah-onboarding-permission-notice">
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.title, { color: tc.text }]}>{t('tdahOnboarding.permissionNotice.title')}</Text>
                <Text style={[styles.body, { color: tc.secondaryText }]}>{t('tdahOnboarding.permissionNotice.body')}</Text>

                {degraded.map((kind) => (
                    <View key={kind} style={[styles.card, { borderColor: tc.border, backgroundColor: tc.cardBg }]}>
                        <Text style={[styles.cardTitle, { color: tc.text }]}>
                            {t(`tdahOnboarding.permissionNotice.${kind}Title`)}
                        </Text>
                        <Text style={[styles.cardDescription, { color: tc.secondaryText }]}>
                            {t(`tdahOnboarding.permissionNotice.${kind}Recovery`)}
                        </Text>
                        <TouchableOpacity
                            accessibilityRole="button"
                            onPress={() => void Linking.openSettings()}
                            style={[styles.button, styles.buttonOutline, { borderColor: tc.tint, alignSelf: 'flex-start' }]}
                            testID={`tdah-onboarding-permission-notice-settings-${kind}`}
                        >
                            <Text style={[styles.buttonText, { color: tc.tint }]}>
                                {t('tdahOnboarding.permissionNotice.openSettings')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                ))}
            </ScrollView>
            <View style={styles.footer}>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={onBack}
                    style={[styles.button, styles.buttonOutline, { borderColor: tc.border }]}
                    testID="tdah-onboarding-permission-notice-back"
                >
                    <Text style={[styles.buttonText, { color: tc.text }]}>{t('tdahOnboarding.back')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={onContinue}
                    style={[styles.button, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-onboarding-permission-notice-continue"
                >
                    <Text style={[styles.buttonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {t('tdahOnboarding.permissionNotice.continue')}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}
