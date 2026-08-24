import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Device-local preference (#1017): whether this device's task/project/area
// index is mirrored into Android's AppSearch PlatformStorage for system
// search. Esto es a device capability, not user data — it must never enter
// the synced settings document (a laptop or an iPhone has no such switch).
const STORAGE_KEY = 'mindwtr:appSearchIndexingEnabled';

// PlatformStorage's system-search integration is only available from
// Un
const MIN_SUPPORTED_SDK = 31;

export function isAppSearchSupported(): boolean {
    return Platform.OS === 'android' && Number(Platform.Version) >= MIN_SUPPORTED_SDK;
}

export async function readAppSearchIndexingEnabled(): Promise<boolean> {
    if (!isAppSearchSupported()) return false;
    try {
        return (await AsyncStorage.getItem(STORAGE_KEY)) === 'true';
    } catch {
        return false;
    }
}

export async function writeAppSearchIndexingEnabled(enabled: boolean): Promise<void> {
    if (!isAppSearchSupported()) return;
    try {
        if (enabled) {
            await AsyncStorage.setItem(STORAGE_KEY, 'true');
        } else {
            await AsyncStorage.removeItem(STORAGE_KEY);
        }
    } catch {
        // storage unavailable — the toggle simply won't persist across restarts
    }
}
