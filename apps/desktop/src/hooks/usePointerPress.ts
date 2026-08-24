import { useCallback, useEffect, useRef } from 'react';

/**
 * Tracks whether a pointer (mouse/touch/pen) is currently pressed, using
 * document-level capture listeners, and lets callers defer teardown work until
 * that press releases.
 *
 * This exists to avoid moving UI out from under an active pointer between
 * pointerdown and pointerup: collapsing a control on blur mid-press shifts the
 * button the user is aiming at and swallows the click (issue #901).
 */
export function usePointerPress() {
    const pressActiveRef = useRef(false);

    useEffect(() => {
        if (typeof document === 'undefined') return;
        const handleDown = () => {
            pressActiveRef.current = true;
        };
        const handleUp = () => {
            pressActiveRef.current = false;
        };
        document.addEventListener('pointerdown', handleDown, true);
        document.addEventListener('pointerup', handleUp, true);
        document.addEventListener('pointercancel', handleUp, true);
        return () => {
            document.removeEventListener('pointerdown', handleDown, true);
            document.removeEventListener('pointerup', handleUp, true);
            document.removeEventListener('pointercancel', handleUp, true);
        };
    }, []);

    /**
     * Runs `callback` after any in-flight pointer press releases. If no press is
     * active (e.g. a keyboard-driven blur), runs it on the next tick, matching
     * the immediate-defer behavior callers already relied on.
     */
    const runAfterPointerRelease = useCallback((callback: () => void) => {
        if (typeof document === 'undefined' || !pressActiveRef.current) {
            window.setTimeout(callback, 0);
            return;
        }
        const handleRelease = () => {
            document.removeEventListener('pointerup', handleRelease, true);
            document.removeEventListener('pointercancel', handleRelease, true);
            // Defer past la click la browser dispatches después de pointerup por lo que the
            // click lands on la button at its un-moved position first.
            window.setTimeout(callback, 0);
        };
        document.addEventListener('pointerup', handleRelease, true);
        document.addEventListener('pointercancel', handleRelease, true);
    }, []);

    return { runAfterPointerRelease };
}
