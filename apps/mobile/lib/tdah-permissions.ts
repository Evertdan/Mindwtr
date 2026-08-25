import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';

import { getSystemCalendarPermissionStatus, requestSystemCalendarPermission } from './external-calendar';

/**
 * Single wrapper for the three T-14 step-4 permissions (notifications,
 * battery-unrestricted, calendar). Same tri-state shape as
 * `SystemCalendarPermissionStatus` in `external-calendar.ts` so all three
 * render through one status pill. Every permission here is degradable —
 * nothing in this module ever throws to block the onboarding flow.
 */
export type TdahPermissionStatus = 'undetermined' | 'granted' | 'denied';

export type TdahPermissionsSnapshot = {
    notifications: TdahPermissionStatus;
    battery: TdahPermissionStatus;
    calendar: TdahPermissionStatus;
};

const BATTERY_OPTIMIZATION_INTENT = 'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS';
const BATTERY_PENDING_KEY = 'mindwtr:tdah:batteryUnrestrictedPending';
const BATTERY_GRANTED_KEY = 'mindwtr:tdah:batteryUnrestrictedGranted';
const ANDROID_NOTIFICATION_PERMISSION_MIN_SDK = 33;

// --- Notifications ---------------------------------------------------------
// Android: same `PermissionsAndroid` primitive `persistent-capture-notification.ts`
// already uses for `.check`. iOS: no wrapper exists here on purpose — the
// obvious library (`expo-notifications`) links `com.google.firebase:firebase-messaging`
// unconditionally on Android (confirmed in its `android/build.gradle`, no plugin
// option gates it out), which trips `verify_foss_no_google_services.py`. Adding a
// dedicated native module for one story's permission prompt is disproportionate
// (same reasoning as the battery exemption below), so iOS reports 'undetermined'
// and is skipped by `requestTdahNotificationsPermission` — deferred to whichever
// story gives this app real notification delivery (Epic 2) and can justify a
// proper cross-platform module.

export async function getTdahNotificationsPermissionStatus(): Promise<TdahPermissionStatus> {
    if (Platform.OS === 'android') {
        if (Platform.Version < ANDROID_NOTIFICATION_PERMISSION_MIN_SDK) return 'granted';
        try {
            const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
            // PermissionsAndroid.check cannot distinguish "denied" from
            // "never asked" (an RN/Android platform limitation) — both are
            // reported as 'undetermined' so step 4 always offers the request.
            return granted ? 'granted' : 'undetermined';
        } catch {
            return 'undetermined';
        }
    }
    return 'undetermined';
}

export async function requestTdahNotificationsPermission(): Promise<TdahPermissionStatus> {
    if (Platform.OS === 'android') {
        if (Platform.Version < ANDROID_NOTIFICATION_PERMISSION_MIN_SDK) return 'granted';
        try {
            const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
            return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
        } catch {
            return 'denied';
        }
    }
    return 'undetermined';
}

// --- Battery (unrestricted / Doze exemption) --------------------------------
// Android-only (FR boundary — no action on iOS). There is no OS API to read
// whether the exemption is granted without a native module, and adding one
// for a single story is disproportionate (see spec Design Notes), so the
// intent is fire-and-forget: `Linking.sendIntent` opens the system screen and
// the only observable signal is the app returning to the foreground —
// tracked below the same way `keepPersistentCaptureNotificationArmed` re-arms
// the persistent-capture notification on `AppState` → 'active'.

export function isTdahBatteryPermissionApplicable(): boolean {
    return Platform.OS === 'android';
}

export async function getTdahBatteryPermissionStatus(): Promise<TdahPermissionStatus> {
    if (!isTdahBatteryPermissionApplicable()) return 'granted';
    try {
        const granted = await AsyncStorage.getItem(BATTERY_GRANTED_KEY);
        return granted === 'true' ? 'granted' : 'undetermined';
    } catch {
        return 'undetermined';
    }
}

export async function requestTdahBatteryPermission(): Promise<TdahPermissionStatus> {
    if (!isTdahBatteryPermissionApplicable()) return 'granted';
    try {
        await AsyncStorage.setItem(BATTERY_PENDING_KEY, 'true');
        await Linking.sendIntent(BATTERY_OPTIMIZATION_INTENT);
        // Real status is only known once the user returns to the app — see
        // `subscribeTdahBatteryPermissionForegroundRecheck`.
        return 'undetermined';
    } catch {
        try {
            await AsyncStorage.removeItem(BATTERY_PENDING_KEY);
        } catch {
            // storage unavailable — nothing left to clean up
        }
        return 'denied';
    }
}

async function recheckPendingBatteryPermission(): Promise<TdahPermissionStatus | null> {
    if (!isTdahBatteryPermissionApplicable()) return null;
    try {
        const pending = await AsyncStorage.getItem(BATTERY_PENDING_KEY);
        if (pending !== 'true') return null;
        await AsyncStorage.setItem(BATTERY_GRANTED_KEY, 'true');
        await AsyncStorage.removeItem(BATTERY_PENDING_KEY);
        return 'granted';
    } catch {
        return null;
    }
}

/**
 * Re-checks the pending battery request every time the app returns to the
 * foreground (mirrors `keepPersistentCaptureNotificationArmed`). Calls
 * `onBatteryResolved` once a pending request resolves; a no-op on iOS/web.
 * Returns an unsubscribe.
 */
export function subscribeTdahBatteryPermissionForegroundRecheck(
    onBatteryResolved: (status: TdahPermissionStatus) => void,
): () => void {
    if (!isTdahBatteryPermissionApplicable()) return () => {};
    const subscription = AppState.addEventListener('change', (state) => {
        if (state !== 'active') return;
        void recheckPendingBatteryPermission().then((status) => {
            if (status) onBatteryResolved(status);
        });
    });
    return () => subscription.remove();
}

// --- Calendar ---------------------------------------------------------------
// Reuses `external-calendar.ts` as-is (already the same tri-state shape).

export async function getTdahCalendarPermissionStatus(): Promise<TdahPermissionStatus> {
    return getSystemCalendarPermissionStatus();
}

export async function requestTdahCalendarPermission(): Promise<TdahPermissionStatus> {
    return requestSystemCalendarPermission();
}

// --- Aggregate snapshot ------------------------------------------------------

export async function getTdahPermissionsSnapshot(): Promise<TdahPermissionsSnapshot> {
    const [notifications, battery, calendar] = await Promise.all([
        getTdahNotificationsPermissionStatus(),
        getTdahBatteryPermissionStatus(),
        getTdahCalendarPermissionStatus(),
    ]);
    return { notifications, battery, calendar };
}

export function isTdahPermissionDegraded(snapshot: TdahPermissionsSnapshot): boolean {
    return snapshot.notifications !== 'granted'
        || snapshot.battery !== 'granted'
        || snapshot.calendar !== 'granted';
}
