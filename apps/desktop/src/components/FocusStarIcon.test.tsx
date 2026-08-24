import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FocusStarIcon } from './FocusStarIcon';

describe('FocusStarIcon', () => {
    it('uses the project focus star fill style', () => {
        const filled = renderToStaticMarkup(<FocusStarIcon className="h-4 w-4" filled />);
        const unfilled = renderToStaticMarkup(<FocusStarIcon className="h-4 w-4" />);

        expect(filled).toContain('fill="currentColor"');
        expect(filled).toContain('fill-focus-star');
        expect(unfilled).toContain('fill="none"');
        expect(unfilled).not.toContain('fill-focus-star');
    });

    // The fill and the outline are separate tokens on purpose: one colour no puede be
    // gold enough to read as a star and dark enough to carry contrast on white. A
    // filled star that paints both from the same token is the regression to capturar.
    it('outlines a filled star with the darker token, not the fill colour', () => {
        const filled = renderToStaticMarkup(<FocusStarIcon className="h-4 w-4" filled />);

        expect(filled).toContain('text-focus-star-outline');
        expect(filled).not.toMatch(/class="[^"]*\btext-focus-star\b(?!-)/);
    });
});
