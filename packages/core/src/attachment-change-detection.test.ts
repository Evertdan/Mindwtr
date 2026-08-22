import { describe, expect, it } from 'vitest';
import {
    applyAttachmentContentStat,
    bumpAttachmentContentRevision,
    checkAttachmentContentChange,
} from './attachment-change-detection';

describe('checkAttachmentContentChange', () => {
    it('is a no-op fast path when mtime and size both match the recorded values', async () => {
        const computeHash = async () => 'should-not-be-called';
        const result = await checkAttachmentContentChange(
            { contentMtimeMs: 1000, contentSize: 10, fileHash: 'abc' },
            { mtimeMs: 1000, size: 10 },
            computeHash,
        );
        expect(result).toEqual({ changed: false, stat: { mtimeMs: 1000, size: 10 } });
    });

    it('confirms a real change when the recomputed hash differs from the recorded one', async () => {
        const result = await checkAttachmentContentChange(
            { contentMtimeMs: 1000, contentSize: 10, fileHash: 'old-hash' },
            { mtimeMs: 2000, size: 20 },
            async () => 'new-hash',
        );
        expect(result).toEqual({ changed: true, stat: { mtimeMs: 2000, size: 20 }, hash: 'new-hash' });
    });

    it('treats a stat mismatch with a matching hash as cosmetic, not a change', async () => {
        const result = await checkAttachmentContentChange(
            { contentMtimeMs: 1000, contentSize: 10, fileHash: 'same-hash' },
            { mtimeMs: 2000, size: 10 },
            async () => 'same-hash',
        );
        expect(result).toEqual({ changed: false, stat: { mtimeMs: 2000, size: 10 }, hash: 'same-hash' });
    });

    it('hash comparison is case-insensitive', async () => {
        const result = await checkAttachmentContentChange(
            { contentMtimeMs: 1000, contentSize: 10, fileHash: 'ABCDEF' },
            { mtimeMs: 2000, size: 10 },
            async () => 'abcdef',
        );
        expect(result.changed).toBe(false);
    });

    it('treats a stat mismatch as a real change when no hash can be computed', async () => {
        const result = await checkAttachmentContentChange(
            { contentMtimeMs: 1000, contentSize: 10, fileHash: 'old-hash' },
            { mtimeMs: 2000, size: 20 },
            async () => null,
        );
        expect(result).toEqual({ changed: true, stat: { mtimeMs: 2000, size: 20 } });
    });

    it('treats a stat mismatch as a real change on a never-tracked attachment (no recorded fileHash)', async () => {
        const result = await checkAttachmentContentChange(
            { contentMtimeMs: undefined, contentSize: undefined, fileHash: undefined },
            { mtimeMs: 2000, size: 20 },
            async () => 'first-hash',
        );
        expect(result).toEqual({ changed: true, stat: { mtimeMs: 2000, size: 20 }, hash: 'first-hash' });
    });
});

describe('bumpAttachmentContentRevision', () => {
    it('treats a missing contentRev as 0', () => {
        expect(bumpAttachmentContentRevision({})).toBe(1);
    });

    it('increments an existing contentRev', () => {
        expect(bumpAttachmentContentRevision({ contentRev: 7 })).toBe(8);
    });
});

describe('applyAttachmentContentStat', () => {
    it('records mtime and size, and only overwrites fileHash when a hash is given', () => {
        const attachment: { contentMtimeMs?: number; contentSize?: number; fileHash?: string } = {
            fileHash: 'old-hash',
        };
        applyAttachmentContentStat(attachment, { mtimeMs: 1, size: 2 });
        expect(attachment).toEqual({ contentMtimeMs: 1, contentSize: 2, fileHash: 'old-hash' });

        applyAttachmentContentStat(attachment, { mtimeMs: 3, size: 4 }, 'new-hash');
        expect(attachment).toEqual({ contentMtimeMs: 3, contentSize: 4, fileHash: 'new-hash' });
    });
});
