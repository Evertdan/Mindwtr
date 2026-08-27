import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { TdahStatusGlyph } from './TdahStatusGlyph';
import type { TdahActivityState } from './tdah-today-types';

vi.mock('lucide-react-native', () => ({
    Circle: (props: any) => React.createElement('Circle', props),
    CircleCheck: (props: any) => React.createElement('CircleCheck', props),
    CircleDashed: (props: any) => React.createElement('CircleDashed', props),
    CircleDot: (props: any) => React.createElement('CircleDot', props),
    CircleSlash: (props: any) => React.createElement('CircleSlash', props),
    CircleX: (props: any) => React.createElement('CircleX', props),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({
        secondaryText: '#94a3b8',
        tint: '#3b82f6',
        success: '#10b981',
        danger: '#ef4444',
        warning: '#f59e0b',
    }),
}));

// Every one of the six Activity states renders a distinct lucide icon type —
// spec Always: shape-distinguishable, not color-only (doc 02's état table).
const EXPECTED_SHAPE_BY_STATE: Record<TdahActivityState, string> = {
    pending: 'Circle',
    started: 'CircleDot',
    completed: 'CircleCheck',
    missed: 'CircleX',
    limbo: 'CircleDashed',
    discarded: 'CircleSlash',
};

describe('TdahStatusGlyph', () => {
    for (const [state, shape] of Object.entries(EXPECTED_SHAPE_BY_STATE)) {
        it(`renders a distinct "${shape}" shape for state "${state}"`, () => {
            let tree: ReturnType<typeof create> | undefined;
            act(() => {
                tree = create(<TdahStatusGlyph state={state as TdahActivityState} />);
            });
            expect(tree!.root.findAll((node) => node.type === shape)).toHaveLength(1);
        });
    }

    it('uses six mutually distinct shapes across all states', () => {
        const shapes = new Set(Object.values(EXPECTED_SHAPE_BY_STATE));
        expect(shapes.size).toBe(6);
    });
});
