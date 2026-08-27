import { Stack, useLocalSearchParams } from 'expo-router';

import { TdahActivityDetailScreen } from '@/components/tdah/today/TdahActivityDetailScreen';
import { useLanguage } from '@/contexts/language-context';

/**
 * Story 3.3: the only other value T-06's own CTA ever sends here — anything
 * else (or none) keeps this route's existing "today" behavior, same
 * defensive narrowing as [id].tsx's own `toAutoAction`.
 */
function toTargetDate(value: string | undefined): 'today' | 'tomorrow' | undefined {
    return value === 'tomorrow' ? 'tomorrow' : undefined;
}

/**
 * T-02 create mode — the manual-add CTA's destination from T-01, and (story
 * 3.3) T-06's own "Agregar manual" CTA via `targetDate=tomorrow`.
 */
export default function TdahActivityCreateRoute() {
    const { targetDate } = useLocalSearchParams<{ targetDate?: string }>();
    const { t } = useLanguage();
    return (
        <>
            <Stack.Screen options={{ title: t('tdahActivity.createTitle') }} />
            <TdahActivityDetailScreen mode="create" targetDate={toTargetDate(targetDate)} />
        </>
    );
}
