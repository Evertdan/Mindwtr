export const allowedEnglishMirrorTerms = [
    'Mindwtr',
    'Apple',
    'WebDAV',
    'CalDAV',
    'Dropbox',
    'iCloud',
    'CloudKit',
    'GitHub',
    'OpenAI',
    'Gemini',
    'Anthropic',
    'Claude',
    'Pomodoro',
    'GTD',
    'ICS',
    'URL',
    'URI',
    'API',
    'AI',
    'OK',
    'HTTP',
    'HTTPS',
    'JSON',
    'CSV',
    'PDF',
    'ZIP',
    'Markdown',
    'TaskNotes',
    'Todoist',
    'TickTick',
    'OmniFocus',
    'Obsidian',
    'DGT',
    'Vim',
    'Emacs',
    'Nord',
    'Catppuccin',
    'Macchiato',
    'Dracula',
] as const;

export const allowedEnglishMirrorKeysByLocale: Record<string, readonly string[]> = {
    de: [
        'keybindings.style.standard',
        // "Routine" is the ordinary German noun for the concept (same spelling
        // as English), used consistently across the tdahRoutines.* copy.
        'tdahToday.routineLabel',
        'tdahActivity.origin.routine',
    ],
    es: [
        // "Manual" is the ordinary Spanish adjective/noun, identical to English.
        'tdahActivity.origin.manual',
    ],
    it: [
        'keybindings.style.standard',
        // "Routine" is the ordinary Italian noun (same spelling as English),
        // matching the lowercase usage in 'Nessuna routine oggi'.
        'tdahToday.routineLabel',
        'tdahActivity.origin.routine',
    ],
    ko: [
        // Korean UI writes the e-ink theme in Latin.
        'settings.eink',
    ],
    fa: [
        // Persian tech writing keeps "E-Tinta" in Latin (it's a display-technology
        // brand name), and "Apple Reminders" is the Apple product's proper name.
        'settings.eink',
        'settings.appleRemindersImport.appleReminders',
    ],
    nl: [
        // "Routine" is the ordinary Dutch noun (same spelling as English),
        // matching 'Geen Routine vandaag' and tdahRoutines.* copy.
        'tdahToday.routineLabel',
        'tdahActivity.origin.routine',
    ],
    pt: [
        // "Manual" is the ordinary Portuguese adjective, identical to English.
        'tdahActivity.origin.manual',
    ],
    sv: [
        // Swedish shares these words with English identically (loanwords or
        // Latin-derived cognates spelled the same way in both languages), or the
        // term is a proper noun/brand kept in Latin per the add-swedish handoff.
        'keybindings.style.standard',
        'settings.gtdMobile.standard',
        'taskEdit.start',
        'calendar.start',
        'taskEdit.statusLabel',
        'projects.statusLabel',
        'bulk.organizeStatus',
        'settings.dropboxStatus',
        'taskEdit.relativeStartMinutesShort',
        'taskEdit.repeatReminderMinutesShort',
        'settings.system',
        'settings.eink',
        'settings.sepia',
        'settings.version',
        'settings.data',
        'settings.captureDefaultText',
        'settings.syncHistoryBackend',
        'settings.rendering',
        'settings.localApiPort',
        'settings.emailCapturePort',
        'settings.appleRemindersImport.appleReminders',
    ],
    fr: [
        'calendar.date',
        'keybindings.style.standard',
        'common.pause',
        'context.energy.routine',
        'list.compact',
        'list.densityCompact',
        'projects.sectionsLabel',
        'recurrence.occurrenceUnit',
        'review.description',
        'settings.aiMobile.suggestions',
        'settings.densityCompact',
        'settings.documentation',
        'settings.feedbackMessage',
        'settings.feedbackWhereNotifications',
        'settings.gtdMobile.simple',
        'settings.gtdMobile.standard',
        'settings.notifications',
        'settings.speechFieldDescription',
        'settings.syncHistoryBackend',
        'settings.syncHistoryType',
        'settings.version',
        'tab.menu',
        'tags.title',
        'task.aria.tags',
        'taskEdit.descriptionLabel',
        'taskEdit.tagsLabel',
        'taskEdit.timeSpentPlaceholder',
        // 'Notifications' is spelled identically in French, same reasoning as
        // the pre-existing settings.notifications entry above.
        'tdahOnboarding.permissions.notificationsTitle',
        // "Routine" is the ordinary French noun (same spelling as English),
        // matching the capitalization of 'Aucune Routine aujourd'hui'.
        'tdahToday.routineLabel',
        'tdahActivity.origin.routine',
    ],
};

const translatableEnglishPattern = /[A-Za-z]{3,}/;

export function isAllowedEnglishMirrorKey(locale: string, key: string): boolean {
    return allowedEnglishMirrorKeysByLocale[locale]?.includes(key) ?? false;
}

export function stripAllowedEnglishTerms(value: string): string {
    let next = value
        .replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/g, '')
        .replace(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g, '')
        // Single-brace placeholders (e.g. {date}, {count}) are as valid as the
        // double-brace form the i18n runtime accepts (index.ts's interpolation
        // regex matches both) — stripping only {{...}} left a translation that
        // keeps a required {date}/{count} token verbatim flagged as untranslated
        // English on every non-Latin locale that has to preserve it in place.
        .replace(/\{\s*[A-Za-z0-9_]+\s*\}/g, '')
        .replace(/\/[A-Za-z][A-Za-z0-9:_-]*/g, '')
        .replace(/[+#@!][A-Za-z][A-Za-z0-9:_-]*/g, '');

    for (const term of allowedEnglishMirrorTerms) {
        next = next.replace(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '');
    }
    return next;
}

export function hasTranslatableEnglishText(value: string): boolean {
    return translatableEnglishPattern.test(stripAllowedEnglishTerms(value));
}
