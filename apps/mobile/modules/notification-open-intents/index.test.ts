import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Story 2.2 review finding: `consumePendingOpenPayload()`'s normalization
// only forwarded a fixed field allowlist (notificationId/actionIdentifier/
// taskId/projectId/context/kind) that had no `edge` slot, so the
// Activity-trigger notification's start/end edge was silently dropped on
// both the live and Android-cold-start open paths. This exercises the real
// `normalizePayload` (via the exported `consumePendingNotificationOpenPayload`)
// on both platform branches to prove `edge` now survives.

const { requireOptionalNativeModuleMock, androidNativeModule, iosAlarmModule } = vi.hoisted(() => ({
    requireOptionalNativeModuleMock: vi.fn(),
    androidNativeModule: {
        consumePendingOpenPayload: vi.fn(),
    },
    iosAlarmModule: {
        consumePendingNotificationOpenPayload: vi.fn(),
    },
}));

vi.mock('expo-modules-core', () => ({
    requireOptionalNativeModule: requireOptionalNativeModuleMock,
}));

let platformOS: 'android' | 'ios' = 'android';

vi.mock('react-native', () => ({
    NativeModules: {
        get RNAlarmNotification() {
            return iosAlarmModule;
        },
    },
    Platform: {
        get OS() {
            return platformOS;
        },
    },
}));

describe('notification-open-intents index', () => {
    beforeEach(() => {
        requireOptionalNativeModuleMock.mockReset();
        requireOptionalNativeModuleMock.mockReturnValue(androidNativeModule);
        androidNativeModule.consumePendingOpenPayload.mockReset();
        iosAlarmModule.consumePendingNotificationOpenPayload.mockReset();
        platformOS = 'android';
    });

    afterEach(() => {
        vi.resetModules();
    });

    it('carries `edge` through the Android cold-start payload store, alongside the existing allowlisted fields', async () => {
        androidNativeModule.consumePendingOpenPayload.mockReturnValue({
            kind: 'tdah-activity',
            context: '42',
            edge: 'start',
            actionIdentifier: 'start',
        });

        const { consumePendingNotificationOpenPayload } = await import('./index');
        const payload = await consumePendingNotificationOpenPayload();

        expect(payload).toEqual(expect.objectContaining({
            kind: 'tdah-activity',
            context: '42',
            edge: 'start',
            actionIdentifier: 'start',
        }));
    });

    it('reads `edge` out of a nested `data` payload too, the same way `context`/`kind` already are', async () => {
        androidNativeModule.consumePendingOpenPayload.mockReturnValue({
            id: 'notif-1',
            data: JSON.stringify({ kind: 'tdah-activity', context: '7', edge: 'end' }),
        });

        const { consumePendingNotificationOpenPayload } = await import('./index');
        const payload = await consumePendingNotificationOpenPayload();

        expect(payload?.edge).toBe('end');
    });

    it('carries `edge` through the iOS live/pending payload path too', async () => {
        platformOS = 'ios';
        iosAlarmModule.consumePendingNotificationOpenPayload.mockResolvedValue({
            kind: 'tdah-activity',
            context: '9',
            edge: 'start',
        });

        const { consumePendingNotificationOpenPayload } = await import('./index');
        const payload = await consumePendingNotificationOpenPayload();

        expect(payload?.edge).toBe('start');
    });

    it('leaves `edge` undefined when the native payload never set one (GTD reminders, N-05, etc.)', async () => {
        androidNativeModule.consumePendingOpenPayload.mockReturnValue({
            kind: 'task-reminder',
            taskId: 'task-1',
        });

        const { consumePendingNotificationOpenPayload } = await import('./index');
        const payload = await consumePendingNotificationOpenPayload();

        expect(payload?.edge).toBeUndefined();
    });
});
