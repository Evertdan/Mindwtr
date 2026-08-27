import { Stack } from 'expo-router';

import { TdahTodayScreen } from '@/components/tdah/today/TdahTodayScreen';
import { useLanguage } from '@/contexts/language-context';

/**
 * T-01 route. `(drawer)/_layout.tsx`'s own `<Stack.Screen>` list isn't
 * touched by this story (out of this story's owned files) — this local
 * `<Stack.Screen options={...} />` sets the header title without needing
 * that file edited, the same supported expo-router pattern the app's root
 * `_layout.tsx` already uses for its own top-level Stack.Screen entries.
 */
export default function TdahTodayRoute() {
    const { t } = useLanguage();
    return (
        <>
            <Stack.Screen options={{ title: t('tdahToday.title') }} />
            <TdahTodayScreen />
        </>
    );
}
