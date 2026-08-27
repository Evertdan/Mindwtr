import { Ionicons } from '@expo/vector-icons';
import type { StyleProp, TextStyle } from 'react-native';

type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to emoji mappings here.
 */
const MAPPING = {
  'house.fill': 'home',
  'paperplane.fill': 'paper-plane',
  'chevron.left.forwardslash.chevron.right': 'code-slash',
  'chevron.right': 'chevron-forward',
  'tray.fill': 'file-tray',
  'arrow.right.circle.fill': 'arrow-forward-circle',
  'pause.circle.fill': 'pause-circle',
  'folder.fill': 'folder',
  'square.grid.2x2.fill': 'grid',
  'line.3.horizontal': 'menu',
  'calendar.fill': 'calendar',
  'calendar': 'calendar-outline',
  'checkmark.circle.fill': 'checkmark-circle',
  'clipboard.fill': 'clipboard',
  'circle': 'ellipse-outline',
  'arrow.up.circle.fill': 'arrow-up-circle',
  'book.closed.fill': 'book',
  'archivebox.fill': 'archive',
  'trash.fill': 'trash',
  'gearshape.fill': 'settings',
  'questionmark.circle.fill': 'help-circle',
  // Story 3.1 ("La invitación nocturna"): the More sheet's tdah-ritual tile
  // — same moon concept as T-01's header button for the same manual-open
  // action (instead of reusing the unrelated "done" checkmark), rendered
  // via Ionicons' own `moon` glyph in this file's icon system rather than
  // T-01's `lucide-react-native` Moon — two different icon libraries/art
  // styles, not a literal shared asset.
  'moon.fill': 'moon',
} as const;

/**
 * An icon component that uses emoji to avoid font loading issues.
 * Icon `name`s are based on SF Symbols and mapped to emoji.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
  weight: _weight,
}: {
  name: IconSymbolName;
  size?: number;
  color: string;
  style?: StyleProp<TextStyle>;
  weight?: string;
}) {
  return (
    <Ionicons
      name={MAPPING[name]}
      size={size}
      color={color}
      style={style}
    />
  );
}
