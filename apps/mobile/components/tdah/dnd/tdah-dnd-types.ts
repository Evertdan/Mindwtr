/**
 * Wire-facing shapes for T-12 (story 4.3). Mirrors the `/v1/tdah/dnd*`
 * contracts by hand rather than importing apps/cloud/src/tdah/types.ts
 * (ADR 0026: clients talk to the HTTP surface, never to server-only types
 * across the wire boundary — same convention as tdah-today-types.ts).
 *
 * Everything here is **data the server already resolved**. In particular
 * `activeUntil` is the server's own answer to "is a window active right now,
 * and when does its contiguous block end", computed in the profile's time
 * zone — the client never recomputes it (AD-8).
 */

export const TDAH_DND_WINDOW_SOURCES = ['manual', 'calendar'] as const;
export type TdahDndWindowSource = (typeof TDAH_DND_WINDOW_SOURCES)[number];

export const TDAH_DND_WINDOW_KINDS = ['weekly', 'once'] as const;
export type TdahDndWindowKind = (typeof TDAH_DND_WINDOW_KINDS)[number];

/**
 * One quiet window. `weekdays` (0=Sunday … 6=Saturday, the same numbering
 * `Date.prototype.getUTCDay` uses) is non-null exactly for `kind: 'weekly'`;
 * `date` (`YYYY-MM-DD`) is non-null exactly for `kind: 'once'` — which is
 * also the shape every `source: 'calendar'` row takes, since the server
 * materializes a detected meeting as a one-off window on its local day.
 *
 * A `source: 'calendar'` row is read-only: the server answers 409
 * `TDAH_DND_READ_ONLY` to any edit or delete, so T-12 never offers those
 * affordances on one (it says the window refreshes from the calendar
 * instead).
 */
export type TdahDndWindow = {
    id: string;
    source: TdahDndWindowSource;
    kind: TdahDndWindowKind;
    weekdays: number[] | null;
    date: string | null;
    startTime: string;
    endTime: string;
    label: string | null;
};

/**
 * DND's own working hours — deliberately NOT the Origen Jira band's
 * (spec Design Notes: 4.3 is independent of 4.1 and cannot require a
 * connected Origen). Defaults 09:00–18:00, same as the server's.
 */
export type TdahDndSettings = {
    calendarEnabled: boolean;
    workStart: string;
    workEnd: string;
};

/** `GET /v1/tdah/dnd` response — returned bare, no wrapper. */
export type TdahDndResponse = {
    settings: TdahDndSettings;
    windows: TdahDndWindow[];
    /**
     * `HH:mm` when a window is active right now, `null` otherwise. The end of
     * the whole **contiguous block** of overlapping/adjacent windows, not of
     * the single window that happens to contain "now" — computed by the
     * server, rendered verbatim here and in T-01's chip.
     */
    activeUntil: string | null;
};

/** `POST /v1/tdah/dnd/windows` and `PUT /v1/tdah/dnd/windows/{id}` body. */
export type TdahDndWindowInput = {
    kind: TdahDndWindowKind;
    weekdays: number[] | null;
    date: string | null;
    startTime: string;
    endTime: string;
    label: string | null;
};

/** `PUT /v1/tdah/dnd` body — the settings half only, never the windows. */
export type TdahDndSettingsInput = TdahDndSettings;

/**
 * `PUT /v1/tdah/dnd/calendar` body. `events` are raw UTC ISO instants
 * straight from `collectBusyCalendarEvents` (AD-8) and `rangeStart`/
 * `rangeEnd` bound the block replacement the server performs over its
 * `source='calendar'` rows — manual windows are never touched by it.
 */
export type TdahDndCalendarSyncRequest = {
    rangeStart: string;
    rangeEnd: string;
    events: { startsAt: string; endsAt: string }[];
};

/** Mirrors TDAH_ERROR_CODES.dndInvalid/dndReadOnly/dndLimit in apps/cloud/src/tdah/types.ts. */
export const TDAH_DND_INVALID_CODE = 'TDAH_DND_INVALID';
export const TDAH_DND_READ_ONLY_CODE = 'TDAH_DND_READ_ONLY';
export const TDAH_DND_LIMIT_CODE = 'TDAH_DND_LIMIT';
