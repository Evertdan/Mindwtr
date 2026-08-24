import { Alert } from 'react-native';
import { logError } from '../lib/app-log';

/**
 * Runtime verification of critical polyfills.
 * This ensures that our shim strategy is actually working in the Hermes environment.
 */
export function verifyPolyfills() {
    const errors: string[] = [];

    // 1. Verify URL
    try {
        if (typeof URL === 'undefined') {
            errors.push('Global URL is undefined');
        } else {
            const u = new URL('https://example.com/path?foo=bar');
            if (u.protocol !== 'https:') errors.push('URL protocol parsing failed');
            if (u.pathname !== '/path') errors.push('URL pathname parsing failed');
            if (u.search !== '?foo=bar') errors.push('URL search parsing failed');
        }
    } catch (e) {
        errors.push(`URL instantiation failed: ${(e as Error).message}`);
    }

    // 2. Verify URLSearchParams
    try {
        if (typeof URLSearchParams === 'undefined') {
            errors.push('Global URLSearchParams is undefined');
        } else {
            const params = new URLSearchParams('foo=1&bar=2');
            if (params.get('foo') !== '1') errors.push('URLSearchParams.get failed');
            if (!params.has('bar')) errors.push('URLSearchParams.has failed');

            // Verificación crítica: soporte de .keys() (frecuentemente faltante en verificaciones nativas de Hermes 101)
            if (typeof (params as any).keys !== 'function') {
                errors.push('URLSearchParams.keys() is missing (Shim failed?)');
            } else {
                // Verificar iteración
                const keys = Array.from((params as any).keys());
                if (!keys.includes('foo')) errors.push('URLSearchParams iteration failed');
            }
        }
    } catch (e) {
        errors.push(`URLSearchParams check failed: ${(e as Error).message}`);
    }

    // 3. Verify createObjectURL (should throw or be supported, depending on shim)
    // Nuestro shim lanza 'no soportado' que es lo esperado/manejado
    try {
        if (typeof URL.createObjectURL === 'undefined') {
            // Este/Esta
            // Nuestro shim lo define pero lanza.
            // errors.push('URL.createObjectURL is undefined');
        }
    } catch (e) {
        // ignore
    }

    if (errors.length > 0) {
        void logError(new Error('Polyfill checks failed'), {
            scope: 'polyfill',
            extra: { errors: errors.join('; ') },
        });
        Alert.alert(
            '⚠️ Critical Polyfill Failure',
            'The application environment is unstable:\n\n' + errors.join('\n') + '\n\nPlease check metro.config.js and shims.',
            [{ text: 'OK' }]
        );
    } else {
        // console.log('[Polyfill Check] ✅ All checks passed');
    }
}
