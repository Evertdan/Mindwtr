import React from 'react';
import renderer from 'react-test-renderer';
import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectImagePreviewModal } from './ProjectOverlayModals';

const sharingMocks = vi.hoisted(() => ({
  isAvailableAsync: vi.fn(async () => true),
  shareAsync: vi.fn(async () => undefined),
}));

vi.mock('expo-sharing', () => sharingMocks);

beforeEach(() => {
  sharingMocks.isAvailableAsync.mockReset().mockResolvedValue(true);
  sharingMocks.shareAsync.mockReset().mockResolvedValue(undefined);
  vi.restoreAllMocks();
});

describe('ProjectImagePreviewModal', () => {
  it('tells the user when image sharing fails', async () => {
    sharingMocks.shareAsync.mockRejectedValue(new Error('share rejected'));
    const alertSpy = vi.spyOn(Alert, 'alert');

    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(
        <ProjectImagePreviewModal
          visible
          presentationStyle="overFullScreen"
          t={(key) => ({
            'attachments.title': 'Attachments',
            'common.close': 'Close',
            'common.share': 'Share',
            'share.unavailable': 'Share unavailable',
          }[key] ?? key)}
          tc={{
            cardBg: '#111',
            border: '#222',
            text: '#fff',
            secondaryText: '#aaa',
            inputBg: '#000',
            filterBg: '#000',
            tint: '#3b82f6',
          }}
          attachment={{
            id: 'image-1',
            kind: 'file',
            title: 'Photo',
            uri: 'file:///photo.jpg',
            mimeType: 'image/jpeg',
            createdAt: '2026-08-14T00:00:00.000Z',
            updatedAt: '2026-08-14T00:00:00.000Z',
          }}
          onClose={vi.fn()}
        />,
      );
    });

    const shareButton = tree.root.findByProps({ children: 'Share' }).parent;
    if (!shareButton || typeof shareButton.props.onPress !== 'function') {
      throw new Error('Share button not found');
    }
    await renderer.act(async () => {
      shareButton.props.onPress();
    });

    expect(sharingMocks.isAvailableAsync).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith('Attachments', 'Share unavailable');
  });
});
