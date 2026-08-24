import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsAboutPage } from './useSettingsAboutPage';
import { getEnglishSettingsLabels } from './labels';
import { UpdateRateLimitedError } from '../../../lib/update-service';

const runtimeMock = vi.hoisted(() => ({
    isTauriRuntime: vi.fn(() => true),
    getInstallSourceOrFallback: vi.fn<() => Promise<string>>(),
}));

const updateServiceMock = vi.hoisted(() => ({
    checkForUpdates: vi.fn(async () => ({ hasUpdate: false })),
}));

vi.mock('../../../lib/runtime', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../lib/runtime')>()),
    isTauriRuntime: runtimeMock.isTauriRuntime,
    getInstallSourceOrFallback: runtimeMock.getInstallSourceOrFallback,
}));

vi.mock('../../../lib/update-service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../lib/update-service')>()),
    checkForUpdates: updateServiceMock.checkForUpdates,
}));

vi.mock('@tauri-apps/api/app', () => ({
    getVersion: vi.fn(async () => '1.0.0'),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(async () => null),
}));

vi.mock('../../../lib/app-log', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../lib/app-log')>()),
    getLogPath: vi.fn(async () => ''),
}));

const reportErrorMock = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/report-error', () => ({ reportError: reportErrorMock }));

function Harness() {
    useSettingsAboutPage({ t: getEnglishSettingsLabels() });
    return null;
}

type AboutPageResult = ReturnType<typeof useSettingsAboutPage>;

function CaptureHarness({ onResult }: { onResult: (result: AboutPageResult) => void }) {
    onResult(useSettingsAboutPage({ t: getEnglishSettingsLabels() }));
    return null;
}

describe('useSettingsAboutPage background update check', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
    });

    it('stays offline until install source detection identifies a quiet channel', async () => {
        // Slow detection resolving to scoop: antes de la fix la verificar fired
        // con la initial 'unknown' source mientras detection was in flight.
        let resolveSource: (value: string) => void = () => {};
        runtimeMock.getInstallSourceOrFallback.mockImplementation(
            () => new Promise<string>((resolve) => { resolveSource = resolve; }),
        );

        render(<Harness />);

        // Give la app-versión efecto tiempo to settle por lo que la badge verificar sería
        // tienen sido eligible to ejecución si it ignored la unresolved source.
        await waitFor(() => expect(runtimeMock.getInstallSourceOrFallback).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(updateServiceMock.checkForUpdates).not.toHaveBeenCalled();

        resolveSource('scoop');
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(updateServiceMock.checkForUpdates).not.toHaveBeenCalled();
    });

    it('runs the background check once detection resolves a non-quiet channel', async () => {
        runtimeMock.getInstallSourceOrFallback.mockResolvedValue('winget');

        render(<Harness />);

        await waitFor(() => expect(updateServiceMock.checkForUpdates).toHaveBeenCalledTimes(1));
        expect(updateServiceMock.checkForUpdates).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ installSource: 'winget' }),
        );
    });

    it('reports the localized copy, not the error message, when the check is rate-limited', async () => {
        const labels = getEnglishSettingsLabels();
        runtimeMock.getInstallSourceOrFallback.mockResolvedValue('scoop');
        updateServiceMock.checkForUpdates.mockRejectedValue(new UpdateRateLimitedError());

        let result!: AboutPageResult;
        render(<CaptureHarness onResult={(value) => { result = value; }} />);
        await waitFor(() => expect(result).toBeDefined());

        await result.aboutPageProps.onCheckUpdates();

        expect(reportErrorMock).toHaveBeenCalledWith(
            'Update check failed',
            expect.any(UpdateRateLimitedError),
            { userMessage: labels.updateRateLimited },
        );
        // The raw error message es diagnostic-only y debe nunca be la copy.
        expect(labels.updateRateLimited).not.toBe(new UpdateRateLimitedError().message);
    });
});
