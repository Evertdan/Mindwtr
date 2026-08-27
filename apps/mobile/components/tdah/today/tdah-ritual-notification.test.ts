import { describe, expect, it } from 'vitest';

import {
    parseTdahWsRitualInvitationEvent,
    TDAH_RITUAL_VIBRATION_PATTERN,
} from './tdah-ritual-notification';
import { TDAH_ACTIVITY_VIBRATION_PATTERNS } from './tdah-activity-notification';

describe('parseTdahWsRitualInvitationEvent', () => {
    it('parses a valid JSON-string ritual-invitation event', () => {
        const raw = JSON.stringify({ kind: 'ritual-invitation', at: '2026-08-27T05:00:00.000Z' });
        expect(parseTdahWsRitualInvitationEvent(raw)).toEqual({
            kind: 'ritual-invitation',
            at: '2026-08-27T05:00:00.000Z',
        });
    });

    it('parses an already-decoded object (test doubles / future transports)', () => {
        expect(parseTdahWsRitualInvitationEvent({ kind: 'ritual-invitation', at: '2026-08-27T05:00:00.000Z' })).toEqual({
            kind: 'ritual-invitation',
            at: '2026-08-27T05:00:00.000Z',
        });
    });

    it('defaults a missing/non-string "at" to an empty string rather than rejecting the event', () => {
        expect(parseTdahWsRitualInvitationEvent({ kind: 'ritual-invitation' })).toEqual({
            kind: 'ritual-invitation',
            at: '',
        });
    });

    it('ignores story 2.1\'s own {kind: "connected"} event rather than throwing', () => {
        expect(parseTdahWsRitualInvitationEvent(JSON.stringify({ kind: 'connected', at: '2026-08-27T09:00:00.000Z' }))).toBeNull();
    });

    it('ignores story 2.2\'s "activity-trigger" event — a different consumer\'s event on the same WS channel', () => {
        expect(parseTdahWsRitualInvitationEvent({
            kind: 'activity-trigger', edge: 'start', activityId: 1, title: 'x', durationMinutes: 1,
        })).toBeNull();
    });

    it.each([
        ['non-JSON string', 'not json at all'],
        ['null', null],
        ['a number', 42],
        ['missing kind', { at: '2026-08-27T05:00:00.000Z' }],
        ['wrong kind', { kind: 'other', at: '2026-08-27T05:00:00.000Z' }],
    ])('returns null for %s', (_label, input) => {
        expect(parseTdahWsRitualInvitationEvent(input)).toBeNull();
    });
});

describe('TDAH_RITUAL_VIBRATION_PATTERN', () => {
    it('is three short pulses with pauses longer than the start pattern\'s (invitation, not alarm)', () => {
        expect(TDAH_RITUAL_VIBRATION_PATTERN).toEqual([0, 150, 300, 150, 300, 150]);
    });

    it('is distinct from both the start and end Activity-trigger vibration patterns', () => {
        expect(TDAH_RITUAL_VIBRATION_PATTERN).not.toEqual(TDAH_ACTIVITY_VIBRATION_PATTERNS.start);
        expect(TDAH_RITUAL_VIBRATION_PATTERN).not.toEqual(TDAH_ACTIVITY_VIBRATION_PATTERNS.end);
    });
});
