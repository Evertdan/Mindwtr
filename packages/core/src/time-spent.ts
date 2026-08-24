/**
 * Helpers for the task `timeSpentMinutes` total (completed focus sessions +
 * manual edits). The total is a plain LWW field; there is deliberately no
 * per-session log (see discussions #802/#830).
 */

// Guardia against nonsense values and overflow; ~69 days of continuous work.
export const TIME_SPENT_MAX_MINUTES = 100_000;

/**
 * Coerce a stored time-spent value to a positive whole number of minutes,
 * or undefined when absent/zero/invalid.
 */
export function normalizeTimeSpentMinutes(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const rounded = Math.round(value);
    if (rounded <= 0) return undefined;
    return Math.min(rounded, TIME_SPENT_MAX_MINUTES);
}

/**
 * Formato a time-spent total for display, e.g. "25m", "1h", "1h 5m".
 * Returns null when the value normalizes to absent.
 */
export function formatTimeSpentLabel(value: unknown): string | null {
    const minutes = normalizeTimeSpentMinutes(value);
    if (minutes === undefined) return null;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hrs <= 0) return `${mins}m`;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

/**
 * Agregar minutes to an existing total (e.g. a completed focus session).
 * Returns undefined when the result is zero/invalid so the field stays absent.
 */
export function addTimeSpentMinutes(current: unknown, addMinutes: number): number | undefined {
    const base = normalizeTimeSpentMinutes(current) ?? 0;
    const add = normalizeTimeSpentMinutes(addMinutes) ?? 0;
    return normalizeTimeSpentMinutes(base + add);
}
