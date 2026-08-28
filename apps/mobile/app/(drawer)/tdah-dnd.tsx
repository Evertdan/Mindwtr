import { Stack } from 'expo-router';

import { TdahDndScreen } from '@/components/tdah/dnd/TdahDndScreen';
import { useLanguage } from '@/contexts/language-context';

/**
 * T-12 route (story 4.3, "Juntas sin vibras"). Same thin wrapper pattern
 * tdah-limbo.tsx/tdah-today.tsx already use — a local
 * `<Stack.Screen options={...}>` sets the header title without touching
 * `(drawer)/_layout.tsx` (out of this story's owned files).
 */
export default function TdahDndRoute() {
    const { t } = useLanguage();
    return (
        <>
            <Stack.Screen options={{ title: t('tdahDnd.title') }} />
            <TdahDndScreen />
        </>
    );
}
