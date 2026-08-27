import type { MobileQuickAccessView } from '@mindwtr/core';

import type { IconSymbol } from '@/components/ui/icon-symbol';
import { MOBILE_QUICK_ACCESS_STACK_ROUTE } from '@/lib/mobile-quick-access-view';

type IconSymbolName = Parameters<typeof IconSymbol>[0]['name'];
type Translate = (key: string) => string;

export type MoreDestination = {
  id: string;
  label: string;
  displayLabel?: string;
  icon: IconSymbolName;
  iconColor: string;
  route?: string;
  onPress?: () => void;
};

// The More sheet's primary tile list, kept out of `_layout.tsx` so the
// E-05 tdah-today tile's presence/absence is testable without mounting
// the whole tab bar.
export const MORE_SHEET_ICON_COLORS = {
  board: '#4F8CF7',
  review: '#22C55E',
  calendar: '#35B8B1',
  projects: '#10B981',
  contexts: '#8B5CF6',
  waiting: '#F2B705',
  someday: '#6366F1',
  reference: '#0EA5E9',
  done: '#22C55E',
  archived: '#64748B',
  trash: '#EF4444',
  settings: '#64748B',
  saved: '#4F8CF7',
  tdahToday: '#F97316',
  tdahRitual: '#8B5CF6',
  tdahLimbo: '#EAB308',
};

export function compactSlashLabel(label: string) {
  return label.split('/')[0]?.trim() || label;
}

export function buildMoreSheetPrimaryItems(options: {
  t: Translate;
  tdahModeActive: boolean;
  quickAccessView: MobileQuickAccessView;
}): MoreDestination[] {
  const { t, tdahModeActive, quickAccessView } = options;
  const quickAccessItems: Record<MobileQuickAccessView, MoreDestination> = {
    review: { id: 'review', label: t('nav.review'), icon: 'clipboard.fill', iconColor: MORE_SHEET_ICON_COLORS.review, route: MOBILE_QUICK_ACCESS_STACK_ROUTE.review },
    projects: { id: 'projects', label: t('nav.projects'), icon: 'folder.fill', iconColor: MORE_SHEET_ICON_COLORS.projects, route: MOBILE_QUICK_ACCESS_STACK_ROUTE.projects },
    calendar: { id: 'calendar', label: t('nav.calendar'), icon: 'calendar', iconColor: MORE_SHEET_ICON_COLORS.calendar, route: MOBILE_QUICK_ACCESS_STACK_ROUTE.calendar },
    contexts: { id: 'contexts', label: t('nav.contexts'), icon: 'circle', iconColor: MORE_SHEET_ICON_COLORS.contexts, route: MOBILE_QUICK_ACCESS_STACK_ROUTE.contexts },
  };
  const moreQuickAccessItem = (view: Exclude<MobileQuickAccessView, 'review'>) => (
    quickAccessView === view ? quickAccessItems.review : quickAccessItems[view]
  );
  // E-05: a guaranteed entry point to T-01, but only while the server
  // confirms ADHD mode is on — the tile disappears the moment it's off.
  return [
    { id: 'waiting', label: t('nav.waiting'), icon: 'pause.circle.fill', iconColor: MORE_SHEET_ICON_COLORS.waiting, route: '/waiting' },
    { id: 'board', label: t('nav.board'), icon: 'square.grid.2x2.fill', iconColor: MORE_SHEET_ICON_COLORS.board, route: '/board' },
    moreQuickAccessItem('projects'),
    {
      id: 'someday',
      label: t('nav.someday'),
      displayLabel: compactSlashLabel(t('nav.someday')),
      icon: 'arrow.up.circle.fill',
      iconColor: MORE_SHEET_ICON_COLORS.someday,
      route: '/someday',
    },
    moreQuickAccessItem('contexts'),
    moreQuickAccessItem('calendar'),
    ...(tdahModeActive ? [{
      id: 'tdah-today',
      label: t('nav.tdahToday'),
      icon: 'house.fill' as IconSymbolName,
      iconColor: MORE_SHEET_ICON_COLORS.tdahToday,
      route: '/tdah-today',
    }] : []),
    // Story 3.1 ("La invitación nocturna"): first of two manual-open entries
    // for T-05 (the other is T-01's header button) — same tdahModeActive
    // gate as the tdah-today tile above, since the ritual only exists while
    // Modo TDAH is on.
    ...(tdahModeActive ? [{
      id: 'tdah-ritual',
      label: t('nav.tdahRitual'),
      icon: 'moon.fill' as IconSymbolName,
      iconColor: MORE_SHEET_ICON_COLORS.tdahRitual,
      route: '/tdah-ritual',
    }] : []),
    // Story 3.4 (T-08, "El Limbo"): a guaranteed manual entry point into the
    // Limbo tray, same tdahModeActive gate as the two tiles above — the
    // other entry point is T-01's own limbo-badge (TdahTodayScreen.tsx).
    // `'circle'` (icon-symbol.tsx's own closed MAPPING, out of this story's
    // owned files — no 'circle.dashed' entry exists there to add without
    // touching it): the same plain-outline-circle concept
    // TdahStatusGlyph.tsx's lucide `CircleDashed` reads as for `limbo`, one
    // icon library removed (moon.fill's own doc comment above notes this is
    // an established convention here, not a literal shared asset).
    ...(tdahModeActive ? [{
      id: 'tdah-limbo',
      label: t('nav.tdahLimbo'),
      icon: 'circle' as IconSymbolName,
      iconColor: MORE_SHEET_ICON_COLORS.tdahLimbo,
      route: '/tdah-limbo',
    }] : []),
  ];
}
