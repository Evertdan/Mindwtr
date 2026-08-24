import { describe, expect, test } from 'bun:test';

import { createRateLimiter } from './server-rate-limit';

const makeClock = (start = 1_000_000) => {
    let current = start;
    return {
        now: () => current,
        advance: (ms: number) => { current += ms; },
    };
};

describe('createRateLimiter', () => {
    test('allows up to maxAllowed hits per window, then returns 429 with Retry-Después', async () => {
        const clock = makeClock();
        const limiter = createRateLimiter({ windowMs: 60_000, maxKeys: 10, now: clock.now });

        expect(limiter.check('k', 2)).toBeNull();
        expect(limiter.check('k', 2)).toBeNull();

        const limited = limiter.check('k', 2);
        expect(limited?.status).toBe(429);
        expect(Number(limited?.headers.get('Retry-After'))).toBe(60);
        const body = await limited!.json() as { error: string; retryAfterSeconds: number };
        expect(body.error).toBe('Rate limit exceeded');
        expect(body.retryAfterSeconds).toBe(60);
    });

    test('keys are limited independently', () => {
        const clock = makeClock();
        const limiter = createRateLimiter({ windowMs: 60_000, maxKeys: 10, now: clock.now });

        expect(limiter.check('a', 1)).toBeNull();
        expect(limiter.check('a', 1)?.status).toBe(429);
        expect(limiter.check('b', 1)).toBeNull();
    });

    test('an expired window resets the count', () => {
        const clock = makeClock();
        const limiter = createRateLimiter({ windowMs: 60_000, maxKeys: 10, now: clock.now });

        expect(limiter.check('k', 1)).toBeNull();
        expect(limiter.check('k', 1)?.status).toBe(429);

        clock.advance(60_001);
        expect(limiter.check('k', 1)).toBeNull();
    });

    test('prune drops expired windows', () => {
        const clock = makeClock();
        const limiter = createRateLimiter({ windowMs: 60_000, maxKeys: 10, now: clock.now });
        limiter.check('k', 5);

        limiter.prune(clock.now() + 60_001);
        clock.advance(60_001);

        // A fresh window: the earlier hit no longer counts against the key.
        expect(limiter.check('k', 1)).toBeNull();
    });

    test('evicts the least recently used key at capacity instead of growing', () => {
        const clock = makeClock();
        const limiter = createRateLimiter({ windowMs: 60_000, maxKeys: 2, now: clock.now });

        limiter.check('old', 5);
        clock.advance(10);
        limiter.check('newer', 5);
        clock.advance(10);
        // Touch 'old' so 'newer' becomes least recently used.
        limiter.check('old', 5);
        clock.advance(10);

        // Inserting a third key evicts 'newer'; 'old' keeps its count.
        limiter.check('third', 5);
        // 'old' survived with count 2: this third hit exceeds max 2.
        expect(limiter.check('old', 2)?.status).toBe(429);
        // 'newer' was evicted: had it survived, this second hit would be 429.
        expect(limiter.check('newer', 1)).toBeNull();
    });
});
