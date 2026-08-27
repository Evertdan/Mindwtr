import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type PersistentConnectionNativeModule = {
    startForegroundConnection(title: string, text: string, channelName: string): void;
    updateForegroundConnectionStatus(title: string, text: string, channelName: string): void;
    stopForegroundConnection(): void;
    isIgnoringBatteryOptimizations(): boolean;
    requestIgnoreBatteryOptimizations(): void;
};

const nativeModule = Platform.OS === 'android'
    ? requireOptionalNativeModule<PersistentConnectionNativeModule>('PersistentConnection')
    : null;

// Android-only (spec Code Map): the foreground service + its mandatory N-05
// notification are an Android OS requirement with no iOS equivalent — same
// gate as isPersistentCaptureSupported() in persistent-capture-notification.ts.
export function isPersistentConnectionForegroundServiceSupported(): boolean {
    return Platform.OS === 'android';
}

export function startPersistentConnectionForegroundService(title: string, text: string, channelName: string): void {
    if (Platform.OS !== 'android') return;
    nativeModule?.startForegroundConnection?.(title, text, channelName);
}

export function updatePersistentConnectionForegroundServiceStatus(title: string, text: string, channelName: string): void {
    if (Platform.OS !== 'android') return;
    nativeModule?.updateForegroundConnectionStatus?.(title, text, channelName);
}

export function stopPersistentConnectionForegroundService(): void {
    if (Platform.OS !== 'android') return;
    nativeModule?.stopForegroundConnection?.();
}

export function isIgnoringBatteryOptimizations(): boolean {
    if (Platform.OS !== 'android') return true;
    return nativeModule?.isIgnoringBatteryOptimizations?.() ?? true;
}

export function requestIgnoreBatteryOptimizations(): void {
    if (Platform.OS !== 'android') return;
    nativeModule?.requestIgnoreBatteryOptimizations?.();
}
