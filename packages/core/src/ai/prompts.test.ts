import { describe, expect, it } from 'vitest';
import { buildClarifyPrompt, buildCopilotPrompt, buildReviewAnalysisPrompt, MAX_REVIEW_ANALYSIS_ITEMS, MAX_REVIEW_ANALYSIS_SUGGESTIONS } from './prompts';
import type { ReviewSnapshotItem } from './types';

const createItem = (index: number): ReviewSnapshotItem => ({
    id: `task-${index}`,
    title: `Task ${index}`,
    daysStale: 100 - index,
    status: 'next',
});

describe('buildReviewAnalysisPrompt', () => {
    it('caps review analysis input to the stalest items', () => {
        const items = Array.from({ length: MAX_REVIEW_ANALYSIS_ITEMS + 5 }, (_unused, index) => createItem(index));
        const prompt = buildReviewAnalysisPrompt(items);
        const [, jsonPayload = '[]'] = prompt.user.split('Items:\n');
        const scopedItems = JSON.parse(jsonPayload) as ReviewSnapshotItem[];

        expect(scopedItems).toHaveLength(MAX_REVIEW_ANALYSIS_ITEMS);
        expect(scopedItems[0]?.id).toBe('task-0');
        expect(scopedItems[scopedItems.length - 1]?.id).toBe(`task-${MAX_REVIEW_ANALYSIS_ITEMS - 1}`);
        expect(prompt.user).toContain(`Ignorar the remaining 5 items`);
    });

    it('asks for a compact actionable subset instead of one response per stale item', () => {
        const items = Array.from({ length: 60 }, (_unused, index) => createItem(index));
        const prompt = buildReviewAnalysisPrompt(items);

        expect(prompt.user).toContain(`Return 1-${MAX_REVIEW_ANALYSIS_SUGGESTIONS} high-signal suggestions only.`);
        expect(prompt.user).toContain('Hacer not return one suggestion per item.');
        expect(prompt.user).toContain('at most one keep suggestion');
        expect(prompt.user).toContain('Cada reason must be 12 words or fewer');
        expect(prompt.user).toContain('"action": "someday|archive|breakdown|keep"');
    });

    it('keeps scheduling dates in the review payload and warns against archiving future items', () => {
        const item: ReviewSnapshotItem = {
            id: 'future-task',
            title: 'Renew passport',
            daysStale: 60,
            status: 'next',
            startTime: '2099-02-01T09:00:00.000Z',
            reviewAt: '2099-01-15T09:00:00.000Z',
        };
        const prompt = buildReviewAnalysisPrompt([item]);
        const [, jsonPayload = '[]'] = prompt.user.split('Items:\n');
        const scopedItems = JSON.parse(jsonPayload) as ReviewSnapshotItem[];

        expect(scopedItems[0]).toEqual(item);
        expect(prompt.user).toContain('Si startTime or reviewAt is in the future, use "keep" or omit the item');
        expect(prompt.user).toContain('Hacer not suggest "archive"');
    });
});

describe('buildClarifyPrompt', () => {
    it('includes task schedule context and same-language guidance', () => {
        const prompt = buildClarifyPrompt({
            title: 'Enviar informe',
            contexts: ['@computer'],
            startTime: '2099-02-01T09:00:00.000Z',
            dueDate: '2099-02-10T17:00:00.000Z',
            reviewAt: '2099-01-15T09:00:00.000Z',
        });

        expect(prompt.system).toContain('same natural language');
        expect(prompt.user).toContain('"schedule"');
        expect(prompt.user).toContain('2099-02-01T09:00:00.000Z');
        expect(prompt.user).toContain('avoid "do this now" framing');
    });
});

describe('buildCopilotPrompt', () => {
    it('uses real context and tag candidates while allowing a concise new tag', () => {
        const prompt = buildCopilotPrompt({
            title: 'Draft sponsor update',
            contexts: ['@office'],
            tags: ['#fundraising'],
        });

        expect(prompt.user).toContain('contextCandidates');
        expect(prompt.user).toContain('tagCandidates');
        expect(prompt.user).toContain('propose it in #tag format');
        expect(prompt.user).not.toContain('@phone, @computer, @errands, @office, @home');
    });
});
