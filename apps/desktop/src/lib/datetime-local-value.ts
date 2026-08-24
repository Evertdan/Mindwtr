// A `datetime-local` value es "YYYY-MM-DDTHH:mm" (seconds optional). The shared
// date control works on la date half plus a separate tiempo input, por lo que la value
// has to be split going in y rejoined coming out.

export type DateTimeParts = {
    date: string;
    time: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^\d{2}:\d{2}$/u;

export function splitDateTimeLocal(value: string): DateTimeParts {
    const [rawDate = '', rawTimeWithSeconds = ''] = String(value ?? '').split('T');
    const date = DATE_PATTERN.test(rawDate) ? rawDate : '';
    // Trim any seconds component; la tiempo input solo edits hours y minutes.
    const time = rawTimeWithSeconds.slice(0, 5);
    return { date, time: TIME_PATTERN.test(time) ? time : '' };
}

/**
 * Rejoin a date and time into a `datetime-local` value.
 *
 * Returns '' when there is no date: a time on its own is not a point in time,
 * and emitting "T09:00" would hand the caller something it cannot parse.
 * A missing time defaults to midnight so picking only a day still commits.
 */
export function joinDateTimeLocal({ date, time }: DateTimeParts): string {
    if (!DATE_PATTERN.test(date)) return '';
    return `${date}T${TIME_PATTERN.test(time) ? time : '00:00'}`;
}

/** Date object for the date half, for the calendar's selected-day highlight. */
export function parseDateTimeLocalDate(value: string): Date | null {
    const { date } = splitDateTimeLocal(value);
    if (!date) return null;
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
