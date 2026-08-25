import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { X } from 'lucide-react-native';

import { useThemeColors } from '@/hooks/use-theme-colors';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useLanguage } from '@/contexts/language-context';

import { styles } from './tdah-onboarding.styles';

/**
 * T-14 step 1 — "Qué es esto". Stitch: Activación 1 — Promesa
 * (`f99ea4235b4840a5a13a8cde69cf7345`). One screen, no jargon: the promise
 * from the PRD ("tu cabeza no sostiene el día sola"), not a feature tour.
 */
export type TdahOnboardingStepPromiseProps = {
    onNext: () => void;
    onClose: () => void;
};

export function TdahOnboardingStepPromise({ onNext, onClose }: TdahOnboardingStepPromiseProps) {
    const tc = useThemeColors();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();

    return (
        <View style={styles.container} testID="tdah-onboarding-step-promise">
            <View style={styles.closeRow}>
                <TouchableOpacity
                    accessibilityLabel={t('tdahOnboarding.close')}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={onClose}
                    style={[styles.closeButton, { backgroundColor: tc.cardBg }]}
                    testID="tdah-onboarding-close"
                >
                    <X color={tc.secondaryText} size={20} strokeWidth={2.2} />
                </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.title, { color: tc.text }]}>{t('tdahOnboarding.promise.title')}</Text>
                <Text style={[styles.body, { color: tc.secondaryText }]}>{t('tdahOnboarding.promise.body')}</Text>
            </ScrollView>
            <View style={styles.footer}>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={onNext}
                    style={[styles.button, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-onboarding-promise-next"
                >
                    <Text style={[styles.buttonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {t('tdahOnboarding.promise.cta')}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}
