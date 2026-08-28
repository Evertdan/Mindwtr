/**
 * T-09/T-10 (spec 3.5): shared, framework-free helpers for the period
 * selector and resolved-range label both `TdahHistoryView` and
 * `TdahMetricsView` use. Pure by design (no React, no i18n import) — the
 * same "hand-derived from the spec, kept in sync" convention
 * `TdahRoutinesListView.tsx` documents, since the server side of
 * `/v1/tdah/history` and `/v1/tdah/metrics` may land independently.
 *
 * `formatRangeLabel` is presentation-only: it never computes "today" or a
 * range boundary itself (AD note in spec-3-5 — "hoy" y los límites de cada
 * rango se calculan siempre en el servidor con `formatDateInTimeZone`). It
 * only formats the already-resolved `YYYY-MM-DD` strings the server returns
 * in a response's `range`/`period` field. `new Date('${iso}T00:00:00Z')` +
 * `timeZone: 'UTC'` is used purely to hand an already-fixed calendar date to
 * `Intl.DateTimeFormat` without letting the *device's* local time zone shift
 * it by a day — not a recomputation of the date itself.
 */

export type TdahHistoryMetricsPeriod = 'day' | 'week' | 'month' | 'custom';

export type TdahDateRange = { from: string; to: string };

export type TdahPeriodOption = { value: TdahHistoryMetricsPeriod; labelKey: string };

// Shared across both views' period selector — same i18n namespace either one
// resolves via its own `t()`.
export const TDAH_PERIOD_OPTIONS: TdahPeriodOption[] = [
    { value: 'day', labelKey: 'tdahPeriod.day' },
    { value: 'week', labelKey: 'tdahPeriod.week' },
    { value: 'month', labelKey: 'tdahPeriod.month' },
    { value: 'custom', labelKey: 'tdahPeriod.custom' },
];

export const TDAH_DEFAULT_PERIOD: TdahHistoryMetricsPeriod = 'day';

// Same span cap the server enforces (spec-3-5's "Always" list: "span máximo
// de 366 días"). Client-side validation here only prevents an obviously
// invalid request from ever being sent — the server's own 400
// `TDAH_INVALID_BODY` remains the authority.
export const TDAH_CUSTOM_RANGE_MAX_SPAN_DAYS = 366;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const parseIsoDateUtc = (value: string): Date | null => {
    if (!ISO_DATE_PATTERN.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
};

/** `from <= to` and the span between them is within the server's cap. */
export const isValidCustomPeriodRange = (from: string, to: string): boolean => {
    const fromDate = parseIsoDateUtc(from);
    const toDate = parseIsoDateUtc(to);
    if (!fromDate || !toDate) return false;
    if (fromDate.getTime() > toDate.getTime()) return false;
    const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
    return spanDays <= TDAH_CUSTOM_RANGE_MAX_SPAN_DAYS;
};

/**
 * A single `YYYY-MM-DD` server date rendered in the UI locale ("Aug 20, 2026").
 * Exported so every surface that prints one of these strings — the History
 * entry dates, the Metrics trend week starts, and `formatRangeLabel` below —
 * goes through the same formatter instead of leaking the raw ISO text next to
 * an Intl-formatted range label. Falls back to the raw value if it does not
 * parse, so a malformed server string degrades to text rather than throwing.
 */
export const formatIsoDate = (value: string, locale: string): string => {
    const date = parseIsoDateUtc(value);
    if (!date) return value;
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
};

/** "Aug 20, 2026" for a single-day range, "Aug 1, 2026 – Aug 20, 2026" otherwise. */
export const formatRangeLabel = (range: TdahDateRange, locale: string): string => {
    const from = formatIsoDate(range.from, locale);
    if (range.from === range.to) return from;
    return `${from} – ${formatIsoDate(range.to, locale)}`;
};
