import { Platform } from 'react-native';
import * as Calendar from 'expo-calendar';
import { isMindwtrMirrorCalendar } from '@mindwtr/core';

import { getSystemCalendarPermissionStatus } from './external-calendar';

/**
 * Story 4.3 — the phone's calendar **observer** for DND (FR-12/AD-8).
 *
 * This module is deliberately the dumbest possible thing: it asks
 * `expo-calendar` for the busy events in an absolute instant range and hands
 * them back as raw UTC ISO instants. It performs **zero** policy:
 *
 * - no conversion to the profile's time zone (the device's zone can differ
 *   from `profile.timeZone`, which AD-6 makes editable),
 * - no clipping to working hours,
 * - no splitting at local midnight,
 * - no decision about whether a window is active or a notification is
 *   suppressed.
 *
 * All of that lives in exactly one place in the repo — the server's pure
 * `apps/cloud/src/tdah/dnd.ts` — which is what makes the AD-8 acceptance
 * criterion verifiable with a grep ("cero lógica de supresión en el
 * cliente"): the names of that module's predicates must not appear anywhere
 * under `apps/mobile`, this file included. A local copy of one would break
 * that property even if it happened to agree with the server today.
 */
export type TdahDndCalendarEvent = {
    /** Absolute instant, UTC ISO 8601 (`Date.prototype.toISOString`). */
    startsAt: string;
    /** Absolute instant, UTC ISO 8601. Always strictly after `startsAt`. */
    endsAt: string;
};

/**
 * Mirrors the server's own `TDAH_DND_MAX_CALENDAR_EVENTS` cap so a user with
 * a pathological calendar never posts an unbounded body the server would
 * only reject. The oldest-first slice is deliberate: a range that overflows
 * loses its far end, never the meetings about to start.
 */
export const TDAH_DND_MAX_CALENDAR_EVENTS = 200;

const toInstant = (value: unknown): Date | null => {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
};

const calendarTitleOf = (calendar: Calendar.Calendar): string => {
    const title = typeof calendar.title === 'string' ? calendar.title.trim() : '';
    if (title.length > 0) return title;
    return typeof calendar.name === 'string' ? calendar.name.trim() : '';
};

/**
 * `availability` and `status` are real `expo-calendar` fields, but the app's
 * own hand-written ambient declaration of the module
 * (`apps/mobile/types/native-modules.d.ts`, outside this story's owned files)
 * carries only the subset the rest of the app used until now. Read them
 * structurally against their documented string values rather than widening
 * that shared declaration for one caller.
 */
type CalendarBusySignals = {
    /** `'busy' | 'free' | 'tentative' | 'unavailable' | 'notSupported'`. */
    availability?: string;
    /** `'none' | 'confirmed' | 'tentative' | 'canceled'`. */
    status?: string;
};

/**
 * Mindwtr's own mirror calendar carries the user's GTD tasks, not meetings —
 * `external-calendar.ts` already excludes it from every read for the same
 * reason. Letting it through here would have the user's own todo list
 * silence their reminders.
 */
const isMirrorCalendar = (calendar: Calendar.Calendar): boolean => (
    isMindwtrMirrorCalendar({ name: calendarTitleOf(calendar) })
);

/**
 * "Busy" is read permissively: only an event the calendar explicitly marks
 * `free` (or one the user already cancelled) is dropped. Android frequently
 * reports no availability at all, and an ordinary meeting with no explicit
 * availability is exactly the case this feature exists for — treating an
 * unknown availability as free would silently disable DND on most Android
 * calendars.
 */
const isBusyEvent = (event: Calendar.Event & CalendarBusySignals): boolean => {
    if (event.allDay === true) return false;
    if (event.availability === 'free') return false;
    if (event.status === 'canceled') return false;
    return true;
};

/**
 * Reads the system calendars for every busy event overlapping
 * `[rangeStart, rangeEnd)` and returns their raw UTC instants, oldest first.
 *
 * Returns an empty list — never throws — when the platform has no calendars
 * (web/PWA) or the permission is not granted: a denied permission is a
 * legitimate choice that degrades T-12 to manual windows only, not an error
 * state (doc 06's "copy sin culpa").
 */
export async function collectBusyCalendarEvents(
    rangeStart: Date,
    rangeEnd: Date,
): Promise<TdahDndCalendarEvent[]> {
    if (Platform.OS === 'web') return [];
    if (rangeEnd.getTime() <= rangeStart.getTime()) return [];

    const permission = await getSystemCalendarPermissionStatus();
    if (permission !== 'granted') return [];

    try {
        const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const calendarIds = calendars
            .filter((calendar) => typeof calendar.id === 'string' && calendar.id.trim().length > 0)
            .filter((calendar) => !isMirrorCalendar(calendar))
            .map((calendar) => calendar.id);
        if (calendarIds.length === 0) return [];

        const rawEvents = await Calendar.getEventsAsync(calendarIds, rangeStart, rangeEnd);
        const events: TdahDndCalendarEvent[] = [];
        for (const event of rawEvents) {
            if (!isBusyEvent(event)) continue;
            const start = toInstant(event.startDate);
            const end = toInstant(event.endDate);
            // A zero-length or reversed event cannot silence anything; unlike
            // `fetchSystemCalendarEvents`, which invents a 1h end so the row
            // is still drawable, nothing here may fabricate a duration — an
            // invented end is an invented silence.
            if (!start || !end || end.getTime() <= start.getTime()) continue;
            events.push({ startsAt: start.toISOString(), endsAt: end.toISOString() });
        }

        events.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
        return events.slice(0, TDAH_DND_MAX_CALENDAR_EVENTS);
    } catch {
        // Never surface a raw calendar error: it can embed event titles and
        // account names (server policy's "nunca datos del calendario del
        // usuario en logs", applied to the client side of the same data).
        return [];
    }
}
