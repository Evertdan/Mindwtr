import { Platform } from 'react-native';
import type { MarkdownSelection } from '@mindwtr/core';

export function getControlledTextInputSelection(
  selection: MarkdownSelection,
  options?: { force?: boolean },
): MarkdownSelection | undefined {
  if (options?.force) return selection;
  // Un
  return Platform.OS === 'android' ? undefined : selection;
}
