import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const openShellMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: openShellMock,
}));

import { openAttachmentTarget } from './open-attachment-target';

describe('openAttachmentTarget', () => {
    beforeEach(() => {
        invokeMock.mockReset();
        openShellMock.mockReset();
        vi.restoreAllMocks();
        delete (window as any).__TAURI_INTERNALS__;
        delete (window as any).__TAURI__;
    });

    it('opens web links through the Tauri shell opener', async () => {
        (window as any).__TAURI_INTERNALS__ = {};

        await openAttachmentTarget('https://example.com/file.pdf');

        expect(openShellMock).toHaveBeenCalledWith('https://example.com/file.pdf');
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('opens local paths through the desktop open_path command', async () => {
        (window as any).__TAURI_INTERNALS__ = {};

        await openAttachmentTarget('file:///tmp/a1.pdf', 'a1');

        expect(invokeMock).toHaveBeenCalledWith('open_path', {
            path: '/tmp/a1.pdf',
            attachmentId: 'a1',
        });
        expect(openShellMock).not.toHaveBeenCalled();
    });

    it('uses browser file urls outside Tauri', async () => {
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        await openAttachmentTarget('/tmp/My Doc.pdf');

        expect(openSpy).toHaveBeenCalledWith('file:///tmp/My Doc.pdf', '_blank');
        expect(invokeMock).not.toHaveBeenCalled();
        expect(openShellMock).not.toHaveBeenCalled();
    });
});
