export const DEFAULT_PROJECT_COLOR = '#94a3b8';
export const DEFAULT_AREA_COLOR = DEFAULT_PROJECT_COLOR;
/**
 * Area swatches, tailwind-500 family so light/dark contrast is uniform.
 * The first six are the original palette and must keep their order: the exact
 * hex is what gets stored on an area and synced, so reordering or replacing one
 * silently recolors every area already using it.
 */
export const AREA_PRESET_COLORS = [
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#ec4899',
    '#f97316',
    '#14b8a6',
    '#06b6d4',
    '#6366f1',
    '#f43f5e',
    '#64748b',
] as const;
