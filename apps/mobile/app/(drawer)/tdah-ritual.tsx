import { Stack } from 'expo-router';

import { TdahRitualScreen } from '@/components/tdah/today/TdahRitualScreen';
import { useLanguage } from '@/contexts/language-context';

/**
 * T-05 route. Story 3.1 ("La invitación nocturna") only delivers the
 * navigable route with the "carga" placeholder state — the real
 * scoreboard/decision-chips/Limbo list ship in Story 3.2 (spec Never:
 * "nunca construir el contenido real de T-05"). Same local
 * `<Stack.Screen options={...}>` pattern tdah-today.tsx already uses to set
 * the header title without touching `(drawer)/_layout.tsx` (out of this
 * story's owned files).
 */
export default function TdahRitualRoute() {
    const { t } = useLanguage();
    return (
        <>
            <Stack.Screen options={{ title: t('nav.tdahRitual') }} />
            <TdahRitualScreen />
        </>
    );
}
