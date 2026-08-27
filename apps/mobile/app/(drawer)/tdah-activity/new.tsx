import { Stack } from 'expo-router';

import { TdahActivityDetailScreen } from '@/components/tdah/today/TdahActivityDetailScreen';
import { useLanguage } from '@/contexts/language-context';

/** T-02 create mode — the manual-add CTA's destination from T-01. */
export default function TdahActivityCreateRoute() {
    const { t } = useLanguage();
    return (
        <>
            <Stack.Screen options={{ title: t('tdahActivity.createTitle') }} />
            <TdahActivityDetailScreen mode="create" />
        </>
    );
}
