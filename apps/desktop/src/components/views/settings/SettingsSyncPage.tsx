import { SyncConfigurationSection } from './sync/SyncConfigurationSection';
import { SyncEncryptionSection } from './sync/SyncEncryptionSection';
import { SyncStatusSection } from './sync/SyncStatusSection';
import type { SettingsSyncPageProps } from './sync/types';

// Layout solo — esto component es la `page-chunk:sync` lazy límite. URL
// validity y `isSyncTargetValid` live in `useSyncSettings`, next to la estado
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
