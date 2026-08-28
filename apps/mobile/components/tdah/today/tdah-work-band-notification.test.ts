import { describe, expect, it } from 'vitest';

import {
    parseTdahWsWorkBandEvent,
    TDAH_WORK_BAND_VIBRATION_PATTERN,
} from './tdah-work-band-notification';
import { TDAH_ACTIVITY_VIBRATION_PATTERNS } from './tdah-activity-notification';
import { TDAH_RITUAL_VIBRATION_PATTERN } from './tdah-ritual-notification';

const validEvent = {
    kind: 'work-band',
    activityId: 12,
    title: 'Sprint',
    startTime: '09:00',
    durationMinutes: 540,
    itemCount: 3,
    at: '2026-08-28T15:00:00.000Z',
};

describe('parseTdahWsWorkBandEvent', () => {
    it('parses a valid JSON-string work-band event', () => {
        expect(parseTdahWsWorkBandEvent(JSON.stringify(validEvent))).toEqual(validEvent);
    });

    it('parses an already-decoded object (test doubles / future transports)', () => {
        expect(parseTdahWsWorkBandEvent(validEvent)).toEqual(validEvent);
    });

    it('keeps the task count, which is the whole point of a grouped band notification', () => {
        const parsed = parseTdahWsWorkBandEvent({ ...validEvent, itemCount: 7 });
        expect(parsed?.itemCount).toBe(7);
    });

    it('accepts a zero count rather than silently swallowing a well-formed event', () => {
        expect(parseTdahWsWorkBandEvent({ ...validEvent, itemCount: 0 })?.itemCount).toBe(0);
    });

    it('accepts a null durationMinutes (a band the server could not size)', () => {
        expect(parseTdahWsWorkBandEvent({ ...validEvent, durationMinutes: null })?.durationMinutes).toBeNull();
    });

    it('defaults a missing "at"/"startTime" to an empty string rather than rejecting the event', () => {
        expect(parseTdahWsWorkBandEvent({
            kind: 'work-band', activityId: 12, title: 'Sprint', itemCount: 3,
        })).toEqual({
            kind: 'work-band',
            activityId: 12,
            title: 'Sprint',
            startTime: '',
            durationMinutes: null,
            itemCount: 3,
            at: '',
        });
    });

    it('ignores every other event that shares this WS channel', () => {
        expect(parseTdahWsWorkBandEvent(JSON.stringify({ kind: 'connected', at: 'x' }))).toBeNull();
        expect(parseTdahWsWorkBandEvent({
            kind: 'activity-trigger', edge: 'start', activityId: 1, title: 'x', durationMinutes: 1,
        })).toBeNull();
        expect(parseTdahWsWorkBandEvent({ kind: 'ritual-invitation', at: 'x' })).toBeNull();
    });

    it.each([
        ['non-JSON string', 'not json at all'],
        ['null', null],
        ['a number', 42],
        ['missing kind', { ...validEvent, kind: undefined }],
        ['wrong kind', { ...validEvent, kind: 'other' }],
        ['a missing activityId', { ...validEvent, activityId: undefined }],
        ['a non-integer activityId', { ...validEvent, activityId: 1.5 }],
        ['a zero activityId', { ...validEvent, activityId: 0 }],
        ['a blank title', { ...validEvent, title: '   ' }],
        // The title is built around the count — a band whose count could not
        // be read would announce "Sprint: NaN pending assigned tasks".
        ['a missing itemCount', { ...validEvent, itemCount: undefined }],
        ['a non-numeric itemCount', { ...validEvent, itemCount: 'three' }],
        ['a negative itemCount', { ...validEvent, itemCount: -1 }],
        ['a negative durationMinutes', { ...validEvent, durationMinutes: -5 }],
    ])('returns null for %s', (_label, input) => {
        expect(parseTdahWsWorkBandEvent(input)).toBeNull();
    });
});

describe('TDAH_WORK_BAND_VIBRATION_PATTERN', () => {
    it('is UX-DR6\'s single short pulse', () => {
        expect(TDAH_WORK_BAND_VIBRATION_PATTERN).toEqual([0, 90]);
    });

    // Spec Never: "ni un patrón háptico que coincida con N-01
    // [0,120,120,120], N-02 [0,650] o N-03 [0,150,300,150,300,150]".
    it('is distinct from all three patterns already in the module', () => {
        expect(TDAH_WORK_BAND_VIBRATION_PATTERN).not.toEqual(TDAH_ACTIVITY_VIBRATION_PATTERNS.start);
        expect(TDAH_WORK_BAND_VIBRATION_PATTERN).not.toEqual(TDAH_ACTIVITY_VIBRATION_PATTERNS.end);
        expect(TDAH_WORK_BAND_VIBRATION_PATTERN).not.toEqual(TDAH_RITUAL_VIBRATION_PATTERN);
    });

    // N-02 is the other single-pulse pattern, so "short tap" vs "long buzz"
    // is the only thing distinguishing them by feel.
    it('is far shorter than N-02, the only other single-pulse pattern', () => {
        expect(TDAH_WORK_BAND_VIBRATION_PATTERN[1]).toBeLessThan(TDAH_ACTIVITY_VIBRATION_PATTERNS.end[1] / 2);
    });
});
