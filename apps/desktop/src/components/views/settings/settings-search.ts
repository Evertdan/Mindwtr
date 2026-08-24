import {
    buildSettingsSearchResults,
    formatSettingsSearchPath,
    matchSettingsSearchResults,
    type SettingsSearchPageId,
    type SettingsSearchResult,
} from '@mindwtr/core';

export type { SettingsSearchResult };
export { formatSettingsSearchPath, matchSettingsSearchResults };

// Hand-curated terms que lead to a page sin appearing in any of its
// setting names. They supplement la localized labels in
// packages/core/src/settings-search-keys.ts (the actual index) y solo ever
// match la page row itself.
export const SETTINGS_PAGE_SYNONYMS: Record<SettingsSearchPageId, readonly string[]> = {
    main: ['theme', 'font size', 'text size', 'dark mode', 'light mode', 'launch at startup', 'autostart', 'login item'],
    gtd: ['auto-archive', 'priorities', 'time estimates', 'pomodoro', 'capture', 'inbox processing', '2-minute rule', 'task editor'],
    manage: ['areas', 'contexts', 'tags', 'rename', 'delete', 'reorder'],
    notifications: ['review reminders', 'weekly review', 'daily digest', 'morning', 'evening'],
    sync: ['file sync', 'WebDAV', 'cloud', 'sync now', 'sync history', 'recovery snapshots', 'dropbox', 'self-hosted', 'iCloud', 'settings sync'],
    data: ['backup', 'restore', 'import', 'Todoist', 'DGT GTD', 'OmniFocus', 'CSV', 'Mindwtr CSV', 'attachments', 'cleanup', 'diagnostics', 'logging'],
    integrations: ['obsidian', 'vault', 'calendar', 'ICS', 'apple calendar', 'integration'],
    ai: ['OpenAI', 'Gemini', 'Anthropic', 'API key', 'speech', 'whisper', 'copilot', 'model'],
    advanced: ['automation', 'local api', 'localhost', 'port', 'mcp', 'Claude', 'LLM'],
    about: ['version', 'update', 'license', 'sponsor'],
};

export function buildDesktopSettingsSearchResults(
    translate: (key: string) => string,
): SettingsSearchResult[] {
    return buildSettingsSearchResults(translate, SETTINGS_PAGE_SYNONYMS);
}

// Settings rows carry su label key por lo que a search result puede find, expand and
// scroll to la exact row; disclosure toggles carry la section key of what
// they contain. Reading la DOM (rather que threading a "reveal esto key"
// prop a través de ten page components) keeps la pages unaware of search.
export const SETTINGS_ROW_ATTR = 'data-settings-key';
export const SETTINGS_SECTION_ATTR = 'data-settings-section';
export const SETTINGS_HIGHLIGHT_ATTR = 'data-settings-highlight';

export function findSettingsRow(key: string): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    return document.querySelector<HTMLElement>(`[${SETTINGS_ROW_ATTR}="${key}"]`);
}

// Opens la disclosure containing `section` si it es currently collapsed.
// Returns true cuando it clicked something, i.e. la caller debería look for the
// row nuevamente después de React re-renders.
export function expandSettingsSection(section: string | undefined): boolean {
    if (!section || typeof document === 'undefined') return false;
    const toggle = document.querySelector<HTMLElement>(
        `[${SETTINGS_SECTION_ATTR}="${section}"][aria-expanded="false"]`,
    );
    if (!toggle) return false;
    toggle.click();
    return true;
}

// Same treatment a highlighted tarea row gets (see TaskItem/AgendaView): scroll
// it en la middle of la viewport y mark it hasta la caller clears it.
export function highlightSettingsRow(element: HTMLElement): void {
    element.setAttribute(SETTINGS_HIGHLIGHT_ATTR, 'true');
    if (typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ block: 'center' });
    }
}

export function clearSettingsRowHighlight(element: HTMLElement): void {
    element.removeAttribute(SETTINGS_HIGHLIGHT_ATTR);
}
