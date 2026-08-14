import { describe, expect, it } from 'vitest';

import { settleStoreAction } from './store-action-result';

describe('settleStoreAction', () => {
    it('treats a void result as successful', async () => {
        await expect(settleStoreAction(() => undefined)).resolves.toEqual({
            ok: true,
            result: undefined,
        });
    });

    it('preserves a successful payload by identity', async () => {
        const result = { success: true, id: 'task-1', ids: ['task-1'], reused: true };

        const outcome = await settleStoreAction(() => result);

        expect(outcome).toEqual({ ok: true, result });
        if (outcome.ok) {
            expect(outcome.result).toBe(result);
        }
    });

    it('uses the trimmed message from a structured failure', async () => {
        await expect(settleStoreAction(() => ({ success: false, error: ' message ' }))).resolves.toEqual({
            ok: false,
            message: 'message',
        });
    });

    it('omits the message for a blank structured error', async () => {
        const outcome = await settleStoreAction(() => ({ success: false, error: '   ' }));

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
            expect(outcome.message).toBeUndefined();
        }
    });

    it('normalizes a synchronous throw and preserves its cause', async () => {
        const cause = new Error('synchronous failure');
        const outcome = await settleStoreAction(() => {
            throw cause;
        });

        expect(outcome).toEqual({
            ok: false,
            message: 'synchronous failure',
            cause,
        });
    });

    it('normalizes a rejected promise and preserves its cause', async () => {
        const cause = ' rejected failure ';

        await expect(settleStoreAction(() => Promise.reject(cause))).resolves.toEqual({
            ok: false,
            message: 'rejected failure',
            cause,
        });
    });
});
