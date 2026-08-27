import { Stack } from 'expo-router';

import { TdahLimboScreen } from '@/components/tdah/today/TdahLimboScreen';
import { useLanguage } from '@/contexts/language-context';

/**
 * T-08 route (story 3.4, "El Limbo"). Same thin wrapper pattern
 * tdah-ritual.tsx/tdah-today.tsx already use — a local
 * `<Stack.Screen options={...}>` sets the header title without touching
 * `(drawer)/_layout.tsx` (out of this story's owned files).
 */
export default function TdahLimboRoute() {
    const { t } = useLanguage();
    return (
        <>
            <Stack.Screen options={{ title: t('nav.tdahLimbo') }} />
            <TdahLimboScreen />
        </>
    );
}
