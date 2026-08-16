import { AREA_PRESET_COLORS, getEnglishI18nValue } from '@mindwtr/core';
import { describe, expect, it } from 'vitest';

import { AREA_COLOR_DISPLAY_BY_HEX } from './project-meta-pickers';

describe('AREA_COLOR_DISPLAY_BY_HEX', () => {
    it('names every preset color for the iOS action sheets', () => {
        // Without a row the sheet falls back to a raw hex like "◯ #F97316".
        for (const color of AREA_PRESET_COLORS) {
            expect(AREA_COLOR_DISPLAY_BY_HEX[color]?.nameKey).toBeTruthy();
            expect(AREA_COLOR_DISPLAY_BY_HEX[color]?.swatch).toBeTruthy();
        }
    });

    it('uses translation keys that exist in English', () => {
        for (const meta of Object.values(AREA_COLOR_DISPLAY_BY_HEX)) {
            expect(getEnglishI18nValue(meta.nameKey)).toBeTruthy();
        }
    });

    it('does not name colors that are not in the palette', () => {
        const palette = new Set<string>(AREA_PRESET_COLORS);
        expect(Object.keys(AREA_COLOR_DISPLAY_BY_HEX).filter((hex) => !palette.has(hex))).toEqual([]);
    });
});
