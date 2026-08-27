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

const ORIGIN_KEYS: Record<TdahActivity['origin'], string> = {
    routine: 'tdahActivity.origin.routine',
    manual: 'tdahActivity.origin.manual',
};

const ORIGIN_FALLBACKS: Record<TdahActivity['origin'], string> = {
    routine: 'Routine',
    manual: 'Manual',
};

export function tdahActivityStateLabel(t: TranslateFn, state: TdahActivity['state']): string {
    return tFallback(t, STATE_KEYS[state], STATE_FALLBACKS[state]);
}

export function tdahActivityOriginLabel(t: TranslateFn, origin: TdahActivity['origin']): string {
    return tFallback(t, ORIGIN_KEYS[origin], ORIGIN_FALLBACKS[origin]);
}
