import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';

import { styles } from './tdah-today.styles';

/**
 * T-06 placeholder screen (spec Never: "nunca construir el contenido real
 * de T-06/T-07 -- editar 'Mañana', confirmar -- Story 3.3. El nuevo
 * TdahMorningScreen es un placeholder 'próximamente' idéntico en espíritu
 * al de TdahRitualScreen de 3.1"). "Continuar a Mañana" on T-05 needs
 * somewhere real to land; the real edit/confirm content ships in Story 3.3.
 *
 * Same honest "not built yet" copy as 3.1's own placeholder — never a
 * permanent loading spinner, since there is no fetch behind this route in
 * this story either.
 */
export function TdahMorningScreen() {
    const tc = useThemeColors();
    const { t } = useLanguage();

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]} edges={['bottom']}>
            <View style={styles.centered} testID="tdah-morning-coming-soon">
                <Text style={[styles.emptyTitle, { color: tc.text }]}>
                    {tFallback(t, 'tdahToday.morningComingSoon', "Tomorrow's plan is coming soon")}
                </Text>
            </View>
        </SafeAreaView>
    );
}
