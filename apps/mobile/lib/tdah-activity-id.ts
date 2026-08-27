/**
 * Shared Activity-id validity guard for story 2.3's notification tap-through:
 * `use-root-layout-notification-open-handler.ts` (deciding whether to route
 * to T-02 at all) and `app/(drawer)/tdah-activity/[id].tsx` (deciding
 * whether to render T-02 or redirect) must agree on exactly what counts as a
 * valid id, or a value one guard accepts and the other rejects would either
 * push a route T-02 immediately redirects away from, or silently drop a
 * notification tap the route itself would have accepted. Requires a genuine
 * positive integer — `Number.isFinite` alone would also accept `"42.5"` or
 * `"1e2"`.
 */
export function parseTdahActivityId(value: string | undefined | null): number | null {
    if (!value) return null;
    // Review fix (LOW): canonical decimal form only — `Number('1e2') === 100`
    // and `Number('0x2A') === 42` would otherwise pass the integer check
    // below despite no server ever emitting them as an Activity id.
    if (!/^\d+$/.test(value.trim())) return null;
    const activityId = Number(value);
    if (!Number.isInteger(activityId) || activityId <= 0) return null;
    return activityId;
}
