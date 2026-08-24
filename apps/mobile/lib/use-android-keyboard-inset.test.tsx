import React from 'react';
import { Dimensions, Keyboard, Platform, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAndroidKeyboardInset, useKeyboardInset } from './use-android-keyboard-inset';

const originalPlatformOs = Platform.OS;

const setPlatform = (os: typeof Platform.OS) => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
};

function Probe({ active }: { active?: boolean }) {
  const inset = useAndroidKeyboardInset(active);
  return <Text>{`inset:${inset}`}</Text>;
}

function CrossPlatformProbe({ active }: { active?: boolean }) {
  const inset = useKeyboardInset(active);
  return <Text>{`inset:${inset}`}</Text>;
}

const insetText = (tree: ReturnType<typeof create>): string => {
  const node = tree.root.findByType(Text);
  return String(node.props.children);
};

afterEach(() => {
  setPlatform(originalPlatformOs);
  vi.restoreAllMocks();
});

describe('useAndroidKeyboardInset', () => {
  it('tracks the measured keyboard height on Android and resets on hide', () => {
    setPlatform('android');
    const listeners = new Map<string, (event?: any) => void>();
    vi.spyOn(Keyboard, 'addListener').mockImplementation((event: string, cb: any) => {
      listeners.set(event, cb);
      return { remove: vi.fn() } as any;
    });

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Probe active />);
    });

    expect(insetText(tree)).toBe('inset:0');

    act(() => {
      listeners.get('keyboardDidShow')?.({ endCoordinates: { height: 320 } });
    });
    expect(insetText(tree)).toBe('inset:320');

    act(() => {
      listeners.get('keyboardDidHide')?.();
    });
    expect(insetText(tree)).toBe('inset:0');
  });

  it('does not attach listeners or report an inset on iOS', () => {
    setPlatform('ios');
    const addListener = vi.spyOn(Keyboard, 'addListener');

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Probe active />);
    });

    expect(addListener).not.toHaveBeenCalled();
    expect(insetText(tree)).toBe('inset:0');
  });

  it('stays at zero while inactive', () => {
    setPlatform('android');
    const addListener = vi.spyOn(Keyboard, 'addListener');

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Probe active={false} />);
    });

    expect(addListener).not.toHaveBeenCalled();
    expect(insetText(tree)).toBe('inset:0');
  });
});

describe('useKeyboardInset', () => {
  it('tracks the keyboard frame on iOS via the will* events and reads offscreen frames as zero', () => {
    setPlatform('ios');
    vi.spyOn(Dimensions, 'get').mockReturnValue({ height: 800, width: 400, scale: 2, fontScale: 1 });
    const listeners = new Map<string, (event?: any) => void>();
    vi.spyOn(Keyboard, 'addListener').mockImplementation((event: string, cb: any) => {
      listeners.set(event, cb);
      return { remove: vi.fn() } as any;
    });

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<CrossPlatformProbe active />);
    });

    expect(listeners.has('keyboardWillShow')).toBe(true);
    expect(listeners.has('keyboardWillChangeFrame')).toBe(true);
    expect(listeners.has('keyboardWillHide')).toBe(true);

    act(() => {
      listeners.get('keyboardWillShow')?.({ endCoordinates: { screenY: 500, height: 300 } });
    });
    expect(insetText(tree)).toBe('inset:300');

    // A frame change (predictive bar toggled) updates from the new top edge.
    act(() => {
      listeners.get('keyboardWillChangeFrame')?.({ endCoordinates: { screenY: 540, height: 300 } });
    });
    expect(insetText(tree)).toBe('inset:260');

    // A frame change that slides the keyboard offscreen must read 0 even
    // though endCoordinates.height still reports the keyboard's Tamaño.
    act(() => {
      listeners.get('keyboardWillChangeFrame')?.({ endCoordinates: { screenY: 800, height: 300 } });
    });
    expect(insetText(tree)).toBe('inset:0');

    act(() => {
      listeners.get('keyboardWillShow')?.({ endCoordinates: { screenY: 500, height: 300 } });
      listeners.get('keyboardWillHide')?.();
    });
    expect(insetText(tree)).toBe('inset:0');
  });

  it('keeps the Android did* events and defensive frame math', () => {
    setPlatform('android');
    const listeners = new Map<string, (event?: any) => void>();
    vi.spyOn(Keyboard, 'addListener').mockImplementation((event: string, cb: any) => {
      listeners.set(event, cb);
      return { remove: vi.fn() } as any;
    });

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<CrossPlatformProbe active />);
    });

    expect(listeners.has('keyboardDidShow')).toBe(true);

    act(() => {
      listeners.get('keyboardDidShow')?.({ endCoordinates: { height: 320 } });
    });
    expect(insetText(tree)).toBe('inset:320');

    act(() => {
      listeners.get('keyboardDidHide')?.();
    });
    expect(insetText(tree)).toBe('inset:0');
  });

  it('stays at zero while inactive', () => {
    setPlatform('ios');
    const addListener = vi.spyOn(Keyboard, 'addListener');

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<CrossPlatformProbe active={false} />);
    });

    expect(addListener).not.toHaveBeenCalled();
    expect(insetText(tree)).toBe('inset:0');
  });
});
