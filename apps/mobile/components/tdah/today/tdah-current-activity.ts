import { parseHHMMToMinutes } from './tdah-timeline-layout';
import type { TdahActivity } from './tdah-today-types';

/**
 * Story 1.6 AC ("la línea 'ahora' marca la Actividad vigente"): the id of the
 * Activity whose [plannedStart, plannedStart + duration) window contains
 * `nowMinutes` (minutes since midnight in the profile's zone), considering
 * only pending/started Activities. Computed from already-loaded state — no
 * fetch. A zero/null duration leaves an empty window that can never contain
 * "now", so such Activities are never current. When windows nest, the last
 * match in `activities` wins (server order: later blocks override earlier
 * ones on overlap).
 */
export function findCurrentActivityId(activities: TdahActivity[], nowMinutes: number): number | null {
    let currentId: number | null = null;
    for (const activity of activities) {
        if (activity.state !== 'pending' && activity.state !== 'started') continue;
        if (activity.startTime === null) continue;
        const startMinutes = parseHHMMToMinutes(activity.startTime);
        if (startMinutes === null) continue;
        const durationMinutes = activity.durationMinutes ?? 0;
        if (nowMinutes >= startMinutes && nowMinutes < startMinutes + durationMinutes) {
            currentId = activity.id;
        }
    }
    return currentId;
}
