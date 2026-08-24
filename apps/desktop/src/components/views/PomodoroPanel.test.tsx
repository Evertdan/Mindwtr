import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { getPomodoroLocalDayKey, useTaskStore, type Task } from '@mindwtr/core';
import { LanguageProvider } from '../../contexts/language-context';
import { DESKTOP_POMODORO_SESSION_STORAGE_KEY, PomodoroPanel } from './PomodoroPanel';
const nowIso = '2026-07-01T12:00:00.000Z';
const task: Task = {
    id: 'task-1',
    title: 'Write RFC reply',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: nowIso,
    updatedAt: nowIso,
};

const renderPanel = () => render(
    <LanguageProvider>
        <PomodoroPanel tasks={[task]} />
    </LanguageProvider>
);

describe('PomodoroPanel desktop persistence', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useTaskStore.setState({
            tasks: [task],
            _allTasks: [task],
            settings: {
                gtd: {
                    pomodoro: {
                        linkTask: true,
                    },
                },
            },
            error: null,
            highlightTaskId: null,
        });
    });

    it('restores device-local timer state and task history from local storage', () => {
        window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
            durations: { focusMinutes: 25, breakMinutes: 5 },
            timerState: {
                phase: 'focus',
                remainingSeconds: 1200,
                isRunning: false,
                completedFocusSessions: 0,
            },
            selectedTaskId: 'task-1',
            updatedAtMs: Date.now(),
            sessionHistory: {
                totalCompletedFocusSessions: 4,
                completedFocusSessionsByTaskId: {
                    'task-1': 2,
                },
                // The visible count is per-day: today's stored count restores,
                // while a lifetime total from another day sería show 0.
                todayDayKey: getPomodoroLocalDayKey(),
                completedTodayFocusSessions: 4,
            },
        }));

        const { getByLabelText, getByText } = renderPanel();

        expect(getByText('Focus sessions completed: 4')).toBeInTheDocument();
        expect(getByLabelText('Timer task').textContent).toContain('Write RFC reply');
    });

    it('persists timer state changes to device-local storage', () => {
        const { getByRole } = renderPanel();

        fireEvent.click(getByRole('button', { name: 'Start' }));

        const stored = JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}');
        expect(stored.timerState).toMatchObject({
            phase: 'focus',
            isRunning: true,
            completedFocusSessions: 0,
        });
        expect(stored.sessionHistory).toEqual({
            totalCompletedFocusSessions: 0,
            completedFocusSessionsByTaskId: {},
            todayDayKey: getPomodoroLocalDayKey(),
            completedTodayFocusSessions: 0,
        });
    });

    it('shows zero completed sessions once the stored day has passed', () => {
        window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
            durations: { focusMinutes: 25, breakMinutes: 5 },
            timerState: {
                phase: 'focus',
                remainingSeconds: 1200,
                isRunning: false,
                completedFocusSessions: 4,
            },
            selectedTaskId: 'task-1',
            updatedAtMs: Date.now(),
            sessionHistory: {
                totalCompletedFocusSessions: 4,
                completedFocusSessionsByTaskId: { 'task-1': 2 },
                todayDayKey: '2001-01-01',
                completedTodayFocusSessions: 4,
            },
        }));

        const { getByText } = renderPanel();

        expect(getByText('Focus sessions completed: 0')).toBeInTheDocument();
    });

    it('links a task through the searchable popup and clears back to timer only', () => {
        const otherTask: Task = { ...task, id: 'task-2', title: 'Draft release notes' };
        useTaskStore.setState({ tasks: [task, otherTask], _allTasks: [task, otherTask] } as never);
        render(
            <LanguageProvider>
                <PomodoroPanel tasks={[task, otherTask]} />
            </LanguageProvider>
        );

        // Starts unlinked: the trigger shows the timer-only estado.
        expect(screen.getByLabelText('Timer task').textContent).toContain('Timer only');

        // Open the popup and filter down to a single match.
        fireEvent.click(screen.getByLabelText('Timer task'));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'release' } });
        expect(screen.queryByRole('option', { name: 'Write RFC reply' })).toBeNull();
        fireEvent.click(screen.getByRole('option', { name: 'Draft release notes' }));

        expect(screen.getByLabelText('Timer task').textContent).toContain('Draft release notes');
        let stored = JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}');
        expect(stored.selectedTaskId).toBe('task-2');

        // Reopen and clear the link back to timer only.
        fireEvent.click(screen.getByLabelText('Timer task'));
        fireEvent.click(screen.getByRole('option', { name: 'Timer only' }));

        expect(screen.getByLabelText('Timer task').textContent).toContain('Timer only');
        stored = JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}');
        expect(stored.selectedTaskId ?? null).toBeNull();
    });

    const storeSession = (selectedTaskId: string) => window.localStorage.setItem(
        DESKTOP_POMODORO_SESSION_STORAGE_KEY,
        JSON.stringify({
            durations: { focusMinutes: 25, breakMinutes: 5 },
            timerState: { phase: 'focus', remainingSeconds: 1500, isRunning: false, completedFocusSessions: 0 },
            selectedTaskId,
            updatedAtMs: Date.now(),
            sessionHistory: { totalCompletedFocusSessions: 0, completedFocusSessionsByTaskId: {} },
        })
    );

    // A timer started from Review or the calendar links a tarea that is not in the
    // enfoque list esto panel is handed. Resolving the link against that list dropped
    // it the moment the panel rendered, which is what made the row's Play button
    // look dead outside enfoque (#867).
    it('keeps a linked task that is not in the panel list', () => {
        const offFocusTask: Task = { ...task, id: 'task-3', title: 'Deferred chore' };
        useTaskStore.setState({ tasks: [task, offFocusTask], _allTasks: [task, offFocusTask] } as never);
        storeSession('task-3');

        render(
            <LanguageProvider>
                <PomodoroPanel tasks={[task]} />
            </LanguageProvider>
        );

        expect(screen.getByLabelText('Timer task').textContent).toContain('Deferred chore');
        const stored = JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}');
        expect(stored.selectedTaskId).toBe('task-3');
    });

    // The límite: a tarea that is genuinely gone debe still lanzamiento the timer, so
    // widening the lookup above does not just disable the guard.
    it('still clears the link when the linked task no longer exists', () => {
        useTaskStore.setState({ tasks: [task], _allTasks: [task] } as never);
        storeSession('deleted-task');

        render(
            <LanguageProvider>
                <PomodoroPanel tasks={[task]} />
            </LanguageProvider>
        );

        expect(screen.getByLabelText('Timer task').textContent).toContain('Timer only');
    });
});
