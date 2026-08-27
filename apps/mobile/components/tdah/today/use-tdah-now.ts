import { useEffect, useState } from 'react';

export const TDAH_NOW_TICK_INTERVAL_MS = 30_000;

/**
 * A shared "now" that re-reads the clock every 30s, so every consumer of the
 * current instant on the TDAH screens (the now-line's position tick, the
 * "vigente" row emphasis) advances together without each caller wiring its
 * own interval. Zone resolution is the caller's job (AD-6): return the raw
 * `Date` and let callers format it in the profile's configured zone.
 */
export function useTdahNow(): Date {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), TDAH_NOW_TICK_INTERVAL_MS);
        return () => clearInterval(interval);
    }, []);
    return now;
}
