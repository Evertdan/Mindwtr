import React from 'react';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';

import { TdahActivityDetailScreen, type TdahActivityAutoAction } from '@/components/tdah/today/TdahActivityDetailScreen';
import { useLanguage } from '@/contexts/language-context';
import { parseTdahActivityId } from '@/lib/tdah-activity-id';

// Story 2.3: the only two actions a notification tap can drive automatically
// (spec Never: "No completada" stays app-exclusive) — any other value (or
// none) is ignored rather than forwarded.
function toAutoAction(value: string | undefined): TdahActivityAutoAction | undefined {
    return value === 'start' || value === 'complete' ? value : undefined;
}

/** T-02 view mode — tapping a row on T-01's timeline, or a story 2.3 notification tap-through. */
export default function TdahActivityDetailRoute() {
    const { id, autoAction } = useLocalSearchParams<{ id: string; autoAction?: string }>();
    const { t } = useLanguage();
    const activityId = parseTdahActivityId(id);

    if (activityId === null) {
        return <Redirect href="/tdah-today" />;
    }

    return (
        <>
            <Stack.Screen options={{ title: t('tdahActivity.detailTitle') }} />
            <TdahActivityDetailScreen mode="view" activityId={activityId} autoAction={toAutoAction(autoAction)} />
        </>
    );
}
