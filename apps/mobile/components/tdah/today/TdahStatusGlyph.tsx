import React from 'react';
import { Circle, CircleCheck, CircleDashed, CircleDot, CircleSlash, CircleX } from 'lucide-react-native';

import { useThemeColors } from '@/hooks/use-theme-colors';

import type { TdahActivityState } from './tdah-today-types';

export type TdahStatusGlyphProps = {
    state: TdahActivityState;
    size?: number;
};

/**
 * The six-state Activity glyph (spec Always: shape-distinguishable, not
 * color-only — doc 02's état table: círculo vacío / círculo medio-lleno /
 * check / cruz / círculo punteado / tachado). Every shape here is a distinct
 * lucide-react-native icon rather than one icon recolored, so grayscale/eink
 * still reads six different states (spec's own accessibility note).
 */
export function TdahStatusGlyph({ state, size = 20 }: TdahStatusGlyphProps) {
    const tc = useThemeColors();
    const strokeWidth = 2;

    switch (state) {
        case 'pending':
            return <Circle size={size} color={tc.secondaryText} strokeWidth={strokeWidth} />;
        case 'started':
            return <CircleDot size={size} color={tc.tint} strokeWidth={strokeWidth} />;
        case 'completed':
            return <CircleCheck size={size} color={tc.success} strokeWidth={strokeWidth} />;
        case 'missed':
            return <CircleX size={size} color={tc.danger} strokeWidth={strokeWidth} />;
        case 'limbo':
            return <CircleDashed size={size} color={tc.warning} strokeWidth={strokeWidth} />;
        case 'discarded':
            return <CircleSlash size={size} color={tc.secondaryText} strokeWidth={strokeWidth} />;
        default:
            return <Circle size={size} color={tc.secondaryText} strokeWidth={strokeWidth} />;
    }
}
