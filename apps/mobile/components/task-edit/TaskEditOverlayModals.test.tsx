import React from 'react';
import renderer from 'react-test-renderer';
import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskEditAudioModal, TaskEditImagePreviewModal } from './TaskEditOverlayModals';

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

describe('TaskEditAudioModal', () => {
  it('renders the retry transcription action', () => {
    const onRetryTranscription = vi.fn();

    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(
        <TaskEditAudioModal
          visible
          t={(key) =>
            ({
              'quickAdd.audioNoteTitle': 'Audio Note',
              'common.play': 'Play',
              'common.close': 'Close',
              'attachments.retryTranscription': 'Re-transcribe',
              'audio.loading': 'Loading audio...',
            }[key] ?? key)
          }
          tc={{
            cardBg: '#111',
            border: '#222',
            text: '#fff',
            secondaryText: '#aaa',
            inputBg: '#000',
            tint: '#3b82f6',
            danger: '#ef4444',
          }}
          audioTitle="Audio Note"
          audioStatus={{ isLoaded: true, playing: false, currentTime: 1, duration: 5 }}
          audioLoading={false}
          audioTranscribing={false}
          audioTranscriptionError={null}
          onTogglePlayback={vi.fn()}
          onRetryTranscription={onRetryTranscription}
          onClose={vi.fn()}
        />,
      );
    });

    const retryLabel = tree.root.findByProps({ children: 'Re-transcribe' });
    const retryButton = retryLabel.parent;
    if (!retryButton || typeof retryButton.props.onPress !== 'function') {
      throw new Error('Retry button not found');
    }
    renderer.act(() => {
      retryButton.props.onPress();
    });

    expect(onRetryTranscription).toHaveBeenCalledTimes(1);
  });

  it('shows the transcribing state and inline error', () => {
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(
        <TaskEditAudioModal
          visible
          t={(key) =>
            ({
              'quickAdd.audioNoteTitle': 'Audio Note',
              'common.play': 'Play',
              'common.close': 'Close',
              'attachments.transcribing': 'Transcribing...',
              'audio.loading': 'Loading audio...',
            }[key] ?? key)
          }
          tc={{
            cardBg: '#111',
            border: '#222',
            text: '#fff',
            secondaryText: '#aaa',
            inputBg: '#000',
            tint: '#3b82f6',
            danger: '#ef4444',
          }}
          audioTitle="Audio Note"
          audioStatus={{ isLoaded: true, playing: false, currentTime: 1, duration: 5 }}
          audioLoading={false}
          audioTranscribing
          audioTranscriptionError="Transcription failed. Please try again."
          onTogglePlayback={vi.fn()}
          onRetryTranscription={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    expect(tree.root.findByProps({ children: 'Transcribing...' }).parent?.props.disabled).toBe(true);
    expect(tree.root.findByProps({ children: 'Transcription failed. Please try again.' })).toBeTruthy();
  });
});

describe('TaskEditImagePreviewModal', () => {
  it('tells the user when image sharing is unavailable', async () => {
    sharingMocks.isAvailableAsync.mockResolvedValue(false);
    const alertSpy = vi.spyOn(Alert, 'alert');

    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(
        <TaskEditImagePreviewModal
          visible
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
            tint: '#3b82f6',
            danger: '#ef4444',
          }}
          imagePreviewAttachment={{
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

    expect(sharingMocks.shareAsync).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Attachments', 'Share unavailable');
  });
});
