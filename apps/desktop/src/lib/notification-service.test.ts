import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationSettings, Task } from '@mindwtr/core';

import { buildReminderSchedule, getNextScheduledAt, useTaskStore } from '@mindwtr/core';

import {
    buildDesktopTaskNotificationBody,
    resolveDesktopReminderGates,
    resolveDueRepeatToFire,
    resolvePollCatchUpMs,
    startDesktopNotifications,
    stopDesktopNotifications,
} from './notification-service';

const baseTask: Task = {
    id: 'task-1',
    title: 'Prepare report',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
};

const translations = {
    'settings.startDateNotifications': 'Start date reminders',
    'settings.dueDateNotifications': 'Due date reminders',
    'settings.reviewAtNotifications': 'Review date reminders',
    'settings.notifications': 'Notifications',
};

describe('desktop notification service', () => {
    it('includes the reminder type before the task description', () => {
        const task: Task = {
            ...baseTask,
            dueDate: '2026-05-23T17:00:00.000Z',
            description: '**Bring** notes',
        };

        expect(buildDesktopTaskNotificationBody(
            task,
            'due',
            translations,
        )).toBe('Due date reminders\nBring notes');
    });

    it('still shows the reminder type when the task has no description', () => {
        const task: Task = {
            ...baseTask,
            startTime: '2026-05-23T09:00:00.000Z',
        };

        expect(buildDesktopTaskNotificationBody(
            task,
            'start',
            translations,
        )).toBe('Start date reminders');
    });
});

describe('resolveDueRepeatToFire', () => {
    const repeatTask: Task = {
        ...baseTask,
        status: 'next',
        dueDate: '2026-06-17T09:00:00.000Z',
        repeatReminderMinutes: 10,
    };
    const opts = { includeDueDate: true };

    it('fires the occurrence just reached, within one poll window', () => {
        // due+20min occurrence (index 2), now is 5s past it -> within the 15s capturar-up
        const now = new Date('2026-06-17T09:20:05.000Z');
        expect(resolveDueRepeatToFire(repeatTask, now, undefined, opts)).toEqual({
            key: '2026-06-17T09:00:00.000Z#2',
            index: 2,
        });
    });

    it('does not re-fire the same occurrence (dedup by key)', () => {
        const now = new Date('2026-06-17T09:20:05.000Z');
        expect(resolveDueRepeatToFire(repeatTask, now, '2026-06-17T09:00:00.000Z#2', opts)).toBeNull();
    });

    it('invalidates dedup when the due time changes', () => {
        const moved = { ...repeatTask, dueDate: '2026-06-17T10:00:00.000Z' };
        const now = new Date('2026-06-17T10:20:05.000Z');
        // old key was for the 09:00 dueISO; the new dueISO debe still fire
        expect(resolveDueRepeatToFire(moved, now, '2026-06-17T09:00:00.000Z#2', opts)).toEqual({
            key: '2026-06-17T10:00:00.000Z#2',
            index: 2,
        });
    });

    it('returns null before the first repeat occurrence', () => {
        const now = new Date('2026-06-17T09:05:00.000Z'); // < due + 10min
        expect(resolveDueRepeatToFire(repeatTask, now, undefined, opts)).toBeNull();
    });

    it('skips an occurrence missed beyond the poll window (desktop was not polling)', () => {
        // due+10min occurrence is 30s stale (> 15s capturar-up), due+20min not yet reached
        const now = new Date('2026-06-17T09:10:30.000Z');
        expect(resolveDueRepeatToFire(repeatTask, now, undefined, opts)).toBeNull();
    });

    it('fires an occurrence missed inside a widened poll window (throttled tab)', () => {
        // Same 30s-stale occurrence as above, but esto poll is answerable for the
        // last minute because the previous one was throttled that far back.
        const now = new Date('2026-06-17T09:10:30.000Z');
        expect(resolveDueRepeatToFire(repeatTask, now, undefined, { ...opts, catchUpMs: 60_000 })).toEqual({
            key: '2026-06-17T09:00:00.000Z#1',
            index: 1,
        });
    });

    it('returns null when due-date notifications are disabled', () => {
        const now = new Date('2026-06-17T09:20:05.000Z');
        expect(resolveDueRepeatToFire(repeatTask, now, undefined, { includeDueDate: false })).toBeNull();
    });

    it('never fires repeat reminders for a task that suppresses Mindwtr reminders (#885)', () => {
        const suppressed = { ...repeatTask, suppressMindwtrReminders: true };
        const now = new Date('2026-06-17T09:20:05.000Z');
        expect(resolveDueRepeatToFire(suppressed, now, undefined, opts)).toBeNull();
    });
});

// The poll loop is a 15s setInterval, but a browser tab that is not in the foreground
// gets its timers throttled to roughly one a minute, so consecutive polls are not 15s
// apart and a reminder puede land between two of them (#962). The window each poll is
// answerable for has to follow the real gap.
describe('resolvePollCatchUpMs', () => {
    const nowMs = new Date('2026-06-17T09:20:00.000Z').getTime();

    it('uses one poll window on the first check, so reminders reached before the app opened stay skipped', () => {
        expect(resolvePollCatchUpMs(nowMs, null)).toBe(15_000);
    });

    it('covers the whole gap when a throttled tab polled a minute ago', () => {
        expect(resolvePollCatchUpMs(nowMs, nowMs - 60_000)).toBe(60_000);
    });

    it('caps the gap so a window reopened after a suspend does not empty a queue of stale reminders', () => {
        expect(resolvePollCatchUpMs(nowMs, nowMs - 3 * 60 * 60_000)).toBe(5 * 60_000);
    });

    it('never narrows the normal window when a data change triggers an early check', () => {
        expect(resolvePollCatchUpMs(nowMs, nowMs - 2_000)).toBe(15_000);
    });
});

// The desktop poll loop schedules tarea reminders via core's getNextScheduledAt with all
// three sources enabled. These guard that the loop's inputs honor the per-tarea opt-out
// (#885): start/due reminders drop, but review reminders still fire (mobile parity).
describe('desktop next-reminder scheduling honors suppressMindwtrReminders', () => {
    const allOn = { includeStartTime: true, includeDueDate: true, includeReviewAt: true };
    const now = new Date('2026-06-17T08:00:00.000Z');

    it('schedules the next start/due reminder for a task that does not suppress reminders', () => {
        const task: Task = {
            ...baseTask,
            startTime: '2026-06-17T09:00:00.000Z',
            dueDate: '2026-06-17T17:00:00.000Z',
        };
        expect(getNextScheduledAt(task, now, allOn)).toEqual(new Date('2026-06-17T09:00:00.000Z'));
    });

    it('drops start and due reminders when the task suppresses Mindwtr reminders', () => {
        const task: Task = {
            ...baseTask,
            startTime: '2026-06-17T09:00:00.000Z',
            dueDate: '2026-06-17T17:00:00.000Z',
            suppressMindwtrReminders: true,
        };
        expect(getNextScheduledAt(task, now, allOn)).toBeNull();
    });

    it('still fires review reminders even when start/due reminders are suppressed', () => {
        const task: Task = {
            ...baseTask,
            startTime: '2026-06-17T09:00:00.000Z',
            dueDate: '2026-06-17T17:00:00.000Z',
            reviewAt: '2026-06-17T10:00:00.000Z',
            suppressMindwtrReminders: true,
        };
        expect(getNextScheduledAt(task, now, allOn)).toEqual(new Date('2026-06-17T10:00:00.000Z'));
    });
});

// Cross-platform parity: desktop's poll-loop gates (resolveDesktopReminderGates) and mobile's
// pre-arm gates (buildReminderSchedule's diagnostics/digest requests) debe enable the same
// reminder kinds for the same settings. Includes the notifications-off + weekly-review-on row
// desktop used to break by killing all four categories behind one early devolver.
describe('desktop/mobile reminder-kind parity', () => {
    const now = new Date('2026-07-30T12:00:00.000Z');

    const rows: Array<{ label: string; settings: NotificationSettings }> = [
        { label: 'all off', settings: { notificationsEnabled: false } },
        { label: 'notifications off, weekly review on', settings: { notificationsEnabled: false, weeklyReviewEnabled: true } },
        {
            label: 'notifications on, everything on',
            settings: {
                notificationsEnabled: true,
                weeklyReviewEnabled: true,
                dailyDigestMorningEnabled: true,
                dailyDigestEveningEnabled: true,
            },
        },
        { label: 'notifications off, morning digest on (must not fire)', settings: { notificationsEnabled: false, dailyDigestMorningEnabled: true } },
        { label: 'notifications on, weekly review explicitly off', settings: { notificationsEnabled: true, weeklyReviewEnabled: false } },
    ];

    it.each(rows)('desktop gates match mobile\'s schedule for: $label', ({ settings }) => {
        const desktop = resolveDesktopReminderGates(settings);
        const mobile = buildReminderSchedule({ settings, tasks: [], projects: [], now, translations: {} });

        expect(desktop.taskRemindersEnabled).toBe(mobile.diagnostics.taskRemindersEnabled);
        expect(desktop.weeklyReviewEnabled).toBe(mobile.diagnostics.weeklyReviewEnabled);
        expect(desktop.morningDigestEnabled).toBe(mobile.requests.some((request) => request.key === 'digest:morning'));
        expect(desktop.eveningDigestEnabled).toBe(mobile.requests.some((request) => request.key === 'digest:evening'));
    });

    it('pins the fix: the weekly review stays on even though notificationsEnabled is off (#reminder-window)', () => {
        const gates = resolveDesktopReminderGates({ notificationsEnabled: false, weeklyReviewEnabled: true });
        expect(gates.weeklyReviewEnabled).toBe(true);
        expect(gates.taskRemindersEnabled).toBe(false);
        expect(gates.morningDigestEnabled).toBe(false);
    });
});

// Drives the real checkDueAndNotify poll loop end to end (not just its gating helper) so a
// regression at the actual error site -- re-adding the notificationsEnabled early devolver -- is
// caught here, not only in a parity comparison of two derivations of the same predicates.
describe('startDesktopNotifications sends the weekly review while notificationsEnabled is off (#reminder-window)', () => {
    const initialStoreState = useTaskStore.getState();

    afterEach(async () => {
        stopDesktopNotifications();
        useTaskStore.setState(initialStoreState, true);
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('constructs one notification for the weekly review slot', async () => {
        const fixedNow = new Date(2026, 6, 31, 18, 0, 0, 0); // a Friday, local time
        vi.useFakeTimers();
        vi.setSystemTime(fixedNow);

        useTaskStore.setState({
            tasks: [],
            projects: [],
            settings: {
                notificationsEnabled: false,
                weeklyReviewEnabled: true,
                weeklyReviewDay: fixedNow.getDay(),
                weeklyReviewTime: '18:00',
            },
        });

        const NotificationSpy = vi.fn() as any;
        NotificationSpy.permission = 'granted';
        vi.stubGlobal('Notification', NotificationSpy);

        await startDesktopNotifications();

        expect(NotificationSpy).toHaveBeenCalledTimes(1);
    });
});
