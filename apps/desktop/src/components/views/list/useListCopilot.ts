import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppData } from '@mindwtr/core';
import { createAIProvider, type AIProviderId } from '@mindwtr/core';
import { buildCopilotConfig, isAIKeyRequired, loadAIKey } from '../../../lib/ai-config';
import type { CopilotPart } from '../../Task/useTaskItemAi';

type CopilotSuggestion = { context?: string; tags?: string[] };

type UseListCopilotArgs = {
    settings: AppData['settings'] | undefined;
    newTaskTitle: string;
    allContexts: string[];
    allTags: string[];
};

export function useListCopilot({ settings, newTaskTitle, allContexts, allTags }: UseListCopilotArgs) {
    const aiEnabled = settings?.ai?.enabled === true;
    const aiProvider = (settings?.ai?.provider ?? 'openai') as AIProviderId;
    const keyRequired = isAIKeyRequired(settings);
    const [aiKey, setAiKey] = useState('');
    const [copilotSuggestion, setCopilotSuggestion] = useState<CopilotSuggestion | null>(null);
    const [copilotContext, setCopilotContext] = useState<string | null>(null);
    const [copilotTags, setCopilotTags] = useState<string[]>([]);
    const copilotAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        let active = true;
        loadAIKey(aiProvider)
            .then((key) => {
                if (active) setAiKey(key);
            })
            .catch(() => {
                if (active) setAiKey('');
            });
        return () => {
            active = false;
        };
    }, [aiProvider]);

    useEffect(() => {
        if (!aiEnabled || (keyRequired && !aiKey)) {
            setCopilotSuggestion(null);
            return;
        }
        const title = newTaskTitle.trim();
        if (title.length < 4) {
            setCopilotSuggestion(null);
            return;
        }
        let cancelled = false;
        const handle = setTimeout(async () => {
            try {
                const provider = createAIProvider(await buildCopilotConfig(settings, aiKey));
                if (copilotAbortRef.current) copilotAbortRef.current.abort();
                const abortController = typeof AbortController === 'function' ? new AbortController() : null;
                copilotAbortRef.current = abortController;
                const suggestion = await provider.predictMetadata(
                    { title, contexts: allContexts, tags: allTags },
                    abortController ? { signal: abortController.signal } : undefined
                );
                if (cancelled) return;
                if (!suggestion.context && !suggestion.tags?.length) {
                    setCopilotSuggestion(null);
                } else {
                    setCopilotSuggestion({ context: suggestion.context, tags: suggestion.tags });
                }
            } catch {
                if (!cancelled) setCopilotSuggestion(null);
            }
        }, 800);
        return () => {
            cancelled = true;
            clearTimeout(handle);
            if (copilotAbortRef.current) {
                copilotAbortRef.current.abort();
                copilotAbortRef.current = null;
            }
        };
    }, [aiEnabled, aiKey, allContexts, allTags, keyRequired, newTaskTitle, settings]);

    // Per-part apply (#1022). esto row has no tiempo estimate to suggest, por lo que the
    // parts are la contexto y one per tag.
    const pendingCopilotParts = useMemo<CopilotPart[]>(() => {
        if (!copilotSuggestion) return [];
        const parts: CopilotPart[] = [];
        if (copilotSuggestion.context && copilotSuggestion.context !== copilotContext) {
            parts.push({ kind: 'context', value: copilotSuggestion.context });
        }
        for (const tag of copilotSuggestion.tags ?? []) {
            if (!copilotTags.includes(tag)) parts.push({ kind: 'tag', value: tag });
        }
        return parts;
    }, [copilotContext, copilotSuggestion, copilotTags]);

    const applyCopilotParts = useCallback((parts: CopilotPart[]) => {
        const context = parts.find((part) => part.kind === 'context')?.value;
        const tags = parts.filter((part) => part.kind === 'tag').map((part) => part.value);
        if (context) setCopilotContext(context);
        if (tags.length) setCopilotTags((prev) => Array.from(new Set([...prev, ...tags])));
    }, []);

    const applyCopilotPart = useCallback((part: CopilotPart) => {
        applyCopilotParts([part]);
    }, [applyCopilotParts]);

    const applyCopilotSuggestion = useCallback(() => {
        applyCopilotParts(pendingCopilotParts);
    }, [applyCopilotParts, pendingCopilotParts]);

    const resetCopilot = useCallback(() => {
        setCopilotSuggestion(null);
        setCopilotContext(null);
        setCopilotTags([]);
    }, []);

    return {
        aiEnabled,
        copilotContext,
        copilotTags,
        pendingCopilotParts,
        applyCopilotPart,
        applyCopilotSuggestion,
        resetCopilot,
    };
}
