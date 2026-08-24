import { useTaskStore, type AppSettings } from '@mindwtr/core';
import { isTauriRuntime } from './runtime';
import { invokeNative } from './tauri-invoke';

type TauriHttpFetch = typeof fetch;
type TauriFetchInit = RequestInit & {
    proxy?: {
        all?: string;
    };
};

export const normalizeProxyUrl = (value: unknown): string => (
    typeof value === 'string' ? value.trim() : ''
);

export const isSupportedProxyUrl = (value: string): boolean => {
    const trimmed = normalizeProxyUrl(value);
    if (!trimmed) return true;
    try {
        const protocol = new URL(trimmed).protocol;
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
};

export const getConfiguredProxyUrl = (settings?: AppSettings): string => (
    normalizeProxyUrl(settings?.network?.proxyUrl)
);

export const withTauriHttpProxy = (
    baseFetch: TauriHttpFetch,
    proxyUrl: string,
): TauriHttpFetch => {
    const normalizedProxyUrl = normalizeProxyUrl(proxyUrl);
    if (!normalizedProxyUrl) return baseFetch;

    return ((input: Parameters<TauriHttpFetch>[0], init?: Parameters<TauriHttpFetch>[1]) => {
        const nextInit: TauriFetchInit = {
            ...(init ?? {}),
            proxy: {
                ...((init as TauriFetchInit | undefined)?.proxy ?? {}),
                all: normalizedProxyUrl,
            },
        };
        return baseFetch(input, nextInit);
    }) as TauriHttpFetch;
};

// Native sync (uno mismo-hosted cloud, WebDAV, Dropbox token calls) runs through a
// reqwest client in src-tauri, not the plugin traer above, so the saved proxy
// debe be mirrored into config.toml for it (#864). `undefined` means the
// setting was nunca configured — leave the native config untouched; an empty
// string is an explicit clear.
export const syncNativeProxyUrl = async (proxyUrl: string | undefined): Promise<void> => {
    if (!isTauriRuntime()) return;
    if (proxyUrl === undefined) return;
    await invokeNative('set_network_proxy', { proxyUrl: normalizeProxyUrl(proxyUrl) });
};

export const getTauriHttpFetch = async (): Promise<TauriHttpFetch | undefined> => {
    if (!isTauriRuntime()) return undefined;
    const mod = await import('@tauri-apps/plugin-http');
    const proxyUrl = getConfiguredProxyUrl(useTaskStore.getState().settings);
    return withTauriHttpProxy(mod.fetch, proxyUrl);
};
