import { beforeEach, describe, expect, it, vi } from 'vitest';

const modernFileSystemMock = vi.hoisted(() => {
  type PathKind = 'file' | 'directory';

  const paths = new Map<string, PathKind>();
  const directoryCreates = vi.fn((uri: string, _options?: unknown) => {
    paths.set(uri, 'directory');
  });
  const directoryDeletes = vi.fn((uri: string) => {
    paths.delete(uri);
  });
  const fileCreates = vi.fn((uri: string, _options?: unknown) => {
    paths.set(uri, 'file');
  });
  const fileWrites = vi.fn((uri: string, _contents: string, _options?: unknown) => {
    if (paths.get(uri) === 'directory') {
      throw new Error('EISDIR');
    }
    paths.set(uri, 'file');
  });
  const fileCopies = vi.fn((from: string, to: string) => {
    if (paths.get(from) !== 'file') {
      throw new Error(`Missing source file: ${from}`);
    }
    if (paths.get(to) === 'directory') {
      throw new Error('EISDIR');
    }
    paths.set(to, 'file');
  });
  const fileMoves = vi.fn((from: string, to: string) => {
    if (paths.get(from) !== 'file') {
      throw new Error(`Missing source file: ${from}`);
    }
    if (paths.get(to) === 'directory') {
      throw new Error('EISDIR');
    }
    paths.delete(from);
    paths.set(to, 'file');
  });

  const resolveUri = (value: string | { uri: string }): string =>
    typeof value === 'string' ? value : value.uri;

  const getParentUri = (uri: string): string => {
    const trimmed = uri.replace(/\/+$/, '');
    const separatorIndex = trimmed.lastIndexOf('/');
    return separatorIndex > 'file://'.length ? trimmed.slice(0, separatorIndex) : trimmed;
  };

  class Directory {
    uri: string;

    constructor(uri: string | { uri: string }) {
      this.uri = resolveUri(uri);
    }

    get exists() {
      return paths.get(this.uri) === 'directory';
    }

    create(options?: unknown) {
      directoryCreates(this.uri, options);
    }

    delete() {
      directoryDeletes(this.uri);
    }

    list() {
      return [];
    }

    info() {
      return {
        exists: this.exists,
        uri: this.uri,
      };
    }

    copy(destination: Directory) {
      paths.set(destination.uri, 'directory');
    }

    move(destination: Directory) {
      paths.delete(this.uri);
      paths.set(destination.uri, 'directory');
    }
  }

  class File {
    uri: string;

    constructor(uri: string | { uri: string }) {
      this.uri = resolveUri(uri);
    }

    get exists() {
      return paths.get(this.uri) === 'file';
    }

    get parentDirectory() {
      return new Directory(getParentUri(this.uri));
    }

    create(options?: unknown) {
      fileCreates(this.uri, options);
    }

    write(contents: string, options?: unknown) {
      fileWrites(this.uri, contents, options);
    }

    copy(destination: File) {
      fileCopies(this.uri, destination.uri);
    }

    move(destination: File) {
      fileMoves(this.uri, destination.uri);
    }

    delete() {
      paths.delete(this.uri);
    }

    info() {
      return {
        exists: this.exists,
        uri: this.uri,
      };
    }

    text() {
      return '';
    }

    base64() {
      return '';
    }
  }

  const Paths = {
    cache: { uri: 'file://Cache/' },
    document: { uri: 'file://document/' },
    info: vi.fn((uri: string) => ({
      exists: paths.has(uri),
      isDirectory: paths.get(uri) === 'directory',
    })),
  };

  return {
    Directory,
    File,
    Paths,
    directoryCreates,
    directoryDeletes,
    fileCreates,
    fileWrites,
    fileCopies,
    fileMoves,
    __getPath: (uri: string) => paths.get(uri),
    __reset: () => {
      paths.clear();
      directoryCreates.mockClear();
      directoryDeletes.mockClear();
      fileCreates.mockClear();
      fileWrites.mockClear();
      fileCopies.mockClear();
      fileMoves.mockClear();
      Paths.info.mockClear();
    },
    __setPath: (uri: string, kind: PathKind) => {
      paths.set(uri, kind);
    },
  };
});

const legacyFileSystemMock = vi.hoisted(() => ({
  __esModule: true,
  documentDirectory: 'file://document/',
  cacheDirectory: 'file://Cache/',
  getInfoAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
  readDirectoryAsync: vi.fn(),
  deleteAsync: vi.fn(),
  copyAsync: vi.fn(),
  moveAsync: vi.fn(),
}));

vi.mock('expo-file-system', () => modernFileSystemMock);
vi.mock('expo-file-system/legacy', () => legacyFileSystemMock);

describe('file-system wrapper', () => {
  beforeEach(() => {
    modernFileSystemMock.__reset();
    vi.clearAllMocks();
  });

  it('repairs a stale directory at a file write target', async () => {
    const { EncodingType, writeAsStringAsync } = await import('./file-system');
    const targetUri = 'file://document/attachments/photo.jpg.tmp-123';
    modernFileSystemMock.__setPath(targetUri, 'directory');

    await writeAsStringAsync(targetUri, 'AQID', { encoding: EncodingType.Base64 });

    expect(modernFileSystemMock.directoryDeletes).toHaveBeenCalledWith(targetUri);
    expect(modernFileSystemMock.fileCreates).toHaveBeenCalledWith(targetUri, { overwrite: true });
    expect(modernFileSystemMock.fileCreates).not.toHaveBeenCalledWith(
      targetUri,
      expect.objectContaining({ intermediates: true })
    );
    expect(modernFileSystemMock.fileWrites).toHaveBeenCalledWith(
      targetUri,
      'AQID',
      { encoding: 'base64' }
    );
    expect(legacyFileSystemMock.writeAsStringAsync).not.toHaveBeenCalled();
    expect(modernFileSystemMock.__getPath(targetUri)).toBe('file');
  });

  it('repairs stale directory targets before file copy and move', async () => {
    const { copyAsync, moveAsync } = await import('./file-system');
    const copySourceUri = 'file://document/source.jpg';
    const copyTargetUri = 'file://document/attachments/source.jpg.tmp-copy';
    const moveSourceUri = 'file://document/source-2.jpg';
    const moveTargetUri = 'file://document/attachments/source-2.jpg';
    modernFileSystemMock.__setPath(copySourceUri, 'file');
    modernFileSystemMock.__setPath(copyTargetUri, 'directory');
    modernFileSystemMock.__setPath(moveSourceUri, 'file');
    modernFileSystemMock.__setPath(moveTargetUri, 'directory');

    await copyAsync({ from: copySourceUri, to: copyTargetUri });
    await moveAsync({ from: moveSourceUri, to: moveTargetUri });

    expect(modernFileSystemMock.directoryDeletes).toHaveBeenCalledWith(copyTargetUri);
    expect(modernFileSystemMock.directoryDeletes).toHaveBeenCalledWith(moveTargetUri);
    expect(modernFileSystemMock.fileCopies).toHaveBeenCalledWith(copySourceUri, copyTargetUri);
    expect(modernFileSystemMock.fileMoves).toHaveBeenCalledWith(moveSourceUri, moveTargetUri);
    expect(modernFileSystemMock.__getPath(copyTargetUri)).toBe('file');
    expect(modernFileSystemMock.__getPath(moveTargetUri)).toBe('file');
    expect(modernFileSystemMock.__getPath(moveSourceUri)).toBeUndefined();
    expect(legacyFileSystemMock.copyAsync).not.toHaveBeenCalled();
    expect(legacyFileSystemMock.moveAsync).not.toHaveBeenCalled();
  });
});
