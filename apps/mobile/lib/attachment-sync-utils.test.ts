import { describe, expect, it, vi, beforeEach } from 'vitest';

const fileSystemMock = vi.hoisted(() => ({
  __esModule: true,
  writeAsStringAsync: vi.fn(),
  moveAsync: vi.fn(),
  deleteAsync: vi.fn(),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  StorageAccessFramework: {},
}));

vi.mock('./file-system', () => fileSystemMock);

vi.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

// Static, not a per-test dynamic import: attachment-sync-utils.ts pulls in a heavy
// module graph, and paying that transform cost inside `it()` (as a dynamic import)
// counted against the per-test timeout and made this file flaky under a parallel
// full-suite run even though it passed reliably alone.
import { writeBytesSafely } from './attachment-sync-utils';

// #1057: attachment downloads must be write-temp-then-rename so a cut connection
// can never leave a truncated file at the real target path that a later sync would
// mistake for new content.
describe('writeBytesSafely', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes to a temp uri first, only moving it onto the target once the write succeeds', async () => {
    fileSystemMock.writeAsStringAsync.mockResolvedValue(undefined);
    fileSystemMock.moveAsync.mockResolvedValue(undefined);

    await writeBytesSafely('file://attachments/a1.pdf', new Uint8Array([1, 2, 3]));

    const [tempUri] = fileSystemMock.writeAsStringAsync.mock.calls[0] ?? [];
    expect(tempUri).not.toBe('file://attachments/a1.pdf');
    expect(fileSystemMock.moveAsync).toHaveBeenCalledWith({ from: tempUri, to: 'file://attachments/a1.pdf' });
  });

  it('a failed temp write never touches the target path, so a previously-downloaded file survives intact', async () => {
    const writeError = new Error('connection cut mid-download');
    fileSystemMock.writeAsStringAsync.mockRejectedValueOnce(writeError);

    await expect(writeBytesSafely('file://attachments/a1.pdf', new Uint8Array([1, 2, 3])))
      .rejects.toThrow(writeError);

    // Only the temp write was attempted — the fallback direct-write-to-target
    // branch (used only when the *move* fails, not the initial write) never runs.
    expect(fileSystemMock.writeAsStringAsync).toHaveBeenCalledTimes(1);
    expect(fileSystemMock.writeAsStringAsync.mock.calls[0]?.[0]).not.toBe('file://attachments/a1.pdf');
    expect(fileSystemMock.moveAsync).not.toHaveBeenCalled();
  });
});
