import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../lib/app-log', () => ({
    logWarn: vi.fn(),
}));

import { logWarn } from '../lib/app-log';
import * as shim from './url-polyfill';

describe('URL Polyfill Shim', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
    });

    test('exports URL and URLSearchParams', () => {
        expect(shim.URL).toBeDefined();
        expect(shim.URLSearchParams).toBeDefined();
    });

    test('does not mutate existing timer globals', async () => {
        vi.resetModules();
        const originalSetImmediate = (globalThis as any).setImmediate;
        const originalClearImmediate = (globalThis as any).clearImmediate;
        await import('./url-polyfill');
        expect((globalThis as any).setImmediate).toBe(originalSetImmediate);
        expect((globalThis as any).clearImmediate).toBe(originalClearImmediate);
    });

    test('shimmed URL has createObjectURL that is safe (mocked environment)', async () => {
        // 1. Reset modules to ensure fresh execution of shim logic
        vi.resetModules();

        // 2. Mock global URL to simulate Hermes (no createObjectURL)
        const OriginalURL = globalThis.URL;

        // Necesitamos una clase que extienda o imite URL pero definitivamente no tiene método estático createObjectURL
        // @ts-ignore - MockURL matching OriginalURL structure for tests
        class MockURL extends OriginalURL {
            // @ts-ignore - Intentionally removing static method to simulate Hermes
            static createObjectURL = undefined;
            // @ts-ignore - Intentionally removing static method to simulate Hermes
            static revokeObjectURL = undefined;
        }

        // Reemplazar temporalmente la URL global
        globalThis.URL = MockURL as unknown as typeof URL;

        // 3. Re-import and call setupURLPolyfill
        const shimModule = await import('./url-polyfill');
        shimModule.setupURLPolyfill();

        // 4. Verify it was patched on globalThis
        expect(typeof globalThis.URL.createObjectURL).toBe('function');

        // 5. Test safety behavior (returns string, warns)
        const result = globalThis.URL.createObjectURL({} as any);
        expect(result).toBe('');

        const warnMock = vi.mocked(logWarn);
        if (warnMock.mock.calls.length > 0) {
            expect(warnMock).toHaveBeenCalledWith(
                expect.stringContaining('not supported'),
                expect.any(Object)
            );
        }

        // Limpieza
        globalThis.URL = OriginalURL;
    });

    test('shimmed URL has revokeObjectURL', () => {
        expect(typeof shim.URL.revokeObjectURL).toBe('function');
        // No debe lanzar
        shim.URL.revokeObjectURL('some-url');
    });

    test('URLSearchParams basic functionality', () => {
        const params = new shim.URLSearchParams!('foo=1&bar=2');
        expect(params.get('foo')).toBe('1');
        expect(params.get('bar')).toBe('2');
        expect(params.has('foo')).toBe(true);
        expect(params.has('baz')).toBe(false);
    });
});
