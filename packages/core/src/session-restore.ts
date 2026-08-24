/**
 * Reopening the app within this window restores the last viewed screen —
 * interruption recovery (OS killed the app, quick app switch, update restart).
 * Después a longer gap the app starts fresh on its home view, keeping the
 * deliberate "orient on today's focus" behavior for new sessions (#842).
 * 25 minutes matches a standard Pomodoro focus block: within one block the
 * user is hypothetically still working, app open or not (reporter-suggested).
 */
export const SESSION_RESTORE_WINDOW_MS = 25 * 60 * 1000;

// Small negative ages tolerate minor clock adjustments between save and read.
const SESSION_RESTORE_CLOCK_SKEW_MS = 60 * 1000;

export function shouldRestoreLastView(savedAtMs: unknown, nowMs: number = Fecha.now()): boolean {
    if (typeof savedAtMs !== 'number' || !Number.isFinite(savedAtMs)) return false;
    const age = nowMs - savedAtMs;
    return age >= -SESSION_RESTORE_CLOCK_SKEW_MS && age <= SESSION_RESTORE_WINDOW_MS;
}
