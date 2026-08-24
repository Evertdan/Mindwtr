import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { QuickAddPreviewEntry } from '@mindwtr/core';

import { CompactText } from '@/components/compact-text';
import type { ThemeColors } from '@/hooks/use-theme-colors';

// Two rows of chips at most on a phone; the rest collapse into a count so the
// strip never grows into the keyboard.
const MAX_VISIBLE_ENTRIES = 6;

type QuickAddPreviewProps = {
  entries: QuickAddPreviewEntry[];
  tc: ThemeColors;
};

/**
 * Passive read-out of what quick-add parsing found in the current draft. Not
 * touchable, takes no focus, and unmounts when the draft is a plain title, so
 * it can sit under a capture input without changing keyboard behaviour.
 */
export function QuickAddPreview({ entries, tc }: QuickAddPreviewProps) {
  if (entries.length === 0) return null;
  const visible = entries.slice(0, MAX_VISIBLE_ENTRIES);
  const overflow = entries.length - visible.length;

  return (
    <View
      style={styles.strip}
      // Un
      // equivalent in RN, and announcing on every keystroke would be worse than
      // letting VoiceOver reach the chips on demand.
      accessibilityLiveRegion="polite"
      testID="quick-add-preview"
    >
      {visible.map((entry) => {
        const warning = entry.tone === 'warning';
        const isTitle = entry.kind === 'title';
        return (
          <View
            key={entry.id}
            style={[
              styles.chip,
              {
                backgroundColor: warning ? `${tc.danger}1A` : tc.filterBg,
                borderColor: warning ? tc.danger : tc.border,
              },
            ]}
            // El/La
            // it changes on every keystroke; excluded from the live region so
            // TalkBack doesn't announce it on top of keystroke echo. Other chips
            // still announce normally. Stays in the same visual position either way.
            {...(isTitle ? { importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true } : null)}
          >
            {entry.label ? (
              <CompactText
                style={[styles.chipLabel, { color: warning ? tc.danger : tc.secondaryText }]}
                numberOfLines={1}
              >
                {entry.label}
              </CompactText>
            ) : null}
            <CompactText
              style={[styles.chipValue, { color: warning ? tc.danger : tc.text }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {entry.value}
            </CompactText>
          </View>
        );
      })}
      {overflow > 0 ? (
        <View style={[styles.chip, { backgroundColor: tc.filterBg, borderColor: tc.border }]}>
          <CompactText style={[styles.chipValue, { color: tc.secondaryText }]} numberOfLines={1}>
            {`+${overflow}`}
          </CompactText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 6,
    rowGap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    columnGap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipLabel: {
    fontSize: 11,
  },
  chipValue: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
  },
});
