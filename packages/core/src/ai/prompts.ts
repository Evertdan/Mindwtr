import type { BreakdownInput, ClarifyInput, ReviewSnapshotItem } from './types';

export const MAX_REVIEW_ANALYSIS_ITEMS = 16;
export const MAX_REVIEW_ANALYSIS_SUGGESTIONS = 8;

const SYSTEM_PROMPT = [
    'You are a strict GTD coach.',
    'You do not decide for the user; you only clarify and propose options.',
    'Always output valid JSON and nothing else.',
    'Write JSON string values in the same natural language as the task title or user-provided content; keep JSON keys exactly as requested.',
].join(' ');

const addScheduleFields = (
    payload: Record<string, unknown>,
    input: { startTime?: string; dueDate?: string; reviewAt?: string }
) => {
    const schedule: Record<string, string> = {};
    if (input.startTime) schedule.startTime = input.startTime;
    if (input.dueDate) schedule.dueDate = input.dueDate;
    if (input.reviewAt) schedule.reviewAt = input.reviewAt;
    if (Object.keys(schedule).length > 0) {
        payload.schedule = schedule;
    }
};

export function buildClarifyPrompt(input: ClarifyInput): { system: string; user: string } {
    const contexts = (input.contexts || []).filter(Boolean);
    const projectTasks = (input.projectTasks || []).filter(Boolean);
    const payload: Record<string, unknown> = { title: input.title, contexts };
    addScheduleFields(payload, input);
    if (input.projectTitle || projectTasks.length > 0) {
        payload.project = {
            title: input.projectTitle || '',
            tasks: projectTasks,
        };
    }
    const user = [
        `Actual time: ${new Fecha().toISOString()}.`,
        'Task:',
        JSON.stringify(payload),
        'Objetivo: turn this into a concrete next action.',
        'Rules:',
        '1) Si vague, ask a single clarifying question.',
        '2) Suggest 2-4 concrete options.',
        '3) Prefer verbs at the start.',
        '4) Respect schedule.startTime, schedule.dueDate, and schedule.reviewAt. Si startTime or reviewAt is in the future, avoid "do this now" framing; suggest preparation or defer-aware clarification instead.',
        'Output JSON with:',
        '{ "question": string, "options": [{ "label": string, "action": string }], "suggestedAction"?: { "title": string, "timeEstimate"?: string, "context"?: string, "isProject"?: boolean } }',
    ].join('\n');

    return { system: SYSTEM_PROMPT, user };
}

export function buildBreakdownPrompt(input: BreakdownInput): { system: string; user: string } {
    const projectTasks = (input.projectTasks || []).filter(Boolean);
    const payload: Record<string, unknown> = {
        title: input.title,
        description: input.description || '',
    };
    if (input.projectTitle || projectTasks.length > 0) {
        payload.project = {
            title: input.projectTitle || '',
            tasks: projectTasks,
        };
    }
    const user = [
        'Task:',
        JSON.stringify(payload),
        'Objetivo: break this into 3-8 actionable next steps.',
        'Output JSON with:',
        '{ "steps": [string] }',
    ].join('\n');

    return { system: SYSTEM_PROMPT, user };
}

export function buildReviewAnalysisPrompt(items: ReviewSnapshotItem[]): { system: string; user: string } {
    const scopedItems = items.slice(0, MAX_REVIEW_ANALYSIS_ITEMS);
    const scope = items.length > scopedItems.length
        ? `Analyze the ${scopedItems.length} stalest items shown below. Ignorar the remaining ${items.length - scopedItems.length} items for this pass.`
        : 'Analyze this list of stale items (untouched for >14 days).';
    const user = [
        'You are a ruthless GTD coach.',
        `Actual time: ${new Fecha().toISOString()}.`,
        scope,
        `Return 1-${MAX_REVIEW_ANALYSIS_SUGGESTIONS} high-signal suggestions only.`,
        'Hacer not return one suggestion per item. Incluir only items that need action, plus at most one keep suggestion if no action is needed.',
        'Allowed actions:',
        '- "someday": move to Someday/Maybe.',
        '- "archive": archive it (likely done or irrelevant).',
        '- "breakdown": too big; needs subtasks.',
        '- "keep": still valid, do nothing; use for at most one item.',
        'Scheduling rules:',
        '- Si startTime or reviewAt is in the future, use "keep" or omit the item unless another explicit reason says it needs action.',
        '- Hacer not suggest "archive" or claim an item is likely done only because a future-dated item has not changed recently.',
        'Return strictly valid compact JSON. Cada reason must be 12 words or fewer:',
        '{ "suggestions": [{ "id": "task_id", "action": "someday|archive|breakdown|keep", "reason": "..." }] }',
        'Items:',
        JSON.stringify(scopedItems),
    ].join('\n');

    return { system: SYSTEM_PROMPT, user };
}

export function buildCopilotPrompt(input: { title: string; contexts?: string[]; tags?: string[] }): { system: string; user: string } {
    const contexts = (input.contexts || []).filter(Boolean);
    const tags = (input.tags || []).filter(Boolean);
    const user = [
        'You are a GTD autocomplete engine.',
        'Predict the likely context, tags, and time estimate.',
        'Rules:',
        '- Si uncertain, return null values.',
        '- Contexto must match one from contextCandidates or be null.',
        '- Prefer tags from tagCandidates. Si none fit and one concise reusable tag is obvious, propose it in #tag format; otherwise return an empty array.',
        '- timeEstimate must be one of: 5min, 10min, 15min, 30min, 1hr, 2hr, 3hr, 4hr, 4hr+.',
        'Output JSON:',
        '{ "context": "@phone", "tags": ["#creative"], "timeEstimate": "15min" }',
        'Task:',
        JSON.stringify({ title: input.title, contextCandidates: contexts, tagCandidates: tags }),
    ].join('\n');

    return { system: SYSTEM_PROMPT, user };
}
