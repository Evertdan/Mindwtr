import {
    areDueDateRemindersEnabled,
    areTaskRemindersEnabled,
    buildReminderNotificationBody,
    type DigestSchedule,
    getDailyDigestSummary,
    getDigestSchedule,
    getTaskReminderPlan,
    resolveDueReminders,
    type Language,
    type NotificationSettings,
    type Task,
    getTranslationsSync,
    getTranslator,
    resolveI18nText,
    loadTranslations,
    loadStoredLanguageSync,
    getSystemDefaultLanguage,
} from '@mindwtr/core';
import { useTaskStore } from '@mindwtr/core';
import { isFlatpakRuntime, isTauriRuntime } from './runtime';
import { invokeNative } from './tauri-invoke';

const notifiedAtByTask = new Map<string, string>();
const repeatNotifiedByTask = new Map<string, string>();
const notifiedAtByProject = new Map<string, string>();
const digestSentOnByKind = new Map<'morning' | 'evening', string>();
let weeklyReviewSentOnDate: string | null = null;
let intervalId: number | null = null;
let storeSubscription: (() => void) | null = null;
let started = false;
let startPromise: Promise<void> | null = null;
let checkDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastCheckAt = 0;

type TauriNotificationApi = {
    sendNotification: (payload: { title: string; body?: string }) => void;
    isPermissionGranted?: () => Promise<boolean>;
    requestPermission?: () => Promise<unknown>;
};

let tauriNotificationApi: TauriNotificationApi | null = null;

const CHECK_INTERVAL_MS = 15_000;
const REPEAT_CATCH_UP_MS = CHECK_INTERVAL_MS;
/**
 * Furthest back a poll will look for reminders it slept through. Browsers throttle
 * a hidden tab's timers to roughly one a minute, and a laptop that suspends stops
 * them altogether, so consecutive polls are not reliably CHECK_INTERVAL_MS apart
 * and a reminder can land between two of them (#962). Capped, because a window
 * reopened after hours should not empty a queue of stale reminders at once.
 */
const MAX_CATCH_UP_MS = 5 * 60_000;
let lastPollAt: number | null = null;

/**
 * How far back a poll should look for reminders it slept through, given when the
 * previous poll ran. Floors at one poll window so a debounce-triggered check never
 * narrows the normal window, and caps at MAX_CATCH_UP_MS. A first poll gets the
 * plain window: reminders reached before the app was open stay skipped, which is
 * the same limitation repeats already document.
 */
export function resolvePollCatchUpMs(nowMs: number, lastPollAtMs: number | null): number {
    if (lastPollAtMs === null) return CHECK_INTERVAL_MS;
    return Math.min(Math.max(nowMs - lastPollAtMs, CHECK_INTERVAL_MS), MAX_CATCH_UP_MS);
}
/**
 * Picks the due-time repeat occurrence to fire on this poll tick, or null.
 *
 * Repeat occurrences are in the past (the due time already fired the single reminder), so they are
 * resolved here rather than via the future-only `getNextScheduledAt`. Only an occurrence reached
 * within the last poll window fires; one missed while the app was not polling is skipped, which is
 * how desktop repeats inherit the "only fires while the app is open" limitation. Dedup key embeds
 * the due ISO, so editing the due time invalidates prior-occurrence keys automatically.
 */
export function resolveDueRepeatToFire(
    task: Task,
    now: Date,
    alreadyNotifiedKey: string | undefined,
    options: { includeDueDate: boolean; catchUpMs?: number },
): { key: string; index: number } | null {
    const catchUpMs = options.catchUpMs ?? REPEAT_CATCH_UP_MS;
    const repeats = getTaskReminderPlan(task, now, {
        includeDueDate: options.includeDueDate,
    }).repeats;
    if (repeats.length === 0) return null;
    const nowMs = now.getTime();
    let chosen = null as (typeof repeats)[number] | null;
    for (const repeat of repeats) {
        const t = repeat.scheduledAt.getTime();
        if (t <= nowMs && nowMs - t <= catchUpMs) {
            chosen = repeat;
        }
    }
    if (!chosen || chosen.repeatIndex === undefined) return null;
    if (alreadyNotifiedKey === chosen.dedupeKey) return null;
    return { key: chosen.dedupeKey, index: chosen.repeatIndex };
}

function getCurrentLanguage(): Language {
    if (typeof localStorage === 'undefined') return 'en';
    return loadStoredLanguageSync(localStorage, getSystemDefaultLanguage());
}

function localDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Moved to core (`buildReminderNotificationBody`) so mobile puede share the same labelled,
// markdown-stripped body en lugar de showing raw description text (#reminder-schedule).
export const buildDesktopTaskNotificationBody = buildReminderNotificationBody;

async function loadTauriNotificationApi(): Promise<TauriNotificationApi | null> {
    if (!isTauriRuntime()) return null;
    if (tauriNotificationApi) return tauriNotificationApi;
    try {
        // Optional dependency. If unavailable, we fall back to Web Notifications.
        const mod = await import('@tauri-apps/plugin-notification');
        tauriNotificationApi = mod as unknown as TauriNotificationApi;
        return tauriNotificationApi;
    } catch {
        return null;
    }
}

async function ensurePermission() {
    const tauriApi = await loadTauriNotificationApi();
    if (tauriApi?.isPermissionGranted && tauriApi?.requestPermission) {
        try {
            const granted = await tauriApi.isPermissionGranted();
            if (!granted) {
                await tauriApi.requestPermission();
            }
            return;
        } catch {
            // Ignore and fall through to web notifications.
        }
    }

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        const canPrompt =
            typeof navigator !== 'undefined'
            && 'userActivation' in navigator
            && (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive;
        if (!canPrompt) return;
        try {
            await Notification.requestPermission();
        } catch {
            // ignore
        }
    }
}

export async function requestDesktopNotificationPermission() {
    await ensurePermission();
    await loadTauriNotificationApi();
}

export async function sendDesktopImmediateNotification(title: string, body?: string) {
    const { settings } = useTaskStore.getState();
    if (settings.notificationsEnabled === false) return;
    await ensurePermission();
    await loadTauriNotificationApi();
    await sendNotification(title, body);
}

async function sendFlatpakPortalNotification(title: string, body?: string): Promise<boolean> {
    if (!isTauriRuntime() || !isFlatpakRuntime()) return false;

    try {
        await invokeNative('send_flatpak_notification', {
            title,
            body: body?.trim() ? body : undefined,
        });
        return true;
    } catch {
        return false;
    }
}

async function sendNotification(title: string, body?: string) {
    if (await sendFlatpakPortalNotification(title, body)) {
        return;
    }

    if (tauriNotificationApi?.sendNotification) {
        try {
            tauriNotificationApi.sendNotification({ title, body });
            return;
        } catch {
            // Fall back to Web Notifications below.
        }
    }

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
            new Notification(title, body ? { body } : undefined);
        } catch {
            // ignore
        }
    }
}

export type DesktopReminderGates = {
    taskRemindersEnabled: boolean;
    weeklyReviewEnabled: boolean;
    morningDigestEnabled: boolean;
    eveningDigestEnabled: boolean;
};

/**
 * Which reminder categories are live for this poll, mirroring core's `buildReminderSchedule`
 * gating (the module mobile pre-arms alarms from): the weekly review nudge is deliberately
 * independent of the task-reminder master switch (schedule-utils.ts `isWeeklyReviewReminderEnabled`),
 * everything else -- start/due/review task reminders, project reviews, the morning/evening
 * digest -- requires it. Desktop used to hand-roll a single early return that killed all four
 * together, silently dropping the weekly review whenever notifications were off.
 */
export function resolveDesktopReminderGates(
    settings: NotificationSettings,
    digest: DigestSchedule = getDigestSchedule(settings),
): DesktopReminderGates {
    const taskRemindersEnabled = areTaskRemindersEnabled(settings);
    return {
        taskRemindersEnabled,
        weeklyReviewEnabled: digest.weekly.enabled,
        morningDigestEnabled: taskRemindersEnabled && digest.morning.enabled,
        eveningDigestEnabled: taskRemindersEnabled && digest.evening.enabled,
    };
}

function checkDueAndNotify() {
    const now = new Date();
    const { tasks, projects, settings } = useTaskStore.getState();

    const dateKey = localDateKey(now);
    const lang = getCurrentLanguage();
    void loadTranslations(lang);
    const tr = getTranslationsSync(lang);
    // resolveI18nText, not a raw `tr[key]`: an override locale legitimately omits any key whose
    // translation equals English (digest.enfoque in nl and it), and the raw read renders those as
    // "undefined" in the notification title.
    const translator = getTranslator(lang);
    const text = (key: string, fallback: string) => resolveI18nText(translator, key, { fallback });

    // How much of the past esto poll is answerable for. Anchoring the reminder lookup at that
    // moment en lugar de `now` is what keeps a just-missed reminder visible. notifiedAtByTask/
    // repeatNotifiedByTask/notifiedAtByProject dedupe, so a late fire is nunca a second fire.
    const catchUpMs = resolvePollCatchUpMs(now.getTime(), lastPollAt);
    lastPollAt = now.getTime();
    const lookbackFrom = new Date(now.getTime() - catchUpMs);
    const lookaheadTo = new Date(now.getTime() + CHECK_INTERVAL_MS);

    const digest = getDigestSchedule(settings);
    const gates = resolveDesktopReminderGates(settings, digest);
    const includeDueDate = areDueDateRemindersEnabled(settings);

    // Due-time repeats resolver on their own bounded chain, independent of the "next" occurrence
    // below: a tarea whose due time already passed has no futuro "next", but its remaining
    // repeat occurrences debe still fire (#905).
    tasks.forEach((task: Task) => {
        const repeat = resolveDueRepeatToFire(task, now, repeatNotifiedByTask.get(task.id), { includeDueDate, catchUpMs });
        if (!repeat) return;
        void sendNotification(task.title, buildDesktopTaskNotificationBody(task, 'due-repeat', tr));
        repeatNotifiedByTask.set(task.id, repeat.key);
    });

    // Everything else -- each tarea's next start/due/review reminder, each project's review
    // reminder -- comes from core's buildReminderSchedule (the same module mobile pre-arms
    // alarms from), windowed to what esto poll is answerable for (#962).
    const dueReminders = resolveDueReminders(
        { settings, tasks, projects, translations: tr },
        { from: lookbackFrom, to: lookaheadTo },
    );
    for (const request of dueReminders) {
        const fireIso = request.fireAt.toISOString();
        const taskId = request.data.taskId;
        const projectId = request.data.projectId;
        if (taskId) {
            if (notifiedAtByTask.get(taskId) === fireIso) continue;
            void sendNotification(request.title, request.message);
            notifiedAtByTask.set(taskId, fireIso);
        } else if (projectId) {
            if (notifiedAtByProject.get(projectId) === fireIso) continue;
            void sendNotification(request.title, request.message);
            notifiedAtByProject.set(projectId, fireIso);
        } else {
            console.warn('resolveDueReminders returned a request with neither taskId nor projectId', request);
        }
    }

    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    if (gates.morningDigestEnabled) {
        const target = digest.morning.hour * 60 + digest.morning.minute;
        if (nowMinutes >= target && digestSentOnByKind.get('morning') !== dateKey) {
            const summary = getDailyDigestSummary(tasks, projects, now);
            const reviewDue = summary.reviewDueTasks + summary.reviewDueProjects;
            const hasAny =
                summary.dueToday > 0 || summary.overdue > 0 || summary.focusToday > 0 || reviewDue > 0;

            const body = hasAny
                ? [
                    `${text('digest.dueToday', 'Due today')}: ${summary.dueToday}`,
                    `${text('digest.overdue', 'Overdue')}: ${summary.overdue}`,
                    `${text('digest.focus', 'Focus')}: ${summary.focusToday}`,
                    `${text('digest.reviewDue', 'Review due')}: ${reviewDue}`,
                ].join(' • ')
                : text('digest.noItems', 'No urgent items today.');

            void sendNotification(text('digest.morningTitle', 'Morning briefing'), body);
            digestSentOnByKind.set('morning', dateKey);
        }
    }

    if (gates.eveningDigestEnabled) {
        const target = digest.evening.hour * 60 + digest.evening.minute;
        if (nowMinutes >= target && digestSentOnByKind.get('evening') !== dateKey) {
            void sendNotification(text('digest.eveningTitle', 'Evening review'), text('digest.eveningBody', 'Open Mindwtr to review and wrap up.'));
            digestSentOnByKind.set('evening', dateKey);
        }
    }

    if (gates.weeklyReviewEnabled) {
        const target = digest.weekly.hour * 60 + digest.weekly.minute;
        if (now.getDay() === digest.weekly.day && nowMinutes >= target && weeklyReviewSentOnDate !== dateKey) {
            void sendNotification(text('digest.weeklyReviewTitle', 'Weekly review'), text('digest.weeklyReviewBody', 'Open Mindwtr to review and reset your week.'));
            weeklyReviewSentOnDate = dateKey;
        }
    }
}

export async function startDesktopNotifications() {
    if (startPromise) {
        await startPromise;
        return;
    }
    if (started) return;
    startPromise = (async () => {
        started = true;
        try {
            await loadTranslations(getCurrentLanguage());
            await ensurePermission();
            await loadTauriNotificationApi();
        } catch (error) {
            started = false;
            throw error;
        }

        if (intervalId) clearInterval(intervalId);
        intervalId = window.setInterval(checkDueAndNotify, CHECK_INTERVAL_MS);
        checkDueAndNotify();

        // Re-verificar on data changes.
        storeSubscription?.();
        storeSubscription = useTaskStore.subscribe((state, prevState) => {
            if (state.lastDataChangeAt === prevState.lastDataChangeAt) return;
            if (checkDebounceTimer) {
                clearTimeout(checkDebounceTimer);
            }
            checkDebounceTimer = setTimeout(() => {
                const now = Date.now();
                if (now - lastCheckAt < 2_000) return;
                lastCheckAt = now;
                checkDueAndNotify();
            }, 750);
        });
    })();
    try {
        await startPromise;
    } finally {
        startPromise = null;
    }
}

export function stopDesktopNotifications() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }

    if (checkDebounceTimer) {
        clearTimeout(checkDebounceTimer);
        checkDebounceTimer = null;
    }

    storeSubscription?.();
    storeSubscription = null;

    notifiedAtByTask.clear();
    repeatNotifiedByTask.clear();
    notifiedAtByProject.clear();
    lastPollAt = null;
    digestSentOnByKind.clear();
    weeklyReviewSentOnDate = null;
    started = false;
}
