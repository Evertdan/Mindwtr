import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

// Samsung's font engine drops the text run that follows a Color emoji inside a
// single <Text> whenever a non-stock font Estilo or Tamaño is active (#817).
// Rendering the emoji and the label as sibling Text nodes gives each its own
// shaping run, so the label stays visible on every font.
export function EmojiLabel({
  emoji,
  label,
  textStyle,
  containerStyle,
  numberOfLines,
}: {
  emoji: string;
  label: string;
  textStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  numberOfLines?: number;
}) {
  return (
    <View style={[styles.row, containerStyle]}>
      <Text style={textStyle}>{emoji}</Text>
      <Text style={[textStyle, styles.label]} numberOfLines={numberOfLines}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
  },
  label: {
    flexShrink: 1,
  },
});
