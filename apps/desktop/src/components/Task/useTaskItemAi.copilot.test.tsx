import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskItemAi } from './useTaskItemAi';

const predictMetadata = vi.hoisted(() => vi.fn());

vi.mock('@mindwtr/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@mindwtr/core')>();
    return { ...actual, createAIProvider: () => ({ predictMetadata }) };
});

vi.mock('../../lib/ai-config', () => ({
    buildAIConfig: vi.fn(async () => ({})),
    buildCopilotConfig: vi.fn(async () => ({})),
    isAIKeyRequired: () => false,
    loadAIKey: vi.fn(async () => 'test-key'),
}));

vi.mock('../../lib/app-log', () => ({ logWarn: vi.fn() }));

const settings = { ai: { enabled: true, provider: 'openai' } } as never;

const renderAi = (setField: ReturnType<typeof vi.fn>, overrides: Record<string, unknown> = {}) => renderHook(() => useTaskItemAi({
    taskId: 'task-1',
    settings,
    t: (key: string) => key,
    editTitle: 'Book the dentist',
    editDescription: '',
    editContexts: '',
    editTags: '',
    editStartTime: '',
    editDueDate: '',
    editReviewAt: '',
    contextOptions: ['@phone'],
    tagOptions: ['#health'],
    projectContext: null,
    timeEstimatesEnabled: true,
    setField,
    ...overrides,
}));

/** The debounced copilot request plus the promise it awaits. */
const settleSuggestion = async () => {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
    });
};

describe('useTaskItemAi copilot parts', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        predictMetadata.mockReset();
        predictMetadata.mockResolvedValue({ context: '@phone', timeEstimate: '15min', tags: ['#health', '#errand'] });
    });

    it('applies exactly one part per chip and leaves the others suggestible', async () => {
        const setField = vi.fn();
        const { result } = renderAi(setField);
        await settleSuggestion();

        expect(result.current.pendingCopilotParts).toEqual([
            { kind: 'context', value: '@phone' },
            { kind: 'timeEstimate', value: '15min' },
            { kind: 'tag', value: '#health' },
            { kind: 'tag', value: '#errand' },
        ]);

        act(() => {
            result.current.applyCopilotPart({ kind: 'tag', value: '#health' });
        });

        expect(setField.mock.calls).toEqual([['tags', '#health']]);
        expect(result.current.pendingCopilotParts).toEqual([
            { kind: 'context', value: '@phone' },
            { kind: 'timeEstimate', value: '15min' },
            { kind: 'tag', value: '#errand' },
        ]);
        expect(result.current.copilotTags).toEqual(['#health']);
        expect(result.current.copilotContext).toBeUndefined();
        expect(result.current.copilotEstimate).toBeUndefined();
    });

    it('applies only the remaining parts on apply-all, in one write per field', async () => {
        const setField = vi.fn();
        const { result } = renderAi(setField);
        await settleSuggestion();

        act(() => {
            result.current.applyCopilotPart({ kind: 'context', value: '@phone' });
        });
        setField.mockClear();

        act(() => {
            result.current.applyCopilotSuggestion();
        });

        expect(setField.mock.calls).toEqual([
            ['tags', '#health, #errand'],
            ['timeEstimate', '15min'],
        ]);
        expect(result.current.pendingCopilotParts).toEqual([]);
    });

    it('never offers a time estimate part when the feature is off', async () => {
        const setField = vi.fn();
        const { result } = renderAi(setField, { timeEstimatesEnabled: false });
        await settleSuggestion();

        expect(result.current.pendingCopilotParts.some((part) => part.kind === 'timeEstimate')).toBe(false);

        act(() => {
            result.current.applyCopilotSuggestion();
        });

        expect(setField.mock.calls.some(([field]) => field === 'timeEstimate')).toBe(false);
    });

    it('makes no copilot request when copilot is switched off for the surface', async () => {
        const setField = vi.fn();
        const { result } = renderAi(setField, { copilotEnabled: false });
        await settleSuggestion();

        expect(predictMetadata).not.toHaveBeenCalled();
        expect(result.current.pendingCopilotParts).toEqual([]);
    });
});
