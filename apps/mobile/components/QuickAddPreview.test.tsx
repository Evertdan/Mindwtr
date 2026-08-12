import React from 'react';
import { Text, View } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { buildQuickAddPreviewEntries, parseQuickAdd, type QuickAddPreviewEntry } from '@mindwtr/core';

import { QuickAddPreview } from './QuickAddPreview';

const tc = {
  border: '#333',
  danger: '#ef4444',
  filterBg: '#222',
  secondaryText: '#aaa',
  text: '#fff',
} as any;

const render = (entries: QuickAddPreviewEntry[]) => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<QuickAddPreview entries={entries} tc={tc} />);
  });
  return tree;
};

const texts = (tree: renderer.ReactTestRenderer) => (
  tree.root.findAllByType(Text).map((node) => node.props.children)
);

describe('QuickAddPreview', () => {
  it('renders nothing when the draft is a plain title', () => {
    const parsed = parseQuickAdd('call mom', [], new Date(2026, 7, 11, 9));
    const entries = buildQuickAddPreviewEntries(parsed, { t: (key) => key, rawInput: 'call mom' });
    expect(render(entries).toJSON()).toBeNull();
  });

  it('reads the parsed tokens out as chips', () => {
    const input = 'call mom @errands #family';
    const parsed = parseQuickAdd(input, [], new Date(2026, 7, 11, 9));
    const tree = render(buildQuickAddPreviewEntries(parsed, { t: (key) => key, rawInput: input }));

    expect(texts(tree)).toEqual(expect.arrayContaining(['@errands', '#family']));
    expect(tree.root.findByProps({ testID: 'quick-add-preview' }).props.accessibilityLiveRegion)
      .toBe('polite');
  });

  it('hides the title chip from the Android live region so per-keystroke text does not get announced', () => {
    const entries: QuickAddPreviewEntry[] = [
      { id: 'title', kind: 'title', label: 'Title', value: 'Call mom', tone: 'default' },
      { id: '@errands', kind: 'context', value: '@errands', tone: 'default' },
    ];
    const chips = render(entries).root.findAllByType(View)
      .filter((node) => node.props.importantForAccessibility !== undefined);

    expect(chips).toHaveLength(1);
    expect(chips[0].findAllByType(Text).map((node) => node.props.children)).toContain('Call mom');
    expect(chips[0].props.importantForAccessibility).toBe('no-hide-descendants');
    expect(chips[0].props.accessibilityElementsHidden).toBe(true);
  });

  it('collapses a long strip into a trailing count', () => {
    const entries: QuickAddPreviewEntry[] = Array.from({ length: 9 }, (_, index) => ({
      id: `#tag${index}`,
      kind: 'tag' as const,
      value: `#tag${index}`,
      tone: 'default' as const,
    }));
    const labels = texts(render(entries));
    expect(labels).toContain('#tag5');
    expect(labels).not.toContain('#tag6');
    expect(labels).toContain('+3');
  });
});
