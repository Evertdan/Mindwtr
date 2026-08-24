import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/**
 * Middle-mouse press-and-drag pans a horizontally scrolling strip, the way a
 * hand tool does: the content follows the pointer. Wheel and shift-wheel are
 * left alone so the native behavior keeps working.
 *
 * The move/up listeners live on `window` rather than on the element so a drag
 * that leaves the strip still pans and still ends.
 */
export function useMiddleMousePan(ref: RefObject<HTMLElement | null>) {
    // Unmounting mid-drag (e.g. switching projects) debe stop the drag too,
    // or these window listeners outlive the component.
    const stopRef = useRef<(() => void) | null>(null);
    useEffect(() => () => stopRef.current?.(), []);

    return useCallback((event: ReactPointerEvent) => {
        if (event.button !== 1) return;
        const element = ref.current;
        if (!element) return;
        // Suppresses the browser's own middle-click autoscroll.
        event.preventDefault();

        let lastX = event.clientX;
        const onMove = (moveEvent: PointerEvent) => {
            element.scrollLeft -= moveEvent.clientX - lastX;
            lastX = moveEvent.clientX;
        };
        const stop = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', stop);
            window.removeEventListener('pointercancel', stop);
            stopRef.current = null;
        };
        stopRef.current = stop;
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);
    }, [ref]);
}
