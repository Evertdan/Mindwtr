import { describe, expect, it } from 'vitest';

import { SESSION_RESTORE_WINDOW_MS, shouldRestoreLastView } from './session-restore';

describe('shouldRestoreLastView', () => {
    const now = Date.parse('2026-07-09T12:00:00.000Z');

    it('restores within the window and not after it', () => {
        expect(shouldRestoreLastView(now - 1000, now)).toBe(true);
        expect(shouldRestoreLastView(now - SESSION_RESTORE_WINDOW_MS, now)).toBe(true);
        expect(shouldRestoreLastView(now - SESSION_RESTORE_WINDOW_MS - 1, now)).toBe(false);
    });

    it('tolerates small clock skew but rejects far-future timestamps', () => {
        expect(shouldRestoreLastView(now + 30_000, now)).toBe(true);
        expect(shouldRestoreLastView(now + 5 * 60_000, now)).toBe(false);
    });

    it('rejects missing or malformed timestamps', () => {
        expect(shouldRestoreLastView(undefined, now)).toBe(false);
        expect(shouldRestoreLastView(null, now)).toBe(false);
        expect(shouldRestoreLastView('recent', now)).toBe(false);
        expect(shouldRestoreLastView(Number.NaN, now)).toBe(false);
    });
});
