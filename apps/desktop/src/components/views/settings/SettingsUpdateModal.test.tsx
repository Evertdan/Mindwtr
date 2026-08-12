import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { UpdateInfo } from '../../../lib/update-service';
import { SettingsUpdateModal } from './SettingsUpdateModal';

const labels = {
    updateAvailable: 'Update Available',
    changelog: 'Changelog',
    noChangelog: 'No changelog',
    downloadRecommended: 'Recommended package',
    downloadAURHint: 'Arch detected: update via AUR',
    later: 'Later',
    downloadStarting: 'Opening download...',
    download: 'Download',
    checkStoreUpdates: 'Check Microsoft Store',
};

const updateInfo: UpdateInfo = {
    hasUpdate: true,
    currentVersion: '0.9.10',
    latestVersion: '1.0.0',
    releaseUrl: 'https://github.com/dongdongbh/Mindwtr/releases/latest',
    latestReleasedAt: null,
    releaseNotes: 'Release notes',
    downloadUrl: null,
    platform: 'windows',
    assets: [],
    source: 'github-release',
    installSource: 'microsoft-store',
    sourceFallback: false,
};

describe('SettingsUpdateModal', () => {
    it('labels Microsoft Store updates as a store action', () => {
        render(
            <SettingsUpdateModal
                isOpen
                updateInfo={updateInfo}
                t={labels}
                recommendedDownload={{ label: 'Microsoft Store' }}
                linuxFlavor={null}
                isDownloading={false}
                downloadNotice={null}
                canDownload
                onClose={vi.fn()}
                onDownload={vi.fn()}
            />,
        );

        expect(screen.getByRole('button', { name: /check microsoft store/i })).toBeEnabled();
        expect(screen.queryByRole('button', { name: /^download$/i })).not.toBeInTheDocument();
    });
});
