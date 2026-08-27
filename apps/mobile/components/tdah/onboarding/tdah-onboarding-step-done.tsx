import React from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { resolveI18nText } from '@mindwtr/core';

import { useThemeColors } from '@/hooks/use-theme-colors';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useLanguage } from '@/contexts/language-context';

import { styles } from './tdah-onboarding.styles';
import type { TdahActivateResult, TdahActivateStatus, TdahOnboardingVariant } from './tdah-onboarding-types';

/**
 * T-14 step 5 — "Listo". Stitch: Activación 5 — Listo
 * (`84f414dc7e564d9c9f3f7f443f96a664`). Always reflects the real
 * `POST /activate` response — `dayPlan` here is the server's own answer,
 * never a client-fabricated state (spec AC).
 */
export type TdahOnboardingStepDoneProps = {
    variant: TdahOnboardingVariant;
    status: TdahActivateStatus;
    result: TdahActivateResult | null;
    onRetry: () => void;
    onDone: () => void;
    onClose: () => void;
};

export function TdahOnboardingStepDone({ variant, status, result, onRetry, onDone, onClose }: TdahOnboardingStepDoneProps) {
    const tc = useThemeColors();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();

    if (status === 'pending' || status === 'idle') {
        return (
            <View style={styles.centeredBody} testID="tdah-onboarding-step-done-pending">
                <ActivityIndicator color={tc.tint} size="large" />
                <Text style={[styles.body, { color: tc.secondaryText }]}>{t('tdahOnboarding.done.pending')}</Text>
            </View>
        );
    }

    if (status === 'error') {
        return (
            <View style={styles.centeredBody} testID="tdah-onboarding-step-done-error">
                <Text style={[styles.title, { color: tc.text }]}>{t('tdahOnboarding.done.errorTitle')}</Text>
                <Text style={[styles.body, { color: tc.secondaryText }]}>{t('tdahOnboarding.done.errorBody')}</Text>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={onRetry}
                    style={[styles.button, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-onboarding-done-retry"
                >
                    <Text style={[styles.buttonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {t('tdahOnboarding.done.retry')}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={onClose}
                    style={[styles.button, styles.buttonOutline, { borderColor: tc.border }]}
                    testID="tdah-onboarding-done-close"
                >
                    <Text style={[styles.buttonText, { color: tc.text }]}>{t('tdahOnboarding.close')}</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const dayPlanCopy = result
        ? resolveI18nText(t, 'tdahOnboarding.done.dayPlanReady', {
            values: { date: result.dayPlan.date, count: String(result.dayPlan.activityCount) },
        })
        : '';

    return (
        <View style={styles.container} testID="tdah-onboarding-step-done-success">
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.title, { color: tc.text }]}>
                    {variant === 'reactivation' ? t('tdahOnboarding.done.reactivatedTitle') : t('tdahOnboarding.done.title')}
                </Text>
                {variant === 'reactivation' ? (
                    <Text style={[styles.body, { color: tc.secondaryText }]}>{t('tdahOnboarding.done.reactivatedBody')}</Text>
                ) : null}
                <Text style={[styles.body, { color: tc.secondaryText }]} testID="tdah-onboarding-done-day-plan">
                    {dayPlanCopy}
                </Text>
            </ScrollView>
            <View style={styles.footer}>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={onDone}
                    style={[styles.button, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-onboarding-done-finish"
                >
                    <Text style={[styles.buttonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {t('tdahOnboarding.done.finish')}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}
