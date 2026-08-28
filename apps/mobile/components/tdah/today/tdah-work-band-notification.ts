/**
 * Story 4.2 ("La franja laboral en mi día") — pure, testable helpers for
 * turning the server-pushed WS `work-band` event into N-04, the single
 * notification a Jira work band is allowed to produce per local day. Same
 * shape and purpose as tdah-ritual-notification.ts (no native/React Native
 * imports on purpose, imported by both the root-layout hook and its unit
 * tests), and for the same reason: this is our own independent client-side
 * copy of `apps/cloud/src/tdah/types.ts`'s `TdahWsWorkBandEvent` (ADR 0026 —
 * clients never import that file across the wire boundary), not a shared
 * type.
 *
 * There is deliberately no `edge` here, unlike `activity-trigger`: the band
 * is excluded from the N-01/N-02 candidate query server-side and fires
 * exactly one event, at its start, deduped on its own row's
 * `start_notified_at` (spec Always: "Una sola notificación por franja y por
 * día local"; spec Never: "No se añade una notificación de fin de franja").
 * `itemCount` rides in the payload so the notification title is
 * self-sufficient on a watch face — the count is the whole point of grouping
 * (FR-11: one notification per band, never one per task).
 */

export const TDAH_WS_WORK_BAND_KIND = 'work-band';

export type TdahWsWorkBandEvent = {
    kind: typeof TDAH_WS_WORK_BAND_KIND;
    activityId: number;
    title: string;
    startTime: string;
    durationMinutes: number | null;
    itemCount: number;
    at: string;
};

function tryParseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Same raw-pass-through contract as the other two parsers: RN's WebSocket
 * delivers a JSON string, test doubles may hand over an already-parsed
 * object. Returns `null` for anything that isn't a valid `work-band` event —
 * including every other `TdahWsServerEvent` variant (`connected`,
 * `activity-trigger`, `ritual-invitation`), which this consumer must
 * silently ignore rather than error on.
 *
 * `itemCount` is required and must be a non-negative integer: the title is
 * built around it, and a band whose count could not be read would announce
 * "Sprint: NaN pending assigned tasks". A `0` count is *not* rejected here
 * (the server retires an emptied band rather than firing for it, but a
 * client that silently swallowed a well-formed event would be harder to
 * diagnose than one that shows an honest zero).
 */
export function parseTdahWsWorkBandEvent(raw: unknown): TdahWsWorkBandEvent | null {
    const value = typeof raw === 'string' ? tryParseJson(raw) : raw;
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (obj.kind !== TDAH_WS_WORK_BAND_KIND) return null;

    const activityId = Number(obj.activityId);
    if (!Number.isInteger(activityId) || activityId <= 0) return null;

    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    if (!title) return null;

    const itemCount = Number(obj.itemCount);
    if (!Number.isInteger(itemCount) || itemCount < 0) return null;

    // `null` is a real, expected value (a band the server could not give a
    // duration to), not a malformed payload — only genuinely invalid values
    // reject, exactly as parseTdahWsActivityTriggerEvent does.
    let durationMinutes: number | null = null;
    if (obj.durationMinutes !== null && obj.durationMinutes !== undefined) {
        const parsedDuration = Number(obj.durationMinutes);
        if (!Number.isFinite(parsedDuration) || parsedDuration < 0) return null;
        durationMinutes = parsedDuration;
    }

    return {
        kind: TDAH_WS_WORK_BAND_KIND,
        activityId,
        title,
        startTime: typeof obj.startTime === 'string' ? obj.startTime : '',
        durationMinutes,
        itemCount,
        at: typeof obj.at === 'string' ? obj.at : '',
    };
}

/**
 * UX-DR6's "un solo pulso corto": one 90 ms pulse and nothing else. It has
 * to be distinguishable by feel alone from the three patterns already in the
 * module (spec Never: "ni un patrón háptico que coincida con N-01
 * `[0,120,120,120]`, N-02 `[0,650]` o N-03 `[0,150,300,150,300,150]`") —
 * N-02 is the only other single-pulse pattern and it is over seven times
 * longer, so "short tap" vs "long buzz" reads at the wrist without looking.
 * `[delay, on, off, on, ...]` milliseconds, the same
 * `VibrationEffect.createWaveform` shape the native layer already expects.
 */
export const TDAH_WORK_BAND_VIBRATION_PATTERN: number[] = [0, 90];
