import type { AppData, AppTheme } from '@mindwtr/core';
import { resolveThemeColorScheme } from '@mindwtr/core';

import { invokeNative } from './tauri-invoke';

export type DesktopThemeMode = 'system' | 'light' | 'dark' | 'eink' | 'nord' | 'sepia' | 'oled' | 'catppuccin-macchiato' | 'dracula';
export type SystemThemePreference = 'light' | 'dark' | null;
type NativeThemePreference = Exclude<SystemThemePreference, null>;
type NativeThemeSetter = (theme?: NativeThemePreference | null) => Promise<void>;
type NativeThemeAppModule = {
    setTheme: NativeThemeSetter;
};
type NativeThemeWindow = {
    theme: () => Promise<SystemThemePreference>;
    setTheme?: NativeThemeSetter;
    onThemeChanged: (
        listener: (event: { payload: NativeThemePreference }) => void
    ) => Promise<() => void>;
};
type NativeThemeWindowModule = {
    getCurrentWindow: () => NativeThemeWindow;
};

export const THEME_STORAGE_KEY = 'mindwtr-theme';
const SYSTEM_THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';
const COMMAND_THEME_POLL_INTERVAL_MS = 2000;
let cachedSystemThemePreference: SystemThemePreference = null;

const isDesktopThemeMode = (value: string | null | undefined): value is DesktopThemeMode => (
    value === 'system'
    || value === 'light'
    || value === 'dark'
    || value === 'eink'
    || value === 'nord'
    || value === 'sepia'
    || value === 'oled'
    || value === 'catppuccin-macchiato'
    || value === 'dracula'
);

// Desktop has no material3-* theme of its own; collapse those into the
// plain light/dark mode they render as. Classification comes from core so this
// stays in lockstep with mobile and the iOS widget.
const collapseUnsupportedDesktopTheme = (value: string): DesktopThemeMode | null => {
    if (value !== 'material3-dark' && value !== 'material3-light') return null;
    return resolveThemeColorScheme(value as AppTheme, 'light');
};

export const coerceDesktopThemeMode = (value: string | null | undefined): DesktopThemeMode | null => {
    if (!value) return null;
    if (isDesktopThemeMode(value)) return value;
    return collapseUnsupportedDesktopTheme(value);
};

export const mapSyncedThemeToDesktop = (value: AppData['settings']['theme'] | null | undefined): DesktopThemeMode | null => {
    if (!value) return null;
    if (isDesktopThemeMode(value)) return value;
    return collapseUnsupportedDesktopTheme(value);
};

export const resolveDesktopThemeMode = (
    syncedTheme: AppData['settings']['theme'] | null | undefined,
    storedTheme: string | null | undefined,
): DesktopThemeMode => (
    mapSyncedThemeToDesktop(syncedTheme)
    ?? coerceDesktopThemeMode(storedTheme)
    ?? 'system'
);

export const resolveSystemThemePreference = (override?: SystemThemePreference): SystemThemePreference => {
    if (override === 'light' || override === 'dark') {
        cachedSystemThemePreference = override;
        return override;
    }
    if (cachedSystemThemePreference) return cachedSystemThemePreference;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    return window.matchMedia(SYSTEM_THEME_MEDIA_QUERY).matches ? 'dark' : 'light';
};

export const coerceSystemThemePreference = (value: unknown): SystemThemePreference => {
    if (value === 'light' || value === 'dark') return value;
    return null;
};

export const resolveSystemThemeCommandPreference = async (
    onError?: (step: 'resolveSystem', error: unknown) => void,
): Promise<SystemThemePreference> => {
    try {
        return coerceSystemThemePreference(await invokeNative('get_system_theme_preference'));
    } catch (error) {
        onError?.('resolveSystem', error);
        return null;
    }
};

export const watchSystemThemePreference = (
    onChange: (theme: NativeThemePreference) => void
): (() => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => { };

    const mediaQuery = window.matchMedia(SYSTEM_THEME_MEDIA_QUERY);
    const handler = (event: MediaQueryListEvent | { matches: boolean }) => {
        onChange(event.matches ? 'dark' : 'light');
    };

    if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handler as EventListener);
        return () => mediaQuery.removeEventListener('change', handler as EventListener);
    }

    if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handler as (event: MediaQueryListEvent) => void);
        return () => mediaQuery.removeListener(handler as (event: MediaQueryListEvent) => void);
    }

    return () => { };
};

export const watchNativeSystemThemePreference = (
    loadWindowModule: () => Promise<NativeThemeWindowModule>,
    onChange: (theme: NativeThemePreference) => void,
    onError?: (step: 'resolveSystem' | 'watch', error: unknown) => void,
): (() => void) => {
    let cancelled = false;
    let stopWatchingNativeTheme = () => { };

    void loadWindowModule()
        .then(async ({ getCurrentWindow }) => {
            if (cancelled) return;
            const currentWindow = getCurrentWindow();

            try {
                const nativeTheme = await currentWindow.theme();
                if (!cancelled && nativeTheme) {
                    onChange(nativeTheme);
                }
            } catch (error) {
                if (!cancelled) {
                    onError?.('resolveSystem', error);
                }
            }

            if (cancelled) return;

            try {
                const unlisten = await currentWindow.onThemeChanged(({ payload }) => {
                    onChange(payload);
                });
                if (cancelled) {
                    unlisten();
                    return;
                }
                stopWatchingNativeTheme = unlisten;
            } catch (error) {
                if (!cancelled) {
                    onError?.('watch', error);
                }
            }
        })
        .catch((error) => {
            if (!cancelled) {
                onError?.('watch', error);
            }
        });

    return () => {
        cancelled = true;
        stopWatchingNativeTheme();
    };
};

export const watchSystemThemeCommandPreference = (
    onChange: (theme: NativeThemePreference) => void,
    onError?: (step: 'resolveSystem', error: unknown) => void,
    pollIntervalMs = COMMAND_THEME_POLL_INTERVAL_MS,
): (() => void) => {
    if (typeof window === 'undefined') return () => { };

    let cancelled = false;
    let lastTheme: SystemThemePreference = null;
    let pollInFlight = false;

    const emitIfChanged = (theme: SystemThemePreference) => {
        if (!theme || theme === lastTheme) return;
        lastTheme = theme;
        onChange(theme);
    };

    const poll = async () => {
        if (cancelled || pollInFlight) return;
        pollInFlight = true;
        try {
            const theme = coerceSystemThemePreference(
                await invokeNative('get_system_theme_preference')
            );
            if (!cancelled) {
                emitIfChanged(theme);
            }
        } catch (error) {
            if (!cancelled) {
                onError?.('resolveSystem', error);
            }
        } finally {
            pollInFlight = false;
        }
    };

    void poll();
    const pollTimer = window.setInterval(() => {
        void poll();
    }, pollIntervalMs);

    return () => {
        cancelled = true;
        window.clearInterval(pollTimer);
    };
};

// One entry per theme with its own CSS variable block in index.css. This single
// map drives both the reset and the apply below, so a new theme can't end up in
// one list and not the other — and whether it renders dark comes from core's
// classification, not a second hand-maintained list here.
const THEME_MODE_CLASSES = {
    eink: 'theme-eink',
    nord: 'theme-nord',
    sepia: 'theme-sepia',
    oled: 'theme-oled',
    'catppuccin-macchiato': 'theme-catppuccin-macchiato',
    dracula: 'theme-dracula',
} as const satisfies Partial<Record<DesktopThemeMode, string>>;

export const applyThemeMode = (mode: DesktopThemeMode | null, systemTheme?: SystemThemePreference) => {
    const root = document.documentElement;
    root.classList.remove(...Object.values(THEME_MODE_CLASSES));

    const prefersDark = resolveSystemThemePreference(systemTheme) === 'dark';
    root.classList.toggle(
        'dark',
        mode === 'system' || mode === null ? prefersDark : resolveThemeColorScheme(mode, 'light') === 'dark',
    );

    const themeClass = THEME_MODE_CLASSES[mode as keyof typeof THEME_MODE_CLASSES];
    if (themeClass) root.classList.add(themeClass);
};

export const resolveNativeTheme = (mode: DesktopThemeMode | null): 'light' | 'dark' | null => {
    if (!mode || mode === 'system') return null;
    return resolveThemeColorScheme(mode, 'light');
};

export const applyNativeTheme = async (
    theme: ReturnType<typeof resolveNativeTheme>,
    loadAppModule: () => Promise<NativeThemeAppModule>,
    loadWindowModule: () => Promise<NativeThemeWindowModule>,
    onError?: (step: 'app' | 'window', error: unknown) => void,
): Promise<void> => {
    await Promise.all([
        loadAppModule()
            .then(({ setTheme }) => setTheme(theme))
            .catch((error) => onError?.('app', error)),
        loadWindowModule()
            .then(({ getCurrentWindow }) => {
                const currentWindow = getCurrentWindow();
                if (typeof currentWindow.setTheme !== 'function') return undefined;
                return currentWindow.setTheme(theme);
            })
            .catch((error) => onError?.('window', error)),
    ]);
};
