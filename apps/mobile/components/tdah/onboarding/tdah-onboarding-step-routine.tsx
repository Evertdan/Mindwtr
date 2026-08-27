import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { useThemeColors } from '@/hooks/use-theme-colors';
import { useFilledButtonColors } from '@/hooks/use-filled-button-colors';
import { useLanguage } from '@/contexts/language-context';

import { styles } from './tdah-onboarding.styles';
import type { TdahRoutineBlockDraft } from './tdah-onboarding-types';

/**
 * The only Rutina pattern this story supports ("Día laboral"). Full block
 * editing is T-04 (story 1.4) — this is a one-tap "accept the suggestion or
 * skip" shortcut, never a builder.
 */
export const TDAH_SUGGESTED_WEEKDAY_ROUTINE_TITLE = 'Día laboral';
export const TDAH_SUGGESTED_WEEKDAY_BLOCKS: TdahRoutineBlockDraft[] = [
    { title: 'Mañana', startTime: '08:00', durationMinutes: 240 },
    { title: 'Tarde', startTime: '13:00', durationMinutes: 240 },
    { title: 'Noche', startTime: '19:00', durationMinutes: 120 },
];

/**
 * T-14 step 3 — primera Rutina o salto. Stitch: Activación 3 — Rutina
 * (`a6c5665284a84bc5a32349fcc96f7707`). Skipping is a first-class path (FR-3):
 * the server keeps generating empty days until a Rutina exists.
 */
export type TdahOnboardingStepRoutineProps = {
    onCreate: () => void;
    onSkip: () => void;
    onBack: () => void;
};

export function TdahOnboardingStepRoutine({ onCreate, onSkip, onBack }: TdahOnboardingStepRoutineProps) {
    const tc = useThemeColors();
    const filledButton = useFilledButtonColors();
    const { t } = useLanguage();

    return (
        <View style={styles.container} testID="tdah-onboarding-step-routine">
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.title, { color: tc.text }]}>{t('tdahOnboarding.routine.title')}</Text>
                <Text style={[styles.body, { color: tc.secondaryText }]}>{t('tdahOnboarding.routine.body')}</Text>

                <View style={[styles.card, { borderColor: tc.border, backgroundColor: tc.cardBg }]}>
                    <Text style={[styles.cardTitle, { color: tc.text }]}>{TDAH_SUGGESTED_WEEKDAY_ROUTINE_TITLE}</Text>
                    {TDAH_SUGGESTED_WEEKDAY_BLOCKS.map((block) => (
                        <View key={block.title} style={styles.row}>
                            <Text style={[styles.cardDescription, { color: tc.text }]}>{block.title}</Text>
                            <Text style={[styles.cardDescription, { color: tc.secondaryText }]}>
                                {block.startTime} · {block.durationMinutes}min
                            </Text>
                        </View>
                    ))}
                </View>
            </ScrollView>
            <View style={styles.footer}>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={onBack}
                    style={[styles.button, styles.buttonOutline, { borderColor: tc.border }]}
                    testID="tdah-onboarding-routine-back"
                >
                    <Text style={[styles.buttonText, { color: tc.text }]}>{t('tdahOnboarding.back')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={onSkip}
                    style={[styles.button, styles.buttonOutline, { borderColor: tc.border }]}
                    testID="tdah-onboarding-routine-skip"
                >
                    <Text style={[styles.buttonText, { color: tc.text }]}>{t('tdahOnboarding.routine.skip')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    accessibilityRole="button"
                    onPress={onCreate}
                    style={[styles.button, { backgroundColor: filledButton.backgroundColor }]}
                    testID="tdah-onboarding-routine-create"
                >
                    <Text style={[styles.buttonText, { color: filledButton.textColor ?? tc.onTint }]}>
                        {t('tdahOnboarding.routine.create')}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}
