import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { useTdahMorning, type UseTdahMorningResult } from './use-tdah-morning';
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

const activity = (overrides: Partial<TdahActivity> = {}): TdahActivity => ({
    id: 1,
    dayPlanDate: '2026-08-28',
    blockId: null,
    title: 'Correo',
    startTime: '09:00',
    durationMinutes: 30,
    origin: 'routine',
    state: 'pending',
    startedAt: null,
    completedAt: null,
    movedAt: null,
    ...overrides,
});

let latest: UseTdahMorningResult | null = null;
let tree: ReactTestRenderer | null = null;

function Harness() {
    latest = useTdahMorning();
    return React.createElement('Harness', null);
}

const mount = async (): Promise<void> => {
    await act(async () => {
        tree = create(React.createElement(Harness));
    });
};

describe('useTdahMorning', () => {
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

    it('reads "mañana" via GET /v1/tdah/day/tomorrow (spec Always), never the "hoy" endpoint', async () => {
        cloudGetJson.mockResolvedValue({
            date: '2026-08-28', timeZone: 'America/Mexico_City', routineTitle: 'Día laboral',
            activities: [activity()], confirmedAt: null,
        });
        await mount();
        await act(async () => { await latest?.reload(); });

        expect(latest?.phase).toBe('ready');
        expect(latest?.draftActivities).toHaveLength(1);
        expect(latest?.confirmedAt).toBeNull();
        expect(cloudGetJson).toHaveBeenCalledWith(
            'https://sync.example.com/v1/tdah/day/tomorrow',
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );
    });

    // DW-117: the DEVICE_TIME_ZONE fallback (use-tdah-morning.ts:80,183) had no
    // test at all on this surface. The literal is what the pinned test
    // environment produces (TZ=UTC in the test script, enforced by
    // tests/deterministic-environment.test.ts) — never a live `Intl` call,
    // which is what made the sibling assertions in use-tdah-dnd/today/ritual
    // tautological before DW-115.
    it('falls back to the device zone when the server sends no timeZone', async () => {
        cloudGetJson.mockResolvedValue({
            date: '2026-08-28', timeZone: undefined, routineTitle: null,
            activities: [], confirmedAt: null,
        });
        await mount();
        await act(async () => { await latest?.reload(); });

        expect(latest?.timeZone).toBe('UTC');
    });

    it('keeps the server timeZone when it sends one', async () => {
        cloudGetJson.mockResolvedValue({
            date: '2026-08-28', timeZone: 'Asia/Tokyo', routineTitle: null,
            activities: [], confirmedAt: null,
        });
        await mount();
        await act(async () => { await latest?.reload(); });

        expect(latest?.timeZone).toBe('Asia/Tokyo');
    });

    it('surfaces a non-null confirmedAt from the server (soft-lock banner data)', async () => {
        cloudGetJson.mockResolvedValue({
            date: '2026-08-28', timeZone: 'UTC', routineTitle: null, activities: [],
            confirmedAt: '2026-08-27T22:00:00.000Z',
        });
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.confirmedAt).toBe('2026-08-27T22:00:00.000Z');
    });

    it('moves to a clear error phase (never offline) on a malformed response body', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-28', routineTitle: null, activities: 'nope' });
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

    it('moves to the unconfigured phase (never error) when Self-Hosted sync is not configured, without ever fetching', async () => {
        configureCloudSync(null, null);
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('unconfigured');
        expect(cloudGetJson).not.toHaveBeenCalled();
    });

    describe('local draft mutations (spec Always: no request per action)', () => {
        beforeEach(async () => {
            cloudGetJson.mockResolvedValue({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                activities: [
                    activity({ id: 1, title: 'A', startTime: '08:00' }),
                    activity({ id: 2, title: 'B', startTime: '09:00' }),
                    activity({ id: 3, title: 'C', startTime: '10:00' }),
                ],
                confirmedAt: null,
            });
            await mount();
            await act(async () => { await latest?.reload(); });
        });

        it('reorderDraft moves an item without issuing any request', async () => {
            act(() => { latest?.reorderDraft(0, 2); });
            expect(latest?.draftActivities.map((a) => a.id)).toEqual([2, 3, 1]);
            expect(cloudRequestJson).not.toHaveBeenCalled();
        });

        it('updateDraftActivity edits startTime/durationMinutes locally without issuing any request', async () => {
            act(() => { latest?.updateDraftActivity(2, { startTime: '11:30', durationMinutes: 45 }); });
            const edited = latest?.draftActivities.find((a) => a.id === 2);
            expect(edited?.startTime).toBe('11:30');
            expect(edited?.durationMinutes).toBe(45);
            expect(cloudRequestJson).not.toHaveBeenCalled();
        });

        it('deleteDraftActivity removes the row from the draft locally without issuing any request', async () => {
            act(() => { latest?.deleteDraftActivity(2); });
            expect(latest?.draftActivities.map((a) => a.id)).toEqual([1, 3]);
            expect(cloudRequestJson).not.toHaveBeenCalled();
        });
    });

    describe('addManualActivity (spec Always: persists immediately, independent of the confirm draft)', () => {
        beforeEach(async () => {
            cloudGetJson.mockResolvedValue({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                activities: [activity({ id: 1 })], confirmedAt: null,
            });
            await mount();
            await act(async () => { await latest?.reload(); });
        });

        it('POSTs to the tomorrow-activities endpoint and appends the result to the draft', async () => {
            cloudRequestJson.mockResolvedValue({ activity: activity({ id: 9, origin: 'manual', title: 'Nueva' }) });
            let result: TdahActivity | undefined;
            await act(async () => { result = await latest?.addManualActivity({ title: 'Nueva' }); });

            expect(cloudRequestJson).toHaveBeenCalledWith(
                'POST',
                'https://sync.example.com/v1/tdah/day/tomorrow/activities',
                { title: 'Nueva' },
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
            expect(result?.id).toBe(9);
            expect(latest?.draftActivities.map((a) => a.id)).toEqual([1, 9]);
        });
    });

    describe('syncNewActivities (bug fix: "Agregar manual" then "Confirmar mañana" always failing with a 400)', () => {
        beforeEach(async () => {
            cloudGetJson.mockResolvedValue({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                activities: [activity({ id: 1, title: 'A' })],
                confirmedAt: null,
            });
            await mount();
            await act(async () => { await latest?.reload(); });
        });

        it('appends an activity present in a fresh GET but absent from the draft, without touching the rest of the draft', async () => {
            act(() => { latest?.reorderDraft(0, 0); }); // no-op, just establishes the draft is otherwise untouched
            cloudGetJson.mockResolvedValueOnce({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                // Simulates the create screen's own useTdahMorning() instance
                // having POSTed a new manual Activity (id 9) that this
                // instance's own mount-only reload() never re-fetches.
                activities: [
                    activity({ id: 1, title: 'A' }),
                    activity({ id: 9, origin: 'manual', title: 'Nueva' }),
                ],
                confirmedAt: null,
            });
            await act(async () => { await latest?.syncNewActivities(); });

            expect(latest?.draftActivities.map((a) => a.id)).toEqual([1, 9]);
        });

        it('the newly-synced activity is included in the very next confirmMorning() payload (the exact-accounting 400 this fixes)', async () => {
            cloudGetJson.mockResolvedValueOnce({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                activities: [
                    activity({ id: 1, title: 'A' }),
                    activity({ id: 9, origin: 'manual', title: 'Nueva' }),
                ],
                confirmedAt: null,
            });
            await act(async () => { await latest?.syncNewActivities(); });

            cloudRequestJson.mockResolvedValue({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                activities: latest?.draftActivities ?? [],
                confirmedAt: '2026-08-27T22:00:00.000Z',
            });
            await act(async () => { await latest?.confirmMorning(); });

            expect(cloudRequestJson).toHaveBeenCalledWith(
                'POST',
                'https://sync.example.com/v1/tdah/day/tomorrow/confirm',
                expect.objectContaining({
                    activities: [
                        { id: 1, startTime: '09:00', durationMinutes: 30 },
                        { id: 9, startTime: '09:00', durationMinutes: 30 },
                    ],
                }),
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });

        it('never reorders or edits an activity already present in the draft', async () => {
            act(() => { latest?.updateDraftActivity(1, { startTime: '12:00', durationMinutes: 15 }); });
            cloudGetJson.mockResolvedValueOnce({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                // The server's own copy of id 1 still has the old values —
                // syncNewActivities must never write them back over the draft.
                activities: [activity({ id: 1, title: 'A', startTime: '08:00', durationMinutes: 30 })],
                confirmedAt: null,
            });
            await act(async () => { await latest?.syncNewActivities(); });

            const edited = latest?.draftActivities.find((a) => a.id === 1);
            expect(edited?.startTime).toBe('12:00');
            expect(edited?.durationMinutes).toBe(15);
        });
    });

    describe('confirmMorning (spec Always: one grouped request persists the whole draft)', () => {
        beforeEach(async () => {
            cloudGetJson.mockResolvedValue({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                activities: [
                    activity({ id: 1, title: 'A', startTime: '08:00' }),
                    activity({ id: 2, title: 'B', startTime: '09:00' }),
                    activity({ id: 3, title: 'C', startTime: '10:00' }),
                ],
                confirmedAt: null,
            });
            await mount();
            await act(async () => { await latest?.reload(); });
        });

        it('sends every surviving activity in draft order plus deletedActivityIds, and sets confirmedAt on success', async () => {
            act(() => { latest?.reorderDraft(0, 2); }); // [2, 3, 1]
            act(() => { latest?.updateDraftActivity(3, { startTime: '11:00', durationMinutes: 20 }); });
            act(() => { latest?.deleteDraftActivity(1); }); // draft becomes [2, 3]

            cloudRequestJson.mockResolvedValue({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                activities: [
                    activity({ id: 2, title: 'B', startTime: '09:00' }),
                    activity({ id: 3, title: 'C', startTime: '11:00', durationMinutes: 20 }),
                ],
                confirmedAt: '2026-08-27T22:00:00.000Z',
            });

            let outcome: { changesCount: number } | undefined;
            await act(async () => { outcome = await latest?.confirmMorning(); });

            expect(cloudRequestJson).toHaveBeenCalledWith(
                'POST',
                'https://sync.example.com/v1/tdah/day/tomorrow/confirm',
                {
                    activities: [
                        { id: 2, startTime: '09:00', durationMinutes: 30 },
                        { id: 3, startTime: '11:00', durationMinutes: 20 },
                    ],
                    deletedActivityIds: [1],
                },
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
            // 1 edit (id 3) + 1 deletion (id 1) + 0 manual adds this session.
            expect(outcome?.changesCount).toBe(2);
            expect(latest?.confirmedAt).toBe('2026-08-27T22:00:00.000Z');
            expect(latest?.draftActivities.map((a) => a.id)).toEqual([2, 3]);
        });

        // Story 4.2 — the payload half of the read-only band. The display
        // guard in TdahMorningScreen and this filter have to agree: if the
        // band ever reaches the request body, the server answers 409
        // TDAH_ORIGIN_READ_ONLY and the user's whole legitimate confirmation
        // dies with nothing written. Asserted here rather than at the screen,
        // because the screen never sees the body.
        it('never sends the read-only Jira band in the confirm payload, and does not count it as a change', async () => {
            cloudGetJson.mockResolvedValue({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                activities: [
                    activity({ id: 1, title: 'A', startTime: '08:00' }),
                    activity({ id: 7, title: 'Sprint', origin: 'jira', startTime: '09:00', durationMinutes: 540 }),
                    activity({ id: 2, title: 'B', startTime: '14:00' }),
                ],
                confirmedAt: null,
            });
            await act(async () => { await latest?.reload(); });
            // The band is still part of the draft the user SEES...
            expect(latest?.draftActivities.map((a) => a.id)).toEqual([1, 7, 2]);

            cloudRequestJson.mockResolvedValue({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                activities: latest?.draftActivities ?? [],
                confirmedAt: '2026-08-27T22:00:00.000Z',
            });
            let outcome: { changesCount: number } | undefined;
            await act(async () => { outcome = await latest?.confirmMorning(); });

            // ...but never part of what is SENT.
            expect(cloudRequestJson).toHaveBeenCalledWith(
                'POST',
                'https://sync.example.com/v1/tdah/day/tomorrow/confirm',
                {
                    activities: [
                        { id: 1, startTime: '08:00', durationMinutes: 30 },
                        { id: 2, startTime: '14:00', durationMinutes: 30 },
                    ],
                    deletedActivityIds: [],
                },
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
            expect(outcome?.changesCount).toBe(0);
        });

        it('counts a manual addition made this session toward changesCount', async () => {
            cloudRequestJson.mockResolvedValueOnce({ activity: activity({ id: 9, origin: 'manual', title: 'Nueva' }) });
            await act(async () => { await latest?.addManualActivity({ title: 'Nueva' }); });

            cloudRequestJson.mockResolvedValueOnce({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                activities: latest?.draftActivities ?? [],
                confirmedAt: '2026-08-27T22:00:00.000Z',
            });
            let outcome: { changesCount: number } | undefined;
            await act(async () => { outcome = await latest?.confirmMorning(); });
            expect(outcome?.changesCount).toBe(1);
        });

        it('never recounts a manual addition already accounted for by an earlier confirm in the same session (bug fix)', async () => {
            cloudRequestJson.mockResolvedValueOnce({ activity: activity({ id: 9, origin: 'manual', title: 'Nueva' }) });
            await act(async () => { await latest?.addManualActivity({ title: 'Nueva' }); });

            cloudRequestJson.mockResolvedValueOnce({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                activities: latest?.draftActivities ?? [],
                confirmedAt: '2026-08-27T22:00:00.000Z',
            });
            let firstOutcome: { changesCount: number } | undefined;
            await act(async () => { firstOutcome = await latest?.confirmMorning(); });
            expect(firstOutcome?.changesCount).toBe(1);

            // A second confirmMorning() later in the same mounted session
            // (the documented soft-lock re-entry/reconfirm flow), with no
            // further edits since the first confirm succeeded.
            cloudRequestJson.mockResolvedValueOnce({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                activities: latest?.draftActivities ?? [],
                confirmedAt: '2026-08-27T23:00:00.000Z',
            });
            let secondOutcome: { changesCount: number } | undefined;
            await act(async () => { secondOutcome = await latest?.confirmMorning(); });
            expect(secondOutcome?.changesCount).toBe(0);
        });

        it('a pure drag-reorder with no other edits reports a nonzero changesCount (bug fix — T-07 previously saw 0)', async () => {
            act(() => { latest?.reorderDraft(0, 2); }); // [1, 2, 3] -> [2, 3, 1]
            cloudRequestJson.mockResolvedValue({
                date: '2026-08-28', timeZone: 'UTC', routineTitle: null,
                activities: [
                    activity({ id: 2, title: 'B', startTime: '09:00' }),
                    activity({ id: 3, title: 'C', startTime: '10:00' }),
                    activity({ id: 1, title: 'A', startTime: '08:00' }),
                ],
                confirmedAt: '2026-08-27T22:00:00.000Z',
            });
            let outcome: { changesCount: number } | undefined;
            await act(async () => { outcome = await latest?.confirmMorning(); });
            expect(outcome?.changesCount).toBe(1);
        });

        it('leaves the draft fully intact on a rejected confirm (spec Error Handling: borrador local no se pierde)', async () => {
            act(() => { latest?.deleteDraftActivity(2); });
            cloudRequestJson.mockRejectedValue(new MockCloudHttpError('TDAH_ACTIVITY_INVALID', 400));

            await expect(act(async () => {
                await latest?.confirmMorning();
            })).rejects.toThrow();

            expect(latest?.draftActivities.map((a) => a.id)).toEqual([1, 3]);
            expect(latest?.confirmedAt).toBeNull();
        });

        it('leaves the draft intact on a network-level failure too', async () => {
            cloudRequestJson.mockRejectedValue(new Error('network down'));
            await expect(act(async () => {
                await latest?.confirmMorning();
            })).rejects.toThrow();
            expect(latest?.draftActivities).toHaveLength(3);
        });

        it('throws when Self-Hosted sync is not configured, without issuing a request', async () => {
            configureCloudSync(null, null);
            await expect(act(async () => {
                await latest?.confirmMorning();
            })).rejects.toThrow();
            expect(cloudRequestJson).not.toHaveBeenCalled();
        });
    });
});
