/**
 * Read-only iCalendar subscription feed (#952).
 *
 * The feed URL carries its own unguessable token, stored per namespace in a
 * sidecar file next to that namespace's data. It is deliberately independent of
 * the sync auth token: rotating or revoking the feed never touches sync, and a
 * leaked feed URL grants nothing but read access to the calendar events.
 */
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { join } from 'path';
import { buildCalendarFeed } from '@mindwtr/core';

import { corsOrigin } from './server-config';
import { loadAppData } from './server-data-cache';
import { writeData } from './server-storage';

const FEED_FILE_SUFFIX = '.ics.json';
const FEED_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export const CALENDAR_FEED_PATH_PREFIX = '/v1/calendar/';

export type CalendarFeedRecord = {
    createdAt: string;
    token: string;
};

const feedFilePath = (dataDir: string, key: string): string => join(dataDir, `${key}${FEED_FILE_SUFFIX}`);

const readFeedFile = (filePath: string): CalendarFeedRecord | null => {
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<CalendarFeedRecord>;
        if (typeof parsed?.token !== 'string' || !FEED_TOKEN_PATTERN.test(parsed.token)) return null;
        return {
            token: parsed.token,
            createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
        };
    } catch {
        return null;
    }
};

export const readCalendarFeed = (dataDir: string, key: string): CalendarFeedRecord | null => (
    readFeedFile(feedFilePath(dataDir, key))
);

/** Creates the namespace's feed token, replacing any existing one. */
export const rotateCalendarFeed = (dataDir: string, key: string): CalendarFeedRecord => {
    const record: CalendarFeedRecord = {
        token: randomBytes(32).toString('hex'),
        createdAt: new Date().toISOString(),
    };
    writeData(feedFilePath(dataDir, key), record);
    return record;
};

export const revokeCalendarFeed = (dataDir: string, key: string): boolean => {
    const filePath = feedFilePath(dataDir, key);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
};

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

const isSameToken = (left: string, right: string): boolean => timingSafeEqual(digest(left), digest(right));

/**
 * Maps a feed token back to its namespace.
 *
 * ponytail: linear scan over the sidecar files (one tiny file per namespace) —
 * a self-hosted server has a handful. Add a token-keyed index if a deployment
 * ever grows past that.
 */
export const findCalendarFeedNamespace = (dataDir: string, token: string): string | null => {
    if (!FEED_TOKEN_PATTERN.test(token)) return null;
    let entries: string[];
    try {
        entries = readdirSync(dataDir);
    } catch {
        return null;
    }
    for (const entry of entries) {
        if (!entry.endsWith(FEED_FILE_SUFFIX)) continue;
        const record = readFeedFile(join(dataDir, entry));
        if (!record || !isSameToken(record.token, token)) continue;
        return entry.slice(0, -FEED_FILE_SUFFIX.length);
    }
    return null;
};

/**
 * Deletes feed sidecars whose namespace key is no longer in the allowlist.
 * A revoked token's feed sidecar has no other cleanup path: the authenticated
 * DELETE route needs the very token being revoked, so nothing else ever
 * removes it. Called once at startup when an allowlist is configured; the
 * route-level check (server.ts) is what actually stops the feed from being
 * served in the meantime, this just reclaims the file.
 */
export type PruneOrphanedCalendarFeedsResult = { pruned: number; failed: number };

export const pruneOrphanedCalendarFeeds = (
    dataDir: string,
    allowedKeys: ReadonlySet<string>
): PruneOrphanedCalendarFeedsResult => {
    let entries: string[];
    try {
        entries = readdirSync(dataDir);
    } catch {
        return { pruned: 0, failed: 0 };
    }
    let pruned = 0;
    let failed = 0;
    for (const entry of entries) {
        if (!entry.endsWith(FEED_FILE_SUFFIX)) continue;
        const key = entry.slice(0, -FEED_FILE_SUFFIX.length);
        if (allowedKeys.has(key)) continue;
        // Best-effort (I4): a permission error, an in-flight delete racing
        // another process, or an unexpected directory at this path must never
        // stop the server from starting - only the count is worth knowing.
        try {
            unlinkSync(join(dataDir, entry));
            pruned += 1;
        } catch {
            failed += 1;
        }
    }
    return { pruned, failed };
};

/** The token in `/v1/calendar/<token>.ics`, or null when the path is not a feed request. */
export const parseCalendarFeedPathToken = (pathname: string): string | null => {
    if (!pathname.startsWith(CALENDAR_FEED_PATH_PREFIX) || !pathname.endsWith('.ics')) return null;
    const token = pathname.slice(CALENDAR_FEED_PATH_PREFIX.length, -'.ics'.length);
    return FEED_TOKEN_PATTERN.test(token) ? token : null;
};

export const calendarFeedResponse = (dataDir: string, key: string): Response => {
    const data = loadAppData(join(dataDir, `${key}.json`));
    const body = buildCalendarFeed(data);
    return new Response(body, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': corsOrigin,
            // The URL is a bearer credential and the body contains task titles
            // and times. `no-cache` still permits shared caches to retain it;
            // never let a reverse proxy or browser cache store the feed (#952).
            'Cache-Control': 'private, no-store',
            'Content-Disposition': 'inline; filename="mindwtr.ics"',
            'Content-Type': 'text/calendar; charset=utf-8',
        },
    });
};
