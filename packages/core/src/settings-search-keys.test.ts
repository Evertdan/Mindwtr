import { describe, expect, it } from 'vitest';

import { getEnglishI18nValue } from './i18n';
import {
    buildSettingsSearchResults,
    formatSettingsSearchPath,
    getSettingsSearchEntryKeys,
    getSettingsSearchPageEnglishText,
    matchSettingsSearchResults,
    resolveSettingsSearchI18nKey,
    SETTINGS_SEARCH_INDEX,
    SETTINGS_SEARCH_MOBILE_EXCLUSIONS,
    SETTINGS_SEARCH_PAGE_IDS,
    SETTINGS_SEARCH_PAGE_TITLE_KEYS,
    type SettingsSearchPageId,
} from './settings-search-keys';

const ALL_PAGE_IDS = SETTINGS_SEARCH_PAGE_IDS;
const ALL_KEYS = SETTINGS_SEARCH_INDEX.map((entry) => entry.key);

describe('settings search key roster', () => {
    it('resolves every page key (excluded or not) to a real English string', () => {
        // This is the original bug: a key that exists in the roster but has no
        // translation is worse than a missing key — search looks broken.
        const unresolved = ALL_KEYS.filter((key) => {
            const value = getEnglishI18nValue(resolveSettingsSearchI18nKey(key));
            return !value || !value.trim();
        });
        expect(unresolved).toEqual([]);
    });

    it('resolves every section and page title to a real English string', () => {
        const unresolved: string[] = [];
        for (const entry of SETTINGS_SEARCH_INDEX) {
            if (!entry.section) continue;
            const value = getEnglishI18nValue(resolveSettingsSearchI18nKey(entry.section));
            if (!value || !value.trim()) unresolved.push(entry.section);
        }
        for (const pageId of ALL_PAGE_IDS) {
            const value = getEnglishI18nValue(SETTINGS_SEARCH_PAGE_TITLE_KEYS[pageId]);
            if (!value || !value.trim()) unresolved.push(pageId);
        }
        expect(unresolved).toEqual([]);
    });

    it('has no stale exclusion-list entries', () => {
        const known = new Set(ALL_KEYS);
        for (const [key, reason] of Object.entries(SETTINGS_SEARCH_MOBILE_EXCLUSIONS)) {
            expect(known.has(key), `exclusion "${key}" is not a real page key`).toBe(true);
            expect(reason.trim().length > 0, `exclusion "${key}" needs a reason`).toBe(true);
        }
    });

    it('lists every setting once per page', () => {
        for (const pageId of ALL_PAGE_IDS) {
            const keys = getSettingsSearchEntryKeys(pageId);
            expect(new Set(keys).size, `page "${pageId}" repeats a key`).toBe(keys.length);
        }
    });

    // The coverage-direction invariant this task exists for: every key is
    // either accounted for (excluded with a reason) or actually contributes
    // text to its page — never silently neither. Demonstrated below with a
    // synthetic fixture, since the real roster is expected to hold (that's
    // the whole point of the exclusion list) and can't itself exercise the
    // failure path.
    function findUnaccountedKeys(
        keys: readonly string[],
        exclusions: Record<string, string>,
        resolve: (key: string) => string | undefined,
    ): string[] {
        return keys.filter((key) => !(key in exclusions) && !resolve(key));
    }

    it('every real page key is indexed or deliberately excluded', () => {
        for (const pageId of ALL_PAGE_IDS) {
            const unaccounted = findUnaccountedKeys(
                getSettingsSearchEntryKeys(pageId),
                SETTINGS_SEARCH_MOBILE_EXCLUSIONS,
                (key) => getEnglishI18nValue(resolveSettingsSearchI18nKey(key)),
            );
            expect(unaccounted, `page "${pageId}" has unaccounted keys`).toEqual([]);
        }
    });

    it('the coverage check actually fails on a key that is neither indexed nor excluded', () => {
        // Mutation test of the checker itself: an unresolvable, non-excluded
        // key must be flagged.
        const fixtureKeys = ['knownGood', 'orphanKey'];
        const fixtureExclusions = {};
        const resolve = (key: string) => (key === 'knownGood' ? 'Known Bueno' : undefined);
        expect(findUnaccountedKeys(fixtureKeys, fixtureExclusions, resolve)).toEqual(['orphanKey']);

        // Excluding it clears the failure, proving exclusion is the intended escape hatch.
        expect(findUnaccountedKeys(fixtureKeys, { orphanKey: 'test fixture' }, resolve)).toEqual([]);
    });

    it('getSettingsSearchPageEnglishText drops excluded keys and returns real text', () => {
        const gtdText = getSettingsSearchPageEnglishText('gtd');
        expect(gtdText).toContain('Pomodoro timer');
        // 'keybindings' is excluded on the main page; must not leak into its text list.
        expect(getSettingsSearchPageEnglishText('main')).not.toContain('Keyboard shortcuts');
    });

    // The settings the #884 reporter named as missing before this task: rows
    // that exist on a desktop page but were absent from the roster, and rows
    // that were present but gave no clue where to find them. Pinned by the
    // exact query the reporter typed.
    const english = buildSettingsSearchResults((key) => getEnglishI18nValue(key));

    function search(query: string): Array<{ title: string; page: SettingsSearchPageId; path: string }> {
        return matchSettingsSearchResults(english, query).map((result) => ({
            title: result.title,
            page: result.pageId,
            path: formatSettingsSearchPath(result),
        }));
    }

    it('finds both quick-add settings for "add", each with its page and section', () => {
        const results = search('add');
        expect(results).toContainEqual({
            title: 'Global quick add shortcut',
            page: 'main',
            path: 'General → Input',
        });
        expect(results).toContainEqual({
            title: 'Clean up quick add text',
            page: 'gtd',
            path: 'GTD → Default capture method',
        });
    });

    it('finds the default area setting for "area"', () => {
        expect(search('area')).toContainEqual({
            title: 'Default area for new tasks',
            page: 'gtd',
            path: 'GTD → Default capture method',
        });
    });

    it('finds the default project flow setting for "project"', () => {
        expect(search('project')).toContainEqual({
            title: 'Default project flow',
            page: 'gtd',
            path: 'GTD',
        });
    });

    it('finds the time estimate presets for "estimate"', () => {
        expect(search('estimate')).toContainEqual({
            title: 'Time estimate presets',
            page: 'gtd',
            path: 'GTD',
        });
    });

    it('ranks settings whose own name matches above ones that only share a page', () => {
        const titles = matchSettingsSearchResults(english, 'pomodoro').map((r) => r.title);
        expect(titles[0]).toBe('Pomodoro timer');
    });

    it('matches page synonyms, but only on the row that is the page itself', () => {
        const withSynonyms = buildSettingsSearchResults((key) => getEnglishI18nValue(key), {
            main: ['dark mode'],
        });
        const results = matchSettingsSearchResults(withSynonyms, 'dark mode');
        expect(results.map((r) => r.key)).toEqual(['general']);
    });

    it('returns nothing for an empty query', () => {
        expect(matchSettingsSearchResults(english, '   ')).toEqual([]);
    });
});
