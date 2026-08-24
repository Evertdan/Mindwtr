import { useEffect, useState, useRef, useTransition, useCallback, useMemo, Suspense, lazy } from 'react';
import { Layout } from './components/Layout';
import { ListView } from './components/views/ListView';
import { CalendarView } from './components/views/CalendarView';
const BoardView = lazy(() => import('./components/views/BoardView').then((m) => ({ default: m.BoardView })));
const ObsidianView = lazy(() => import('./components/views/ObsidianView').then((m) => ({ default: m.ObsidianView })));
import { ContextsView } from './components/views/ContextsView';
import { ProjectsView as ProjectsViewEager } from './components/views/ProjectsView';
const ReviewView = lazy(() => import('./components/views/ReviewView').then((m) => ({ default: m.ReviewView })));
import { ArchiveView } from './components/views/ArchiveView';
import { TrashView } from './components/views/TrashView';
import { AgendaView } from './components/views/AgendaView';
import { SearchView } from './components/views/SearchView';
import {
    ACTIVE_APP_ANNOUNCEMENT,
    APP_ANNOUNCEMENT_DISMISSED_VALUE,
    DONATION_PROMPT_ANNOUNCEMENT,
    addBreadcrumb,
    configureDateFormatting,
    flushPendingSave,
    getAnnouncementDismissalStorageKey,
    isSupportedLanguage,
    isTaskFinished,
    recordDonationPromptShown,
    recordDonationPromptSupportClicked,
    recordUpdateReminderChecked,
    recordUpdateReminderDismissed,
    recordUpdateReminderShown,
    shouldShowAppAnnouncement,
    shouldShowDonationPrompt,
    shouldCheckUpdateReminder,
    shouldShowUpdateReminder,
    sortTasksByFocusOrder,
    summarizeMergeStats,
    translateWithFallback,
    useTaskStore,
    resolveFeatureFlags,
    resolveI18nText,
    type AppAnnouncement,
    type AppAnnouncementAction,
} from '@mindwtr/core';
import { buildTrayTooltip } from './lib/tray-tooltip';
import { GlobalSearch } from './components/GlobalSearch';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StartupPromptModal, type StartupPromptPresentation } from './components/StartupPromptModal';
import { DesktopOnboardingFlow } from './components/DesktopOnboardingFlow';
import { Dialog, DialogBody, DialogFooter } from './components/ui/Dialog';
import { useLanguage } from './contexts/language-context';
import { KeybindingProvider } from './contexts/keybinding-context';
import { QuickAddModal } from './components/QuickAddModal';
import { CloseBehaviorModal } from './components/CloseBehaviorModal';
import { PersistenceFailureBanner } from './components/PersistenceFailureBanner';
import { startDesktopNotifications, stopDesktopNotifications } from './lib/notification-service';
import {
    runFullDesktopCalendarPushSync,
    startDesktopCalendarPushSync,
    stopDesktopCalendarPushSync,
} from './lib/desktop-calendar-push-sync';
import { startMacWidgetSync, stopMacWidgetSync } from './lib/macos-widget-sync';
import { SyncService } from './lib/sync-service';
import type { ExternalSyncChange, ExternalSyncChangeResolution } from './lib/sync-service';
import { migratePortableAttachments } from './lib/portable-migration';
import { logDesktopStartupContext } from './lib/startup-context';
import * as LocalDataWatcher from './lib/local-data-watcher';
import { invokeNative } from './lib/tauri-invoke';
import { getInstallSourceOrFallback, isFlatpakRuntime, isTauriRuntime } from './lib/runtime';
import { useDesktopShellSync } from './lib/desktop-shell-sync';
import { reportError as reportAppError } from './lib/report-error';
import { syncNativeProxyUrl } from './lib/tauri-http';
import { persistLastView, readRestorableLastView } from './lib/session-restore';
import { readViewFromUrl, writeViewToUrl } from './lib/view-url-params';
import { logError, logInfo } from './lib/app-log';
import { createDesktopAutoSyncController } from './lib/auto-sync-controller';
import {
    createEmailCaptureController,
    registerEmailCaptureController,
    type EmailCaptureController,
} from './lib/email-capture';
import { canDesktopAutoSync } from './lib/desktop-auto-sync-eligibility';
import { beginSettingsOpenTrace, markSettingsOpenTrace, wrapSettingsOpenImport } from './lib/settings-open-diagnostics';
import {
    THEME_STORAGE_KEY,
    applyNativeTheme,
    applyThemeMode,
    resolveDesktopThemeMode,
    resolveNativeTheme,
    resolveSystemThemeCommandPreference,
    watchSystemThemeCommandPreference,
    watchNativeSystemThemePreference,
    watchSystemThemePreference,
} from './lib/theme';
import {
    DEFAULT_DESKTOP_TEXT_SIZE_MODE,
    TEXT_SIZE_STORAGE_KEY,
    applyDesktopTextSize,
    coerceDesktopTextSize,
} from './lib/text-size';
import { saveStoredFullscreen } from './lib/window-state';
import { installWebviewZoomShortcuts } from './lib/webview-zoom';
import { isEditableManualSyncShortcutTarget, isManualSyncShortcut } from './lib/manual-sync-shortcut';
import {
    isDesktopSyncRuntimeActive,
    resolveVisibilitySyncAction,
    shouldHandleDesktopManualSyncShortcut,
} from './lib/desktop-sync-runtime';
import { resolveCloseBehavior } from './lib/window-behavior';
import { handleDesktopCloseRequest } from './lib/close-request-handler';
import { beginCloseFlush, resetCloseFlushGate } from './lib/close-flush-gate';
import { hideMainWindowToTray } from './lib/hide-to-tray';
import { useConfirmDialog } from './hooks/useConfirmDialog';
import { subscribeNavigateEvent } from './lib/navigation-events';
import { shouldOpenDesktopFirstRunOnboarding, subscribeDesktopOnboardingEvent } from './lib/desktop-onboarding-events';
import { QUICK_ADD_SAVED_EVENT } from './lib/quick-add-saved-event';
import {
    readLocalUserPromptState,
    recordLocalPromptActivity,
    updateLocalUserPromptState,
} from './lib/user-prompt-state';
import {
    checkForUpdates,
    normalizeInstallSource,
    type InstallSource,
} from './lib/update-service';
import { getDesktopUpdateTarget, isDesktopUpdateReminderAllowed, isUpdateReminderVersionTrusted } from './lib/desktop-update-targets';
import { usePomodoroStore } from './store/pomodoro-store';
import { usePomodoroAlerts } from './hooks/usePomodoroAlerts';
import {
    PROMPT_TEST_CONTROLS_ENABLED,
    subscribePromptTest,
} from './lib/prompt-test-controls';
import { useStartupPromptQueue, type StartupPromptDescriptor } from '@mindwtr/core';
import { useUiStore } from './store/ui-store';
import { useObsidianStore } from './store/obsidian-store';
import type { SettingsOnboardingHintPage, SettingsPage } from './components/views/SettingsView';
import { installKeyringFallbackWarningListener } from './lib/keyring-fallback-warning';

const ProjectsView = import.meta.env.DEV
    ? ProjectsViewEager
    : lazy(() => import('./components/views/ProjectsView').then((m) => ({ default: m.ProjectsView })));
const SettingsView = lazy(wrapSettingsOpenImport(
    'settings-view-chunk',
    () => import('./components/views/SettingsView').then((m) => ({ default: m.SettingsView }))
));

const DEFAULT_DESKTOP_VIEW = 'agenda';
const DESKTOP_ONBOARDING_STORAGE_KEY = 'mindwtr:desktop:first-run-onboarding:v1';
const DONATION_PROMPT_ENABLED = (
    import.meta.env.VITE_DONATION_PROMPT_ENABLED === '1'
    || import.meta.env.VITE_DONATION_PROMPT_ENABLED === 'true'
);
const DONATION_PROMPT_STARTUP_DELAY_MS = 2000;
// #913: a save_data bloqueado invocar used to leave la descarga pre-cierre awaited with
// no bound, wedging la window shut forever. Past esto, Dejar de bloquear y ask
// la user — generously past any normal save, y past la perro guardián nativo's
// 5s por lo que its rastreo forzado lands first si la canal completo es dead.
const CLOSE_FLUSH_TIMEOUT_MS = 10_000;
const MS_STORE_REVIEW_URL = 'ms-windows-store://review/?ProductId=9N0V5B0B6FRX';
const MAC_APP_STORE_REVIEW_URL = 'macappstore://itunes.apple.com/app/id6758597144?action=write-review';

type DesktopUpdateReminderInfo = {
    currentVersion: string;
    latestVersion: string;
    latestReleasedAt: string | null;
    releaseUrl: string;
    actionLabel?: string;
    testOnly?: boolean;
};

const isDesktopDonationPromptAllowed = (installSource: string | null | undefined): boolean => (
    DONATION_PROMPT_ENABLED && normalizeInstallSource(installSource) !== 'unknown'
);

const readDesktopOnboardingDismissed = () => {
    if (typeof window === 'undefined') return true;
    try {
        return window.localStorage.getItem(DESKTOP_ONBOARDING_STORAGE_KEY) === 'dismissed';
    } catch {
        return false;
    }
};

const writeDesktopOnboardingDismissed = () => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(DESKTOP_ONBOARDING_STORAGE_KEY, 'dismissed');
    } catch {
        // If localStorage es unavailable, mantener la despido en memoria for esto session.
    }
};

const buildUpdateReminderAnnouncement = (info: DesktopUpdateReminderInfo): AppAnnouncement => ({
    id: `update-reminder-${info.latestVersion}`,
    title: 'Update available',
    body: `Mindwtr ${info.latestVersion} is available. You are using ${info.currentVersion}. Update when you have a minute to keep fixes and improvements current.`,
    action: {
        type: 'url',
        label: info.actionLabel ?? 'View release',
        url: info.releaseUrl,
    },
});

const PROMPT_TEST_ANNOUNCEMENT: AppAnnouncement = {
    id: 'prompt-test-announcement',
    title: 'Test announcement',
    body: 'This is the temporary announcement template test. It uses the same popup surface as a real maintainer announcement.',
};

const getDesktopPlatform = (): 'windows' | 'macos' | 'linux' | 'other' => {
    const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent.toLowerCase();
    if (userAgent.includes('win')) return 'windows';
    if (userAgent.includes('mac')) return 'macos';
    if (userAgent.includes('linux')) return 'linux';
    return 'other';
};

const getDesktopReviewTarget = (installSource: InstallSource | null): { label: string; url: string } | null => {
    const platform = getDesktopPlatform();
    if (platform === 'linux') return null;
    if (installSource === 'microsoft-store' || platform === 'windows') {
        return { label: 'Rate Mindwtr', url: MS_STORE_REVIEW_URL };
    }
    if (installSource === 'mac-app-store' || platform === 'macos') {
        return { label: 'Rate Mindwtr', url: MAC_APP_STORE_REVIEW_URL };
    }
    return {
        label: 'Open GitHub',
        url: 'https://github.com/dongdongbh/Mindwtr',
    };
};

const buildPromptTestReviewAnnouncement = (installSource: InstallSource | null): AppAnnouncement | null => {
    const target = getDesktopReviewTarget(installSource);
    if (!target) return null;
    return {
        id: 'prompt-test-review',
        title: 'Enjoying Mindwtr?',
        body: 'A quick rating helps others discover it. It only takes a moment.',
        action: {
            type: 'url',
            label: target.label,
            url: target.url,
        },
    };
};

// Títulos de Tarea no puede contener a NUL, por lo que it es seguro unir la Títulos de Enfoque en a
// single string for la información sobre herramientas de bandeja selector. A separador visible tal as a space
// sería split títulos de múltiples palabras apart cuando la string es analizado de vuelta.
const FOCUS_TITLE_SEPARATOR = '\u0000';

function App() {
    // Reapertura pronto después de la app closed resumes la sesión interrumpida on
    // la misma pantalla; a sesión nueva starts on la vista predeterminada (#842).
    const [restoredLastView] = useState(() => {
        if (import.meta.env.MODE === 'test' || import.meta.env.VITEST || process.env.NODE_ENV === 'test') return null;
        return readRestorableLastView();
    });
    // The URL es intención explícita del usuario (a link, o a refresh mid-Settings) and
    // prevalece sobre la instantánea de localStorage, que in turn prevalece sobre the
    // default (#931).
    const [viewFromUrl] = useState(() => readViewFromUrl());
    const [currentView, setCurrentView] = useState(viewFromUrl ?? restoredLastView?.view ?? DEFAULT_DESKTOP_VIEW);
    const [activeView, setActiveView] = useState(viewFromUrl ?? restoredLastView?.view ?? DEFAULT_DESKTOP_VIEW);
    // handleViewChange keeps ?view= in sync on cada later navigation, but a
    // carga nueva que resuelve la vista desde localStorage (no ?view= yet)
    // nunca llama it — write la resolved initial view back once por lo que copying
    // la URL justo después de cargar todavía vincula a lo que hay en pantalla (#931 seguimiento).
    useEffect(() => {
        writeViewToUrl(currentView);
    }, []);
    const [settingsInitialPage, setSettingsInitialPage] = useState<SettingsPage | undefined>();
    const [settingsOnboardingHintPage, setSettingsOnboardingHintPage] = useState<
        SettingsOnboardingHintPage | undefined
    >();
    const [desktopOnboardingDismissed, setDesktopOnboardingDismissed] = useState(readDesktopOnboardingDismissed);
    const [desktopOnboardingOpen, setDesktopOnboardingOpen] = useState(false);
    const [desktopOnboardingBusy, setDesktopOnboardingBusy] = useState(false);
    const [desktopOnboardingError, setDesktopOnboardingError] = useState<string | null>(null);
    const [desktopOnboardingGateSettled, setDesktopOnboardingGateSettled] = useState(false);
    const [desktopInstallSource, setDesktopInstallSource] = useState<InstallSource | null>(null);
    const [updateReminderInfo, setUpdateReminderInfo] = useState<DesktopUpdateReminderInfo | null>(null);
    const [testAnnouncement, setTestAnnouncement] = useState<AppAnnouncement | null>(null);
    const [, startTransition] = useTransition();
    const fetchData = useTaskStore((state) => state.fetchData);
    const seedGettingStarted = useTaskStore((state) => state.seedGettingStarted);
    const isLoading = useTaskStore((state) => state.isLoading);
    const visibleDataCount = useTaskStore((state) => (
        state.tasks.length + state.projects.length + state.sections.length + state.areas.length
    ));
    const setError = useTaskStore((state) => state.setError);
    const isFlatpak = isFlatpakRuntime();
    const windowDecorations = useTaskStore((state) => state.settings?.window?.decorations);
    const closeBehavior = useTaskStore((state) => (
        resolveCloseBehavior(state.settings?.window?.closeBehavior, isFlatpak)
    ));
    const showTray = useTaskStore((state) => state.settings?.window?.showTray);
    const settingsTheme = useTaskStore((state) => state.settings?.theme);
    const settingsProxyUrl = useTaskStore((state) => state.settings?.network?.proxyUrl);
    const settingsTextSize = useTaskStore((state) => state.settings?.appearance?.textSize);
    const settingsLanguage = useTaskStore((state) => state.settings?.language);
    const settingsDateFormat = useTaskStore((state) => state.settings?.dateFormat);
    const settingsCalendarSystem = useTaskStore((state) => state.settings?.calendarSystem);
    const settingsTimeFormat = useTaskStore((state) => state.settings?.timeFormat);
    const updateSettings = useTaskStore((state) => state.updateSettings);
    const showToast = useUiStore((state) => state.showToast);
    const { requestConfirmation, confirmModal } = useConfirmDialog();
    const { t, language, setLanguage } = useLanguage();
    // App-wide por lo que a running timer todavía ticks y todavía alerts mientras la user is
    // in another view o another workspace (#528).
    usePomodoroAlerts();
    // Selected as one joined string, not an array: a fresh array sería fail the
    // store's identity verificar y re-renderizar on cada write. NUL es la separator
    // because it no puede occur in a tarea title — a space sería split multi-word
    // titles en separate entries.
    const focusTaskTitles = useTaskStore((state) => (
        sortTasksByFocusOrder(
            state.tasks.filter((task) => (
                task.isFocusedToday && !isTaskFinished(task)
            ))
        ).map((task) => task.title).join(FOCUS_TITLE_SEPARATOR)
    ));
    const trayTooltip = useMemo(() => buildTrayTooltip({
        appName: translateWithFallback(t, 'app.name', 'Mindwtr'),
        focusLabel: translateWithFallback(t, 'agenda.todaysFocus', "Today's Focus"),
        titles: focusTaskTitles ? focusTaskTitles.split(FOCUS_TITLE_SEPARATOR) : [],
    }), [focusTaskTitles, t]);
    const isActiveRef = useRef(true);
    const lastSyncErrorRef = useRef<string | null>(null);
    const lastSyncErrorAtRef = useRef(0);
    const [closePromptOpen, setClosePromptOpen] = useState(false);
    const [closePromptRemember, setClosePromptRemember] = useState(false);
    const [externalSyncChange, setExternalSyncChange] = useState<ExternalSyncChange | null>(null);
    const [resolvingExternalSync, setResolvingExternalSync] = useState(false);
    const [hasHydratedSettings, setHasHydratedSettings] = useState(false);
    const closePromptRememberRef = useRef(false);
    const closePromptOpenRef = useRef(false);
    const localPromptActivityRecordedRef = useRef(false);
    const lastViewBreadcrumbRef = useRef<string | null>(null);
    const isObsidianEnabled = useObsidianStore((state) => state.config.enabled);
    const obsidianVaultPath = useObsidianStore((state) => state.config.vaultPath);
    const startObsidianWatcher = useObsidianStore((state) => state.startWatcher);
    const stopObsidianWatcher = useObsidianStore((state) => state.stopWatcher);
    const activeAnnouncement = testAnnouncement ?? ACTIVE_APP_ANNOUNCEMENT;

    // inicio prompts share one gate y abierto one at a time. The descriptors
    // below carry each prompt's own eligibility/present logic; la cola owns
    // precedence (announcement > actualizar > donation), la inicio delays, and
    // session dismissal. See packages/core/src/inicio-prompts.ts.
    const startupPromptsEnabled = !(
        import.meta.env.MODE === 'test' || import.meta.env.VITEST || process.env.NODE_ENV === 'test'
    );
    const startupPromptGateOpen = (
        hasHydratedSettings
        && !isLoading
        && desktopOnboardingGateSettled
        && !desktopOnboardingOpen
        && !closePromptOpen
        && !externalSyncChange
    );
    const startupPromptDescriptors = useMemo<StartupPromptDescriptor[]>(() => [
        {
            // Maintainer announcement: highest precedence; cuando one es configured
            // it también blocks la donation/actualizar prompts (see su isEligible).
            id: 'announcement',
            priority: 30,
            delayMs: 250,
            isEligible: () => {
                const announcement = ACTIVE_APP_ANNOUNCEMENT;
                if (!shouldShowAppAnnouncement(announcement, null)) return false;
                let dismissedValue: string | null = null;
                try {
                    dismissedValue = window.localStorage.getItem(getAnnouncementDismissalStorageKey(announcement.id));
                } catch {
                    dismissedValue = null;
                }
                return shouldShowAppAnnouncement(announcement, dismissedValue);
            },
            present: () => true,
        },
        {
            // actualizar reminder: records la verificar on selection, then confirms an
            // actualizar actually exists antes de opening (declines otherwise).
            id: 'update-reminder',
            priority: 20,
            delayMs: 1750,
            // checkForUpdates es a plain traer con no tiempo de espera; cap present() por lo que a
            // hung network nunca holds la single slot y starves la donation
            // prompt for la whole session.
            presentTimeoutMs: 15000,
            isEligible: () => {
                if (!desktopInstallSource) return false;
                if (!isDesktopUpdateReminderAllowed(desktopInstallSource)) return false;
                if (ACTIVE_APP_ANNOUNCEMENT) return false;
                const promptState = readLocalUserPromptState();
                return shouldCheckUpdateReminder({ nowMs: Date.now(), promptState, updateReminderAllowed: true });
            },
            onSelect: () => {
                updateLocalUserPromptState((state) => recordUpdateReminderChecked(state, Date.now()));
            },
            present: async (signal) => {
                if (!desktopInstallSource) return false;
                const { getVersion } = await import('@tauri-apps/api/app');
                const currentVersion = await getVersion();
                const info = await checkForUpdates(currentVersion, { installSource: desktopInstallSource });
                if (signal.aborted) return false;
                if (!info.hasUpdate) return false;
                if (!isUpdateReminderVersionTrusted(desktopInstallSource, info.source)) return false;
                const latestPromptState = readLocalUserPromptState();
                if (!shouldShowUpdateReminder({
                    nowMs: Date.now(),
                    promptState: latestPromptState,
                    updateReminderAllowed: true,
                    currentVersion: info.currentVersion,
                    latestVersion: info.latestVersion,
                    latestReleasedAt: info.latestReleasedAt,
                })) {
                    return false;
                }
                if (signal.aborted) return false;
                updateLocalUserPromptState((state) => recordUpdateReminderShown(state, Date.now()));
                const updateTarget = getDesktopUpdateTarget(desktopInstallSource);
                setUpdateReminderInfo({
                    currentVersion: info.currentVersion,
                    latestVersion: info.latestVersion,
                    latestReleasedAt: info.latestReleasedAt,
                    releaseUrl: updateTarget.url,
                    actionLabel: updateTarget.label,
                });
                return true;
            },
            onError: (error, phase) => {
                const step = phase === 'select'
                    ? 'recordUpdateReminderChecked'
                    : phase === 'present'
                        ? 'checkUpdateReminder'
                        : 'readUpdateReminderState';
                void logError(error, { scope: 'prompt-state', step });
            },
        },
        {
            // Donation ask: lowest precedence; suppressed whenever an announcement
            // es configured o an actualizar reminder es showing (via la cola).
            id: 'donation',
            priority: 10,
            delayMs: DONATION_PROMPT_STARTUP_DELAY_MS,
            isEligible: () => {
                if (ACTIVE_APP_ANNOUNCEMENT) return false;
                if (!isDesktopDonationPromptAllowed(desktopInstallSource)) return false;
                const promptState = readLocalUserPromptState();
                return shouldShowDonationPrompt({ nowMs: Date.now(), promptState, donationAllowed: true });
            },
            present: () => true,
            onError: (error) => {
                void logError(error, { scope: 'prompt-state', step: 'readDonationPromptState' });
            },
        },
    ], [desktopInstallSource]);
    const startupPromptQueue = useStartupPromptQueue({
        enabled: startupPromptsEnabled,
        gateOpen: startupPromptGateOpen,
        descriptors: startupPromptDescriptors,
        signals: [desktopInstallSource],
    });
    const startupPromptOpenId = startupPromptQueue.openId;

    const setClosePromptRememberValue = useCallback((next: boolean) => {
        closePromptRememberRef.current = next;
        setClosePromptRemember(next);
    }, []);

    const setClosePromptOpenValue = useCallback((next: boolean) => {
        closePromptOpenRef.current = next;
        setClosePromptOpen(next);
    }, []);

    const resolveExternalSync = useCallback(async (resolution: ExternalSyncChangeResolution) => {
        setResolvingExternalSync(true);
        try {
            const result = await SyncService.resolveExternalSyncChange(resolution);
            if (result.success) {
                if (resolution === 'keep-local') {
                    showToast(t('settings.externalSyncKeptLocal'), 'success');
                } else if (resolution === 'use-external') {
                    showToast(t('settings.externalSyncUsedExternal'), 'success');
                } else {
                    const conflicts = summarizeMergeStats(result.stats).conflicts;
                    showToast(
                        conflicts > 0
                            ? resolveI18nText(t, 'settings.externalSyncMergedConflicts', { values: { count: conflicts } })
                            : t('settings.externalSyncMerged'),
                        'success'
                    );
                }
                setExternalSyncChange(null);
                return;
            }
            showToast(result.error || t('settings.externalSyncResolveFailed'), 'error');
        } finally {
            setResolvingExternalSync(false);
        }
    }, [showToast, t]);

    const persistCloseBehavior = useCallback(async (behavior: 'tray' | 'quit') => {
        await updateSettings({
            window: {
                ...(useTaskStore.getState().settings?.window ?? {}),
                closeBehavior: behavior,
            },
        });
        await flushPendingSave();
    }, [updateSettings]);

    const getActiveThemeMode = useCallback(() => (
        resolveDesktopThemeMode(settingsTheme, localStorage.getItem(THEME_STORAGE_KEY))
    ), [settingsTheme]);

    const applyActiveNativeTheme = useCallback((stepPrefix = 'apply') => {
        if (!isTauriRuntime()) return;
        const nativeTheme = resolveNativeTheme(getActiveThemeMode());
        void applyNativeTheme(
            nativeTheme,
            () => import('@tauri-apps/api/app'),
            () => import('@tauri-apps/api/window'),
            (step, error) => void logError(error, { scope: 'theme', step: `${stepPrefix}:${step}` }),
        );
    }, [getActiveThemeMode]);

    useEffect(() => {
        if (!hasHydratedSettings) return;
        let cancelled = false;
        const normalizedTheme = getActiveThemeMode();
        localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
        applyThemeMode(normalizedTheme);
        if (normalizedTheme === 'system' && isTauriRuntime()) {
            void resolveSystemThemeCommandPreference(
                (step, error) => void logError(error, { scope: 'theme', step: `initial-command:${step}` }),
            ).then((theme) => {
                if (!cancelled && theme) applyThemeMode('system', theme);
            });
        }
        applyActiveNativeTheme();
        return () => {
            cancelled = true;
        };
    }, [applyActiveNativeTheme, getActiveThemeMode, hasHydratedSettings]);

    useEffect(() => {
        // Hidratar el almacén pomodoro compartido una vez que se cargan las tareas para que las filas de tarea
        // puedan mostrar conteos de sesión por tarea y una sesión de enfoque que terminó
        // mientras la aplicación estaba cerrada acredita sus minutos sin abrir Agenda.
        if (!hasHydratedSettings || isLoading) return;
        const { settings: currentSettings } = useTaskStore.getState();
        if (!resolveFeatureFlags(currentSettings).pomodoro) return;
        const pomodoroState = usePomodoroStore.getState();
        if (pomodoroState.hasHydrated) return;
        pomodoroState.hydratePomodoro({
            autoStartBreaks: currentSettings.gtd?.pomodoro?.autoStartBreaks === true,
            autoStartFocus: currentSettings.gtd?.pomodoro?.autoStartFocus === true,
        });
    }, [hasHydratedSettings, isLoading]);

    useEffect(() => {
        if (!hasHydratedSettings || !isTauriRuntime()) return;
        const reapplyTheme = () => applyActiveNativeTheme('reapply');
        const reapplyThemeWhenVisible = () => {
            if (document.visibilityState === 'visible') {
                reapplyTheme();
            }
        };

        window.addEventListener('focus', reapplyTheme);
        document.addEventListener('visibilitychange', reapplyThemeWhenVisible);
        return () => {
            window.removeEventListener('focus', reapplyTheme);
            document.removeEventListener('visibilitychange', reapplyThemeWhenVisible);
        };
    }, [applyActiveNativeTheme, hasHydratedSettings]);

    useEffect(() => {
        if (!hasHydratedSettings) return;
        // La sincronización nativa lee el proxy desde config.toml; re-espejo después de cada
        // hidratación para que las actualizaciones y los cambios sincronizados tomen efecto (#864).
        syncNativeProxyUrl(settingsProxyUrl).catch((error) => {
            reportAppError('Failed to apply proxy to native sync', error);
        });
    }, [hasHydratedSettings, settingsProxyUrl]);

    useEffect(() => {
        if (!hasHydratedSettings) return;
        const normalizedTextSize = coerceDesktopTextSize(settingsTextSize);
        if (normalizedTextSize === DEFAULT_DESKTOP_TEXT_SIZE_MODE) {
            localStorage.removeItem(TEXT_SIZE_STORAGE_KEY);
        } else {
            localStorage.setItem(TEXT_SIZE_STORAGE_KEY, normalizedTextSize);
        }
        applyDesktopTextSize(normalizedTextSize);
    }, [hasHydratedSettings, settingsTextSize]);

    useEffect(() => {
        if (!hasHydratedSettings) return;
        const normalizedTheme = getActiveThemeMode();
        if (normalizedTheme !== 'system') return;

        const stopWatchingSystemTheme = watchSystemThemePreference((theme) => {
            applyThemeMode('system', theme);
        });

        if (!isTauriRuntime()) {
            return () => {
                stopWatchingSystemTheme();
            };
        }

        const stopWatchingNativeTheme = watchNativeSystemThemePreference(
            () => import('@tauri-apps/api/window'),
            (theme) => {
                applyThemeMode('system', theme);
            },
            (step, error) => {
                void logError(error, { scope: 'theme', step });
            }
        );
        const stopWatchingCommandTheme = watchSystemThemeCommandPreference(
            (theme) => {
                applyThemeMode('system', theme);
            },
            (step, error) => {
                void logError(error, { scope: 'theme', step: `command:${step}` });
            }
        );

        return () => {
            stopWatchingSystemTheme();
            stopWatchingNativeTheme();
            stopWatchingCommandTheme();
        };
    }, [getActiveThemeMode, hasHydratedSettings]);

    useEffect(() => {
        if (!settingsLanguage || !isSupportedLanguage(settingsLanguage)) return;
        if (settingsLanguage === language) return;
        setLanguage(settingsLanguage);
    }, [settingsLanguage, language, setLanguage]);

    useEffect(() => {
        const next = `view:${currentView}`;
        if (lastViewBreadcrumbRef.current === next) return;
        lastViewBreadcrumbRef.current = next;
        addBreadcrumb(next);
    }, [currentView]);

    useEffect(() => {
        const systemLocale = (() => {
            const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
            return String(candidates?.[0] || '').trim();
        })();
        configureDateFormatting({
            language: settingsLanguage || language,
            dateFormat: settingsDateFormat,
            calendarSystem: settingsCalendarSystem,
            timeFormat: settingsTimeFormat,
            systemLocale,
        });
    }, [language, settingsCalendarSystem, settingsDateFormat, settingsLanguage, settingsTimeFormat]);

    const translateOrFallback = useCallback((key: string, fallback: string) => {
        return translateWithFallback(t, key, fallback);
    }, [t]);
    // `t` se reconstruye en cada renderizado de LanguageProvider (carga de traducciones,
    // cambio de idioma), por lo que translateOrFallback no es referencialmente estable.
    // El efecto de configuración de escritorio a continuación registra oyentes de cierre, observadores de archivos
    // y notificaciones — depender de él directamente rompería todo eso
    // y re-ejecutaría fetchData cada vez que se asientan las traducciones. Léalo a través de una
    // referencia en su lugar para que el efecto mantenga solo dependencias estables.
    const translateOrFallbackRef = useRef(translateOrFallback);
    translateOrFallbackRef.current = translateOrFallback;

    const donationPromptAnnouncement = useMemo<AppAnnouncement>(() => ({
        ...DONATION_PROMPT_ANNOUNCEMENT,
        title: translateOrFallback('donationPrompt.title', DONATION_PROMPT_ANNOUNCEMENT.title),
        body: translateOrFallback('donationPrompt.body', DONATION_PROMPT_ANNOUNCEMENT.body),
        dismissLabel: translateOrFallback(
            'donationPrompt.dismiss',
            DONATION_PROMPT_ANNOUNCEMENT.dismissLabel ?? DONATION_PROMPT_ANNOUNCEMENT.title,
        ),
        action: DONATION_PROMPT_ANNOUNCEMENT.action
            ? {
                ...DONATION_PROMPT_ANNOUNCEMENT.action,
                label: translateOrFallback('donationPrompt.action', DONATION_PROMPT_ANNOUNCEMENT.action.label),
            }
            : undefined,
    }), [translateOrFallback]);

    const hideToTray = useCallback(async () => {
        // Ocultar abandona el cierre: el proceso sigue ejecutándose, por lo que el siguiente cierre
        // debe vaciar nuevamente en lugar de reutilizar esta puerta establecida. esto es la
        // contraparte del lado de la bandeja a la puerta de quitApp — cada ruta de bandeja (el modal
        // "mantener ejecutándose", y la rama 'bandeja' directa de handleDesktopCloseRequest,
        // que no puede restablecer la puerta misma) se canaliza aquí.
        resetCloseFlushGate();
        await hideMainWindowToTray();
    }, []);

    const quitApp = useCallback(async () => {
        // nunca exit mientras a descarga pre-cierre es in flight (see close-flush-gate.ts).
        // Vuelo único: instantáneo cuando una ruta de cierre ya lo estableció; comienza un
        // vaciado limitado cuando un cierre llega sin uno — esa brecha es la carrera
        // que esta puerta existe para cerrar (#913 seguimiento).
        await beginCloseFlush({
            flush: flushPendingSave,
            timeoutMs: CLOSE_FLUSH_TIMEOUT_MS,
            logStep: (step) => {
                void logInfo(`Close trace: ${step}`, { scope: 'app', force: true });
            },
            reportError: (label, error) => {
                void logError(error, { scope: 'app', step: label });
            },
        });
        void logInfo('Close trace: invoking quit_app', { scope: 'app', force: true });
        await invokeNative('quit_app');
        // app.exit(0) debería romper el proceso antes de que esto se resuelva; si
                        // esta línea alguna vez registra, la llamada de salida nativa se devolvió sin salir (#913).
        void logInfo('Close trace: quit_app invoke returned without exit', { scope: 'app', force: true });
    }, []);

    useEffect(() => {
        if (import.meta.env.MODE === 'test' || import.meta.env.VITEST || process.env.NODE_ENV === 'test') return;
        let cancelled = false;
        let disposed = false;
        let stopCalendarPush: (() => void) | null = null;

        const reportError = (label: string, error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            setError(`${label}: ${message}`);
            void logError(error, { scope: 'app', step: label });
        };

        fetchData()
            .finally(() => {
                if (!cancelled) {
                    setHasHydratedSettings(true);
                }
                void logDesktopStartupContext(
                    useTaskStore.getState().settings?.diagnostics?.loggingEnabled === true,
                ).catch(() => undefined);
            })
            .then(() => {
                if (!disposed && isTauriRuntime()) {
                    void migratePortableAttachments();
                    stopCalendarPush = startDesktopCalendarPushSync();
                    runFullDesktopCalendarPushSync()
                        .catch((error) => reportError('Calendar push failed', error));
                    startMacWidgetSync();
                }
            })
            .catch((error) => reportError('Data load failed', error));
        useObsidianStore.getState().loadConfig().catch((error) => reportError('Obsidian init failed', error));
        const unsubscribeExternalSync = SyncService.subscribeExternalSyncChange(setExternalSyncChange);

        const handleUnload = () => {
            flushPendingSave().catch((error) => reportError('Save failed', error));
        };
        window.addEventListener('beforeunload', handleUnload);
        let unlistenClose: (() => void) | null = null;
        let closingPromise: Promise<void> | null = null;
        let isClosing = false;
        if (isTauriRuntime()) {
            import('@tauri-apps/api/window')
                .then(async ({ getCurrentWindow }) => {
                    const window = getCurrentWindow();
                    const unlisten = await window.onCloseRequested(async (event) => {
                        if (closingPromise || isClosing) return;
                        isClosing = true;
                        event.preventDefault();
                        // Rastreo de cierre de ruta forzado: #913 reporta que la cadena de cierre muere
                        // silenciosamente en Windows, por lo que cada salto registra incluso con
                        // diagnósticos desactivados — el registro de una ejecución atrapada luego nombra el salto.
                        const logStep = (step: string) => {
                            void logInfo(`Close trace: ${step}`, { scope: 'app', force: true });
                        };
                        const racePromise = beginCloseFlush({
                            flush: flushPendingSave,
                            timeoutMs: CLOSE_FLUSH_TIMEOUT_MS,
                            logStep,
                            reportError,
                        });
                        closingPromise = racePromise.then(() => undefined);
                        let timedOut = false;
                        try {
                            ({ timedOut } = await racePromise);
                        } finally {
                            // Desenganche tan pronto como la carrera limitada termine para que un intento de cierre repetido
                            // (Alt+F4 nuevamente) nunca se trague silenciosamente
                            // para siempre — la "nada pasó en absoluto" del reportero del #913.
                            closingPromise = null;
                            isClosing = false;
                        }
                        if (!timedOut) return;
                        const closeAnyway = await requestConfirmation({
                            title: translateOrFallbackRef.current('app.closeStillSavingTitle', 'Mindwtr is still saving'),
                            description: translateOrFallbackRef.current(
                                'app.closeStillSavingBody',
                                'Mindwtr has not finished saving your recent changes. '
                                + 'Close anyway? Unsaved changes will be lost.'
                            ),
                            confirmLabel: translateOrFallbackRef.current('common.close', 'Close'),
                            cancelLabel: translateOrFallbackRef.current('common.cancel', 'Cancel'),
                        });
                        if (!closeAnyway) {
                            logStep('user kept the window open while save continues');
                            // Cierre abandonado: el siguiente intento de cierre debe vaciar
                            // nuevamente en lugar de reutilizar este resultado establecido.
                            resetCloseFlushGate();
                            return;
                        }
                        logStep('user chose to close while save still pending');
                        await quitApp().catch((error) => reportError('Quit failed', error));
                    });
                    if (disposed) {
                        unlisten();
                    } else {
                        unlistenClose = unlisten;
                    }
                })
                .catch((error) => reportError('Window listener failed', error));
        }

        // Los recordatorios no son solo de Tauri: el servicio de notificación se vuelve a Web
            // Notificaciones, por lo que la aplicación web auto-alojada los programa también mientras una pestaña
            // está abierta (#962). Todo debajo esto genuinamente necesita el shell nativo.
        startDesktopNotifications().catch((error) => reportError('Notifications failed', error));

        if (isTauriRuntime()) {
            SyncService.startFileWatcher().catch((error) => reportError('File watcher failed', error));

            // Watch local data.json y SQLite sidecar files for external changes (CLI/MCP/local REST).
            Promise.all([
                invokeNative<string>('get_data_path_cmd'),
                invokeNative<string>('get_db_path_cmd'),
            ])
                .then(([dataPath, dbPath]) => LocalDataWatcher.start(dataPath, dbPath))
                .catch((error) => reportError('Local data watcher failed', error));
        }

        isActiveRef.current = true;

        const performSync = async () => {
            return SyncService.performSync();
        };

        const handleSyncFailure = (message: string) => {
            const nowMs = Date.now();
            const isSameError = message === lastSyncErrorRef.current;
            // limitación repeated identical errors to once per 2 minutes, but siempre
            // mostrar new/different error messages immediately por lo que la user stays informed.
            const shouldAlert = !isSameError || nowMs - lastSyncErrorAtRef.current > 2 * 60 * 1000;
            if (shouldAlert) {
                lastSyncErrorRef.current = message;
                lastSyncErrorAtRef.current = nowMs;
                showToast(`${t('settings.lastSyncError')}: ${message}`, 'error', 6000);
            }
        };

        const autoSyncController = createDesktopAutoSyncController({
            canSync: () => canDesktopAutoSync(SyncService),
            isSyncEncryptionLocked: async () => {
                // Ambos estados son terminales hasta que el usuario actúa, por lo que ni
                // puede mantener el reintento de auto-sincronización: sin clave para un remoto cifrado, o una clave para un remoto que volvió
                // al texto plano.
                const { state } = await SyncService.getSyncEncryptionStatus();
                return state === 'remote-encrypted-no-key' || state === 'remote-plaintext';
            },
            performSync,
            flushPendingSave,
            reportError,
            onSyncFailure: handleSyncFailure,
            isRuntimeActive: () => isDesktopSyncRuntimeActive(isActiveRef.current),
            shouldPauseWindowSync: () => (
                useTaskStore.getState().editLockCount > 0
                || useUiStore.getState().editingTaskId !== null
            ),
            hasPendingLocalChanges: () => SyncService.hasPendingLocalChangesForAutoSync(),
            logInfo: (message, extra) => {
                void logInfo(message, { scope: 'sync', extra });
            },
        });

        let emailCaptureController: EmailCaptureController | null = null;
        if (isTauriRuntime()) {
            emailCaptureController = createEmailCaptureController({
                addTasks: (items) => useTaskStore.getState().addTasks(items),
                flushPendingSave,
                reportError,
                logInfo: (message, extra) => {
                    void logInfo(message, { scope: 'email-capture', extra });
                },
                onTerminalError: (error) => {
                    showToast(`${t('settings.emailCaptureFailed')}: ${error.message}`, 'error', 6000);
                },
            });
            registerEmailCaptureController(emailCaptureController);
            emailCaptureController.start();
        }

        const focusListener = () => {
            LocalDataWatcher.rearmExhaustedWatchers();
            autoSyncController.handleFocus();
        };

        const blurListener = () => {
            autoSyncController.handleBlur();
        };

        const manualSyncShortcutListener = (event: KeyboardEvent) => {
            if (!shouldHandleDesktopManualSyncShortcut({
                isEditableTarget: isEditableManualSyncShortcutTarget(event.target),
                isShortcut: isManualSyncShortcut(event),
            })) return;
            event.preventDefault();
            void autoSyncController.requestSync(0).catch((error) => reportError('Sync failed', error));
        };

        const visibilityListener = () => {
            const action = resolveVisibilitySyncAction(document.visibilityState);
            if (action === 'focus') {
                autoSyncController.handleFocus();
            } else if (action === 'blur') {
                autoSyncController.handleBlur();
            }
        };

        const storeUnsubscribe = useTaskStore.subscribe((state, prevState) => {
            if (state.lastDataChangeAt === prevState.lastDataChangeAt) return;
            autoSyncController.handleDataChange();
        });

        window.addEventListener('focus', focusListener);
        window.addEventListener('blur', blurListener);
        window.addEventListener('keydown', manualSyncShortcutListener);
        document.addEventListener('visibilitychange', visibilityListener);
        autoSyncController.scheduleInitialSync();

        return () => {
            cancelled = true;
            disposed = true;
            isActiveRef.current = false;
            window.removeEventListener('beforeunload', handleUnload);
            window.removeEventListener('focus', focusListener);
            window.removeEventListener('blur', blurListener);
            window.removeEventListener('keydown', manualSyncShortcutListener);
            document.removeEventListener('visibilitychange', visibilityListener);
            if (unlistenClose) {
                unlistenClose();
            }
            storeUnsubscribe();
            autoSyncController.dispose();
            registerEmailCaptureController(null);
            emailCaptureController?.dispose();
            stopCalendarPush?.();
            stopDesktopCalendarPushSync();
            stopMacWidgetSync();
            stopDesktopNotifications();
            LocalDataWatcher.stop();
            SyncService.stopFileWatcher().catch((error) => reportError('File watcher failed', error));
            unsubscribeExternalSync();
        };
    }, [fetchData, quitApp, requestConfirmation, setError, showToast]);

    useEffect(() => {
        if (!isTauriRuntime()) return;
        let disposed = false;
        let unlisten: (() => void) | undefined;
        const reportQuickAddRefreshError = (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            setError(`Quick add refresh failed: ${message}`);
            void logError(error, { scope: 'quick-add', step: 'refreshAfterStandaloneSave' });
        };

        const setup = async () => {
            const { listen } = await import('@tauri-apps/api/event');
            const nextUnlisten = await listen(QUICK_ADD_SAVED_EVENT, async () => {
                await LocalDataWatcher.refreshFromDiskNow().catch(reportQuickAddRefreshError);
            });
            if (disposed) {
                nextUnlisten();
                return;
            }
            unlisten = nextUnlisten;
        };

        setup().catch(reportQuickAddRefreshError);

        return () => {
            disposed = true;
            if (unlisten) unlisten();
        };
    }, [setError]);

    useEffect(() => {
        if (!isTauriRuntime()) return;
        return installKeyringFallbackWarningListener({
            onWarning: (message) => showToast(message, 'error', 8000),
            onError: (error) => {
                void logError(error, { scope: 'app', step: 'keyringFallbackWarningListener' });
            },
        });
    }, [showToast]);

    useEffect(() => {
        if (!isTauriRuntime()) return;
        let disposed = false;
        let unlisten: (() => void) | undefined;
        const reportCloseError = (label: string, error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            setError(`${label}: ${message}`);
            void logError(error, { scope: 'app', step: label });
        };

        const setup = async () => {
            const { listen } = await import('@tauri-apps/api/event');
            const nextUnlisten = await listen('close-requested', async () => {
                void logInfo('Close trace: close-requested event received', { scope: 'app', force: true });
                await invokeNative('acknowledge_close_request').catch((error) => {
                    void logError(error, { scope: 'app', step: 'acknowledgeCloseRequest' });
                });
                void logInfo('Close trace: close request acknowledged', { scope: 'app', force: true });
                await handleDesktopCloseRequest({
                    logStep: (step) => {
                        void logInfo(`Close trace: ${step}`, { scope: 'app', force: true });
                    },
                    getWindowSettings: () => useTaskStore.getState().settings?.window,
                    hideToTray,
                    isFlatpak,
                    promptOpenRef: closePromptOpenRef,
                    quitApp,
                    reportCloseError,
                    setPromptOpen: setClosePromptOpenValue,
                    setPromptRemember: setClosePromptRememberValue,
                });
            });
            if (disposed) {
                nextUnlisten();
                return;
            }
            unlisten = nextUnlisten;
        };

        setup().catch((error) => reportCloseError('Close listener failed', error));

        return () => {
            disposed = true;
            if (unlisten) unlisten();
        };
    }, [hideToTray, isFlatpak, quitApp, setClosePromptOpenValue, setClosePromptRememberValue, setError]);

    useEffect(() => {
        if (!isTauriRuntime()) return;
        if (windowDecorations === undefined) return;
        if (!/linux/i.test(navigator.userAgent || '')) return;
        let cancelled = false;
        import('@tauri-apps/api/window')
            .then(({ getCurrentWindow }) => {
                if (cancelled) return;
                return getCurrentWindow().setDecorations(windowDecorations);
            })
            .catch((error) => void logError(error, { scope: 'window', step: 'setDecorations' }));
        return () => {
            cancelled = true;
        };
    }, [windowDecorations]);

    useEffect(() => {
        if (!isTauriRuntime()) return;
        let cancelled = false;
        let unlistenResize: (() => void) | undefined;

        const syncFullscreenState = async () => {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            const isFullscreen = await getCurrentWindow().isFullscreen();
            if (!cancelled) {
                saveStoredFullscreen(isFullscreen, localStorage);
            }
        };

        const setup = async () => {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            const current = getCurrentWindow();
            await syncFullscreenState();
            const nextUnlisten = await current.onResized(() => {
                void syncFullscreenState().catch((error) => {
                    void logError(error, { scope: 'window', step: 'syncFullscreenState' });
                });
            });
            if (cancelled) {
                nextUnlisten();
                return;
            }
            unlistenResize = nextUnlisten;
        };

        setup().catch((error) => void logError(error, { scope: 'window', step: 'setupFullscreenSync' }));

        return () => {
            cancelled = true;
            if (unlistenResize) unlistenResize();
        };
    }, []);

    useEffect(() => {
        if (!isTauriRuntime()) return;
        return installWebviewZoomShortcuts({
            storage: localStorage,
            onError: (error) => void logError(error, { scope: 'window', step: 'setWebviewZoom' }),
        });
    }, []);

    useEffect(() => {
        if (!isTauriRuntime()) return;
        if (!isObsidianEnabled || !obsidianVaultPath) {
            void stopObsidianWatcher().catch((error) => void logError(error, { scope: 'obsidian', step: 'stopWatcher' }));
            return;
        }

        void startObsidianWatcher().catch((error) => void logError(error, { scope: 'obsidian', step: 'startWatcher' }));

        return () => {
            void stopObsidianWatcher().catch((error) => void logError(error, { scope: 'obsidian', step: 'stopWatcher' }));
        };
    }, [isObsidianEnabled, obsidianVaultPath, startObsidianWatcher, stopObsidianWatcher]);

    useDesktopShellSync({ showTray, trayTooltip, closeBehavior });

    useEffect(() => {
        if (import.meta.env.MODE === 'test' || import.meta.env.VITEST || process.env.NODE_ENV === 'test') return;
        // La configuración se abre frecuentemente desde acciones de menú; precárguela ávidamente para evitar retraso de primera apertura.
        void import('./components/views/SettingsView');
        const idleCallback =
            (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
            ?? ((cb: () => void) => window.setTimeout(cb, 200));
        const idleCancel =
            (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback
            ?? ((id: number) => window.clearTimeout(id));
        const id = idleCallback(() => {
            void import('./components/views/BoardView');
            void import('./components/views/ObsidianView');
            if (!import.meta.env.DEV) {
                void import('./components/views/ProjectsView');
            }
            void import('./components/views/ReviewView');
        });
        return () => idleCancel(id);
    }, []);

    const renderView = () => {
        if (activeView.startsWith('savedSearch:')) {
            const savedSearchId = activeView.replace('savedSearch:', '');
            return <SearchView savedSearchId={savedSearchId} />;
        }
        switch (activeView) {
            case 'inbox':
                return <ListView title={t('list.inbox')} statusFilter="inbox" />;
            case 'agenda':
                return <AgendaView />;
            case 'next':
                return <AgendaView />;
            case 'someday':
                return <ListView title={t('list.someday')} statusFilter="someday" />;
            case 'reference':
                return <ListView title={t('list.reference')} statusFilter="reference" />;
            case 'waiting':
                return <ListView title={t('list.waiting')} statusFilter="waiting" />;
            case 'done':
                return <ListView title={t('list.done')} statusFilter="done" />;
            case 'calendar':
                return <CalendarView />;
            case 'board':
                return <BoardView />;
            case 'obsidian':
                return <ObsidianView />;
            case 'projects':
                return <ProjectsView />;
            case 'contexts':
                return <ContextsView />;
            case 'review':
                return <ReviewView />;
            case 'settings':
                return (
                    <SettingsView
                        initialPage={settingsInitialPage}
                        onboardingHintPage={settingsOnboardingHintPage}
                        onResumeOnboarding={resumeDesktopOnboarding}
                    />
                );
            case 'archived':
                return <ArchiveView />;
            case 'trash':
                return <TrashView />;
            default:
                return <ListView title={t('list.inbox')} statusFilter="inbox" />;
        }
    };

    const handleViewChange = useCallback((view: string) => {
        const nextView = view === 'obsidian' && !useObsidianStore.getState().config.enabled ? 'settings' : view;
        if (nextView !== 'settings') {
            setSettingsInitialPage(undefined);
            setSettingsOnboardingHintPage(undefined);
        }
        persistLastView(nextView, useUiStore.getState().projectView.selectedProjectId);
        writeViewToUrl(nextView);
        setCurrentView(nextView);
        if (nextView === 'settings') {
            beginSettingsOpenTrace('handleViewChange');
            setActiveView(nextView);
            return;
        }
        startTransition(() => {
            setActiveView(nextView);
        });
    }, [startTransition]);

    useEffect(() => {
        if (isObsidianEnabled || currentView !== 'obsidian') return;
        handleViewChange('settings');
    }, [currentView, handleViewChange, isObsidianEnabled]);

    // Restaurar el proyecto que estaba abierto cuando terminó la sesión interrumpida.
    useEffect(() => {
        if (restoredLastView?.view !== 'projects' || !restoredLastView.projectId) return;
        useUiStore.getState().setProjectView({ selectedProjectId: restoredLastView.projectId });
    }, []);

    // La marca de tiempo guardada debe reflejar cuándo terminó la sesión, no la última
    // navegación en la aplicación: actualícela siempre que la ventana se oculte o cierre.
    useEffect(() => {
        const refreshLastView = () => {
            persistLastView(currentView, useUiStore.getState().projectView.selectedProjectId);
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') refreshLastView();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('beforeunload', refreshLastView);
        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('beforeunload', refreshLastView);
        };
    }, [currentView]);

    useEffect(() => {
        if (!hasHydratedSettings || isLoading) return;
        if (desktopOnboardingDismissed || visibleDataCount > 0) {
            setDesktopOnboardingGateSettled(true);
            return;
        }

        let cancelled = false;
        setDesktopOnboardingGateSettled(false);
        SyncService.getSyncBackend()
            .then((backend) => {
                if (cancelled) return;
                if (shouldOpenDesktopFirstRunOnboarding({
                    hasHydratedSettings,
                    isLoading,
                    dismissed: desktopOnboardingDismissed,
                    visibleDataCount,
                    syncBackend: backend,
                })) {
                    setDesktopOnboardingOpen(true);
                }
                setDesktopOnboardingGateSettled(true);
            })
            .catch((error) => {
                void logError(error, { scope: 'onboarding', step: 'readSyncBackend' });
                if (!cancelled && shouldOpenDesktopFirstRunOnboarding({
                    hasHydratedSettings,
                    isLoading,
                    dismissed: desktopOnboardingDismissed,
                    visibleDataCount,
                    syncBackend: 'off',
                })) {
                    setDesktopOnboardingOpen(true);
                }
                if (!cancelled) {
                    setDesktopOnboardingGateSettled(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [desktopOnboardingDismissed, hasHydratedSettings, isLoading, visibleDataCount]);

    const dismissDesktopOnboarding = useCallback(() => {
        writeDesktopOnboardingDismissed();
        setDesktopOnboardingDismissed(true);
        setDesktopOnboardingOpen(false);
    }, []);

    const resumeDesktopOnboarding = useCallback(() => {
        setDesktopOnboardingBusy(false);
        setDesktopOnboardingError(null);
        setDesktopOnboardingDismissed(false);
        setDesktopOnboardingOpen(true);
    }, []);

    const openSettingsPage = useCallback((page: SettingsOnboardingHintPage) => {
        setDesktopOnboardingOpen(false);
        setSettingsInitialPage(page);
        setSettingsOnboardingHintPage(page);
        handleViewChange('settings');
    }, [handleViewChange]);

    const openSyncSettings = useCallback(() => {
        setSettingsInitialPage('sync');
        handleViewChange('settings');
    }, [handleViewChange]);

    const handleStartFreshOnboarding = useCallback(() => {
        if (desktopOnboardingBusy) return;
        setDesktopOnboardingBusy(true);
        setDesktopOnboardingError(null);
        seedGettingStarted({ language })
            .then((result) => {
                if (!result.id) {
                    setDesktopOnboardingError(t('onboarding.errorNotCreated'));
                    showToast(t('onboarding.toastNotCreated'), 'info');
                    return;
                }
                dismissDesktopOnboarding();
                useUiStore.getState().setProjectView({ selectedProjectId: result.id });
                handleViewChange('projects');
                showToast(t('onboarding.toastReady'), 'success');
            })
            .catch((error) => {
                setDesktopOnboardingError(t('onboarding.errorFailed'));
                showToast(t('onboarding.toastFailed'), 'error');
                void logError(error, { scope: 'onboarding', step: 'seedGettingStarted' });
            })
            .finally(() => setDesktopOnboardingBusy(false));
    }, [desktopOnboardingBusy, dismissDesktopOnboarding, handleViewChange, language, seedGettingStarted, showToast, t]);

    const dismissAppAnnouncement = useCallback(() => {
        if (testAnnouncement) {
            setTestAnnouncement(null);
            startupPromptQueue.closeAll();
            return;
        }
        const announcement = ACTIVE_APP_ANNOUNCEMENT;
        if (announcement && typeof window !== 'undefined') {
            try {
                window.localStorage.setItem(
                    getAnnouncementDismissalStorageKey(announcement.id),
                    APP_ANNOUNCEMENT_DISMISSED_VALUE,
                );
            } catch {
                // Keep la despido en memoria for esto session cuando localStorage es unavailable.
            }
        }
        startupPromptQueue.dismiss('announcement');
    }, [startupPromptQueue, testAnnouncement]);

    const openAnnouncementUrl = useCallback(async (url: string) => {
        const nextUrl = url.trim();
        if (!nextUrl) return;
        let openError: unknown = null;
        if (isTauriRuntime()) {
            try {
                const { open } = await import('@tauri-apps/plugin-shell');
                await open(nextUrl);
                return;
            } catch (error) {
                openError = error;
            }
        }

        const opened = window.open(nextUrl, '_blank', 'noopener,noreferrer');
        if (!opened) {
            void logError(openError ?? new Error('Failed to open announcement link'), {
                scope: 'announcement',
                step: 'openUrl',
            });
        }
    }, []);

    // Compartido por todos los controladores de acción de aviso de inicio a continuación: despido y
    // cualquier efecto secundario específico del aviso (por ejemplo, registro de clic de soporte de donación)
    // sucede en el controlador mismo; solo la rama "retroalimentación -> Configuración, de lo contrario
    // abierto el URL" fue triplicada, por lo que vive aquí una vez.
    const performAnnouncementNavigation = useCallback((action: AppAnnouncementAction) => {
        if (action.type === 'feedback') {
            setSettingsInitialPage('about');
            setSettingsOnboardingHintPage(undefined);
            handleViewChange('settings');
            return;
        }
        void openAnnouncementUrl(action.url);
    }, [handleViewChange, openAnnouncementUrl]);

    const handleAppAnnouncementAction = useCallback((action: AppAnnouncementAction) => {
        dismissAppAnnouncement();
        performAnnouncementNavigation(action);
    }, [dismissAppAnnouncement, performAnnouncementNavigation]);

    const dismissDonationPrompt = useCallback(() => {
        startupPromptQueue.dismiss('donation');
    }, [startupPromptQueue]);

    const handleDonationPromptAction = useCallback((action: AppAnnouncementAction) => {
        dismissDonationPrompt();
        if (action.type !== 'feedback') {
            try {
                updateLocalUserPromptState((state) => recordDonationPromptSupportClicked(state, Date.now()));
            } catch (error) {
                void logError(error, { scope: 'prompt-state', step: 'recordDonationSupportClicked' });
            }
        }
        performAnnouncementNavigation(action);
    }, [dismissDonationPrompt, performAnnouncementNavigation]);

    const recordDonationPromptVisible = useCallback(() => {
        try {
            updateLocalUserPromptState((state) => recordDonationPromptShown(state, Date.now()));
        } catch (error) {
            void logError(error, { scope: 'prompt-state', step: 'recordDonationShown' });
        }
    }, []);

    const dismissUpdateReminder = useCallback(() => {
        const latestVersion = updateReminderInfo?.latestVersion;
        if (latestVersion && updateReminderInfo?.testOnly !== true) {
            try {
                updateLocalUserPromptState((state) => recordUpdateReminderDismissed(state, latestVersion));
            } catch (error) {
                void logError(error, { scope: 'prompt-state', step: 'dismissUpdateReminder' });
            }
        }
        startupPromptQueue.dismiss('update-reminder');
    }, [startupPromptQueue, updateReminderInfo?.latestVersion, updateReminderInfo?.testOnly]);

    const handleUpdateReminderAction = useCallback((action: AppAnnouncementAction) => {
        dismissUpdateReminder();
        performAnnouncementNavigation(action);
    }, [dismissUpdateReminder, performAnnouncementNavigation]);

    // Puerta compartida única: anteriormente cada una de las tres instancias <AppAnnouncementModal>
    // repetía la misma verificación de 4 cláusulas en línea (#19 seguimiento).
    const startupPromptsBlocked = desktopOnboardingOpen || closePromptOpen || Boolean(externalSyncChange);

    const startupPrompts = useMemo<StartupPromptPresentation[]>(() => [
        {
            id: 'announcement',
            announcement: activeAnnouncement,
            onAction: handleAppAnnouncementAction,
            onDismiss: dismissAppAnnouncement,
        },
        {
            id: 'donation',
            announcement: donationPromptAnnouncement,
            onAction: handleDonationPromptAction,
            onDismiss: dismissDonationPrompt,
            onShown: recordDonationPromptVisible,
        },
        {
            id: 'update-reminder',
            announcement: updateReminderInfo ? buildUpdateReminderAnnouncement(updateReminderInfo) : null,
            onAction: handleUpdateReminderAction,
            onDismiss: dismissUpdateReminder,
        },
    ], [
        activeAnnouncement,
        dismissAppAnnouncement,
        dismissDonationPrompt,
        dismissUpdateReminder,
        donationPromptAnnouncement,
        handleAppAnnouncementAction,
        handleDonationPromptAction,
        handleUpdateReminderAction,
        recordDonationPromptVisible,
        updateReminderInfo,
    ]);

    useEffect(() => {
        if (!PROMPT_TEST_CONTROLS_ENABLED) return;
        let disposed = false;
        const closePromptSurfaces = () => {
            startupPromptQueue.closeAll();
            setTestAnnouncement(null);
        };

        const unsubscribe = subscribePromptTest((kind) => {
            closePromptSurfaces();
            if (kind === 'announcement') {
                setTestAnnouncement(PROMPT_TEST_ANNOUNCEMENT);
                startupPromptQueue.forceOpen('announcement');
                return;
            }
            if (kind === 'donation') {
                startupPromptQueue.forceOpen('donation');
                return;
            }
            if (kind === 'review') {
                const reviewAnnouncement = buildPromptTestReviewAnnouncement(desktopInstallSource);
                if (!reviewAnnouncement) return;
                setTestAnnouncement(reviewAnnouncement);
                startupPromptQueue.forceOpen('announcement');
                return;
            }
            const openUpdateTest = async () => {
                let currentVersion = 'this build';
                try {
                    const { getVersion } = await import('@tauri-apps/api/app');
                    currentVersion = await getVersion();
                } catch {
                    currentVersion = 'this build';
                }
                if (disposed) return;
                const updateTarget = getDesktopUpdateTarget(desktopInstallSource);
                setUpdateReminderInfo({
                    currentVersion,
                    latestVersion: '99.99.99',
                    latestReleasedAt: new Date().toISOString(),
                    releaseUrl: updateTarget.url,
                    actionLabel: updateTarget.label,
                    testOnly: true,
                });
                startupPromptQueue.forceOpen('update-reminder');
            };
            void openUpdateTest();
        });
        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [desktopInstallSource, startupPromptQueue]);

    useEffect(() => {
        if (import.meta.env.MODE === 'test' || import.meta.env.VITEST || process.env.NODE_ENV === 'test') return;
        if (localPromptActivityRecordedRef.current || !hasHydratedSettings || isLoading) return;
        localPromptActivityRecordedRef.current = true;
        try {
            recordLocalPromptActivity();
        } catch (error) {
            void logError(error, { scope: 'prompt-state', step: 'recordActivity' });
        }
    }, [hasHydratedSettings, isLoading]);

    useEffect(() => {
        if (import.meta.env.MODE === 'test' || import.meta.env.VITEST || process.env.NODE_ENV === 'test') return;
        let cancelled = false;
        getInstallSourceOrFallback('unknown')
            .then((installSource) => {
                if (cancelled) return;
                const normalized = normalizeInstallSource(installSource);
                setDesktopInstallSource(normalized);
            })
            .catch((error) => {
                if (!cancelled) {
                    setDesktopInstallSource('unknown');
                }
                void logError(error, { scope: 'prompt-state', step: 'resolveDonationInstallSource' });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const LoadingFallback = ({ view }: { view: string }) => {
        useEffect(() => {
            if (view !== 'settings') return;
            markSettingsOpenTrace('app-suspense-fallback-mounted');
        }, [view]);

        return (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <div className="w-full max-w-md space-y-3">
                    <div className="h-4 w-2/3 rounded bg-muted/60 animate-pulse" />
                    <div className="h-4 w-5/6 rounded bg-muted/50 animate-pulse" />
                    <div className="h-4 w-1/2 rounded bg-muted/40 animate-pulse" />
                </div>
            </div>
        );
    };

    useEffect(() => {
        return subscribeNavigateEvent(({ view }) => {
            handleViewChange(view);
        });
    }, [handleViewChange]);

    useEffect(() => {
        return subscribeDesktopOnboardingEvent(() => {
            resumeDesktopOnboarding();
        });
    }, [resumeDesktopOnboarding]);

    return (
        <ErrorBoundary>
            <KeybindingProvider currentView={currentView} onNavigate={handleViewChange}>
                <Layout currentView={currentView} onViewChange={handleViewChange} onOpenSyncSettings={openSyncSettings}>
                    <PersistenceFailureBanner />
                    <Suspense
                        fallback={(
                            <LoadingFallback view={activeView} />
                        )}
                    >
                        {isLoading ? (
                            <LoadingFallback view={activeView} />
                        ) : (
                            renderView()
                        )}
                    </Suspense>
                    <GlobalSearch
                        onNavigate={(view, _id) => handleViewChange(view)}
                        defaultIncludeCompleted={currentView === 'done' || currentView === 'archived'}
                    />
                    <QuickAddModal />
                    {confirmModal}
                    <CloseBehaviorModal
                        isOpen={closePromptOpen}
                        title={translateOrFallback('settings.closeBehaviorPromptTitle', 'Close Mindwtr?')}
                        description={translateOrFallback(
                            'settings.closeBehaviorPromptBody',
                            'Do you want Mindwtr to stay running in the tray or quit completely?'
                        )}
                        rememberLabel={translateOrFallback('settings.closeBehaviorRemember', "Don't ask again")}
                        stayLabel={translateOrFallback('settings.closeBehaviorTray', 'Keep running in tray')}
                        quitLabel={translateOrFallback('settings.closeBehaviorQuit', 'Quit the app')}
                        cancelLabel={translateOrFallback('common.cancel', 'Cancel')}
                        remember={closePromptRemember}
                        onRememberChange={setClosePromptRememberValue}
                        onCancel={() => {
                            setClosePromptOpenValue(false);
                            // Cierre abandonado: el siguiente intento de cierre debe vaciar
                            // nuevamente en lugar de reutilizar este resultado establecido.
                            resetCloseFlushGate();
                        }}
                        onStay={() => {
                            const apply = async () => {
                                if (closePromptRememberRef.current) {
                                    await persistCloseBehavior('tray');
                                }
                                setClosePromptOpenValue(false);
                                // hideToTray restablece la puerta de vaciado de cierre — es el
                                // dueño único de cada ruta de bandeja.
                                await hideToTray();
                            };
                            apply().catch((error) => {
                                setClosePromptOpenValue(false);
                                void logError(error, { scope: 'app', step: 'close-tray' });
                            });
                        }}
                        onQuit={() => {
                            const apply = async () => {
                                if (closePromptRememberRef.current) {
                                    await persistCloseBehavior('quit');
                                }
                                setClosePromptOpenValue(false);
                                await quitApp();
                            };
                            apply().catch((error) => {
                                setClosePromptOpenValue(false);
                                void logError(error, { scope: 'app', step: 'close-quit' });
                            });
                        }}
                    />
                    <DesktopOnboardingFlow
                        isOpen={desktopOnboardingOpen}
                        busy={desktopOnboardingBusy}
                        error={desktopOnboardingError}
                        onOpenSync={() => openSettingsPage('sync')}
                        onOpenImport={() => openSettingsPage('data')}
                        onStartFresh={handleStartFreshOnboarding}
                        onSkip={dismissDesktopOnboarding}
                    />
                    <StartupPromptModal
                        openId={startupPromptOpenId}
                        blocked={startupPromptsBlocked}
                        prompts={startupPrompts}
                    />
                    {externalSyncChange && (
                        <Dialog
                            onClose={() => !resolvingExternalSync && setExternalSyncChange(null)}
                            labelledBy="external-sync-change-title"
                            placement="top"
                            overlayClassName="pt-[20vh]"
                            panelClassName="max-w-lg max-h-[70vh]"
                        >
                            <DialogBody className="px-4 py-3 border-b">
                                <h3 id="external-sync-change-title" className="font-semibold">
                                    {translateOrFallback('settings.externalSyncChangeTitle', 'External sync change detected')}
                                </h3>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {translateOrFallback(
                                        'settings.externalSyncChangeBody',
                                        'The sync file changed while local edits were pending. Choose how to continue.'
                                    )}
                                </p>
                                <p className="text-xs text-muted-foreground mt-2">
                                    {translateOrFallback('settings.lastSync', 'Last sync')}: {externalSyncChange.lastSyncAt || translateOrFallback('settings.lastSyncNever', 'Never')}
                                </p>
                            </DialogBody>
                            <DialogFooter className="p-4 flex flex-wrap justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setExternalSyncChange(null)}
                                    disabled={resolvingExternalSync}
                                    className="px-3 py-1.5 rounded-md text-sm bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {translateOrFallback('common.reviewLater', 'Review later')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => resolveExternalSync('use-external')}
                                    disabled={resolvingExternalSync}
                                    className="px-3 py-1.5 rounded-md text-sm bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {translateOrFallback('settings.useExternal', 'Use external')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => resolveExternalSync('merge')}
                                    disabled={resolvingExternalSync}
                                    className="px-3 py-1.5 rounded-md text-sm bg-secondary text-secondary-foreground hover:bg-secondary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {translateOrFallback('settings.mergeChanges', 'Merge')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => resolveExternalSync('keep-local')}
                                    disabled={resolvingExternalSync}
                                    className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {translateOrFallback('settings.keepLocal', 'Keep local')}
                                </button>
                            </DialogFooter>
                        </Dialog>
                    )}
                </Layout>
            </KeybindingProvider>
        </ErrorBoundary>
    );
}

export default App;
