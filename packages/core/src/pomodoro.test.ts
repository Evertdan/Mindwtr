import { describe, expect, it } from 'vitest';

import {
    advancePomodoroState,
    createPomodoroCustomPreset,
    createPomodoroState,
    DEFAULT_POMODORO_DURATIONS,
    formatPomodoroClock,
    getPomodoroPresetOptions,
    getPomodoroPhaseSeconds,
    getPomodoroFocusSessionsCompletedToday,
    recordPomodoroFocusSessions,
    sanitizePomodoroDurations,
    sanitizePomodoroSessionHistory,
    tickPomodoroState,
} from './pomodoro';

describe('pomodoro helpers', () => {
    it('sanitizes durations into a safe range', () => {
        expect(sanitizePomodoroDurations({ focusMinutes: -2, breakMinutes: 500 })).toEqual({
            focusMinutes: 1,
            breakMinutes: 180,
        });
    });

    it('creates default focus state', () => {
        expect(createPomodoroState()).toEqual({
            phase: 'focus',
            remainingSeconds: DEFAULT_POMODORO_DURATIONS.focusMinutes * 60,
            isRunning: false,
            completedFocusSessions: 0,
        });
    });

    it('adds one custom preset when the saved duration differs from the built-in presets', () => {
        expect(createPomodoroCustomPreset({ focusMinutes: 30, breakMinutes: 6 })).toEqual({
            id: 'custom',
            label: '30/6',
            focusMinutes: 30,
            breakMinutes: 6,
        });
        expect(getPomodoroPresetOptions({ focusMinutes: 30, breakMinutes: 6 })).toHaveLength(4);
    });

    it('reuses built-in presets when custom durations match them', () => {
        expect(createPomodoroCustomPreset({ focusMinutes: 25, breakMinutes: 5 })).toBeNull();
        expect(getPomodoroPresetOptions({ focusMinutes: 25, breakMinutes: 5 })).toHaveLength(3);
    });

    it('switches from focus to break and increments completed session', () => {
        const state = {
            phase: 'focus' as const,
            remainingSeconds: 1,
            isRunning: true,
            completedFocusSessions: 2,
        };
        const result = tickPomodoroState(state, { focusMinutes: 25, breakMinutes: 5 });
        expect(result.switchedPhase).toBe(true);
        expect(result.completedFocusSession).toBe(true);
        expect(result.state.phase).toBe('break');
        expect(result.state.isRunning).toBe(false);
        expect(result.state.remainingSeconds).toBe(getPomodoroPhaseSeconds('break', { focusMinutes: 25, breakMinutes: 5 }));
        expect(result.state.completedFocusSessions).toBe(3);
    });

    it('auto-starts breaks when configured', () => {
        const result = tickPomodoroState({
            phase: 'focus',
            remainingSeconds: 1,
            isRunning: true,
            completedFocusSessions: 0,
        }, { focusMinutes: 25, breakMinutes: 5 }, { autoStartBreaks: true });

        expect(result.state.phase).toBe('break');
        expect(result.state.isRunning).toBe(true);
        expect(result.completedFocusSession).toBe(true);
    });

    it('advances through an auto-started next phase', () => {
        const result = advancePomodoroState({
            phase: 'focus',
            remainingSeconds: 1,
            isRunning: true,
            completedFocusSessions: 4,
        }, { focusMinutes: 25, breakMinutes: 5 }, 3, { autoStartBreaks: true });

        expect(result.lastEvent).toBe('focus-finished');
        expect(result.state).toEqual({
            phase: 'break',
            remainingSeconds: getPomodoroPhaseSeconds('break', { focusMinutes: 25, breakMinutes: 5 }) - 2,
            isRunning: true,
            completedFocusSessions: 5,
        });
    });

    it('formats timer clock values', () => {
        expect(formatPomodoroClock(0)).toBe('00:00');
        expect(formatPomodoroClock(65)).toBe('01:05');
        expect(formatPomodoroClock(3605)).toBe('1:00:05');
    });

    it('sanitizes persisted local session history', () => {
        expect(sanitizePomodoroSessionHistory({
            totalCompletedFocusSessions: 1.2,
            completedFocusSessionsByTaskId: {
                ' task-1 ': 2.8,
                'task-2': -1,
                '': 4,
            },
        }, 5, '2026-08-17')).toEqual({
            totalCompletedFocusSessions: 5,
            completedFocusSessionsByTaskId: {
                'task-1': 2,
            },
            todayDayKey: '2026-08-17',
            completedTodayFocusSessions: 0,
        });
    });

    it('keeps the today-count within its day and zeroes it on rollover', () => {
        const stored = {
            totalCompletedFocusSessions: 9,
            completedFocusSessionsByTaskId: {},
            todayDayKey: '2026-08-17',
            completedTodayFocusSessions: 4,
        };

        const sameDay = sanitizePomodoroSessionHistory(stored, 0, '2026-08-17');
        expect(sameDay.completedTodayFocusSessions).toBe(4);
        expect(getPomodoroFocusSessionsCompletedToday(sameDay, '2026-08-17')).toBe(4);

        const nextDay = sanitizePomodoroSessionHistory(stored, 0, '2026-08-18');
        expect(nextDay.completedTodayFocusSessions).toBe(0);
        expect(nextDay.totalCompletedFocusSessions).toBe(9);
        // Display-time guard: a stale in-memory history reads as zero too.
        expect(getPomodoroFocusSessionsCompletedToday(stored, '2026-08-18')).toBe(0);
    });

    it('records completed focus sessions in local task history', () => {
        const previous = {
            totalCompletedFocusSessions: 2,
            completedFocusSessionsByTaskId: {
                'task-1': 1,
            },
            todayDayKey: '2026-08-17',
            completedTodayFocusSessions: 1,
        };

        const next = recordPomodoroFocusSessions(previous, 'task-1', 2, '2026-08-17');

        expect(next).toEqual({
            totalCompletedFocusSessions: 4,
            completedFocusSessionsByTaskId: {
                'task-1': 3,
            },
            todayDayKey: '2026-08-17',
            completedTodayFocusSessions: 3,
        });
        expect(previous.totalCompletedFocusSessions).toBe(2);

        // A session credited after midnight lands on the new day's count.
        const rolled = recordPomodoroFocusSessions(previous, 'task-1', 1, '2026-08-18');
        expect(rolled.completedTodayFocusSessions).toBe(1);
        expect(rolled.totalCompletedFocusSessions).toBe(3);
    });
});
