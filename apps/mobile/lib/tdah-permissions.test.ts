import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetItem = vi.hoisted(() => vi.fn());
const mockSetItem = vi.hoisted(() => vi.fn());
const mockRemoveItem = vi.hoisted(() => vi.fn());
const mockPermissionCheck = vi.hoisted(() => vi.fn());
const mockPermissionRequest = vi.hoisted(() => vi.fn());
const mockSendIntent = vi.hoisted(() => vi.fn());
const platformState = vi.hoisted(() => ({ OS: 'android', Version: 34 }));
const appStateListeners = vi.hoisted(() => [] as ((state: string) => void)[]);
const mockAppStateRemove = vi.hoisted(() => vi.fn());
const mockGetCalendarStatus = vi.hoisted(() => vi.fn());
const mockRequestCalendarPermission = vi.hoisted(() => vi.fn());

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: mockGetItem,
        setItem: mockSetItem,
        removeItem: mockRemoveItem,
    },
}));

vi.mock('react-native', () => ({
    Platform: platformState,
    PermissionsAndroid: {
        check: mockPermissionCheck,
        request: mockPermissionRequest,
        PERMISSIONS: { POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS' },
        RESULTS: { GRANTED: 'granted', DENIED: 'denied', NEVER_ASK_AGAIN: 'never_ask_again' },
    },
    Linking: {
        sendIntent: mockSendIntent,
    },
    AppState: {
        addEventListener: (_event: string, listener: (state: string) => void) => {
            appStateListeners.push(listener);
            return { remove: mockAppStateRemove };
        },
    },
}));

vi.mock('./external-calendar', () => ({
    getSystemCalendarPermissionStatus: mockGetCalendarStatus,
    requestSystemCalendarPermission: mockRequestCalendarPermission,
}));

import {
    getTdahBatteryPermissionStatus,
    getTdahCalendarPermissionStatus,
    getTdahNotificationsPermissionStatus,
    getTdahPermissionsSnapshot,
    isTdahBatteryPermissionApplicable,
    isTdahPermissionDegraded,
    requestTdahBatteryPermission,
    requestTdahCalendarPermission,
    requestTdahNotificationsPermission,
    subscribeTdahBatteryPermissionForegroundRecheck,
} from './tdah-permissions';

const flushAsync = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('tdah-permissions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        appStateListeners.length = 0;
        platformState.OS = 'android';
        platformState.Version = 34;
        mockGetItem.mockResolvedValue(null);
        mockPermissionCheck.mockResolvedValue(false);
        mockPermissionRequest.mockResolvedValue('granted');
        mockSendIntent.mockResolvedValue(undefined);
        mockGetCalendarStatus.mockResolvedValue('undetermined');
        mockRequestCalendarPermission.mockResolvedValue('granted');
    });

    describe('notifications', () => {
        it('checks and requests POST_NOTIFICATIONS on Android 13+', async () => {
            expect(await getTdahNotificationsPermissionStatus()).toBe('undetermined');

            mockPermissionCheck.mockResolvedValue(true);
            expect(await getTdahNotificationsPermissionStatus()).toBe('granted');

            mockPermissionRequest.mockResolvedValue('denied');
            expect(await requestTdahNotificationsPermission()).toBe('denied');
            expect(mockPermissionRequest).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS');
        });

        it('treats pre-13 Android as already granted, without touching PermissionsAndroid', async () => {
            platformState.Version = 32;
            expect(await getTdahNotificationsPermissionStatus()).toBe('granted');
            expect(await requestTdahNotificationsPermission()).toBe('granted');
            expect(mockPermissionCheck).not.toHaveBeenCalled();
            expect(mockPermissionRequest).not.toHaveBeenCalled();
        });

        it('reports undetermined on iOS without ever calling PermissionsAndroid (no native module — see file header)', async () => {
            platformState.OS = 'ios';
            expect(await getTdahNotificationsPermissionStatus()).toBe('undetermined');
            expect(await requestTdahNotificationsPermission()).toBe('undetermined');
            expect(mockPermissionCheck).not.toHaveBeenCalled();
            expect(mockPermissionRequest).not.toHaveBeenCalled();
        });

        it('degrades to undetermined/denied instead of throwing when the platform API rejects', async () => {
            mockPermissionCheck.mockRejectedValue(new Error('boom'));
            expect(await getTdahNotificationsPermissionStatus()).toBe('undetermined');

            mockPermissionRequest.mockRejectedValue(new Error('boom'));
            expect(await requestTdahNotificationsPermission()).toBe('denied');
        });
    });

    describe('battery', () => {
        it('is only applicable on Android', () => {
            expect(isTdahBatteryPermissionApplicable()).toBe(true);
            platformState.OS = 'ios';
            expect(isTdahBatteryPermissionApplicable()).toBe(false);
        });

        it('reports granted on iOS without sending any intent', async () => {
            platformState.OS = 'ios';
            expect(await getTdahBatteryPermissionStatus()).toBe('granted');
            expect(await requestTdahBatteryPermission()).toBe('granted');
            expect(mockSendIntent).not.toHaveBeenCalled();
        });

        it('sends the ignore-battery-optimizations intent and stays undetermined until foreground recheck', async () => {
            expect(await requestTdahBatteryPermission()).toBe('undetermined');
            expect(mockSendIntent).toHaveBeenCalledWith('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
            expect(mockSetItem).toHaveBeenCalledWith('mindwtr:tdah:batteryUnrestrictedPending', 'true');
        });

        it('resolves to denied when sending the intent itself fails', async () => {
            mockSendIntent.mockRejectedValue(new Error('no such intent'));
            expect(await requestTdahBatteryPermission()).toBe('denied');
            expect(mockRemoveItem).toHaveBeenCalledWith('mindwtr:tdah:batteryUnrestrictedPending');
        });

        it('reads back a previously granted battery exemption', async () => {
            mockGetItem.mockImplementation(async (key: string) => (
                key === 'mindwtr:tdah:batteryUnrestrictedGranted' ? 'true' : null
            ));
            expect(await getTdahBatteryPermissionStatus()).toBe('granted');
        });

        it('resolves the pending request to granted on the next foreground event', async () => {
            const onResolved = vi.fn();
            mockGetItem.mockResolvedValue(null);
            const unsubscribe = subscribeTdahBatteryPermissionForegroundRecheck(onResolved);

            // No pending request yet — foreground events are no-ops.
            appStateListeners.forEach((listener) => listener('active'));
            await flushAsync();
            expect(onResolved).not.toHaveBeenCalled();

            mockGetItem.mockImplementation(async (key: string) => (
                key === 'mindwtr:tdah:batteryUnrestrictedPending' ? 'true' : null
            ));
            appStateListeners.forEach((listener) => listener('active'));
            await flushAsync();
            expect(onResolved).toHaveBeenCalledWith('granted');
            expect(mockSetItem).toHaveBeenCalledWith('mindwtr:tdah:batteryUnrestrictedGranted', 'true');
            expect(mockRemoveItem).toHaveBeenCalledWith('mindwtr:tdah:batteryUnrestrictedPending');

            unsubscribe();
            expect(mockAppStateRemove).toHaveBeenCalled();
        });

        it('never subscribes to AppState on iOS', () => {
            platformState.OS = 'ios';
            const unsubscribe = subscribeTdahBatteryPermissionForegroundRecheck(vi.fn());
            expect(appStateListeners).toHaveLength(0);
            unsubscribe();
        });
    });

    describe('calendar', () => {
        it('delegates to external-calendar.ts as-is', async () => {
            mockGetCalendarStatus.mockResolvedValue('denied');
            expect(await getTdahCalendarPermissionStatus()).toBe('denied');

            mockRequestCalendarPermission.mockResolvedValue('granted');
            expect(await requestTdahCalendarPermission()).toBe('granted');
        });
    });

    describe('snapshot', () => {
        it('aggregates all three permissions', async () => {
            mockPermissionCheck.mockResolvedValue(true);
            mockGetItem.mockImplementation(async (key: string) => (
                key === 'mindwtr:tdah:batteryUnrestrictedGranted' ? 'true' : null
            ));
            mockGetCalendarStatus.mockResolvedValue('denied');

            const snapshot = await getTdahPermissionsSnapshot();
            expect(snapshot).toEqual({ notifications: 'granted', battery: 'granted', calendar: 'denied' });
        });

        it('flags any non-granted permission as degraded', () => {
            expect(isTdahPermissionDegraded({ notifications: 'granted', battery: 'granted', calendar: 'granted' })).toBe(false);
            expect(isTdahPermissionDegraded({ notifications: 'denied', battery: 'granted', calendar: 'granted' })).toBe(true);
            expect(isTdahPermissionDegraded({ notifications: 'granted', battery: 'undetermined', calendar: 'granted' })).toBe(true);
        });
    });
});
