import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTdahModeActive } from './use-tdah-mode-active';

const cloudGetJson = vi.fn();

vi.mock('@mindwtr/core', () => ({
    cloudGetJson: (...args: unknown[]) => cloudGetJson(...args),
    getCloudBaseUrl: (url: string) => `${url.replace(/\/+$/, '')}/v1`,
}));

const asyncStorageGetItem = vi.fn();
vi.mock('@react-native-async-storage/async-storage', () => ({
    default: { getItem: (...args: unknown[]) => asyncStorageGetItem(...args) },
}));

const getSecureConfigValue = vi.fn();
vi.mock('@/lib/secure-config', () => ({
    getSecureConfigValue: (...args: unknown[]) => getSecureConfigValue(...args),
}));

vi.mock('@/lib/webdav-request-options', () => ({
    getMobileCloudRequestOptions: () => ({}),
}));

const configureCloudSync = (url: string | null, token: string | null): void => {
    asyncStorageGetItem.mockImplementation(async (key: string) => {
        if (key === '@mindwtr_cloud_url') return url;
        if (key === '@mindwtr_cloud_allow_insecure_http') return 'false';
        return null;
    });
    getSecureConfigValue.mockImplementation(async (key: string) => (
        key === '@mindwtr_cloud_token' ? token : null
    ));
};

let latest = false;
let tree: ReactTestRenderer | null = null;

function Harness({ refreshKey }: { refreshKey?: unknown }) {
    latest = useTdahModeActive(refreshKey);
    return React.createElement('Harness', null);
}

describe('useTdahModeActive', () => {
    beforeEach(() => {
        cloudGetJson.mockReset();
        asyncStorageGetItem.mockReset();
        getSecureConfigValue.mockReset();
        latest = false;
    });

    afterEach(() => {
        if (tree) act(() => tree?.unmount());
        tree = null;
    });

    it('is true when the server profile reports mode:on', async () => {
        configureCloudSync('https://sync.example.com', 'cloud-token-1234567890');
        cloudGetJson.mockResolvedValue({ profile: { mode: 'on' } });
        await act(async () => { tree = create(React.createElement(Harness)); });
        expect(latest).toBe(true);
    });

    it('is false when the profile reports mode:off', async () => {
        configureCloudSync('https://sync.example.com', 'cloud-token-1234567890');
        cloudGetJson.mockResolvedValue({ profile: { mode: 'off' } });
        await act(async () => { tree = create(React.createElement(Harness)); });
        expect(latest).toBe(false);
    });

    it('is false without ever fetching when Self-Hosted sync is not configured', async () => {
        configureCloudSync(null, null);
        await act(async () => { tree = create(React.createElement(Harness)); });
        expect(latest).toBe(false);
        expect(cloudGetJson).not.toHaveBeenCalled();
    });

    it('is false when the profile fetch fails', async () => {
        configureCloudSync('https://sync.example.com', 'cloud-token-1234567890');
        cloudGetJson.mockRejectedValue(new Error('network down'));
        await act(async () => { tree = create(React.createElement(Harness)); });
        expect(latest).toBe(false);
    });

    it('re-fetches when refreshKey changes, so the Menu sheet gets a fresh check on every open', async () => {
        configureCloudSync('https://sync.example.com', 'cloud-token-1234567890');
        cloudGetJson.mockResolvedValue({ profile: { mode: 'off' } });
        await act(async () => { tree = create(React.createElement(Harness, { refreshKey: 1 })); });
        expect(latest).toBe(false);
        expect(cloudGetJson).toHaveBeenCalledTimes(1);

        cloudGetJson.mockResolvedValue({ profile: { mode: 'on' } });
        await act(async () => { tree?.update(React.createElement(Harness, { refreshKey: 2 })); });
        expect(latest).toBe(true);
        expect(cloudGetJson).toHaveBeenCalledTimes(2);
    });
});
