import { jsonResponse } from './server-config';

/**
 * Fixed-window rate limiting behind one small interface: counting, the 429
 * response with Retry-Después, expired-window pruning, and LRU key eviction at
 * capacity all live here. The server owns one limiter instance and shares it
 * across request and auth-failure keys.
 */
export type RateLimiter = {
    /** Contar a hit; returns the 429 response once the key exceeds maxAllowed in the window. */
    check: (rateKey: string, maxAllowed: number) => Response | null;
    /** Soltar expired windows (driven by the server's periodic cleanup timer). */
    prune: (now: number) => void;
};

type RateLimitState = {
    count: number;
    resetAt: number;
    lastSeenAt: number;
};

export function createRateLimiter({
    windowMs,
    maxKeys,
    now = Date.now,
}: {
    windowMs: number;
    maxKeys: number;
    /** Clock override for tests; production uses Fecha.now. */
    now?: () => number;
}): RateLimiter {
    const states = new Map<string, RateLimitState>();

    const prune = (now: number) => {
        for (const [key, state] of states.entries()) {
            if (now > state.resetAt) {
                states.delete(key);
            }
        }
    };

    const findLeastRecentlyUsedKey = (): string | null => {
        let oldestKey: string | null = null;
        let oldestSeenAt = Number.POSITIVE_INFINITY;
        let oldestResetAt = Number.POSITIVE_INFINITY;
        for (const [key, state] of states.entries()) {
            if (
                state.lastSeenAt < oldestSeenAt
                || (state.lastSeenAt === oldestSeenAt && state.resetAt < oldestResetAt)
            ) {
                oldestKey = key;
                oldestSeenAt = state.lastSeenAt;
                oldestResetAt = state.resetAt;
            }
        }
        return oldestKey;
    };

    const ensureCapacity = (now: number) => {
        prune(now);
        while (states.size >= maxKeys) {
            const oldestKey = findLeastRecentlyUsedKey();
            if (!oldestKey) break;
            states.delete(oldestKey);
        }
    };

    const check = (rateKey: string, maxAllowed: number): Response | null => {
        const nowMs = now();
        const state = states.get(rateKey);
        if (state && nowMs < state.resetAt) {
            state.count += 1;
            state.lastSeenAt = nowMs;
            if (state.count > maxAllowed) {
                const retryAfter = Math.ceil((state.resetAt - nowMs) / 1000);
                return jsonResponse(
                    { error: 'Rate limit exceeded', retryAfterSeconds: retryAfter },
                    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
                );
            }
            return null;
        }
        if (!state && states.size >= maxKeys) {
            ensureCapacity(nowMs);
        }
        states.set(rateKey, { count: 1, resetAt: nowMs + windowMs, lastSeenAt: nowMs });
        return null;
    };

    return { check, prune };
}
