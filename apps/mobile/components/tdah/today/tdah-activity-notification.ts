/**
 * Story 2.2 ("La vibra en la muñeca") — pure, testable helpers for turning a
 * server-pushed WS Activity-trigger event into the local notification the
 * phone shows. No native/React Native imports here on purpose: this module
 * is imported by both the root-layout hook (real wiring) and its unit tests
 * (fake WS payloads, no device needed).
 *
 * Mirrors `apps/cloud/src/tdah/types.ts`'s `TdahWsActivityTriggerEvent`
 * (ADR 0026: clients never import that file directly across the wire
 * boundary, so this is our own independent copy of the shape) —
 * `{ kind: 'activity-trigger', edge: 'start'|'end', activityId, title,
 * durationMinutes, startTime, at }` over the same `TdahWsServerEvent`
 * envelope story 2.1 already opened. `durationMinutes` is `number | null`:
 * never null for an `edge: 'end'` trigger (an Activity without a duration
 * can never reach an end milestone), but genuinely possible for `edge:
 * 'start'` — a manual Activity can have a `startTime` without a
 * `durationMinutes` (Code Map: "hora/duración opcionales").
 */

export const TDAH_WS_ACTIVITY_TRIGGER_KIND = 'activity-trigger';

export const TDAH_ACTIVITY_TRIGGER_EDGES = ['start', 'end'] as const;
export type TdahActivityTriggerEdge = (typeof TDAH_ACTIVITY_TRIGGER_EDGES)[number];

export type TdahWsActivityTriggerEvent = {
    kind: typeof TDAH_WS_ACTIVITY_TRIGGER_KIND;
    edge: TdahActivityTriggerEdge;
    activityId: number;
    title: string;
    durationMinutes: number | null;
    startTime: string;
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
 * `persistent-connection.ts`'s `onMessage?: (data: unknown) => void` is a raw
 * pass-through of the WS `MessageEvent.data` (Code Map: "el parseo/branching
 * del nuevo evento debe vivir en su consumidor") — usually a JSON string on
 * RN's WebSocket, but accepts an already-parsed object too (test doubles,
 * future transports). Returns `null` for anything that isn't a valid,
 * complete `activity-trigger` event — including story 2.1's own `{kind:
 * 'connected'}` event, which this consumer must silently ignore rather than
 * error on.
 */
export function parseTdahWsActivityTriggerEvent(raw: unknown): TdahWsActivityTriggerEvent | null {
    const value = typeof raw === 'string' ? tryParseJson(raw) : raw;
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (obj.kind !== TDAH_WS_ACTIVITY_TRIGGER_KIND) return null;
    if (obj.edge !== 'start' && obj.edge !== 'end') return null;

    // Review fix (LOW): a canonical positive integer only — an Activity id
    // of 0, a negative, or a fraction can never reference a real Activity,
    // and `Number(null) === 0` must not sneak through either.
    const activityId = Number(obj.activityId);
    if (!Number.isFinite(activityId) || !Number.isInteger(activityId) || activityId <= 0) return null;

    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    if (!title) return null;

    // `null` is a real, expected value (Code Map: "hora/duración
    // opcionales" — a manual Activity can have a startTime without a
    // durationMinutes), not a malformed payload — only reject genuinely
    // invalid values (missing entirely, non-numeric, negative).
    // Review fix (LOW): the value must be a genuine `number` — coercing via
    // `Number(...)` also accepted `'' -> 0`, `true -> 1`, and `[] -> 0`.
    let durationMinutes: number | null = null;
    if (obj.durationMinutes !== null && obj.durationMinutes !== undefined) {
        if (typeof obj.durationMinutes !== 'number') return null;
        if (!Number.isFinite(obj.durationMinutes) || obj.durationMinutes < 0) return null;
        durationMinutes = obj.durationMinutes;
    }

    return {
        kind: TDAH_WS_ACTIVITY_TRIGGER_KIND,
        edge: obj.edge,
        activityId,
        title,
        durationMinutes,
        startTime: typeof obj.startTime === 'string' ? obj.startTime : '',
        at: typeof obj.at === 'string' ? obj.at : '',
    };
}

/**
 * Same `"{n} min"` convention `TdahActivityRow.tsx` already renders on the
 * timeline (Code Map: "convención de formateo de duración ya existente ...
 * a reutilizar en el título de la notificación") — deliberately unlocalized,
 * matching that precedent exactly rather than inventing a new unit string.
 */
export function formatTdahActivityDuration(durationMinutes: number): string {
    return `${durationMinutes} min`;
}

/**
 * Spec Always: pattern `"{Actividad} — {duración}"`, ~28 characters, and
 * critically **never truncated** — it is the only thing that survives the
 * Bluetooth re-forward to the watch. This never applies a substring/ellipsis
 * of any kind, however long `activityTitle` is; that's the whole point.
 *
 * `durationMinutes: null` (a manual Activity with a `startTime` but no
 * `durationMinutes` — only reachable on `edge: 'start'`, see this module's
 * top doc comment) drops the " — {duración}" segment entirely rather than
 * rendering a fabricated "0 min" or similar.
 */
export function buildTdahActivityNotificationTitle(activityTitle: string, durationMinutes: number | null): string {
    if (durationMinutes === null) return activityTitle;
    return `${activityTitle} — ${formatTdahActivityDuration(durationMinutes)}`;
}

/**
 * Spec Always: "háptica diferenciada... ninguna reutiliza el patrón fijo de
 * 2 pulsos de react-native-alarm-notification's AlarmUtil.java tal cual" —
 * the library's own patterns are `{0,250,250,250}` (default) and
 * `{0, vibration, 1000, vibration}` (its `vibration` field), both literally
 * two pulses. These two patterns are deliberately shaped differently from
 * both: `start` is two *short* pulses close together ("empezá"), `end` is a
 * single long pulse ("cerrá y mirá qué sigue") — a genuine one-pulse
 * pattern the library's own formula can never produce (it always inserts a
 * second `vibration`-length pulse). Values are `[delay, on, off, on, ...]`
 * milliseconds, the same `VibrationEffect.createWaveform` shape the native
 * layer already expects.
 */
export const TDAH_ACTIVITY_VIBRATION_PATTERNS: Record<TdahActivityTriggerEdge, number[]> = {
    start: [0, 120, 120, 120],
    end: [0, 650],
};

export function getTdahActivityVibrationPattern(edge: TdahActivityTriggerEdge): number[] {
    return TDAH_ACTIVITY_VIBRATION_PATTERNS[edge];
}
