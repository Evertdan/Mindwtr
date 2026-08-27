import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const searchParams = vi.hoisted(() => ({
    current: {} as { id?: string; autoAction?: string },
}));

vi.mock('expo-router', () => ({
    useLocalSearchParams: () => searchParams.current,
    Stack: { Screen: (props: Record<string, unknown>) => React.createElement('Stack.Screen', props) },
    Redirect: (props: Record<string, unknown>) => React.createElement('Redirect', props),
}));

vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/tdah/today/TdahActivityDetailScreen', () => ({
    TdahActivityDetailScreen: (props: Record<string, unknown>) => React.createElement('TdahActivityDetailScreen', props),
}));

// eslint-disable-next-line import/first
import TdahActivityDetailRoute from './[id]';

describe('TdahActivityDetailRoute (T-02 route wrapper)', () => {
    it("forwards a notification-tapped 'start' autoAction from the route params to T-02", () => {
        searchParams.current = { id: '5', autoAction: 'start' };
        let tree: ReturnType<typeof create> | undefined;
        act(() => {
            tree = create(<TdahActivityDetailRoute />);
        });
        const screen = tree!.root.findByType('TdahActivityDetailScreen' as never);
        expect(screen.props.activityId).toBe(5);
        expect(screen.props.autoAction).toBe('start');
    });

    // Story 2.3 Never: "No completada" stays app-exclusive — a forbidden
    // autoAction value must never reach T-02, not even as a passthrough.
    it("drops a 'miss' autoAction (spec Never: never auto-fired from a notification) instead of forwarding it to T-02", () => {
        searchParams.current = { id: '5', autoAction: 'miss' };
        let tree: ReturnType<typeof create> | undefined;
        act(() => {
            tree = create(<TdahActivityDetailRoute />);
        });
        const screen = tree!.root.findByType('TdahActivityDetailScreen' as never);
        expect(screen.props.activityId).toBe(5);
        expect(screen.props.autoAction).toBeUndefined();
    });

    it('redirects to /tdah-today instead of rendering T-02 when the id is not a valid positive integer', () => {
        searchParams.current = { id: '42.5' };
        let tree: ReturnType<typeof create> | undefined;
        act(() => {
            tree = create(<TdahActivityDetailRoute />);
        });
        const redirect = tree!.root.findByType('Redirect' as never);
        expect(redirect.props.href).toBe('/tdah-today');
        expect(tree!.root.findAllByType('TdahActivityDetailScreen' as never)).toHaveLength(0);
    });
});
