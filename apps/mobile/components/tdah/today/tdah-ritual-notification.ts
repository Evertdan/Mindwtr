/**
 * Story 3.1 ("La invitación nocturna") — pure, testable helpers for turning a
 * server-pushed WS `ritual-invitation` event into the local notification the
 * phone shows. Mirrors tdah-activity-notification.ts's shape and purpose
 * (no native/React Native imports on purpose, imported by both the
 * root-layout hook and its unit tests) for the exact same reason: this is
 * our own independent client-side copy of
 * `apps/cloud/src/tdah/types.ts`'s `TdahWsRitualInvitationEvent` (ADR 0026 —
 * clients never import that file directly across the wire boundary), not a
 * shared type.
 *
 * Unlike the Activity trigger, there is no `edge`/duration variation here:
 * the scheduler fires this at most once per local calendar day per
 * namespace (spec Always: "Como máximo un aviso por día calendario local"),
 * so the payload only carries `{ kind: 'ritual-invitation', at: string }`.
 */

export const TDAH_WS_RITUAL_INVITATION_KIND = 'ritual-invitation';

export type TdahWsRitualInvitationEvent = {
    kind: typeof TDAH_WS_RITUAL_INVITATION_KIND;
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
 * Same raw-pass-through contract as parseTdahWsActivityTriggerEvent: RN's
 * WebSocket delivers a JSON string, test doubles may hand over an
 * already-parsed object. Returns `null` for anything that isn't a valid
 * `ritual-invitation` event — including every other `TdahWsServerEvent`
 * variant (`connected`, `activity-trigger`), which this consumer must
 * silently ignore rather than error on.
 */
export function parseTdahWsRitualInvitationEvent(raw: unknown): TdahWsRitualInvitationEvent | null {
    const value = typeof raw === 'string' ? tryParseJson(raw) : raw;
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (obj.kind !== TDAH_WS_RITUAL_INVITATION_KIND) return null;

    return {
        kind: TDAH_WS_RITUAL_INVITATION_KIND,
        at: typeof obj.at === 'string' ? obj.at : '',
    };
}

/**
 * Design Notes: "distinto de start [0,120,120,120] y end [0,650]" — three
 * short, soft pulses with longer pauses than the start/end patterns, so the
 * ritual invitation reads as "vení cuando puedas" (an invitation) rather
 * than an alarm. `[delay, on, off, on, ...]` milliseconds, same
 * `VibrationEffect.createWaveform` shape the native layer already expects
 * for start/end.
 */
export const TDAH_RITUAL_VIBRATION_PATTERN: number[] = [0, 150, 300, 150, 300, 150];
