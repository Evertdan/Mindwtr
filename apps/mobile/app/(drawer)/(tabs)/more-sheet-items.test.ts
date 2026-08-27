import { describe, expect, it, vi } from 'vitest';

import { useTdahModeActive } from '@/components/tdah/today/use-tdah-mode-active';

import { buildMoreSheetPrimaryItems } from './more-sheet-items';

// The tile list reads the mode through the same hook MoreNavigationSheet
// uses; mocking it here keeps the E-05 test free of any network/config path.
const tdahMode = vi.hoisted(() => ({ value: false }));
vi.mock('@/components/tdah/today/use-tdah-mode-active', () => ({
    useTdahModeActive: () => tdahMode.value,
}));

// Hook-named so rules-of-hooks accepts the (fully mocked, state-free) read
// of the mode feeding the builder.
function usePrimaryItemsForSheet(): ReturnType<typeof buildMoreSheetPrimaryItems> {
    return buildMoreSheetPrimaryItems({
        t: (key: string) => key,
        tdahModeActive: useTdahModeActive(),
        quickAccessView: 'review',
    });
}

describe('buildMoreSheetPrimaryItems — E-05 tdah-today tile', () => {
    it('includes the tdah-today tile (route /tdah-today) when the mode hook reports active', () => {
        tdahMode.value = true;
        const tile = usePrimaryItemsForSheet().find((item) => item.id === 'tdah-today');
        expect(tile).toMatchObject({ id: 'tdah-today', label: 'nav.tdahToday', route: '/tdah-today' });
    });

    it('omits the tdah-today tile entirely when the mode is inactive', () => {
        tdahMode.value = false;
        expect(usePrimaryItemsForSheet().some((item) => item.id === 'tdah-today')).toBe(false);
    });

    it('keeps the always-present destinations stable regardless of the mode', () => {
        tdahMode.value = true;
        const withTile = usePrimaryItemsForSheet().map((item) => item.id);
        tdahMode.value = false;
        const withoutTile = usePrimaryItemsForSheet().map((item) => item.id);
        const tdahGatedIds = new Set(['tdah-today', 'tdah-ritual', 'tdah-limbo']);
        expect(withoutTile).toEqual(withTile.filter((id) => !tdahGatedIds.has(id)));
    });
});

describe('buildMoreSheetPrimaryItems — Story 3.1 tdah-ritual tile', () => {
    it('includes the tdah-ritual tile (route /tdah-ritual) when the mode hook reports active', () => {
        tdahMode.value = true;
        const tile = usePrimaryItemsForSheet().find((item) => item.id === 'tdah-ritual');
        expect(tile).toMatchObject({ id: 'tdah-ritual', label: 'nav.tdahRitual', route: '/tdah-ritual' });
    });

    it('omits the tdah-ritual tile entirely when the mode is inactive — same gate as tdah-today', () => {
        tdahMode.value = false;
        expect(usePrimaryItemsForSheet().some((item) => item.id === 'tdah-ritual')).toBe(false);
    });
});

describe('buildMoreSheetPrimaryItems — Story 3.4 tdah-limbo tile', () => {
    it('includes the tdah-limbo tile (route /tdah-limbo) when the mode hook reports active', () => {
        tdahMode.value = true;
        const tile = usePrimaryItemsForSheet().find((item) => item.id === 'tdah-limbo');
        expect(tile).toMatchObject({ id: 'tdah-limbo', label: 'nav.tdahLimbo', route: '/tdah-limbo' });
    });

    it('omits the tdah-limbo tile entirely when the mode is inactive — same gate as tdah-today/tdah-ritual', () => {
        tdahMode.value = false;
        expect(usePrimaryItemsForSheet().some((item) => item.id === 'tdah-limbo')).toBe(false);
    });
});
