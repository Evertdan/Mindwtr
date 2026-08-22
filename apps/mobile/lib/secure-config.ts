import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { CLOUD_TOKEN_KEY, SYNC_ENCRYPTION_KEY_KEY, WEBDAV_PASSWORD_KEY } from './sync-constants';
import {
    deleteSessionSecret,
    evacuateLegacySecretToSession,
    getSessionSecret,
    isSecureStoreAvailable,
    setSessionSecret,
} from './secure-secret-store';

// Sync credentials that must live in the platform keystore (iOS Keychain /
// Android Keystore) rather than plaintext AsyncStorage, which lands in device
// backups. Non-secret sync config (URLs, usernames, flags) stays in
// AsyncStorage on purpose: SecureStore reads are slower and size-limited.
const SECRET_CONFIG_KEYS: ReadonlySet<string> = new Set([
    WEBDAV_PASSWORD_KEY,
    CLOUD_TOKEN_KEY,
    SYNC_ENCRYPTION_KEY_KEY,
]);

export const isSecretConfigKey = (key: string): boolean => SECRET_CONFIG_KEYS.has(key);

// SecureStore keys only allow [A-Za-z0-9._-]; strip the AsyncStorage '@' prefix.
const secureKeyFor = (key: string): string => key.replace(/^@/, '');

// AFTER_FIRST_UNLOCK (not WHEN_UNLOCKED): background sync can fire while the
// device is locked, and these credentials must stay readable there.
const SECURE_WRITE_OPTIONS: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const migrateLegacyValue = async (key: string, legacyValue: string): Promise<void> => {
    await SecureStore.setItemAsync(secureKeyFor(key), legacyValue, SECURE_WRITE_OPTIONS);
    await AsyncStorage.removeItem(key);
};

export const getSecureConfigValue = async (key: string): Promise<string | null> => {
    const secureKey = secureKeyFor(key);
    if (await isSecureStoreAvailable()) {
        const secureValue = await SecureStore.getItemAsync(secureKey);
        if (secureValue !== null) {
            await AsyncStorage.removeItem(key);
            return secureValue;
        }

        const legacyValue = await AsyncStorage.getItem(key);
        if (legacyValue !== null) {
            await migrateLegacyValue(key, legacyValue);
        }
        return legacyValue;
    }

    const sessionValue = getSessionSecret(secureKey);
    if (sessionValue !== null) return sessionValue;

    const legacyValue = await AsyncStorage.getItem(key);
    if (legacyValue !== null) {
        await evacuateLegacySecretToSession(
            secureKey,
            legacyValue,
            () => AsyncStorage.removeItem(key),
        );
    }
    return legacyValue;
};

export const setSecureConfigValue = async (key: string, value: string): Promise<void> => {
    const secureKey = secureKeyFor(key);
    if (await isSecureStoreAvailable()) {
        await SecureStore.setItemAsync(secureKey, value, SECURE_WRITE_OPTIONS);
        await AsyncStorage.removeItem(key);
        deleteSessionSecret(secureKey);
        return;
    }

    await AsyncStorage.removeItem(key);
    setSessionSecret(secureKey, value);
};

export const deleteSecureConfigValue = async (key: string): Promise<void> => {
    const secureKey = secureKeyFor(key);
    if (await isSecureStoreAvailable()) {
        await SecureStore.deleteItemAsync(secureKey);
    }
    await AsyncStorage.removeItem(key);
    deleteSessionSecret(secureKey);
};
