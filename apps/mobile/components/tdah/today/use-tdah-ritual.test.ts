import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { useTdahRitual, type UseTdahRitualResult } from './use-tdah-ritual';
import type { TdahActivity } from './tdah-today-types';

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

let latest: UseTdahRitualResult | null = null;
let tree: ReactTestRenderer | null = null;

function Harness() {
    latest = useTdahRitual();
    return React.createElement('Harness', null);
}

const mount = async (): Promise<void> => {
    await act(async () => {
        tree = create(React.createElement(Harness));
    });
};

describe('useTdahRitual', () => {
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

    it('moves to ready with the server activities on a successful fetch, reading "hoy" via GET /v1/tdah/day (spec Always)', async () => {
        cloudGetJson.mockResolvedValue({
            date: '2026-08-26',
            timeZone: 'America/Mexico_City',
            routineTitle: 'Día laboral',
            activities: [{
                id: 1, dayPlanDate: '2026-08-26', blockId: null, title: 'X', startTime: '09:00',
                durationMinutes: 30, origin: 'routine', state: 'missed', startedAt: null, completedAt: null,
            }],
        });
        await mount();
        await act(async () => { await latest?.reload(); });

        expect(latest?.phase).toBe('ready');
        expect(latest?.activities).toHaveLength(1);
        expect(latest?.timeZone).toBe('America/Mexico_City');
        expect(cloudGetJson).toHaveBeenCalledWith(
            'https://sync.example.com/v1/tdah/day',
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );
    });

    it('moves to ready (never a separate empty phase) for a day with zero Activities — the recap scoreboard renders all-zero', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', timeZone: 'UTC', routineTitle: null, activities: [] });
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('ready');
        expect(latest?.activities).toEqual([]);
    });

    it('falls back to the device time zone when the server response omits timeZone, without failing the fetch', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', routineTitle: null, activities: [] });
        await mount();
        await act(async () => { await latest?.reload(); });

        expect(latest?.phase).toBe('ready');
        expect(latest?.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });

    it('moves to a clear error phase (never offline) on a malformed response body', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', routineTitle: null, activities: 'not-an-array' });
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('error');
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

    it('moves to the unconfigured phase (never error) when Self-Hosted sync is not configured, without ever fetching', async () => {
        configureCloudSync(null, null);
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('unconfigured');
        expect(cloudGetJson).not.toHaveBeenCalled();
    });

    it('decideActivity POSTs to the decide endpoint with the request body and returns the response Activity', async () => {
        cloudRequestJson.mockResolvedValue({
            activity: {
                id: 3, dayPlanDate: '2026-08-27', blockId: null, title: 'X', startTime: '09:00',
                durationMinutes: 30, origin: 'routine', state: 'pending', startedAt: null, completedAt: null,
            },
        });
        await mount();
        let result: TdahActivity | undefined;
        await act(async () => { result = await latest?.decideActivity(3, { decision: 'move-tomorrow' }); });

        expect(cloudRequestJson).toHaveBeenCalledWith(
            'POST',
            'https://sync.example.com/v1/tdah/activities/3/decide',
            { decision: 'move-tomorrow' },
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );
        expect(result?.state).toBe('pending');
        expect(result?.dayPlanDate).toBe('2026-08-27');
    });

    it('decideActivity never merges the mutated Activity back into `activities` — the recap keeps the original missed/limbo snapshot', async () => {
        cloudGetJson.mockResolvedValue({
            date: '2026-08-26',
            timeZone: 'UTC',
            routineTitle: null,
            activities: [{
                id: 3, dayPlanDate: '2026-08-26', blockId: null, title: 'X', startTime: '09:00',
                durationMinutes: 30, origin: 'routine', state: 'missed', startedAt: null, completedAt: null,
            }],
        });
        cloudRequestJson.mockResolvedValue({
            activity: {
                id: 3, dayPlanDate: '2026-08-27', blockId: null, title: 'X', startTime: '09:00',
                durationMinutes: 30, origin: 'routine', state: 'pending', startedAt: null, completedAt: null,
            },
        });
        await mount();
        await act(async () => { await latest?.reload(); });
        await act(async () => { await latest?.decideActivity(3, { decision: 'move-tomorrow' }); });

        expect(latest?.activities[0]?.state).toBe('missed');
        expect(latest?.activities[0]?.dayPlanDate).toBe('2026-08-26');
    });

    it('decideActivity propagates a 400 TDAH_ACTIVITY_INVALID rejection to the caller (e.g. move-date to a past date)', async () => {
        cloudRequestJson.mockRejectedValue(new MockCloudHttpError('TDAH_ACTIVITY_INVALID', 400));
        await mount();

        await expect(act(async () => {
            await latest?.decideActivity(3, { decision: 'move-date', date: '2020-01-01' });
        })).rejects.toThrow();
    });

    it('decideActivity throws when Self-Hosted sync is not configured', async () => {
        configureCloudSync(null, null);
        await mount();

        await expect(act(async () => {
            await latest?.decideActivity(3, { decision: 'discard' });
        })).rejects.toThrow();
        expect(cloudRequestJson).not.toHaveBeenCalled();
    });
});
