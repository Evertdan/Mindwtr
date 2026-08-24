import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

type SanitizePersistedViewState<T> = (value: unknown, fallback: T) => T;

function readPersistedViewState<T>(
    storageKey: string,
    fallback: T,
    sanitize?: SanitizePersistedViewState<T>
): T {
    if (typeof window === 'undefined') return fallback;
    try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw) as unknown;
        return sanitize ? sanitize(parsed, fallback) : parsed as T;
    } catch {
        return fallback;
    }
}

function savePersistedViewState<T>(storageKey: string, value: T) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
        // View estado is a convenience. Storage failures no debería block UI changes.
    }
}

export function usePersistedViewState<T>(
    storageKey: string,
    fallback: T,
    sanitize?: SanitizePersistedViewState<T>
): [T, Dispatch<SetStateAction<T>>] {
    const [storedState, setStoredState] = useState<{ storageKey: string; value: T }>(() => ({
        storageKey,
        value: readPersistedViewState(storageKey, fallback, sanitize),
    }));
    const state = storedState.storageKey === storageKey
        ? storedState.value
        : readPersistedViewState(storageKey, fallback, sanitize);

    const setPersistedState = useCallback<Dispatch<SetStateAction<T>>>((nextState) => {
        setStoredState((current) => {
            const currentValue = current.storageKey === storageKey
                ? current.value
                : readPersistedViewState(storageKey, fallback, sanitize);
            const next = typeof nextState === 'function'
                ? (nextState as (value: T) => T)(currentValue)
                : nextState;
            savePersistedViewState(storageKey, next);
            return { storageKey, value: next };
        });
    }, [fallback, sanitize, storageKey]);

    return [state, setPersistedState];
}
