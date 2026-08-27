import { Stack } from 'expo-router';

import { TdahMorningScreen } from '@/components/tdah/today/TdahMorningScreen';
import { useLanguage } from '@/contexts/language-context';

/**
 * T-06 route. Story 3.2's "Continuar a Mañana" on T-05 needs somewhere real
 * to land — this route only delivers the navigable "próximamente" placeholder
 * (spec Never), same pattern tdah-ritual.tsx used for T-05 in Story 3.1. The
 * real edit/confirm "Mañana" content ships in Story 3.3.
 */
export default function TdahMorningRoute() {
    const { t } = useLanguage();
    return (
        <>
            <Stack.Screen options={{ title: t('nav.tdahMorning') }} />
            <TdahMorningScreen />
        </>
    );
}
