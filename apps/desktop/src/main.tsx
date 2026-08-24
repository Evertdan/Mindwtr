import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { QuickAddWindowApp } from './QuickAddWindowApp.tsx';
import './index.css';

import { consoleLogger, setLogger, setStorageAdapter } from '@mindwtr/core';
import { LanguageProvider } from './contexts/language-context';
import { isTauriRuntime } from './lib/runtime';
import { invokeNative, preloadNativeTransport } from './lib/tauri-invoke';
import { reportError } from './lib/report-error';
import { webStorage } from './lib/storage-adapter-web';
import { isDiagnosticsEnabled, logError, logInfo, logWarn, setupGlobalErrorLogging } from './lib/app-log';
import {
    THEME_STORAGE_KEY,
    applyNativeTheme,
    applyThemeMode,
    coerceDesktopThemeMode,
    resolveNativeTheme,
    resolveSystemThemeCommandPreference,
} from './lib/theme';
import { TEXT_SIZE_STORAGE_KEY, applyDesktopTextSize, coerceDesktopTextSize } from './lib/text-size';
import { loadStoredFullscreen } from './lib/window-state';
import { restoreStoredWebviewZoom } from './lib/webview-zoom';
import { isQuickAddWindowLocation } from './lib/quick-add-window';
import {
    sendDesktopDailyHeartbeat,
} from './lib/analytics-heartbeat';

let coreLoggerBridgeInstalled = false;

const buildCoreLogExtra = (payload: {
    category?: string;
    context?: Record<string, unknown>;
    error?: unknown;
}): Record<string, unknown> | undefined => {
    const extra: Record<string, unknown> = {
        ...(payload.context ?? {}),
    };
    if (payload.category) {
        extra.category = payload.category;
    }
    if (payload.error) {
        extra.error = payload.error instanceof Error ? payload.error.message : String(payload.error);
        if (payload.error instanceof Error && payload.error.name) {
            extra.errorName = payload.error.name;
        }
        if (payload.error instanceof Error && payload.error.stack) {
            extra.errorStack = payload.error.stack;
        }
    }
    return Object.keys(extra).length > 0 ? extra : undefined;
};

const installCoreLoggerBridge = () => {
    if (coreLoggerBridgeInstalled) return;
    coreLoggerBridgeInstalled = true;
    setLogger((payload) => {
        consoleLogger(payload);
        const scope = payload.scope ?? 'core';
        const extra = buildCoreLogExtra(payload);
        if (payload.level === 'error') {
            void logError(payload.error ?? payload.message, {
                scope,
                extra,
                message: payload.message,
            });
            return;
        }
        if (payload.level === 'warn') {
            void logWarn(payload.message, { scope, extra });
            return;
        }
        void logInfo(payload.message, { scope, extra });
    });
};

// Inicializar tema inmediatamente antes de que React renderice para evitar parpadeo
const savedTheme = coerceDesktopThemeMode(localStorage.getItem(THEME_STORAGE_KEY));
applyThemeMode(savedTheme);
if ((savedTheme ?? 'system') === 'system' && isTauriRuntime()) {
    void resolveSystemThemeCommandPreference(
        (step, error) => void logError(error, { scope: 'theme', step: `startup-command:${step}` }),
    ).then((theme) => {
        if (theme) applyThemeMode('system', theme);
    });
}
const savedTextSize = coerceDesktopTextSize(localStorage.getItem(TEXT_SIZE_STORAGE_KEY));
applyDesktopTextSize(savedTextSize);

installCoreLoggerBridge();

const diagnosticsEnabled = isDiagnosticsEnabled();
if (diagnosticsEnabled) {
    setupGlobalErrorLogging();
}
const isQuickAddWindow = isQuickAddWindowLocation();
if (isQuickAddWindow) {
    document.documentElement.dataset.quickAddWindow = 'true';
}

const nativeTheme = resolveNativeTheme(savedTheme);
if (isTauriRuntime()) {
    void applyNativeTheme(
        nativeTheme,
        () => import('@tauri-apps/api/app'),
        () => import('@tauri-apps/api/window'),
    );
}

async function initStorage() {
    if (isTauriRuntime()) {
        const { tauriStorage } = await import('./lib/storage-adapter');
        setStorageAdapter(tauriStorage);
        return;
    }

    setStorageAdapter(webStorage);
}

async function restoreFullscreenState() {
    if (!isTauriRuntime()) return;
    if (!loadStoredFullscreen(localStorage)) return;
    try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const current = getCurrentWindow();
        if (await current.isFullscreen()) return;
        await current.setFullscreen(true);
    } catch (error) {
        void logWarn('Failed to restore fullscreen state', {
            scope: 'window',
            extra: {
                step: 'restoreFullscreen',
                error: error instanceof Error ? error.message : String(error),
            },
        });
    }
}

async function restoreWebviewZoomState() {
    if (!isTauriRuntime()) return;
    try {
        await restoreStoredWebviewZoom({ storage: localStorage });
    } catch (error) {
        void logWarn('Failed to restore webview zoom', {
            scope: 'window',
            extra: {
                step: 'restoreWebviewZoom',
                error: error instanceof Error ? error.message : String(error),
            },
        });
    }
}

// El manejador nativo de arrastrar y soltar de Tauri está apagado (tauri.conf.json dragDropEnabled:
// false) para que el arrastrar y soltar HTML5 funcione para filas de tareas; eso también significa que
// el navegador simple predeterminado de la webview se ejecuta para caídas de archivos del SO en cualquier otro lugar,
// navegando lejos del archivo soltado. Bloquear navegación aquí, pero solo
// preventDefault (nunca stopPropagation) para que el propio manejador de caída de archivos del editor,
// que se ejecuta primero ya que React se adjunta debajo del documento, aún
// reciba el evento.
function installFileDropNavigationGuard() {
    const isFileDrag = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'));
    document.addEventListener('dragover', (event) => {
        if (isFileDrag(event)) event.preventDefault();
    });
    document.addEventListener('drop', (event) => {
        if (isFileDrag(event)) event.preventDefault();
    });
}

// La ventana principal se construye oculta para que la geometría restaurada y la primera pintura
// se mantengan fuera de pantalla (#936). Dos fotogramas de animación después del primer renderizado es la
// señal más económica "ha pintado" que la webview nos proporciona; Rust revela la ventana
// de todos modos después de unos pocos segundos si esto nunca llega.
async function signalUiReady() {
    if (!isTauriRuntime()) return;
    try {
        // Resolver el transporte durante la espera de pintura, no en la llamada de revelación
        // en sí — los dos fotogramas a continuación son el tiempo de la señal, y nada
        // más puede añadirse a esto.
        await preloadNativeTransport();
        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        await invokeNative('notify_ui_ready');
    } catch (error) {
        void logWarn('Failed to signal UI ready', {
            scope: 'window',
            extra: { error: error instanceof Error ? error.message : String(error) },
        });
    }
}

async function bootstrap() {
    installFileDropNavigationGuard();
    await initStorage();
    setupGlobalErrorLogging();
    if (!isQuickAddWindow) {
        await restoreFullscreenState();
        await restoreWebviewZoomState();
    }

    if (!isQuickAddWindow && !isTauriRuntime() && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }

    if (!isTauriRuntime()) {
        // Un chunk de ruta perezosa puede no lograr importar cuando index.html servido y
        // los activos implementados son de diferentes compilaciones (aplicación web reimplementada
        // mientras una pestaña estaba abierta, o un shell en caché obsoleto). Una recarga obtiene un
        // shell fresco con nombres de chunk coincidentes; la guardia detiene un bucle de recarga
        // cuando el fracaso no es obsolescencia.
        window.addEventListener('vite:preloadError', () => {
            const RELOAD_FLAG = 'mindwtr-chunk-reload-at';
            const lastReload = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
            if (Date.now() - lastReload < 30_000) return;
            sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
            window.location.reload();
        });
    }

    const RootApp = isQuickAddWindow ? QuickAddWindowApp : App;

    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <LanguageProvider>
                <RootApp />
            </LanguageProvider>
        </React.StrictMode>,
    );

    if (!isQuickAddWindow) {
        void signalUiReady();
        void sendDesktopDailyHeartbeat().catch((error) => {
            void logWarn('Desktop analytics heartbeat failed', {
                scope: 'analytics',
                extra: { error: error instanceof Error ? error.message : String(error) },
            });
        });
    }
}

bootstrap().catch((error) => reportError('Failed to start app', error));
