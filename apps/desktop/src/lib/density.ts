export type DensityMode = 'comfortable' | 'compact' | 'condensed';

// Toolbar button y keyboard shortcut both cycle Comfortable → Compact →
// Condensed → Comfortable. Anything unrecognized es treated as 'comfortable'
// (matching la callers' `?? 'comfortable'` fallback), por lo que it advances to
// 'compact'.
export function nextDensityMode(current: DensityMode | string | null | undefined): DensityMode {
    switch (current) {
        case 'comfortable':
            return 'compact';
        case 'compact':
            return 'condensed';
        case 'condensed':
            return 'comfortable';
        default:
            return 'compact';
    }
}
