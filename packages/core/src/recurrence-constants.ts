import type { RecurrenceWeekday } from './types';

export const WEEKDAY_ORDER: RecurrenceWeekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export const WEEKDAY_BUTTONS: { key: RecurrenceWeekday; label: string }[] = [
    { key: 'SU', label: 'S' },
    { key: 'MO', label: 'M' },
    { key: 'TU', label: 'T' },
    { key: 'WE', label: 'W' },
    { key: 'TH', label: 'T' },
    { key: 'FR', label: 'F' },
    { key: 'SA', label: 'S' },
];

export const WEEKDAY_FULL_LABELS: Record<RecurrenceWeekday, string> = {
    SU: 'Sunday',
    MO: 'Monday',
    TU: 'Tuesday',
    WE: 'Wednesday',
    TH: 'Thursday',
    FR: 'Friday',
    SA: 'Saturday',
};

export const MONTHLY_WEEKDAY_LABELS: Record<RecurrenceWeekday, string> = { ...WEEKDAY_FULL_LABELS };

type WeekdayLabelWidth = 'narrow' | 'short' | 'long';

const WEEKDAY_INDEX_MAP: Record<RecurrenceWeekday, number> = {
    SU: 0,
    MO: 1,
    TU: 2,
    WE: 3,
    TH: 4,
    FR: 5,
    SA: 6,
};

const WEEKDAY_SHORT_FALLBACK: Record<RecurrenceWeekday, string> = {
    SU: 'Sun',
    MO: 'Mon',
    TU: 'Tue',
    WE: 'Wed',
    TH: 'Thu',
    FR: 'Fri',
    SA: 'Sat',
};

const getWeekdayDate = (weekday: RecurrenceWeekday) =>
    new Date(2024, 0, 7 + WEEKDAY_INDEX_MAP[weekday], 12, 0, 0);

const getWeekdayFallbackLabel = (weekday: RecurrenceWeekday, width: WeekdayLabelWidth): string => {
    if (width === 'narrow') {
        return WEEKDAY_BUTTONS.find((day) => day.key === weekday)?.label ?? weekday;
    }
    if (width === 'short') {
        return WEEKDAY_SHORT_FALLBACK[weekday] ?? weekday;
    }
    return WEEKDAY_FULL_LABELS[weekday] ?? weekday;
};

export const getLocalizedWeekdayLabel = (
    weekday: RecurrenceWeekday,
    locale: string | undefined,
    width: WeekdayLabelWidth = 'long'
): string => {
    try {
        const formatter = new Intl.DateTimeFormat(locale || 'en', { weekday: width });
        return formatter.format(getWeekdayDate(weekday));
    } catch {
        return getWeekdayFallbackLabel(weekday, width);
    }
};

export const getLocalizedWeekdayLabels = (
    locale: string | undefined,
    width: WeekdayLabelWidth = 'long'
): Record<RecurrenceWeekday, string> => {
    return WEEKDAY_ORDER.reduce<Record<RecurrenceWeekday, string>>((acc, weekday) => {
        acc[weekday] = getLocalizedWeekdayLabel(weekday, locale, width);
        return acc;
    }, {} as Record<RecurrenceWeekday, string>);
};

export const getLocalizedWeekdayButtons = (
    locale: string | undefined,
    width: WeekdayLabelWidth = 'narrow'
): { key: RecurrenceWeekday; label: string }[] => {
    return WEEKDAY_ORDER.map((weekday) => ({
        key: weekday,
        label: getLocalizedWeekdayLabel(weekday, locale, width),
    }));
};
