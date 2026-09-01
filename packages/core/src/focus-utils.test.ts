import { describe, expect, it } from 'vitest';
import {
    DEFAULT_FOCUS_TASK_LIMIT,
    MAX_FOCUS_TASK_LIMIT,
    MIN_FOCUS_TASK_LIMIT,
    formatFocusTaskLimitText,
    normalizeFocusTaskLimit,
} from './focus-utils';

describe('focus-utils', () => {
    it('normalizes focus task limits with a conservative default', () => {
        expect(normalizeFocusTaskLimit(undefined)).toBe(DEFAULT_FOCUS_TASK_LIMIT);
        expect(normalizeFocusTaskLimit('5')).toBe(5);
        expect(normalizeFocusTaskLimit(5.8)).toBe(5);
        expect(normalizeFocusTaskLimit(0)).toBe(MIN_FOCUS_TASK_LIMIT);
        expect(normalizeFocusTaskLimit(99)).toBe(MAX_FOCUS_TASK_LIMIT);
    });

    it('formats dynamic focus limit text from new and legacy labels', () => {
        expect(formatFocusTaskLimitText('Max {{count}} focus item(s)', 5)).toBe('Max 5 focus item(s)');
        expect(formatFocusTaskLimitText('Max 3 focus item(s)', 10)).toBe('Max 10 focus item(s)');
    });
});
