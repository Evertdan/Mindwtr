import { Redirect, Stack, useLocalSearchParams } from 'expo-router';

import { TdahActivityDetailScreen } from '@/components/tdah/today/TdahActivityDetailScreen';
import { useLanguage } from '@/contexts/language-context';

/** T-02 view mode — tapping a row on T-01's timeline. */
export default function TdahActivityDetailRoute() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { t } = useLanguage();
    const activityId = Number(id);

    if (!Number.isFinite(activityId) || activityId <= 0) {
        return <Redirect href="/tdah-today" />;
    }

    return (
        <>
            <Stack.Screen options={{ title: t('tdahActivity.detailTitle') }} />
            <TdahActivityDetailScreen mode="view" activityId={activityId} />
        </>
    );
}
