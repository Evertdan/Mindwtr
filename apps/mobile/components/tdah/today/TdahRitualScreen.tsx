import React from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { tFallback } from '@mindwtr/core';

import { useLanguage } from '@/contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';

import { styles } from './tdah-today.styles';

/**
 * T-05 placeholder screen (spec 3.1's Never: "nunca construir el contenido
 * real de T-05 -- scoreboard, decision-chips, lista de decisiones -- eso es
 * Story 3.2"; Always: "esta story solo entrega la ruta navegable con el
 * estado 'carga'"). Exists purely so N-03's tap and the two manual-open
 * entries (More sheet tile, T-01 header button) land somewhere real today.
 *
 * Deliberately NOT `tdahToday.loading`'s spinner-style copy: this route has
 * no fetch behind it in this story (Story 3.2 builds that), so a permanent
 * "Loading your day…" would read as a stuck/broken screen to whoever taps
 * N-03 — undermining N-03's own invitational tone ("Cerrá el día — 10
 * minutos y mañana está lista"). This is an honest "not built yet" message
 * instead, styled like T-01's other "vacío digno" states (`emptyTitle` on
 * `centered`) rather than its loading skeleton.
 */
export function TdahRitualScreen() {
    const tc = useThemeColors();
    const { t } = useLanguage();

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]} edges={['bottom']}>
            <View style={styles.centered} testID="tdah-ritual-coming-soon">
                <Text style={[styles.emptyTitle, { color: tc.text }]}>
                    {tFallback(t, 'tdahToday.ritualComingSoon', 'The night ritual is coming soon')}
                </Text>
            </View>
        </SafeAreaView>
    );
}
