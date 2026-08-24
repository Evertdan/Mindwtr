import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppData, TimeEstimate } from '@mindwtr/core';
import { createAIProvider } from '@mindwtr/core';
import type { AIProviderId } from '@mindwtr/core';
import type { TaskDraft, TaskDraftSetter } from '@mindwtr/core/task-draft';
import { buildCopilotConfig, isAIKeyRequired, loadAIKey } from '../../lib/ai-config';
import { logError } from '../../lib/app-log';

type CopilotSuggestion = {
    context?: string;
    timeEstimate?: TimeEstimate;
    tags?: string[];
};

/** One separately applicable piece of a copilot suggestion. */
export type CopilotPart = { kind: 'context' | 'timeEstimate' | 'tag'; value: string };

type UseTaskEditCopilotArgs = {
    settings: AppData['settings'];
    aiEnabled: boolean;
    aiProvider: AIProviderId;
    timeEstimatesEnabled: boolean;
    titleDraft: string;
    descriptionDraft: string;
    contextOptions: string[];
    tagOptions: string[];
    draft: TaskDraft | null;
    visible: boolean;
    setDraftField: TaskDraftSetter;
};

export function useTaskEditCopilot({
    settings,
    aiEnabled,
    aiProvider,
    timeEstimatesEnabled,
    titleDraft,
    descriptionDraft,
    contextOptions,
    tagOptions,
    draft,
    visible,
    setDraftField,
}: UseTaskEditCopilotArgs) {
    const [aiKey, setAiKey] = useState('');
    const keyRequired = isAIKeyRequired(settings);
    const [copilotSuggestion, setCopilotSuggestion] = useState<CopilotSuggestion | null>(null);
    const [copilotContext, setCopilotContext] = useState<string | undefined>(undefined);
    const [copilotEstimate, setCopilotEstimate] = useState<TimeEstimate | undefined>(undefined);
    const [copilotTags, setCopilotTags] = useState<string[]>([]);
    const [showAllContexts, setShowAllContexts] = useState(false);
    const [showAllTags, setShowAllTags] = useState(false);
    const copilotMountedRef = useRef(true);
    const copilotAbortRef = useRef<AbortController | null>(null);
    const contextOptionsRef = useRef<string[]>([]);
    const tagOptionsRef = useRef<string[]>([]);

    useEffect(() => {
        Promise.resolve()
            .then(() => loadAIKey(aiProvider))
            .then((value) => {
                setAiKey(typeof value === 'string' ? value : '');
            })
            .catch((error) => {
                void logError(error, { scope: 'ai', extra: { message: 'Failed to load AI key' } });
                setAiKey('');
            });
    }, [aiProvider]);

    useEffect(() => {
        copilotMountedRef.current = true;
        return () => {
            copilotMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        contextOptionsRef.current = contextOptions;
        tagOptionsRef.current = tagOptions;
    }, [contextOptions, tagOptions]);

    useEffect(() => {
        if (!aiEnabled || (keyRequired && !aiKey)) {
            setCopilotSuggestion(null);
            return;
        }
        const title = String(titleDraft ?? '').trim();
        const description = String(descriptionDraft ?? '').trim();
        const input = [title, description].filter(Boolean).join('\n');
        if (input.length < 4) {
            setCopilotSuggestion(null);
            return;
        }
        let cancelled = false;
        let localAbortController: AbortController | null = null;
        const handle = setTimeout(async () => {
            const abortController = typeof AbortController === 'function' ? new AbortController() : null;
            localAbortController = abortController;
            const previousController = copilotAbortRef.current;
            if (abortController) {
                copilotAbortRef.current = abortController;
            }
            if (previousController) {
                previousController.abort();
            }
            try {
                const provider = createAIProvider(buildCopilotConfig(settings, aiKey));
                const suggestion = await provider.predictMetadata(
                    { title: input, contexts: contextOptionsRef.current, tags: tagOptionsRef.current },
                    abortController ? { signal: abortController.signal } : undefined
                );
                if (cancelled || !copilotMountedRef.current) return;
                if (!suggestion.context && (!timeEstimatesEnabled || !suggestion.timeEstimate) && !suggestion.tags?.length) {
                    setCopilotSuggestion(null);
                } else {
                    setCopilotSuggestion(suggestion);
                }
            } catch {
                if (!cancelled && copilotMountedRef.current) setCopilotSuggestion(null);
            }
        }, 800);
        return () => {
            cancelled = true;
            clearTimeout(handle);
            if (copilotAbortRef.current && copilotAbortRef.current === localAbortController) {
                copilotAbortRef.current.abort();
                copilotAbortRef.current = null;
            }
        };
    }, [aiEnabled, aiKey, descriptionDraft, keyRequired, settings, timeEstimatesEnabled, titleDraft]);

    useEffect(() => {
        if (!visible) {
            setCopilotSuggestion(null);
            setCopilotContext(undefined);
            setCopilotEstimate(undefined);
            setCopilotTags([]);
            if (copilotAbortRef.current) {
                copilotAbortRef.current.abort();
                copilotAbortRef.current = null;
            }
        }
    }, [visible]);

    const resetCopilotDraft = useCallback(() => {
        setCopilotContext(undefined);
        setCopilotEstimate(undefined);
        setCopilotTags([]);
    }, []);

    const resetCopilotState = useCallback(() => {
        setCopilotSuggestion(null);
        setCopilotContext(undefined);
        setCopilotEstimate(undefined);
        setCopilotTags([]);
    }, []);

    // El/La
    // a part leaves the pending list once it is in the applied markers below.
    const pendingCopilotParts = useMemo<CopilotPart[]>(() => {
        if (!copilotSuggestion) return [];
        const parts: CopilotPart[] = [];
        if (copilotSuggestion.context && copilotSuggestion.context !== copilotContext) {
            parts.push({ kind: 'context', value: copilotSuggestion.context });
        }
        if (timeEstimatesEnabled && copilotSuggestion.timeEstimate && copilotSuggestion.timeEstimate !== copilotEstimate) {
            parts.push({ kind: 'timeEstimate', value: copilotSuggestion.timeEstimate });
        }
        for (const tag of copilotSuggestion.tags ?? []) {
            if (!copilotTags.includes(tag)) parts.push({ kind: 'tag', value: tag });
        }
        return parts;
    }, [copilotContext, copilotEstimate, copilotSuggestion, copilotTags, timeEstimatesEnabled]);

    // Batched on purpose: applying several tags one call at a time would each
    // re-read the same stale draft string and drop all but the last.
    const applyCopilotParts = useCallback((parts: CopilotPart[]) => {
        if (parts.length === 0) return;
        const splitTokens = (value: string | undefined) => (
            (value ?? '').split(',').map((token) => token.trim()).filter(Boolean)
        );
        const context = parts.find((part) => part.kind === 'context')?.value;
        const estimate = parts.find((part) => part.kind === 'timeEstimate')?.value;
        const tags = parts.filter((part) => part.kind === 'tag').map((part) => part.value);
        if (context) {
            const next = Array.from(new Set([...splitTokens(draft?.contexts), context]));
            setDraftField('contexts', next.join(', '));
            setCopilotContext(context);
        }
        if (tags.length) {
            const nextTags = Array.from(new Set([...splitTokens(draft?.tags), ...tags]));
            setDraftField('tags', nextTags.join(', '));
            setCopilotTags((prev) => Array.from(new Set([...prev, ...tags])));
        }
        if (estimate && timeEstimatesEnabled) {
            setDraftField('timeEstimate', estimate as TimeEstimate);
            setCopilotEstimate(estimate as TimeEstimate);
        }
    }, [draft?.contexts, draft?.tags, setDraftField, timeEstimatesEnabled]);

    const applyCopilotPart = useCallback((part: CopilotPart) => {
        applyCopilotParts([part]);
    }, [applyCopilotParts]);

    const applyCopilotSuggestion = useCallback(() => {
        applyCopilotParts(pendingCopilotParts);
    }, [applyCopilotParts, pendingCopilotParts]);

    return {
        aiKey,
        pendingCopilotParts,
        copilotContext,
        copilotEstimate,
        copilotTags,
        showAllContexts,
        setShowAllContexts,
        showAllTags,
        setShowAllTags,
        resetCopilotDraft,
        resetCopilotState,
        applyCopilotPart,
        applyCopilotSuggestion,
    };
}
