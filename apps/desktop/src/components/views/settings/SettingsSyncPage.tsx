import { SyncConfigurationSection } from './sync/SyncConfigurationSection';
import { SyncEncryptionSection } from './sync/SyncEncryptionSection';
import { SyncStatusSection } from './sync/SyncStatusSection';
import type { SettingsSyncPageProps } from './sync/types';

// Layout only — esto component is the `page-chunk:sync` lazy límite. URL
// validity and `isSyncTargetValid` live in `useSyncSettings`, next to the estado
// they validar.
export function SettingsSyncPage(props: SettingsSyncPageProps) {
    return (
        <div className="space-y-8">
            <SyncConfigurationSection {...props} />
            <SyncEncryptionSection t={props.t} encryption={props.encryption} />
            <SyncStatusSection {...props} />
        </div>
    );
}
