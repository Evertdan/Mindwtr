import React, { useMemo } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useThemeColors } from '@/hooks/use-theme-colors';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useLanguage } from '@/contexts/language-context';

import { styles } from './tdah-onboarding.styles';

// Same shapes the server validates in `apps/cloud/src/tdah/routes.ts` — kept
// in sync by hand since clients never import the server's types (ADR 0026).
const IANA_TIME_ZONE_PATTERN = /^[A-Za-z0-9+_/-]{1,64}$/;
const RITUAL_HOUR_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTdahTimeZone(value: string): boolean {
    if (!IANA_TIME_ZONE_PATTERN.test(value)) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

export function isValidTdahRitualHour(value: string): boolean {
    return RITUAL_HOUR_PATTERN.test(value);
}

/**
 * T-14 step 2 — hora del ritual + zona horaria. Stitch: Activación 2 — Ritual
 * (`a5628cbbc7f14a5c88594b7a1d456026`). The time zone arrives pre-filled from
 * the device (AD-6) and stays editable/confirmable in place.
 */
export type TdahOnboardingStepRitualProps = {
    timeZone: string;
    ritualHour: string;
    onChangeTimeZone: (value: string) => void;
    onChangeRitualHour: (value: string) => void;
    onNext: () => void;
    onBack: () => void;
};

export function TdahOnboardingStepRitual({
    timeZone,
    ritualHour,
    onChangeTimeZone,
    onChangeRitualHour,
    onNext,
    onBack,
}: TdahOnboardingStepRitualProps) {
    const tc = useThemeColors();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();

    const timeZoneValid = useMemo(() => isValidTdahTimeZone(timeZone), [timeZone]);
    const ritualHourValid = useMemo(() => isValidTdahRitualHour(ritualHour), [ritualHour]);
    const canContinue = timeZoneValid && ritualHourValid;

    return (
        <View style={styles.container} testID="tdah-onboarding-step-ritual">
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.title, { color: tc.text }]}>{t('tdahOnboarding.ritual.title')}</Text>
                <Text style={[styles.body, { color: tc.secondaryText }]}>{t('tdahOnboarding.ritual.body')}</Text>

                <View>
                    <Text style={[styles.inputLabel, { color: tc.text }]}>{t('tdahOnboarding.ritual.ritualHourLabel')}</Text>
                    <TextInput
                        accessibilityLabel={t('tdahOnboarding.ritual.ritualHourLabel')}
                        autoCapitalize="none"
                        autoCorrect={false}
                        onChangeText={onChangeRitualHour}
                        placeholder="23:00"
                        placeholderTextColor={tc.secondaryText}
                        style={[styles.input, { borderColor: tc.border, color: tc.text, backgroundColor: tc.inputBg }]}
                        testID="tdah-onboarding-ritual-hour-input"
                        value={ritualHour}
                    />
                    {!ritualHourValid && ritualHour.length > 0 ? (
                        <Text style={[styles.inputError, { color: tc.danger }]}>
                            {t('tdahOnboarding.ritual.invalidRitualHour')}
                        </Text>
                    ) : null}
                </View>

                <View>
                    <Text style={[styles.inputLabel, { color: tc.text }]}>{t('tdahOnboarding.ritual.timeZoneLabel')}</Text>
                    <TextInput
                        accessibilityLabel={t('tdahOnboarding.ritual.timeZoneLabel')}
                        autoCapitalize="none"
                        autoCorrect={false}
                        onChangeText={onChangeTimeZone}
                        placeholderTextColor={tc.secondaryText}
                        style={[styles.input, { borderColor: tc.border, color: tc.text, backgroundColor: tc.inputBg }]}
                        testID="tdah-onboarding-time-zone-input"
                        value={timeZone}
                    />
                    {!timeZoneValid && timeZone.length > 0 ? (
                        <Text style={[styles.inputError, { color: tc.danger }]}>
                            {t('tdahOnboarding.ritual.invalidTimeZone')}
                        </Text>
                    ) : null}
                </View>
            </ScrollView>
            <View style={styles.footer}>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={onBack}
                    style={[styles.button, styles.buttonOutline, { borderColor: tc.border }]}
                    testID="tdah-onboarding-ritual-back"
                >
                    <Text style={[styles.buttonText, { color: tc.text }]}>{t('tdahOnboarding.back')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canContinue }}
                    disabled={!canContinue}
                    onPress={onNext}
                    style={[styles.button, { backgroundColor: filledButton.backgroundColor, opacity: canContinue ? 1 : 0.5 }]}
                    testID="tdah-onboarding-ritual-next"
                >
                    <Text style={[styles.buttonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {t('tdahOnboarding.next')}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}
