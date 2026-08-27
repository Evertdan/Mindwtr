import { Stack } from 'expo-router';

import { TdahConfirmationScreen } from '@/components/tdah/today/TdahConfirmationScreen';
import { useLanguage } from '@/contexts/language-context';
import { tFallback } from '@mindwtr/core';

/**
 * T-07 route (story 3.3) — T-06's own "Confirmar mañana" CTA lands here.
 * Same local `<Stack.Screen options={...}>` pattern tdah-morning.tsx/
 * tdah-ritual.tsx already use to set the header title without touching
 * `(drawer)/_layout.tsx` (out of this story's owned files).
 */
export default function TdahConfirmationRoute() {
    const { t } = useLanguage();
    return (
        <>
            <Stack.Screen options={{ title: tFallback(t, 'tdahToday.confirmationSuccess', 'Tomorrow is ready.') }} />
            <TdahConfirmationScreen />
        </>
    );
}
