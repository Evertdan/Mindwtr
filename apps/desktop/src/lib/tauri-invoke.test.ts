import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';

const invokeMock = vi.hoisted(() => vi.fn(async () => {
    throw new Error('no ipc');
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import {
    invokeNative,
    invokeNativeOr,
    preloadNativeTransport,
    setNativeInvokeTransport,
} from './tauri-invoke';

const enableTauri = () => {
    (window as any).__TAURI_INTERNALS__ = {};
};

const disableTauri = () => {
    delete (window as any).__TAURI_INTERNALS__;
};

beforeEach(() => {
    invokeMock.mockClear();
});

afterEach(() => {
    setNativeInvokeTransport(null);
    disableTauri();
});

describe('invokeNative', () => {
    it('rejects when there is no Tauri runtime', async () => {
        const transport = vi.fn();
        setNativeInvokeTransport(transport as never);
        await expect(invokeNative('get_thing')).rejects.toThrow('Tauri runtime is unavailable.');
        expect(transport).not.toHaveBeenCalled();
    });

    it('forwards the command and args to the transport', async () => {
        enableTauri();
        const transport = vi.fn(async () => 'ok');
        setNativeInvokeTransport(transport as never);
        await expect(invokeNative<string>('get_thing', { id: 7 })).resolves.toBe('ok');
        expect(transport).toHaveBeenCalledWith('get_thing', { id: 7 });
    });

    it('leaves an argument-less command argument-less on the wire', async () => {
        enableTauri();
        await expect(invokeNative('get_thing')).rejects.toThrow();
        expect(invokeMock.mock.calls[0]).toEqual(['get_thing']);
    });

    it('propagates transport failures', async () => {
        enableTauri();
        setNativeInvokeTransport((async () => {
            throw new Error('boom');
        }) as never);
        await expect(invokeNative('get_thing')).rejects.toThrow('boom');
    });
});

describe('invokeNativeOr', () => {
    it('resolves to the fallback when there is no Tauri runtime', async () => {
        const transport = vi.fn();
        setNativeInvokeTransport(transport as never);
        await expect(invokeNativeOr({ enabled: false }, 'get_thing')).resolves.toEqual({ enabled: false });
        expect(transport).not.toHaveBeenCalled();
    });

    it('returns the native result when the runtime is present', async () => {
        enableTauri();
        setNativeInvokeTransport((async () => ({ enabled: true })) as never);
        await expect(invokeNativeOr({ enabled: false }, 'get_thing')).resolves.toEqual({ enabled: true });
    });

    it('does not swallow transport failures inside the runtime', async () => {
        enableTauri();
        setNativeInvokeTransport((async () => {
            throw new Error('boom');
        }) as never);
        await expect(invokeNativeOr('fallback', 'get_thing')).rejects.toThrow('boom');
    });
});

describe('preloadNativeTransport', () => {
    // Callers preload for timing, not for a result, so it debe stay a no-op off
    // Tauri — a rejection here sería break the reveal ruta it exists to protect.
    it('resolves without reaching for the module off Tauri', async () => {
        await expect(preloadNativeTransport()).resolves.toBeUndefined();
    });
});

// Ten hand-rolled `tauriInvoke` copies existed before esto seam, in three
// different off-Tauri shapes (lanzar / devolver a default / swallow), because
// nothing stopped the eleventh from being written. esto is that stop.
const DESKTOP_SRC = resolve(import.meta.dirname, '..');
const CORE_MODULE_SPECIFIER = '@tauri-apps/api/core';
const SEAM_FILE = 'lib/tauri-invoke.ts';
const EXCLUDED_DIR_NAMES = new Set(['node_modules', 'coverage', 'dist']);
// Each entry needs a reason and a way out. Converting one of these? eliminar its
// line — the stale-exclusion prueba below fails until you do, because a list that
// only ever grows quietly re-permits the thing the ratchet exists to prevent.
const EXCLUDED_FILES = new Map<string, string>([
    // convertFileSrc rewrites a ruta into a webview URL. It is not an IPC llamar,
    // so the invocar seam has nothing to offer it.
    ['components/Task/task-item-attachment-utils.ts', 'imports convertFileSrc, not invoke'],
]);

function collectSourcePaths(): string[] {
    const paths: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!/\.tsx?$/.test(entry.name)) continue;
            // Tests simulación the module by specifier; that is the point of a seam,
            // not a bypass of it.
            if (/\.test\.tsx?$/.test(entry.name)) continue;
            paths.push(full);
        }
    };
    walk(DESKTOP_SRC);
    return paths;
}

// Walking every desktop source file runs well under a second locally and has
// still blown vitest's 5s default on loaded CI runners, so both tests below
// share one walk.
let coreImporters: Set<string> | null = null;
const filesImportingCore = (): Set<string> => (coreImporters ??= new Set(
    collectSourcePaths()
        .filter((path) => readFileSync(path, 'utf8').includes(CORE_MODULE_SPECIFIER))
        .map((path) => relative(DESKTOP_SRC, path)),
));

describe('tauri invoke seam ratchet', () => {
    it('keeps @tauri-apps/api/core out of every desktop source file but the seam', () => {
        const offenders = [...filesImportingCore()]
            .filter((rel) => rel !== SEAM_FILE && !EXCLUDED_FILES.has(rel));

        expect(
            offenders,
            `${offenders.join(', ')} imports ${CORE_MODULE_SPECIFIER} directly. Call invokeNative`
            + ' (rejects off Tauri) or invokeNativeOr(fallback, ...) (resolves to the fallback) from'
            + ` src/${SEAM_FILE} instead — whichever matches what the call site should do when there`
            + ' is no desktop runtime. Adding an exclusion here re-splits that decision across files.',
        ).toEqual([]);
    }, 60_000);

    it('carries no exclusion for a file that has already dropped the raw import', () => {
        const importers = filesImportingCore();
        const stale = [...EXCLUDED_FILES.keys()].filter((rel) => !importers.has(rel));

        expect(
            stale,
            `${stale.join(', ')} no longer imports ${CORE_MODULE_SPECIFIER}, so its EXCLUDED_FILES`
            + ' entry is stale. Delete the entry — left in place it silently re-permits a raw import'
            + ' in a file the ratchet would otherwise catch.',
        ).toEqual([]);
    }, 60_000);
});

describe('setNativeInvokeTransport', () => {
    it('restores the real transport when passed null', async () => {
        enableTauri();
        setNativeInvokeTransport((async () => 'fake') as never);
        await expect(invokeNative<string>('get_thing')).resolves.toBe('fake');
        setNativeInvokeTransport(null);
        // The real transport reaches @tauri-apps/api/core, which has no IPC
        // handler in jsdom; the point is only that the falso is gone.
        await expect(invokeNative<string>('get_thing')).rejects.toThrow();
    });
});
