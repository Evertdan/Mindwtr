import { describe, expect, it } from 'vitest';

import {
    buildTdahActivityNotificationTitle,
    formatTdahActivityDuration,
    getTdahActivityVibrationPattern,
    parseTdahWsActivityTriggerEvent,
    TDAH_ACTIVITY_VIBRATION_PATTERNS,
} from './tdah-activity-notification';

describe('parseTdahWsActivityTriggerEvent', () => {
    it('parses a valid JSON-string start trigger event', () => {
        const raw = JSON.stringify({
            kind: 'activity-trigger',
            edge: 'start',
            activityId: 42,
            title: 'Ordenar el escritorio',
            durationMinutes: 25,
            startTime: '09:00',
            at: '2026-08-27T09:00:00.000Z',
        });

        expect(parseTdahWsActivityTriggerEvent(raw)).toEqual({
            kind: 'activity-trigger',
            edge: 'start',
            activityId: 42,
            title: 'Ordenar el escritorio',
            durationMinutes: 25,
            startTime: '09:00',
            at: '2026-08-27T09:00:00.000Z',
        });
    });

    it('parses an already-decoded object (test doubles / future transports)', () => {
        const parsed = parseTdahWsActivityTriggerEvent({
            kind: 'activity-trigger',
            edge: 'end',
            activityId: 7,
            title: 'Llamar al banco',
            durationMinutes: 15,
        });

        expect(parsed).toEqual({
            kind: 'activity-trigger',
            edge: 'end',
            activityId: 7,
            title: 'Llamar al banco',
            durationMinutes: 15,
            startTime: '',
            at: '',
        });
    });

    it('ignores story 2.1\'s own {kind: "connected"} event rather than throwing', () => {
        expect(parseTdahWsActivityTriggerEvent(JSON.stringify({ kind: 'connected', at: '2026-08-27T09:00:00.000Z' }))).toBeNull();
    });

    it('accepts a null durationMinutes on a start edge — a manual Activity can have a startTime with no duration', () => {
        const parsed = parseTdahWsActivityTriggerEvent({
            kind: 'activity-trigger', edge: 'start', activityId: 9, title: 'Sin duración', durationMinutes: null,
        });
        expect(parsed).toEqual({
            kind: 'activity-trigger', edge: 'start', activityId: 9, title: 'Sin duración', durationMinutes: null, startTime: '', at: '',
        });
    });

    it('accepts a missing durationMinutes the same as an explicit null', () => {
        const parsed = parseTdahWsActivityTriggerEvent({
            kind: 'activity-trigger', edge: 'start', activityId: 9, title: 'Sin duración',
        });
        expect(parsed?.durationMinutes).toBeNull();
    });

    it.each([
        ['non-JSON string', 'not json at all'],
        ['null', null],
        ['a number', 42],
        ['missing kind', { edge: 'start', activityId: 1, title: 'x', durationMinutes: 1 }],
        ['wrong kind', { kind: 'other', edge: 'start', activityId: 1, title: 'x', durationMinutes: 1 }],
        ['invalid edge', { kind: 'activity-trigger', edge: 'middle', activityId: 1, title: 'x', durationMinutes: 1 }],
        ['non-numeric activityId', { kind: 'activity-trigger', edge: 'start', activityId: 'abc', title: 'x', durationMinutes: 1 }],
        ['empty title', { kind: 'activity-trigger', edge: 'start', activityId: 1, title: '   ', durationMinutes: 1 }],
        ['missing title', { kind: 'activity-trigger', edge: 'start', activityId: 1, durationMinutes: 1 }],
        ['negative durationMinutes', { kind: 'activity-trigger', edge: 'start', activityId: 1, title: 'x', durationMinutes: -1 }],
        ['non-numeric durationMinutes', { kind: 'activity-trigger', edge: 'start', activityId: 1, title: 'x', durationMinutes: 'abc' }],
    ])('returns null for %s', (_label, input) => {
        expect(parseTdahWsActivityTriggerEvent(input)).toBeNull();
    });
});

describe('formatTdahActivityDuration', () => {
    it('reuses TdahActivityRow\'s exact "{n} min" convention', () => {
        expect(formatTdahActivityDuration(25)).toBe('25 min');
        expect(formatTdahActivityDuration(0)).toBe('0 min');
    });
});

describe('buildTdahActivityNotificationTitle', () => {
    it('builds the "{Actividad} — {duración}" pattern', () => {
        expect(buildTdahActivityNotificationTitle('Ordenar el escritorio', 25)).toBe('Ordenar el escritorio — 25 min');
    });

    it('never truncates, however long the Activity title is — the whole point of the AC', () => {
        const longTitle = 'Preparar la presentación completa para la reunión trimestral de todo el equipo de producto y diseño';
        const result = buildTdahActivityNotificationTitle(longTitle, 90);
        expect(result).toBe(`${longTitle} — 90 min`);
        expect(result).not.toContain('…');
        expect(result.endsWith('90 min')).toBe(true);
    });

    it('drops the duration segment entirely for a manual Activity with no durationMinutes, rather than fabricating "0 min"', () => {
        expect(buildTdahActivityNotificationTitle('Sin duración', null)).toBe('Sin duración');
    });
});

describe('getTdahActivityVibrationPattern', () => {
    it('gives start two short pulses and end a single long pulse', () => {
        expect(getTdahActivityVibrationPattern('start')).toEqual([0, 120, 120, 120]);
        expect(getTdahActivityVibrationPattern('end')).toEqual([0, 650]);
    });

    it('start and end patterns are distinct from each other', () => {
        expect(TDAH_ACTIVITY_VIBRATION_PATTERNS.start).not.toEqual(TDAH_ACTIVITY_VIBRATION_PATTERNS.end);
    });

    it('never reuses react-native-alarm-notification\'s own built-in patterns as-is', () => {
        const libraryDefault = [0, 250, 250, 250];
        // The library's `{0, vibration, 1000, vibration}` formula always
        // produces a 4-element two-pulse array separated by a 1000ms gap —
        // `end` must not collapse into that same shape either.
        expect(TDAH_ACTIVITY_VIBRATION_PATTERNS.start).not.toEqual(libraryDefault);
        expect(TDAH_ACTIVITY_VIBRATION_PATTERNS.end.length).not.toBe(4);
        expect(TDAH_ACTIVITY_VIBRATION_PATTERNS.end.length).toBeLessThan(3);
    });
});
