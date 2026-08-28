import { tFallback, type TranslateFn } from '@mindwtr/core';

import type { TdahActivity } from './tdah-today-types';

const STATE_KEYS: Record<TdahActivity['state'], string> = {
    pending: 'tdahActivity.state.pending',
    started: 'tdahActivity.state.started',
    completed: 'tdahActivity.state.completed',
    missed: 'tdahActivity.state.missed',
    limbo: 'tdahActivity.state.limbo',
    discarded: 'tdahActivity.state.discarded',
};

const STATE_FALLBACKS: Record<TdahActivity['state'], string> = {
    pending: 'Pending',
    started: 'Started',
    completed: 'Completed',
    missed: 'Not completed',
    limbo: 'In limbo',
    discarded: 'Discarded',
};

// Exhaustive over the origin union on purpose: widening
// TDAH_ACTIVITY_ORIGINS (tdah-today-types.ts) to match the server breaks
// these two Records at compile time rather than silently resolving to
// `undefined` and rendering a blank badge.
const ORIGIN_KEYS: Record<TdahActivity['origin'], string> = {
    routine: 'tdahActivity.origin.routine',
    manual: 'tdahActivity.origin.manual',
    jira: 'tdahActivity.origin.jira',
};

const ORIGIN_FALLBACKS: Record<TdahActivity['origin'], string> = {
    routine: 'Routine',
    manual: 'Manual',
    jira: 'Jira',
};

export function tdahActivityStateLabel(t: TranslateFn, state: TdahActivity['state']): string {
    return tFallback(t, STATE_KEYS[state], STATE_FALLBACKS[state]);
}

export function tdahActivityOriginLabel(t: TranslateFn, origin: TdahActivity['origin']): string {
    return tFallback(t, ORIGIN_KEYS[origin], ORIGIN_FALLBACKS[origin]);
}
