import type { Attachment } from './types';

/** Local file stat, in a shape every platform's fs API can produce (mtime normalized
 *  to ms since epoch, regardless of the native API's own unit). */
export type LocalFileStat = {
    mtimeMs: number;
    size: number;
};

export type AttachmentContentCheckResult = {
    /** True only once a hash confirms the bytes actually differ from what's recorded.
     *  A bare mtime/size mismatch with a matching hash is NOT a change (#1057: only a
     *  hash change counts). */
    changed: boolean;
    /** The stat this check was run against — callers refresh the attachment's recorded
     *  mtime/size with this even when `changed` is false, so a cosmetic touch (e.g. a
     *  copy that preserves content) doesn't force a hash recompute every cycle. */
    stat: LocalFileStat;
    /** Present whenever a hash was actually computed, i.e. the stat mismatched. */
    hash?: string;
};

/**
 * Check-on-touch content-change detection for one file attachment (#1057). Compares
 * the live file's mtime+size against the attachment's recorded values first (the
 * O(1), no-I/O fast path the perf budget requires); only on a mismatch does it hash
 * the file and compare against the recorded `fileHash` to confirm a real change.
 *
 * Pure and platform-agnostic: `computeHash` is supplied by the caller (each platform
 * reads the file its own way) and is only invoked when the cheap stat check already
 * mismatched.
 */
export async function checkAttachmentContentChange(
    attachment: Pick<Attachment, 'contentMtimeMs' | 'contentSize' | 'fileHash'>,
    stat: LocalFileStat,
    computeHash: () => Promise<string | null>,
): Promise<AttachmentContentCheckResult> {
    const statMatches = attachment.contentMtimeMs === stat.mtimeMs && attachment.contentSize === stat.size;
    if (statMatches) {
        return { changed: false, stat };
    }
    const hash = await computeHash();
    if (!hash) {
        // Can't confirm either way — treat the stat mismatch as a real change rather
        // than silently refreshing recorded stat against unverified bytes.
        return { changed: true, stat };
    }
    if (attachment.fileHash && hash.toLowerCase() === attachment.fileHash.toLowerCase()) {
        return { changed: false, stat, hash };
    }
    return { changed: true, stat, hash };
}

/** Next content revision after a confirmed change. Missing (old client / never
 *  bumped) is equivalent to 0. */
export const bumpAttachmentContentRevision = (attachment: Pick<Attachment, 'contentRev'>): number =>
    (attachment.contentRev ?? 0) + 1;

/** Mutates `attachment` to record the given stat (and hash, if provided) as the
 *  last known-synced content. Shared by every "a transfer just completed, or a
 *  cosmetic touch was confirmed" call site so the three fields always move together. */
export function applyAttachmentContentStat(
    attachment: Pick<Attachment, 'contentMtimeMs' | 'contentSize' | 'fileHash'>,
    stat: LocalFileStat,
    hash?: string,
): void {
    attachment.contentMtimeMs = stat.mtimeMs;
    attachment.contentSize = stat.size;
    if (hash) attachment.fileHash = hash;
}
