import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { useTdahLimbo, type UseTdahLimboResult } from './use-tdah-limbo';
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

const buildActivity = (id: number, overrides: Partial<TdahActivity> = {}): TdahActivity => ({
    id, dayPlanDate: '2026-08-20', blockId: null, title: `Activity ${id}`, startTime: '09:00',
    durationMinutes: 30, origin: 'routine', state: 'limbo', startedAt: null, completedAt: null,
    ...overrides,
});

let latest: UseTdahLimboResult | null = null;
let tree: ReactTestRenderer | null = null;

function Harness() {
    latest = useTdahLimbo();
    return React.createElement('Harness', null);
}

const mount = async (): Promise<void> => {
    await act(async () => {
        tree = create(React.createElement(Harness));
    });
};

describe('useTdahLimbo', () => {
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

    it('moves to ready with the server activities on a successful GET /v1/tdah/limbo, no date/zone scoping', async () => {
        cloudGetJson.mockResolvedValue({ activities: [buildActivity(1), buildActivity(2)] });
        await mount();
        await act(async () => { await latest?.reload(); });

        expect(latest?.phase).toBe('ready');
        expect(latest?.activities).toHaveLength(2);
        expect(cloudGetJson).toHaveBeenCalledWith(
            'https://sync.example.com/v1/tdah/limbo',
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );
    });

    it('moves to ready for an empty Limbo (no separate empty phase)', async () => {
        cloudGetJson.mockResolvedValue({ activities: [] });
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('ready');
        expect(latest?.activities).toEqual([]);
    });

    it('moves to a clear error phase (never offline) on a malformed response body', async () => {
        cloudGetJson.mockResolvedValue({ activities: 'not-an-array' });
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

    describe('selection', () => {
        it('toggles an id in and out of the selection set', async () => {
            cloudGetJson.mockResolvedValue({ activities: [buildActivity(1)] });
            await mount();
            await act(async () => { await latest?.reload(); });

            act(() => { latest?.toggleSelect(1); });
            expect(latest?.selectedIds.has(1)).toBe(true);
            act(() => { latest?.toggleSelect(1); });
            expect(latest?.selectedIds.has(1)).toBe(false);
        });

        it('prunes a previously-selected id that a fresh reload no longer confirms as limbo', async () => {
            cloudGetJson.mockResolvedValue({ activities: [buildActivity(1), buildActivity(2)] });
            await mount();
            await act(async () => { await latest?.reload(); });
            act(() => { latest?.toggleSelect(1); latest?.toggleSelect(2); });
            expect(latest?.selectedIds.size).toBe(2);

            // id 1 was decided elsewhere (e.g. T-05) between the two reloads.
            cloudGetJson.mockResolvedValue({ activities: [buildActivity(2)] });
            await act(async () => { await latest?.reload(); });

            expect(latest?.selectedIds.has(1)).toBe(false);
            expect(latest?.selectedIds.has(2)).toBe(true);
        });

        it('clearSelection empties the set', async () => {
            cloudGetJson.mockResolvedValue({ activities: [buildActivity(1)] });
            await mount();
            await act(async () => { await latest?.reload(); });
            act(() => { latest?.toggleSelect(1); });
            act(() => { latest?.clearSelection(); });
            expect(latest?.selectedIds.size).toBe(0);
        });
    });

    describe('decideOne — T-08 is a live work tray, unlike T-05\'s read-only recap', () => {
        it('POSTs to the existing single-id decide endpoint and removes the Activity from the list on success', async () => {
            cloudGetJson.mockResolvedValue({ activities: [buildActivity(1), buildActivity(2)] });
            await mount();
            await act(async () => { await latest?.reload(); });

            cloudRequestJson.mockResolvedValue({ activity: buildActivity(1, { state: 'completed', completedAt: '2026-08-27T10:00:00Z' }) });
            let result: TdahActivity | undefined;
            await act(async () => { result = await latest?.decideOne(1, { decision: 'complete-late' }); });

            expect(cloudRequestJson).toHaveBeenCalledWith(
                'POST',
                'https://sync.example.com/v1/tdah/activities/1/decide',
                { decision: 'complete-late' },
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
            expect(result?.state).toBe('completed');
            expect(latest?.activities.map((activity) => activity.id)).toEqual([2]);
        });

        it('drops a decided id out of the selection set too', async () => {
            cloudGetJson.mockResolvedValue({ activities: [buildActivity(1)] });
            await mount();
            await act(async () => { await latest?.reload(); });
            act(() => { latest?.toggleSelect(1); });

            cloudRequestJson.mockResolvedValue({ activity: buildActivity(1, { state: 'discarded' }) });
            await act(async () => { await latest?.decideOne(1, { decision: 'discard' }); });

            expect(latest?.selectedIds.has(1)).toBe(false);
        });

        it('propagates a rejection to the caller and leaves the list untouched', async () => {
            cloudGetJson.mockResolvedValue({ activities: [buildActivity(1)] });
            await mount();
            await act(async () => { await latest?.reload(); });

            cloudRequestJson.mockRejectedValue(new MockCloudHttpError('TDAH_ACTIVITY_INVALID', 400));
            await expect(act(async () => {
                await latest?.decideOne(1, { decision: 'move-date', date: '2020-01-01' });
            })).rejects.toThrow();
            expect(latest?.activities.map((activity) => activity.id)).toEqual([1]);
        });

        it('throws when Self-Hosted sync is not configured', async () => {
            configureCloudSync(null, null);
            await mount();
            await expect(act(async () => {
                await latest?.decideOne(1, { decision: 'discard' });
            })).rejects.toThrow();
            expect(cloudRequestJson).not.toHaveBeenCalled();
        });
    });

    describe('decideBatch — atomic, built from the current selection', () => {
        it('POSTs every selected id plus the decision to the batch endpoint, removes the applied ids, and clears the selection', async () => {
            cloudGetJson.mockResolvedValue({ activities: [buildActivity(1), buildActivity(2), buildActivity(3)] });
            await mount();
            await act(async () => { await latest?.reload(); });
            act(() => { latest?.toggleSelect(1); latest?.toggleSelect(2); });

            cloudRequestJson.mockResolvedValue({
                activities: [
                    buildActivity(1, { state: 'pending', dayPlanDate: '2026-08-28' }),
                    buildActivity(2, { state: 'pending', dayPlanDate: '2026-08-28' }),
                ],
            });
            let result: TdahActivity[] | undefined;
            await act(async () => { result = await latest?.decideBatch({ decision: 'move-tomorrow' }); });

            expect(cloudRequestJson).toHaveBeenCalledWith(
                'POST',
                'https://sync.example.com/v1/tdah/limbo/decide',
                { activityIds: [1, 2], decision: { decision: 'move-tomorrow' } },
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
            expect(result).toHaveLength(2);
            expect(latest?.activities.map((activity) => activity.id)).toEqual([3]);
            expect(latest?.selectedIds.size).toBe(0);
        });

        it('propagates a rejection to the caller and leaves both the list and the selection untouched (spec: "todo o nada")', async () => {
            cloudGetJson.mockResolvedValue({ activities: [buildActivity(1), buildActivity(2)] });
            await mount();
            await act(async () => { await latest?.reload(); });
            act(() => { latest?.toggleSelect(1); latest?.toggleSelect(2); });

            cloudRequestJson.mockRejectedValue(new MockCloudHttpError('TDAH_ACTIVITY_INVALID', 400));
            await expect(act(async () => {
                await latest?.decideBatch({ decision: 'discard' });
            })).rejects.toThrow();

            expect(latest?.activities.map((activity) => activity.id)).toEqual([1, 2]);
            expect(latest?.selectedIds).toEqual(new Set([1, 2]));
        });

        it('throws when Self-Hosted sync is not configured', async () => {
            configureCloudSync(null, null);
            await mount();
            await expect(act(async () => {
                await latest?.decideBatch({ decision: 'discard' });
            })).rejects.toThrow();
            expect(cloudRequestJson).not.toHaveBeenCalled();
        });
    });
});
