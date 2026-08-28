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
        // "Limbo" is the ordinary German noun for the concept (same spelling as
        // English), matching tdahToday.scoreboardLimbo ('Im Limbo') and
        // tdahActivity.state.limbo — same reasoning for both the T-08 in-screen
        // title and the nav/tile label (story 3.4).
        'tdahToday.limboTitle',
        'nav.tdahLimbo',
        // Same "Routine" reasoning as tdahToday.routineLabel above, for the
        // History/Metrics origin and Routine filter labels (story 3.5).
        'tdahHistory.filters.originRoutine',
        'tdahHistory.filters.routine',
    ],
    es: [
        // "Manual" is the ordinary Spanish adjective/noun, identical to English.
        'tdahActivity.origin.manual',
        // Same "Manual" reasoning, for the History/Metrics origin filter option
        // (story 3.5).
        'tdahHistory.filters.originManual',
        // "Limbo" is the ordinary Spanish noun for the concept (same spelling as
        // English), matching tdahToday.scoreboardLimbo/tdahActivity.state.limbo —
        // same reasoning for both the T-08 in-screen title and the nav/tile
        // label (story 3.4).
        'tdahToday.limboTitle',
        'nav.tdahLimbo',
    ],
    it: [
        'keybindings.style.standard',
        // "Routine" is the ordinary Italian noun (same spelling as English),
        // matching the lowercase usage in 'Nessuna routine oggi'.
        'tdahToday.routineLabel',
        'tdahActivity.origin.routine',
        // "Limbo" is the ordinary Italian noun for the concept (same spelling as
        // English), matching tdahToday.scoreboardLimbo ('In Limbo') and
        // tdahActivity.state.limbo — same reasoning for both the T-08 in-screen
        // title and the nav/tile label (story 3.4).
        'tdahToday.limboTitle',
        'nav.tdahLimbo',
        // Same "Routine" reasoning as tdahToday.routineLabel above, for the
        // History/Metrics origin and Routine filter labels (story 3.5).
        'tdahHistory.filters.originRoutine',
        'tdahHistory.filters.routine',
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
        // "Limbo" is the ordinary Dutch noun for the concept (same spelling as
        // English), matching tdahToday.scoreboardLimbo ('In Limbo') and
        // tdahActivity.state.limbo — same reasoning for both the T-08 in-screen
        // title and the nav/tile label (story 3.4).
        'tdahToday.limboTitle',
        'nav.tdahLimbo',
        // Same "Routine" reasoning as tdahToday.routineLabel above, for the
        // History/Metrics origin and Routine filter labels (story 3.5).
        'tdahHistory.filters.originRoutine',
        'tdahHistory.filters.routine',
        // "Week" is the ordinary Dutch noun for the concept, spelled exactly as
        // in English, for the shared period selector (story 3.5).
        'tdahPeriod.week',
    ],
    pt: [
        // "Manual" is the ordinary Portuguese adjective, identical to English.
        'tdahActivity.origin.manual',
        // Same "Manual" reasoning, for the History/Metrics origin filter option
        // (story 3.5).
        'tdahHistory.filters.originManual',
        // "Limbo" is the ordinary Portuguese noun for the concept (same spelling
        // as English), matching tdahToday.scoreboardLimbo ('Em Limbo') and
        // tdahActivity.state.limbo — same reasoning for both the T-08 in-screen
        // title and the nav/tile label (story 3.4).
        'tdahToday.limboTitle',
        'nav.tdahLimbo',
    ],
    vi: [
        // "Limbo" is kept as the ordinary Vietnamese loanword for the concept
        // (same spelling as English), matching tdahToday.scoreboardLimbo
        // ('Trong Limbo') and tdahActivity.state.limbo — same reasoning for
        // both the T-08 in-screen title and the nav/tile label (story 3.4).
        'tdahToday.limboTitle',
        'nav.tdahLimbo',
    ],
    pl: [
        // "Limbo" is kept as the ordinary Polish loanword for the concept (same
        // spelling as English), matching tdahToday.scoreboardLimbo ('W Limbo')
        // and tdahActivity.state.limbo — same reasoning for both the T-08
        // in-screen title and the nav/tile label (story 3.4).
        'tdahToday.limboTitle',
        'nav.tdahLimbo',
    ],
    tr: [
        // "Limbo" is kept as the ordinary Turkish loanword for the concept (same
        // spelling as English), matching tdahToday.scoreboardLimbo ('Limbo'da')
        // and tdahActivity.state.limbo — same reasoning for both the T-08
        // in-screen title and the nav/tile label (story 3.4).
        'tdahToday.limboTitle',
        'nav.tdahLimbo',
    ],
    cs: [
        // "Limbo" is the nominative form of the same Czech loanword used
        // (declined) in tdahToday.scoreboardLimbo ('V Limbu') and
        // tdahActivity.state.limbo — identical to the English spelling in the
        // nominative case, used for both the T-08 in-screen title and the
        // nav/tile label (story 3.4).
        'tdahToday.limboTitle',
        'nav.tdahLimbo',
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
        // "Period" is the ordinary Swedish noun for the concept (same spelling as
        // English), used for the History/Metrics range selector (story 3.5).
        'tdahHistory.filters.period',
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
        // "Limbo" is the ordinary French noun for the concept (same spelling as
        // English), matching tdahToday.scoreboardLimbo ('En Limbo') and
        // tdahActivity.state.limbo — same reasoning for both the T-08
        // in-screen title and the nav/tile label (story 3.4).
        'tdahToday.limboTitle',
        'nav.tdahLimbo',
        // Same "Routine" reasoning as tdahToday.routineLabel above, for the
        // History/Metrics origin and Routine filter labels (story 3.5).
        'tdahHistory.filters.originRoutine',
        'tdahHistory.filters.routine',
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
