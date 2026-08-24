import { vi } from 'vitest';
import React from 'react';

// Mínimos globales para módulos Expo en entorno de prueba de nodo.
const testGlobal = globalThis as typeof globalThis & {
  __DEV__?: boolean;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
  expo?: {
    EventEmitter: new () => {
      addListener: () => { remove: () => void };
      removeAllListeners: () => void;
      emit: () => void;
    };
    modules: Record<string, unknown>;
  };
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
};

testGlobal.__DEV__ = false;
testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
testGlobal.expo = testGlobal.expo ?? {
  EventEmitter: class {
    addListener() {
      return { remove: () => {} };
    }
    removeAllListeners() {}
    emit() {}
  },
  modules: {},
};
testGlobal.requestAnimationFrame = testGlobal.requestAnimationFrame ?? ((callback: FrameRequestCallback) => {
  return setTimeout(() => callback(Date.now()), 0) as unknown as number;
});
testGlobal.cancelAnimationFrame = testGlobal.cancelAnimationFrame ?? ((id: number) => {
  clearTimeout(id);
});

// No disponible por defecto
// fallback; secure-config tests override this with their own mock.
vi.mock('expo-secure-store', () => ({
  isAvailableAsync: vi.fn().mockResolvedValue(false),
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
}));

vi.mock('expo-audio', () => ({
  AudioModule: {
    requestRecordingPermissionsAsync: vi.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  },
  requestRecordingPermissionsAsync: vi.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  setAudioModeAsync: vi.fn().mockResolvedValue(undefined),
  useAudioPlayer: vi.fn(() => ({
    play: vi.fn(),
    pause: vi.fn(),
    replace: vi.fn(),
    remove: vi.fn(),
  })),
  useAudioPlayerStatus: vi.fn(() => ({
    id: 0,
    currentTime: 0,
    playbackState: 'stopped',
    timeControlStatus: 'paused',
    reasonForWaitingToPlay: '',
    mute: false,
    duration: 0,
    playing: false,
    loop: false,
    didJustFinish: false,
    isBuffering: false,
    isLoaded: true,
    playbackRate: 1,
    shouldCorrectPitch: true,
  })),
  useAudioRecorder: vi.fn(() => ({
    prepareToRecordAsync: vi.fn().mockResolvedValue(undefined),
    record: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    uri: 'file://recording.m4a',
  })),
  useAudioRecorderState: vi.fn(() => ({
    canRecord: true,
    isRecording: false,
    durationMillis: 0,
    mediaServicesDidReset: false,
    url: null,
  })),
  RecordingPresets: {
    HIGH_QUALITY: {},
  },
}));

vi.mock('expo-file-system', () => ({
  Directory: {
    cache: 'cache',
    document: 'document',
  },
  File: class {},
  Paths: {
    cache: 'cache',
    document: 'document',
  },
}));

vi.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  documentDirectory: 'document',
  cacheDirectory: 'cache',
  StorageAccessFramework: {
    readDirectoryAsync: vi.fn().mockResolvedValue([]),
    makeDirectoryAsync: vi.fn().mockResolvedValue('content://attachments'),
    createFileAsync: vi.fn().mockResolvedValue('content://attachments/file'),
    readAsStringAsync: vi.fn().mockResolvedValue(''),
    writeAsStringAsync: vi.fn().mockResolvedValue(undefined),
  },
  EncodingType: {
    Base64: 'base64',
  },
  getInfoAsync: vi.fn().mockResolvedValue({ exists: false }),
  makeDirectoryAsync: vi.fn().mockResolvedValue(undefined),
  readAsStringAsync: vi.fn().mockResolvedValue(''),
  writeAsStringAsync: vi.fn().mockResolvedValue(undefined),
  readDirectoryAsync: vi.fn().mockResolvedValue([]),
  deleteAsync: vi.fn().mockResolvedValue(undefined),
  copyAsync: vi.fn().mockResolvedValue(undefined),
  moveAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('expo-clipboard', () => ({
  __esModule: true,
  setStringAsync: vi.fn().mockResolvedValue(true),
}));

vi.mock('@expo/vector-icons', () => {
  const Icon = (props: any) => React.createElement('Icon', props, props.children);
  return {
    Ionicons: Icon,
    AntDesign: Icon,
    Entypo: Icon,
    EvilIcons: Icon,
    Feather: Icon,
    FontAwesome: Icon,
    FontAwesome5: Icon,
    FontAwesome6: Icon,
    Foundation: Icon,
    MaterialCommunityIcons: Icon,
    MaterialIcons: Icon,
    Octicons: Icon,
    SimpleLineIcons: Icon,
    Zocial: Icon,
  };
});

vi.mock('lucide-react-native', () => {
  const Icon = (props: any) => React.createElement('Icon', props, props.children);
  // Mantenga esto como un objeto de módulo simple. Un proxy global también expone `then`,
  // which makes the mock look promise-like and can stall ESM imports in Vitest.
  const iconNames = [
    'AlertTriangle',
    'Archive',
    'ArrowLeft',
    'ArrowDown',
    'ArrowRight',
    'ArrowRightCircle',
    'ArrowUp',
    'AtSign',
    'Bell',
    'BookOpen',
    'BookmarkPlus',
    'Calendar',
    'CalendarDays',
    'Check',
    'CheckCircle',
    'CheckCircle2',
    'CheckSquare',
    'ChevronDown',
    'ChevronUp',
    'ChevronRight',
    'Circle',
    'ClipboardCheck',
    'Clock',
    'Clock3',
    'Cloud',
    'Database',
    'Flag',
    'Folder',
    'GripVertical',
    'Inbox',
    'Info',
    'Layers',
    'LayoutGrid',
    'Lightbulb',
    'ListChecks',
    'ListOrdered',
    'ListTodo',
    'Menu',
    'Mic',
    'Monitor',
    'MoreHorizontal',
    'MoveVertical',
    'PauseCircle',
    'Play',
    'Plus',
    'RefreshCw',
    'RotateCcw',
    'Search',
    'Settings',
    'Settings2',
    'SlidersHorizontal',
    'Sparkles',
    'Square',
    'Star',
    'Tag',
    'Target',
    'Timer',
    'Trash2',
    'UserRound',
    'X',
  ] as const;
  const exports = Object.fromEntries(iconNames.map((name) => [name, Icon])) as Record<string, unknown>;
  return {
    __esModule: true,
    ...exports,
    default: exports,
  };
});
