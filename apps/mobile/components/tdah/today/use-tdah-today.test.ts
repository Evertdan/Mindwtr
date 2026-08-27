import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTdahToday, type UseTdahTodayResult } from './use-tdah-today';

const { MockCloudHttpError, cloudGetJson, cloudRequestJson } = vi.hoisted(() => {
    class HoistedMockCloudHttpError extends Error {
        status: number;
        constructor(message: string, status: number) {
            super(message);
            this.status = status;
        }
    }
    return {
        MockCloudHttpError: HoistedMockCloudHttpError,
        cloudGetJson: vi.fn(),
        cloudRequestJson: vi.fn(),
    };
});

vi.mock('@mindwtr/core', () => ({
    cloudGetJson: (...args: unknown[]) => cloudGetJson(...args),
    cloudRequestJson: (...args: unknown[]) => cloudRequestJson(...args),
    CloudHttpError: MockCloudHttpError,
    getCloudBaseUrl: (url: string) => `${url.replace(/\/+$/, '')}/v1`,
}));

const asyncStorageGetItem = vi.fn();
vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: (...args: unknown[]) => asyncStorageGetItem(...args),
    },
}));

const getSecureConfigValue = vi.fn();
vi.mock('@/lib/secure-config', () => ({
    getSecureConfigValue: (...args: unknown[]) => getSecureConfigValue(...args),
}));

vi.mock('@/lib/webdav-request-options', () => ({
    getMobileCloudRequestOptions: () => ({}),
}));

const CLOUD_URL = 'https://sync.example.com';
const CLOUD_TOKEN = 'cloud-token-1234567890';

const configureCloudSync = (url: string | null = CLOUD_URL, token: string | null = CLOUD_TOKEN): void => {
    asyncStorageGetItem.mockImplementation(async (key: string) => {
        if (key === '@mindwtr_cloud_url') return url;
        if (key === '@mindwtr_cloud_allow_insecure_http') return 'false';
        return null;
    });
    getSecureConfigValue.mockImplementation(async (key: string) => (
        key === '@mindwtr_cloud_token' ? token : null
    ));
};

let latest: UseTdahTodayResult | null = null;
let tree: ReactTestRenderer | null = null;

function Harness() {
    latest = useTdahToday();
    return React.createElement('Harness', null);
}

const mount = async (): Promise<void> => {
    await act(async () => {
        tree = create(React.createElement(Harness));
    });
};

describe('useTdahToday', () => {
    beforeEach(() => {
        cloudGetJson.mockReset();
        cloudRequestJson.mockReset();
        asyncStorageGetItem.mockReset();
        getSecureConfigValue.mockReset();
        configureCloudSync();
        latest = null;
    });

    afterEach(() => {
        if (tree) {
            act(() => {
                tree?.unmount();
            });
        }
        tree = null;
    });

    it('starts in the loading phase and never fetches before reload() is called', async () => {
        await mount();
        expect(latest?.phase).toBe('loading');
        expect(cloudGetJson).not.toHaveBeenCalled();
    });

    it('moves to ready with the server activities on a successful fetch', async () => {
        cloudGetJson.mockResolvedValue({
            date: '2026-08-26',
            timeZone: 'America/Mexico_City',
            routineTitle: 'Día laboral',
            activities: [{
                id: 1, dayPlanDate: '2026-08-26', blockId: null, title: 'X', startTime: '09:00',
                durationMinutes: 30, origin: 'routine', state: 'pending', startedAt: null, completedAt: null,
            }],
        });
        await mount();
        await act(async () => { await latest?.reload(); });

        expect(latest?.phase).toBe('ready');
        expect(latest?.routineTitle).toBe('Día laboral');
        expect(latest?.activities).toHaveLength(1);
        // AD-6: threaded straight from the server's own `timeZone` field, for
        // TdahNowLine to resolve "now" against — never a device-local value.
        expect(latest?.timeZone).toBe('America/Mexico_City');
        expect(cloudGetJson).toHaveBeenCalledWith(
            'https://sync.example.com/v1/tdah/day',
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );
    });

    it('falls back to the device time zone when the server response omits timeZone, without failing the fetch', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', routineTitle: null, activities: [] });
        await mount();
        await act(async () => { await latest?.reload(); });

        expect(latest?.phase).toBe('empty');
        expect(latest?.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });

    it('moves to a clear error phase (never offline) on a malformed response body, e.g. activities missing or not an array', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', routineTitle: null, activities: 'not-an-array' });
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('error');
    });

    it('moves to empty when the day has no activities (no Rutina applies)', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', routineTitle: null, activities: [] });
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('empty');
    });

    it('moves to the offline phase on a network-level failure, never a generic error', async () => {
        cloudGetJson.mockRejectedValue(new Error('network down'));
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('offline');
    });

    it('moves to the error phase on a real server error response', async () => {
        cloudGetJson.mockRejectedValue(new MockCloudHttpError('server exploded', 500));
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('error');
    });

    it('moves to the error phase when Self-Hosted sync is not configured, without ever fetching', async () => {
        configureCloudSync(null, null);
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('error');
        expect(cloudGetJson).not.toHaveBeenCalled();
    });

    it('createManualActivity POSTs to /tdah/day/activities and merges the created Activity', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', routineTitle: null, activities: [] });
        cloudRequestJson.mockResolvedValue({
            activity: {
                id: 2, dayPlanDate: '2026-08-26', blockId: null, title: 'Manual', startTime: '10:00',
                durationMinutes: 0, origin: 'manual', state: 'pending', startedAt: null, completedAt: null,
            },
        });
        await mount();
        await act(async () => { await latest?.reload(); });
        await act(async () => { await latest?.createManualActivity({ title: 'Manual' }); });

        expect(cloudRequestJson).toHaveBeenCalledWith(
            'POST',
            'https://sync.example.com/v1/tdah/day/activities',
            { title: 'Manual' },
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );
        expect(latest?.activities.map((activity) => activity.id)).toEqual([2]);
    });

    it('registerActivityAction POSTs to the action URL and merges the returned Activity by id', async () => {
        const activity = {
            id: 3, dayPlanDate: '2026-08-26', blockId: null, title: 'X', startTime: '09:00',
            durationMinutes: 30, origin: 'routine' as const, state: 'pending' as const, startedAt: null, completedAt: null,
        };
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', routineTitle: null, activities: [activity] });
        cloudRequestJson.mockResolvedValue({ activity: { ...activity, state: 'started', startedAt: '2026-08-26T09:00:00.000Z' } });

        await mount();
        await act(async () => { await latest?.reload(); });
        await act(async () => { await latest?.registerActivityAction(3, 'start'); });

        expect(cloudRequestJson).toHaveBeenCalledWith(
            'POST',
            'https://sync.example.com/v1/tdah/activities/3/start',
            undefined,
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );
        expect(latest?.activities[0]?.state).toBe('started');
        expect(latest?.activities[0]?.startedAt).toBe('2026-08-26T09:00:00.000Z');
    });
});
