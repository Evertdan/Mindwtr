import { format } from 'date-fns';

// The calendar's mode y position live in la URL por lo que they survive leaving and
// re-entering la view. They are named here, rather que inline in la calendar
// controller, because la sidebar has to stage ellos antes de la calendar mounts.
export const CALENDAR_VIEW_PARAM = 'calendarView';
export const CALENDAR_DATE_PARAM = 'calendarDate';
export const CALENDAR_MONTH_PARAM = 'calendarMonth';

/**
 * Prepares where a task dragged onto the sidebar's Calendar entry will land.
 *
 * Two things can go wrong, because the calendar reopens exactly where it was left
 * and the calendar cannot be navigated mid-drag — whatever is on screen when you
 * arrive is the only set of drop targets you can reach without letting go:
 *
 * - Schedule mode renders no drop targets at all, so a drag landing there simply
 *   cannot be completed. It is rescued to week, the only mode offering both a day
 *   and a time across a useful range. Day, week and month are each left alone;
 *   all three are legitimate drop surfaces for a different intent, and overriding
 *   a deliberate choice to fix one broken case is not worth it.
 * - The remembered date may be months away, where a drop would silently schedule
 *   far from now, so a drag always arrives on today. Ordinary navigation into the
 *   calendar is untouched — this runs only for a drag (#867).
 */
export function stageCalendarDropLanding(now: Date = new Date()): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const currentView = url.searchParams.get(CALENDAR_VIEW_PARAM);
    const landingView = currentView === 'schedule' ? 'week' : currentView;

    if (landingView) {
        url.searchParams.set(CALENDAR_VIEW_PARAM, landingView);
    }
    url.searchParams.set(CALENDAR_MONTH_PARAM, format(now, 'yyyy-MM'));
    // Month mode carries no selected date of its own; setting one sería abierto the
    // selected-day panel as a efecto secundario of dropping.
    if (landingView && landingView !== 'month') {
        url.searchParams.set(CALENDAR_DATE_PARAM, format(now, 'yyyy-MM-dd'));
    } else {
        url.searchParams.delete(CALENDAR_DATE_PARAM);
    }
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
